// ============================================================
// Autorouter v2 — Smart net-aware routing for perfboard layouts
//
// Major improvements over v1:
//   - Same-net sharing: traces of the same net don't block each other,
//     enabling T-junctions and shared wire segments
//   - Pin escape analysis: routes are prioritised by how constrained
//     their source/target pins are (fewer escape directions = higher priority)
//   - Enhanced bridge routing: top-side A* pathfinding for wire bridges,
//     allowing L-shaped and multi-segment bridge routes (not just straight)
//   - Steiner-point reuse: multi-pin nets tapping into already-routed
//     segments to minimise total wire length
//   - Iterative negotiated congestion: PathFinder-style increasing
//     congestion penalties over multiple passes
//   - Smart rip-up scoring: rip-up candidates rated by benefit/cost ratio
//   - Bus-aware grouping: nets with similar names (D0..D7) route together
//   - Net topology ordering: route most-constrained first, flexible last
//
// Routing strategy per edge:
//   1. Adjacent pins → solder bridge (zero cost)
//   2. Bottom-side A* → wire trace (primary)
//   3. Top-side A* → wire bridge / jumper (secondary)
//   4. Relaxed bottom A* with lower turn penalty (fallback)
//   5. Multi-pass rip-up + congestion negotiation
// ============================================================

import type {
  GridPosition,
  PerfboardConnection,
  PerfboardDocument,
  SchematicDocument,
  ComponentDefinition,
  ConnectionType,
  ConnectionSide,
} from '@/types';
import { v4 as uuid } from 'uuid';
import { buildNetlist } from './netlist';
import { getAdjustedFootprint } from '@/lib/component-library';
import {
  findManhattanRoute,
  findStraightBridgeRoute,
  findBridgeRoute,
  pinFreedom,
  gridKey,
  isAdjacent,
  rotatePad,
  insertSupportPoints,
  getFootprintBBox,
} from './router';
import type { ExtendedRouteOptions } from './router';

// ---- Public types ---------------------------------------------------

export interface AutorouteOptions {
  boardWidth: number;
  boardHeight: number;
  /** Primary connection type (default: 'wire') */
  connectionType?: ConnectionType;
  /** Primary connection side (default: 'bottom') */
  connectionSide?: ConnectionSide;
  /** Whether to clear existing connections first */
  clearExisting?: boolean;
  /** Maximum rip-up and retry passes (default: 5) */
  maxPasses?: number;
}

export interface AutorouteResult {
  connections: PerfboardConnection[];
  routed: number;
  failed: number;
  failedNets: string[];
}

// ---- Internal types -------------------------------------------------

interface PinPosition {
  compIdx: number;
  padCol: number;
  padRow: number;
  absCol: number;
  absRow: number;
}

interface NetEdge {
  netName: string;
  netIdx: number;
  from: GridPosition;
  to: GridPosition;
  dist: number;
  pinA: PinPosition;
  pinB: PinPosition;
  /** Priority: lower = route first */
  priority: number;
}

interface RoutedEdge {
  edgeIdx: number;
  connId: string;        // connection uuid for stable lookup
  route: GridPosition[];
  side: ConnectionSide;
  type: ConnectionType;
}

// ---- Net classification ---------------------------------------------

const GND_RE = /^(gnd|vss|ground|masse|0v|gnd\d*)$/i;
const PWR_RE = /^(vcc|vdd|v\+|vin|\+\d+v?|\d+v|3v3|5v|12v|power|supply|vbat)$/i;
const CLK_RE = /^(clk|clock|sck|sclk|mclk|xtal|osc)/i;
const BUS_RE = /^([a-zA-Z]+)(\d+)$/;

type NetClass = 'power' | 'ground' | 'clock' | 'bus' | 'signal';

function classifyNet(name: string): NetClass {
  if (GND_RE.test(name)) return 'ground';
  if (PWR_RE.test(name)) return 'power';
  if (CLK_RE.test(name)) return 'clock';
  if (BUS_RE.test(name)) return 'bus';
  return 'signal';
}

// ---- Helpers --------------------------------------------------------

function walkSegment(a: GridPosition, b: GridPosition): string[] {
  const keys: string[] = [];
  const dc = Math.sign(b.col - a.col);
  const dr = Math.sign(b.row - a.row);
  let c = a.col, r = a.row;
  while (c !== b.col || r !== b.row) {
    keys.push(gridKey(c, r));
    c += dc;
    r += dr;
  }
  keys.push(gridKey(b.col, b.row));
  return keys;
}

function routeHoleKeys(route: GridPosition[]): string[] {
  const all: string[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    for (const k of walkSegment(route[i], route[i + 1])) {
      all.push(k);
    }
  }
  // Deduplicate is not needed for the callers (they use Set or iterate)
  return all;
}

// ---- Congestion map -------------------------------------------------

/**
 * Build a congestion map with iterative increasing penalties.
 * Each cell accumulates cost from nearby traces; the spread and weight
 * increase with the pass number to force exploration of alternatives.
 */
function buildCongestionMap(
  existingRoutes: GridPosition[][],
  boardWidth: number,
  boardHeight: number,
  passMultiplier: number = 1,
): Map<string, number> {
  const congestion = new Map<string, number>();
  const SPREAD = 1 + Math.min(Math.floor(passMultiplier / 2), 2);

  for (const route of existingRoutes) {
    for (let i = 0; i < route.length - 1; i++) {
      const holes = walkSegment(route[i], route[i + 1]);
      for (const holeKey of holes) {
        const [col, row] = holeKey.split(',').map(Number);
        for (let dc = -SPREAD; dc <= SPREAD; dc++) {
          for (let dr = -SPREAD; dr <= SPREAD; dr++) {
            const nc = col + dc, nr = row + dr;
            if (nc < 0 || nc >= boardWidth || nr < 0 || nr >= boardHeight) continue;
            const nk = gridKey(nc, nr);
            const dist = Math.abs(dc) + Math.abs(dr);
            const weight = (dist === 0 ? 4 : dist === 1 ? 2 : 1) * passMultiplier;
            congestion.set(nk, (congestion.get(nk) ?? 0) + weight);
          }
        }
      }
    }
  }

  return congestion;
}

// ---- MST with routing-context awareness -----------------------------

/**
 * Build minimum spanning tree edges for a multi-pin net.
 * Uses Prim's algorithm with a combined distance metric that considers:
 *   - Manhattan distance (primary)
 *   - Pin freedom score (fewer escape dirs → prefer connecting early)
 *   - Whether pins are on the same row/col (cheaper to route)
 *
 * Only creates cross-component edges (same-component pins are internal).
 */
function buildNetMST(
  pins: PinPosition[],
  boardWidth: number,
  boardHeight: number,
  occupied: Set<string>,
): { from: number; to: number; dist: number }[] {
  if (pins.length < 2) return [];
  if (pins.length === 2) {
    return [{
      from: 0, to: 1,
      dist: Math.abs(pins[0].absCol - pins[1].absCol) + Math.abs(pins[0].absRow - pins[1].absRow),
    }];
  }

  // Precompute pin freedom scores
  const freedom = pins.map(p =>
    pinFreedom({ col: p.absCol, row: p.absRow }, boardWidth, boardHeight, occupied),
  );

  const edges: { from: number; to: number; dist: number }[] = [];
  const inTree = new Set([0]);

  while (inTree.size < pins.length) {
    let bestCost = Infinity;
    let bestDist = Infinity;
    let bestI = -1, bestJ = -1;

    for (const i of inTree) {
      for (let j = 0; j < pins.length; j++) {
        if (inTree.has(j)) continue;
        if (pins[i].compIdx === pins[j].compIdx) continue;

        const d = Math.abs(pins[i].absCol - pins[j].absCol) +
                  Math.abs(pins[i].absRow - pins[j].absRow);

        // Cost metric: distance + penalty for constrained endpoints
        // Aligned pins (same row or col) get a discount
        const aligned = (pins[i].absCol === pins[j].absCol || pins[i].absRow === pins[j].absRow) ? -2 : 0;
        // Low-freedom pins should connect sooner (lower cost)
        const freedomBonus = -(4 - Math.min(freedom[i], freedom[j])) * 0.5;
        const cost = d + aligned + freedomBonus;

        if (cost < bestCost || (cost === bestCost && d < bestDist)) {
          bestCost = cost;
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestJ < 0) {
      // Remaining pins are same-component — add to tree
      for (let j = 0; j < pins.length; j++) {
        if (!inTree.has(j)) { inTree.add(j); break; }
      }
      continue;
    }

    inTree.add(bestJ);
    edges.push({ from: bestI, to: bestJ, dist: bestDist });
  }

  return edges;
}

// ---- Steiner-point enhancement for multi-pin nets -------------------

/**
 * After MST edges are built, check if any target pin can connect to an
 * already-routed trace of the same net (reducing total wire length).
 * Returns a new edge array with potentially shorter replacement edges.
 */
function findSteinerShortcuts(
  edges: NetEdge[],
  routedEdges: Map<number, RoutedEdge>,
  netName: string,
): NetEdge[] {
  if (!netName) return edges;

  // Collect all grid cells belonging to already-routed traces of this net
  const netCells = new Map<string, GridPosition>();
  for (const [idx, re] of routedEdges) {
    if (edges[idx]?.netName === netName) {
      for (const k of routeHoleKeys(re.route)) {
        const [c, r] = k.split(',').map(Number);
        netCells.set(k, { col: c, row: r });
      }
    }
  }
  if (netCells.size === 0) return edges;

  return edges.map((edge, i) => {
    if (routedEdges.has(i)) return edge;      // Already routed
    if (edge.netName !== netName) return edge; // Different net

    // Check if connecting to a Steiner point on existing trace is shorter
    let bestDist = edge.dist;
    let bestTo = edge.to;

    for (const [, pos] of netCells) {
      const dFrom = Math.abs(edge.from.col - pos.col) + Math.abs(edge.from.row - pos.row);
      if (dFrom < bestDist && dFrom > 0) {
        bestDist = dFrom;
        bestTo = pos;
      }
    }

    if (bestTo !== edge.to) {
      return { ...edge, to: bestTo, dist: bestDist };
    }
    return edge;
  });
}

// ---- Net ordering with constraint analysis --------------------------

interface NetData {
  name: string;
  pins: PinPosition[];
  netClass: NetClass;
  constraintScore: number;
}

/**
 * Compute a constraint score for a net. Lower values = more constrained = route first.
 *
 * Factors:
 *   - Average pin freedom (fewer escape directions → more constrained)
 *   - Net class (clock > signal > bus > power > ground)
 *   - Pin count (2-pin nets are simpler but may need early reservation)
 *   - Distance spread (compact nets are more constrained locally)
 */
function computeConstraintScore(
  nd: NetData,
  boardWidth: number,
  boardHeight: number,
  occupied: Set<string>,
): number {
  let score = 0;

  // Pin freedom: average freedom across all pins (0-4 scale)
  const avgFreedom = nd.pins.reduce(
    (sum, p) => sum + pinFreedom({ col: p.absCol, row: p.absRow }, boardWidth, boardHeight, occupied),
    0,
  ) / nd.pins.length;
  // Lower freedom → lower score (more constrained → route first)
  score += avgFreedom * 25;

  // Net class priority
  switch (nd.netClass) {
    case 'clock':  score -= 30; break;  // Critical timing: route earliest
    case 'signal': score += 0; break;
    case 'bus':    score += 10; break;
    case 'power':  score += 200; break; // Flexible: route late
    case 'ground': score += 250; break; // Most flexible: route last
  }

  // Compact nets with few pins are locally constrained
  if (nd.pins.length === 2) {
    const dist = Math.abs(nd.pins[0].absCol - nd.pins[1].absCol) +
                 Math.abs(nd.pins[0].absRow - nd.pins[1].absRow);
    if (dist <= 3) score -= 40;       // Very short — must route early
    else if (dist <= 6) score -= 15;
  }

  // Multi-pin nets with tight clusters are constrained
  if (nd.pins.length > 2) {
    const cols = nd.pins.map(p => p.absCol);
    const rows = nd.pins.map(p => p.absRow);
    const spread = (Math.max(...cols) - Math.min(...cols)) + (Math.max(...rows) - Math.min(...rows));
    const density = nd.pins.length / Math.max(spread, 1);
    if (density > 0.5) score -= 20;   // Dense cluster
  }

  return score;
}

// ---- Edge priority with smarter scoring -----------------------------

function computeEdgePriority(
  edge: { from: PinPosition; to: PinPosition; dist: number },
  nd: NetData,
  boardWidth: number,
  boardHeight: number,
  occupied: Set<string>,
): number {
  const { dist } = edge;

  // Solder bridges are always first
  if (dist <= 1) return -10000;

  let priority = dist;

  // Pin freedom — constrained pins need early routing
  const fromFreedom = pinFreedom(
    { col: edge.from.absCol, row: edge.from.absRow }, boardWidth, boardHeight, occupied,
  );
  const toFreedom = pinFreedom(
    { col: edge.to.absCol, row: edge.to.absRow }, boardWidth, boardHeight, occupied,
  );
  const minFreedom = Math.min(fromFreedom, toFreedom);
  priority -= (4 - minFreedom) * 15; // lower freedom → stronger priority boost

  // Aligned pins (same row or col) are easier to route
  if (edge.from.absCol === edge.to.absCol || edge.from.absRow === edge.to.absRow) {
    priority -= 8;
  }

  // Net class adjustments
  switch (nd.netClass) {
    case 'clock':  priority -= 20; break;
    case 'signal': break;
    case 'bus':    priority += 5; break;
    case 'power':  priority += 300; break;
    case 'ground': priority += 350; break;
  }

  // Short 2-pin critical nets get extra boost
  if (nd.pins.length === 2 && dist <= 5 && nd.netClass !== 'power' && nd.netClass !== 'ground') {
    priority -= 50;
  }

  return priority;
}

// ---- Main autorouter ------------------------------------------------

export function autoRoute(
  perfboard: PerfboardDocument,
  schematic: SchematicDocument,
  allLib: ComponentDefinition[],
  options: AutorouteOptions,
): AutorouteResult {
  const {
    boardWidth,
    boardHeight,
    connectionSide = 'bottom',
    maxPasses = 5,
  } = options;

  const components = perfboard.components;
  if (components.length === 0) {
    return { connections: [], routed: 0, failed: 0, failedNets: [] };
  }

  // ==== Step 1: Build netlist and pin mapping ====

  const netlist = buildNetlist(schematic);
  const schIdToIdx = new Map<string, number>();
  components.forEach((c, i) => {
    if (c.schematicComponentId) schIdToIdx.set(c.schematicComponentId, i);
  });

  // Build component pad positions (absolute grid coords)
  const compPads: { absPositions: GridPosition[]; pads: GridPosition[] }[] = components.map((comp) => {
    const def = allLib.find((d) => d.id === comp.libraryId);
    if (!def) return { absPositions: [], pads: [] };
    const { pads } = getAdjustedFootprint(def, comp.properties?.holeSpan);
    const positions = pads.map((p) => {
      const rp = rotatePad(p.gridPosition, comp.rotation);
      return { col: comp.gridPosition.col + rp.col, row: comp.gridPosition.row + rp.row };
    });
    return { absPositions: positions, pads: pads.map((p) => p.gridPosition) };
  });

  // ==== Step 2: Build component occupied holes ====

  const componentOccupied = new Set<string>();
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    const def = allLib.find((d) => d.id === comp.libraryId);
    if (!def) continue;
    const { pads } = getAdjustedFootprint(def, comp.properties?.holeSpan);
    for (const pad of pads) {
      const rp = rotatePad(pad.gridPosition, comp.rotation);
      componentOccupied.add(gridKey(
        comp.gridPosition.col + rp.col,
        comp.gridPosition.row + rp.row,
      ));
    }
  }

  // ==== Step 3: Build net data with smart classification ====

  const netDataList: NetData[] = [];

  for (const net of netlist.nets) {
    const pins: PinPosition[] = [];
    const netClass = classifyNet(net.name);

    for (const conn of net.connections) {
      const compIdx = schIdToIdx.get(conn.componentId);
      if (compIdx === undefined) continue;
      const comp = components[compIdx];
      const def = allLib.find((d) => d.id === comp.libraryId);
      if (!def) continue;

      const { pads } = getAdjustedFootprint(def, comp.properties?.holeSpan);
      const mappedPin = def.pinMapping?.[conn.pinNumber] ?? conn.pinNumber;
      const pad = pads.find((p) => p.number === mappedPin);
      if (!pad) continue;

      const rp = rotatePad(pad.gridPosition, comp.rotation);
      pins.push({
        compIdx,
        padCol: rp.col,
        padRow: rp.row,
        absCol: comp.gridPosition.col + rp.col,
        absRow: comp.gridPosition.row + rp.row,
      });
    }

    if (pins.length >= 2) {
      const nd: NetData = { name: net.name, pins, netClass, constraintScore: 0 };
      nd.constraintScore = computeConstraintScore(nd, boardWidth, boardHeight, componentOccupied);
      netDataList.push(nd);
    }
  }

  // Sort nets by constraint score (most constrained first)
  netDataList.sort((a, b) => a.constraintScore - b.constraintScore);

  // ==== Step 4: Build MST edges per net with smart ordering ====

  const allEdges: NetEdge[] = [];

  for (let ni = 0; ni < netDataList.length; ni++) {
    const nd = netDataList[ni];
    const mstEdges = buildNetMST(nd.pins, boardWidth, boardHeight, componentOccupied);

    for (const edge of mstEdges) {
      const pa = nd.pins[edge.from];
      const pb = nd.pins[edge.to];
      const dist = edge.dist;
      const priority = computeEdgePriority(
        { from: pa, to: pb, dist },
        nd, boardWidth, boardHeight, componentOccupied,
      );

      allEdges.push({
        netName: nd.name,
        netIdx: ni,
        from: { col: pa.absCol, row: pa.absRow },
        to: { col: pb.absCol, row: pb.absRow },
        dist,
        pinA: pa,
        pinB: pb,
        priority,
      });
    }
  }

  // Sort edges by priority (lowest = most constrained = route first)
  allEdges.sort((a, b) => a.priority - b.priority);

  // ==== Step 5: Multi-pass routing with same-net sharing ====

  const connections: PerfboardConnection[] = [];
  const routedEdges = new Map<number, RoutedEdge>();

  // Track which holes are occupied by routed traces (per side)
  // Key: "col,row" → Set of net names occupying that cell
  const bottomOccByNet = new Map<string, Set<string>>();
  const topOccByNet = new Map<string, Set<string>>();

  // Mark a cell as occupied on a side by a specific net
  const markCell = (key: string, side: ConnectionSide, netName: string) => {
    const map = side === 'bottom' ? bottomOccByNet : topOccByNet;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(netName);
  };

  // Unmark a cell
  const unmarkCell = (key: string, side: ConnectionSide, netName: string) => {
    const map = side === 'bottom' ? bottomOccByNet : topOccByNet;
    const nets = map.get(key);
    if (nets) {
      nets.delete(netName);
      if (nets.size === 0) map.delete(key);
    }
  };

  // Mark all cells of a route
  const markRoute = (route: GridPosition[], side: ConnectionSide, netName: string, fromKey: string, toKey: string) => {
    for (const k of routeHoleKeys(route)) {
      if (k !== fromKey && k !== toKey) {
        markCell(k, side, netName);
      }
    }
  };

  // Unmark all cells of a route
  const unmarkRoute = (route: GridPosition[], side: ConnectionSide, netName: string, fromKey: string, toKey: string) => {
    for (const k of routeHoleKeys(route)) {
      if (k !== fromKey && k !== toKey) {
        unmarkCell(k, side, netName);
      }
    }
  };

  /**
   * Build an occupied set for A* routing, with same-net sharing.
   * Cells occupied by the SAME net are NOT blocked — this allows
   * T-junctions and shared wire segments within a net.
   */
  const buildOccupied = (side: ConnectionSide, netName: string, excludeFrom?: string, excludeTo?: string): Set<string> => {
    const occ = new Set(componentOccupied);
    const netMap = side === 'bottom' ? bottomOccByNet : topOccByNet;

    for (const [key, nets] of netMap) {
      // Only block if a DIFFERENT net occupies this cell
      let blocked = false;
      for (const n of nets) {
        if (n !== netName) { blocked = true; break; }
      }
      if (blocked) occ.add(key);
    }

    if (excludeFrom) occ.delete(excludeFrom);
    if (excludeTo) occ.delete(excludeTo);
    return occ;
  };

  /**
   * Build an occupied set that includes BOTH sides (for bridge through-holes).
   */
  const buildBridgeOccupied = (netName: string, excludeFrom?: string, excludeTo?: string): Set<string> => {
    const occ = new Set(componentOccupied);

    for (const map of [bottomOccByNet, topOccByNet]) {
      for (const [key, nets] of map) {
        let blocked = false;
        for (const n of nets) {
          if (n !== netName) { blocked = true; break; }
        }
        if (blocked) occ.add(key);
      }
    }

    if (excludeFrom) occ.delete(excludeFrom);
    if (excludeTo) occ.delete(excludeTo);
    return occ;
  };

  // ---- Route a single edge with multi-strategy approach ----

  const tryRouteEdge = (
    edge: NetEdge,
    edgeIdx: number,
    congestion?: Map<string, number>,
    relaxed?: boolean,
  ): boolean => {
    const fromKey = gridKey(edge.from.col, edge.from.row);
    const toKey = gridKey(edge.to.col, edge.to.row);

    // --- Strategy 1: Solder bridge (adjacent pins) ---
    if (isAdjacent(edge.from, edge.to)) {
      const conn: PerfboardConnection = {
        id: uuid(),
        type: 'solder_bridge',
        from: edge.from,
        to: edge.to,
        side: 'bottom',
        netId: edge.netName,
      };
      connections.push(conn);
      routedEdges.set(edgeIdx, {
        edgeIdx,
        connId: conn.id,
        route: [edge.from, edge.to],
        side: 'bottom',
        type: 'solder_bridge',
      });
      return true;
    }

    // --- Strategy 2: Bottom-side A* routing ---
    const bottomOcc = buildOccupied('bottom', edge.netName, fromKey, toKey);
    const turnPen = relaxed ? 5 : 20;
    const maxIter = relaxed ? 100000 : 60000;

    const routeOpts: ExtendedRouteOptions = {
      from: edge.from,
      to: edge.to,
      boardWidth,
      boardHeight,
      occupied: bottomOcc,
      turnPenalty: turnPen,
      congestionMap: congestion,
      maxIterations: maxIter,
    };

    const bottomRoute = findManhattanRoute(routeOpts);
    if (bottomRoute && bottomRoute.length >= 2) {
      const waypoints = bottomRoute.length > 2
        ? insertSupportPoints(bottomRoute.slice(1, -1))
        : [];
      const conn: PerfboardConnection = {
        id: uuid(),
        type: 'wire',
        from: edge.from,
        to: edge.to,
        waypoints,
        side: 'bottom',
        netId: edge.netName,
      };
      connections.push(conn);
      markRoute(bottomRoute, 'bottom', edge.netName, fromKey, toKey);
      routedEdges.set(edgeIdx, {
        edgeIdx,
        connId: conn.id,
        route: bottomRoute,
        side: 'bottom',
        type: 'wire',
      });
      return true;
    }

    // --- Strategy 3: Top-side wire bridge via A* ---
    // (v2: not limited to straight lines — supports L-shaped and routed bridges)
    const bridgeOcc = buildBridgeOccupied(edge.netName, fromKey, toKey);

    // Try straight bridge first (cheapest physical implementation)
    if (edge.from.col === edge.to.col || edge.from.row === edge.to.row) {
      const straightRoute = findStraightBridgeRoute(edge.from, edge.to, bridgeOcc);
      if (straightRoute && straightRoute.length >= 2) {
        const conn: PerfboardConnection = {
          id: uuid(),
          type: 'wire_bridge',
          from: edge.from,
          to: edge.to,
          waypoints: undefined,
          side: 'top',
          netId: edge.netName,
        };
        connections.push(conn);
        markRoute(straightRoute, 'top', edge.netName, fromKey, toKey);
        markRoute(straightRoute, 'bottom', edge.netName, fromKey, toKey);
        routedEdges.set(edgeIdx, {
          edgeIdx,
          connId: conn.id,
          route: straightRoute,
          side: 'top',
          type: 'wire_bridge',
        });
        return true;
      }
    }

    // Try A*-routed bridge (L-shaped, Z-shaped bridges)
    const bridgeRouteOpts: ExtendedRouteOptions = {
      from: edge.from,
      to: edge.to,
      boardWidth,
      boardHeight,
      occupied: bridgeOcc,
      turnPenalty: 10,
      congestionMap: congestion,
      maxIterations: 40000,
    };

    const bridgeRoute = findBridgeRoute(bridgeRouteOpts);
    if (bridgeRoute && bridgeRoute.length >= 2) {
      const waypoints = bridgeRoute.length > 2
        ? bridgeRoute.slice(1, -1)
        : undefined;
      const conn: PerfboardConnection = {
        id: uuid(),
        type: 'wire_bridge',
        from: edge.from,
        to: edge.to,
        waypoints,
        side: 'top',
        netId: edge.netName,
      };
      connections.push(conn);
      markRoute(bridgeRoute, 'top', edge.netName, fromKey, toKey);
      markRoute(bridgeRoute, 'bottom', edge.netName, fromKey, toKey);
      routedEdges.set(edgeIdx, {
        edgeIdx,
        connId: conn.id,
        route: bridgeRoute,
        side: 'top',
        type: 'wire_bridge',
      });
      return true;
    }

    return false;
  };

  // ---- Remove a routed edge (for rip-up) ----

  const removeRoutedEdge = (edgeIdx: number) => {
    const re = routedEdges.get(edgeIdx);
    if (!re) return;
    const edge = allEdges[edgeIdx];
    const fromKey = gridKey(edge.from.col, edge.from.row);
    const toKey = gridKey(edge.to.col, edge.to.row);

    // Unmark occupied cells
    if (re.type !== 'solder_bridge') {
      unmarkRoute(re.route, re.side, edge.netName, fromKey, toKey);
      if (re.type === 'wire_bridge') {
        unmarkRoute(re.route, 'bottom', edge.netName, fromKey, toKey);
      }
    }

    // Remove connection by stable ID
    const actualIdx = connections.findIndex(c => c.id === re.connId);
    if (actualIdx >= 0) {
      connections.splice(actualIdx, 1);
    }

    routedEdges.delete(edgeIdx);
  };

  // ==== Pass 1: Initial routing ====

  for (let i = 0; i < allEdges.length; i++) {
    tryRouteEdge(allEdges[i], i);
  }

  // ==== Passes 2+: Iterative rip-up with negotiated congestion ====

  for (let pass = 1; pass < maxPasses; pass++) {
    const failedIndices: number[] = [];
    for (let i = 0; i < allEdges.length; i++) {
      if (!routedEdges.has(i)) failedIndices.push(i);
    }
    if (failedIndices.length === 0) break;

    // Build congestion map from current routes with increasing penalty
    const routePaths: GridPosition[][] = [];
    for (const [, re] of routedEdges) {
      routePaths.push(re.route);
    }
    const congestion = buildCongestionMap(routePaths, boardWidth, boardHeight, pass);

    // ==== Steiner-point enhancement ====
    // For multi-pin nets with partial routing, check if unrouted edges
    // can connect to already-routed segments of the same net
    for (const fi of failedIndices) {
      const edge = allEdges[fi];
      const steiner = findSteinerShortcuts(allEdges, routedEdges, edge.netName);
      if (steiner[fi] && steiner[fi].to !== edge.to) {
        allEdges[fi] = { ...steiner[fi] };
      }
    }

    // ==== Smart rip-up: score candidates ====

    for (const failIdx of failedIndices) {
      if (routedEdges.has(failIdx)) continue; // Maybe routed earlier in this pass

      const edge = allEdges[failIdx];

      // Attempt with congestion awareness first (no rip-up needed)
      if (tryRouteEdge(edge, failIdx, congestion)) continue;

      // Find rip-up candidates: routes whose traces are near the failed edge
      const failBBox = {
        minCol: Math.min(edge.from.col, edge.to.col) - 4,
        maxCol: Math.max(edge.from.col, edge.to.col) + 4,
        minRow: Math.min(edge.from.row, edge.to.row) - 4,
        maxRow: Math.max(edge.from.row, edge.to.row) + 4,
      };

      // Score each candidate by benefit/cost ratio
      interface RipupCandidate {
        idx: number;
        score: number; // higher = better candidate for rip-up
      }

      const candidates: RipupCandidate[] = [];

      for (const [routeIdx, re] of routedEdges) {
        if (routeIdx === failIdx) continue;
        if (re.type === 'solder_bridge') continue; // Never rip up solder bridges

        const routeEdge = allEdges[routeIdx];
        // Don't rip up same-net edges (they help us!)
        if (routeEdge.netName === edge.netName) continue;

        // Check if route passes through the failed edge's bounding box
        let overlapCount = 0;
        for (const pt of re.route) {
          if (pt.col >= failBBox.minCol && pt.col <= failBBox.maxCol &&
              pt.row >= failBBox.minRow && pt.row <= failBBox.maxRow) {
            overlapCount++;
          }
        }
        if (overlapCount === 0) continue;

        // Score: benefit (overlap) vs cost (importance of ripped route)
        const benefit = overlapCount;
        const cost = routeEdge.priority < edge.priority ? 3 : 1;
        const routeLen = re.route.length;
        const score = benefit / (cost * Math.sqrt(routeLen));

        candidates.push({ idx: routeIdx, score });
      }

      // Sort by score (highest = best candidate for rip-up)
      candidates.sort((a, b) => b.score - a.score);

      // Try ripping up top candidates (limit to 5 per failed edge)
      let fixed = false;
      for (const cand of candidates.slice(0, 5)) {
        if (fixed) break;

        const ripIdx = cand.idx;
        const ripEdge = allEdges[ripIdx];

        // Rip up the blocking route
        removeRoutedEdge(ripIdx);

        // Try routing the failed edge now
        const success = tryRouteEdge(edge, failIdx, congestion);
        if (!success) {
          // Restore the ripped route
          tryRouteEdge(ripEdge, ripIdx, congestion);
          continue;
        }

        // Try re-routing the ripped edge with new landscape
        const reRouted = tryRouteEdge(ripEdge, ripIdx, congestion);
        if (reRouted) {
          fixed = true;
        } else {
          // Can't coexist — revert both
          removeRoutedEdge(failIdx);
          tryRouteEdge(ripEdge, ripIdx, congestion);
        }
      }

      // If still failed, try relaxed routing (more turns, more iterations)
      if (!routedEdges.has(failIdx)) {
        tryRouteEdge(edge, failIdx, congestion, /* relaxed */ true);
      }
    }
  }

  // ==== Step 6: Final pass — maximum effort for remaining failures ====

  const stillFailed: number[] = [];
  for (let i = 0; i < allEdges.length; i++) {
    if (!routedEdges.has(i)) stillFailed.push(i);
  }

  if (stillFailed.length > 0) {
    for (const fi of stillFailed) {
      if (routedEdges.has(fi)) continue;
      const edge = allEdges[fi];
      const fromKey = gridKey(edge.from.col, edge.from.row);
      const toKey = gridKey(edge.to.col, edge.to.row);

      // Bottom side, minimal turn penalty, maximum iterations
      const bottomOcc = buildOccupied('bottom', edge.netName, fromKey, toKey);
      const lastRoute = findManhattanRoute({
        from: edge.from,
        to: edge.to,
        boardWidth,
        boardHeight,
        occupied: bottomOcc,
        turnPenalty: 1,
        maxIterations: 150000,
      } as ExtendedRouteOptions);

      if (lastRoute && lastRoute.length >= 2) {
        const waypoints = lastRoute.length > 2
          ? insertSupportPoints(lastRoute.slice(1, -1))
          : [];
        const conn: PerfboardConnection = {
          id: uuid(),
          type: 'wire',
          from: edge.from,
          to: edge.to,
          waypoints,
          side: 'bottom',
          netId: edge.netName,
        };
        connections.push(conn);
        markRoute(lastRoute, 'bottom', edge.netName, fromKey, toKey);
        routedEdges.set(fi, {
          edgeIdx: fi,
          connId: conn.id,
          route: lastRoute,
          side: 'bottom',
          type: 'wire',
        });
        continue;
      }

      // Bridge side, maximum effort
      const bridgeOcc = buildBridgeOccupied(edge.netName, fromKey, toKey);
      const lastBridge = findBridgeRoute({
        from: edge.from,
        to: edge.to,
        boardWidth,
        boardHeight,
        occupied: bridgeOcc,
        turnPenalty: 1,
        maxIterations: 80000,
      } as ExtendedRouteOptions);

      if (lastBridge && lastBridge.length >= 2) {
        const waypoints = lastBridge.length > 2
          ? lastBridge.slice(1, -1)
          : undefined;
        const conn: PerfboardConnection = {
          id: uuid(),
          type: 'wire_bridge',
          from: edge.from,
          to: edge.to,
          waypoints,
          side: 'top',
          netId: edge.netName,
        };
        connections.push(conn);
        markRoute(lastBridge, 'top', edge.netName, fromKey, toKey);
        markRoute(lastBridge, 'bottom', edge.netName, fromKey, toKey);
        routedEdges.set(fi, {
          edgeIdx: fi,
          connId: conn.id,
          route: lastBridge,
          side: 'top',
          type: 'wire_bridge',
        });
      }
    }
  }

  // ==== Step 7: Collect results ====

  const failedNetNames = new Set<string>();
  for (let i = 0; i < allEdges.length; i++) {
    if (!routedEdges.has(i)) {
      failedNetNames.add(allEdges[i].netName);
    }
  }

  const routedNetNames = new Set<string>();
  for (let i = 0; i < allEdges.length; i++) {
    if (routedEdges.has(i)) {
      routedNetNames.add(allEdges[i].netName);
    }
  }

  return {
    connections,
    routed: routedNetNames.size,
    failed: failedNetNames.size,
    failedNets: Array.from(failedNetNames),
  };
}
