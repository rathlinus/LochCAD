// ============================================================
// Autorouter — Automatic net routing for perfboard layouts
//
// Strategy:
//   1. Build netlist and map schematic pins → perfboard pad positions
//   2. Build MST (minimum spanning tree) edges for each net
//   3. Order edges: solder bridges first, then short→long
//   4. Route each edge with multi-strategy approach:
//      a. Adjacent pins → solder bridge (zero cost)
//      b. Bottom-side A* → wire trace
//      c. Top-side A* → wire bridge (jumper)
//   5. Multi-pass rip-up and retry for failed nets
//   6. Congestion-aware re-routing to spread traces
//
// The router uses both board sides:
//   - Bottom (solder side): primary routing with copper traces
//   - Top (component side): wire bridges for crossing traces
//
// Net ordering heuristic:
//   - Power/GND nets route last (they're long, flexible)
//   - Short critical nets route first (least alternatives)
//   - Multi-pin nets get MST decomposition
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
  /** Maximum rip-up and retry passes (default: 3) */
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
  /** Priority: lower = route first. Short critical nets first. */
  priority: number;
}

// ---- Classification regexes -----------------------------------------

const GND_RE = /^(gnd|vss|ground|masse|0v|gnd\d*)$/i;
const PWR_RE = /^(vcc|vdd|v\+|vin|\+\d+v?|\d+v|3v3|5v|12v|power|supply|vbat)$/i;

// ---- Helper: walk segment and collect all intermediate hole keys -----

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

// ---- Congestion map builder -----------------------------------------

/**
 * Build a congestion map: for each grid cell, count how many route traces
 * pass through or near that cell. Cells near traces get higher cost.
 */
function buildCongestionMap(
  existingRoutes: GridPosition[][],
  boardWidth: number,
  boardHeight: number,
): Map<string, number> {
  const congestion = new Map<string, number>();
  const SPREAD = 1; // How far congestion spreads from a trace

  for (const route of existingRoutes) {
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const holes = walkSegment(a, b);
      for (const holeKey of holes) {
        const [col, row] = holeKey.split(',').map(Number);
        // Mark the cell itself and neighbors
        for (let dc = -SPREAD; dc <= SPREAD; dc++) {
          for (let dr = -SPREAD; dr <= SPREAD; dr++) {
            const nc = col + dc, nr = row + dr;
            if (nc < 0 || nc >= boardWidth || nr < 0 || nr >= boardHeight) continue;
            const nk = gridKey(nc, nr);
            const dist = Math.abs(dc) + Math.abs(dr);
            const weight = dist === 0 ? 3 : 1;
            congestion.set(nk, (congestion.get(nk) ?? 0) + weight);
          }
        }
      }
    }
  }

  return congestion;
}

// ---- MST builder for multi-pin nets ---------------------------------

/**
 * Build minimum spanning tree edges for a net with multiple pins.
 * Uses Prim's algorithm. Only creates cross-component edges
 * (same-component pins are internally connected).
 */
function buildNetMST(pins: PinPosition[]): { from: number; to: number; dist: number }[] {
  if (pins.length < 2) return [];
  if (pins.length === 2) {
    return [{
      from: 0, to: 1,
      dist: Math.abs(pins[0].absCol - pins[1].absCol) + Math.abs(pins[0].absRow - pins[1].absRow),
    }];
  }

  const edges: { from: number; to: number; dist: number }[] = [];
  const inTree = new Set([0]);

  while (inTree.size < pins.length) {
    let bestDist = Infinity;
    let bestI = -1, bestJ = -1;

    for (const i of inTree) {
      for (let j = 0; j < pins.length; j++) {
        if (inTree.has(j)) continue;
        // Skip same-component edges (internal connections)
        if (pins[i].compIdx === pins[j].compIdx) continue;
        const d = Math.abs(pins[i].absCol - pins[j].absCol) +
                  Math.abs(pins[i].absRow - pins[j].absRow);
        if (d < bestDist) { bestDist = d; bestI = i; bestJ = j; }
      }
    }

    if (bestJ < 0) {
      // Remaining pins are same-component — just add them to tree
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
    maxPasses = 3,
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

  // ==== Step 2: Build net edges (MST per net) ====

  interface NetData {
    name: string;
    pins: PinPosition[];
    isPower: boolean;
  }

  const netDataList: NetData[] = [];

  for (const net of netlist.nets) {
    const pins: PinPosition[] = [];
    const isPower = GND_RE.test(net.name) || PWR_RE.test(net.name);

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
      netDataList.push({ name: net.name, pins, isPower });
    }
  }

  // Build MST edges for each net
  const allEdges: NetEdge[] = [];

  for (let ni = 0; ni < netDataList.length; ni++) {
    const nd = netDataList[ni];
    const mstEdges = buildNetMST(nd.pins);

    for (const edge of mstEdges) {
      const pa = nd.pins[edge.from];
      const pb = nd.pins[edge.to];
      const dist = edge.dist;

      // Priority: adjacent (0) < short signal (dist) < long signal < power/gnd
      let priority = dist;
      if (dist <= 1) priority = -1000; // solder bridges always first
      else if (nd.isPower) priority += 500; // power/gnd routes last
      // Boost short critical nets
      if (nd.pins.length === 2 && dist <= 5) priority -= 50;

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

  // Sort edges by priority (lowest first)
  allEdges.sort((a, b) => a.priority - b.priority);

  // ==== Step 3: Build component occupied holes ====

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

  // ==== Step 4: Multi-pass routing with rip-up and retry ====

  const connections: PerfboardConnection[] = [];
  const routedEdgeIndices = new Set<number>();
  const routeTraces: Map<number, GridPosition[]> = new Map(); // edgeIdx → route path

  // Track which holes are occupied by routed traces (per side)
  const bottomOccupied = new Set<string>();
  const topOccupied = new Set<string>();

  // Helper: mark route cells as occupied
  const markRouteOccupied = (route: GridPosition[], side: ConnectionSide, fromKey: string, toKey: string) => {
    const occ = side === 'bottom' ? bottomOccupied : topOccupied;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const holes = walkSegment(a, b);
      for (const key of holes) {
        if (key !== fromKey && key !== toKey) {
          occ.add(key);
        }
      }
    }
  };

  // Helper: unmark route cells
  const unmarkRouteOccupied = (route: GridPosition[], side: ConnectionSide, fromKey: string, toKey: string) => {
    const occ = side === 'bottom' ? bottomOccupied : topOccupied;
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i], b = route[i + 1];
      const holes = walkSegment(a, b);
      for (const key of holes) {
        if (key !== fromKey && key !== toKey) {
          occ.delete(key);
        }
      }
    }
  };

  // Helper: build occupied set for routing on a given side
  const buildOccupied = (side: ConnectionSide, excludeFrom?: string, excludeTo?: string): Set<string> => {
    const occ = new Set(componentOccupied);
    const sideOcc = side === 'bottom' ? bottomOccupied : topOccupied;
    for (const k of sideOcc) occ.add(k);
    if (excludeFrom) occ.delete(excludeFrom);
    if (excludeTo) occ.delete(excludeTo);
    return occ;
  };

  // Helper: attempt to route a single edge
  const tryRouteEdge = (
    edge: NetEdge,
    edgeIdx: number,
    congestion?: Map<string, number>,
  ): boolean => {
    const fromKey = gridKey(edge.from.col, edge.from.row);
    const toKey = gridKey(edge.to.col, edge.to.row);

    // Adjacent → solder bridge
    if (isAdjacent(edge.from, edge.to)) {
      connections.push({
        id: uuid(),
        type: 'solder_bridge',
        from: edge.from,
        to: edge.to,
        side: 'bottom',
        netId: edge.netName,
      });
      routedEdgeIndices.add(edgeIdx);
      return true;
    }

    // Try bottom-side routing first (primary)
    const bottomOcc = buildOccupied('bottom', fromKey, toKey);
    const routeOpts: ExtendedRouteOptions = {
      from: edge.from,
      to: edge.to,
      boardWidth,
      boardHeight,
      occupied: bottomOcc,
      turnPenalty: 20,
      congestionMap: congestion,
      maxIterations: 60000,
    };

    const bottomRoute = findManhattanRoute(routeOpts);
    if (bottomRoute && bottomRoute.length >= 2) {
      const waypoints = bottomRoute.length > 2
        ? insertSupportPoints(bottomRoute.slice(1, -1))
        : [];
      connections.push({
        id: uuid(),
        type: 'wire',
        from: edge.from,
        to: edge.to,
        waypoints,
        side: 'bottom',
        netId: edge.netName,
      });
      routeTraces.set(edgeIdx, bottomRoute);
      markRouteOccupied(bottomRoute, 'bottom', fromKey, toKey);
      routedEdgeIndices.add(edgeIdx);
      return true;
    }

    // Try wire bridge (straight-line only, like a 0-ohm resistor jumper)
    // Bridges can ONLY go in a straight line (same row or same column),
    // and they occupy through-holes on both sides.
    // Only attempt if from/to share a row or column.
    if (edge.from.col === edge.to.col || edge.from.row === edge.to.row) {
      const bridgeOcc = buildOccupied('bottom', fromKey, toKey);
      for (const k of topOccupied) bridgeOcc.add(k);
      if (fromKey) bridgeOcc.delete(fromKey);
      if (toKey) bridgeOcc.delete(toKey);

      const bridgeRoute = findStraightBridgeRoute(edge.from, edge.to, bridgeOcc);
      if (bridgeRoute && bridgeRoute.length >= 2) {
        connections.push({
          id: uuid(),
          type: 'wire_bridge',
          from: edge.from,
          to: edge.to,
          waypoints: undefined, // straight line — no waypoints
          side: 'top',
          netId: edge.netName,
        });
        routeTraces.set(edgeIdx, bridgeRoute);
        // Wire bridges occupy through-holes — mark on BOTH sides
        markRouteOccupied(bridgeRoute, 'top', fromKey, toKey);
        markRouteOccupied(bridgeRoute, 'bottom', fromKey, toKey);
        routedEdgeIndices.add(edgeIdx);
        return true;
      }
    }

    return false;
  };

  // ==== Pass 1: Initial routing ====

  for (let i = 0; i < allEdges.length; i++) {
    tryRouteEdge(allEdges[i], i);
  }

  // ==== Pass 2+: Rip-up and retry for failed edges ====

  for (let pass = 1; pass < maxPasses; pass++) {
    const failedIndices: number[] = [];
    for (let i = 0; i < allEdges.length; i++) {
      if (!routedEdgeIndices.has(i)) failedIndices.push(i);
    }
    if (failedIndices.length === 0) break;

    // Build congestion map from successful routes
    const routePaths: GridPosition[][] = [];
    for (const [, path] of routeTraces) {
      routePaths.push(path);
    }
    const congestion = buildCongestionMap(routePaths, boardWidth, boardHeight);

    // For each failed edge, try rip-up of nearby competing routes
    for (const failIdx of failedIndices) {
      const edge = allEdges[failIdx];
      const fromKey = gridKey(edge.from.col, edge.from.row);
      const toKey = gridKey(edge.to.col, edge.to.row);

      // Find candidate routes to rip up (those whose traces are near the failed edge)
      const candidateRipups: number[] = [];
      const failBBox = {
        minCol: Math.min(edge.from.col, edge.to.col) - 3,
        maxCol: Math.max(edge.from.col, edge.to.col) + 3,
        minRow: Math.min(edge.from.row, edge.to.row) - 3,
        maxRow: Math.max(edge.from.row, edge.to.row) + 3,
      };

      for (const [routeIdx, path] of routeTraces) {
        if (routeIdx === failIdx) continue;
        // Check if route passes through the failed edge's bounding box
        for (const pt of path) {
          if (pt.col >= failBBox.minCol && pt.col <= failBBox.maxCol &&
              pt.row >= failBBox.minRow && pt.row <= failBBox.maxRow) {
            candidateRipups.push(routeIdx);
            break;
          }
        }
      }

      if (candidateRipups.length === 0) continue;

      // Try ripping up each candidate and re-routing both
      let fixed = false;
      for (const ripIdx of candidateRipups) {
        if (fixed) break;

        const ripEdge = allEdges[ripIdx];
        const ripRoute = routeTraces.get(ripIdx);
        if (!ripRoute) continue;

        const ripFromKey = gridKey(ripEdge.from.col, ripEdge.from.row);
        const ripToKey = gridKey(ripEdge.to.col, ripEdge.to.row);

        // Rip up the competing route
        const ripConnIdx = connections.findIndex(
          (c) => c.from.col === ripEdge.from.col && c.from.row === ripEdge.from.row &&
                 c.to.col === ripEdge.to.col && c.to.row === ripEdge.to.row,
        );
        const ripConn = ripConnIdx >= 0 ? connections[ripConnIdx] : null;
        if (ripConn) {
          unmarkRouteOccupied(ripRoute, ripConn.side, ripFromKey, ripToKey);
          // Wire bridges occupy both sides — unmark the other side too
          if (ripConn.type === 'wire_bridge') {
            unmarkRouteOccupied(ripRoute, 'bottom', ripFromKey, ripToKey);
          }
        }

        // Try routing the failed edge now
        const success = tryRouteEdge(edge, failIdx, congestion);
        if (!success) {
          // Re-route the ripped-up edge (should still work)
          if (ripConn) {
            markRouteOccupied(ripRoute, ripConn.side, ripFromKey, ripToKey);
            if (ripConn.type === 'wire_bridge') {
              markRouteOccupied(ripRoute, 'bottom', ripFromKey, ripToKey);
            }
          }
          continue;
        }

        // Try re-routing the ripped-up edge
        if (ripConnIdx >= 0) {
          connections.splice(ripConnIdx, 1);
          routedEdgeIndices.delete(ripIdx);
          routeTraces.delete(ripIdx);
        }

        const reRouted = tryRouteEdge(ripEdge, ripIdx, congestion);
        if (reRouted) {
          fixed = true;
        } else {
          // Both can't coexist — revert: remove failed route, restore ripped
          // Remove the newly routed failed edge
          const failConnIdx = connections.findIndex(
            (c) => c.from.col === edge.from.col && c.from.row === edge.from.row &&
                   c.to.col === edge.to.col && c.to.row === edge.to.row,
          );
          if (failConnIdx >= 0) {
            const failConn = connections[failConnIdx];
            const failRoute = routeTraces.get(failIdx);
            if (failRoute) {
              unmarkRouteOccupied(failRoute, failConn.side, fromKey, toKey);
              if (failConn.type === 'wire_bridge') {
                unmarkRouteOccupied(failRoute, 'bottom', fromKey, toKey);
              }
            }
            connections.splice(failConnIdx, 1);
            routedEdgeIndices.delete(failIdx);
            routeTraces.delete(failIdx);
          }
          // Restore ripped route
          if (ripConn) {
            connections.push(ripConn);
            routeTraces.set(ripIdx, ripRoute);
            markRouteOccupied(ripRoute, ripConn.side, ripFromKey, ripToKey);
            if (ripConn.type === 'wire_bridge') {
              markRouteOccupied(ripRoute, 'bottom', ripFromKey, ripToKey);
            }
            routedEdgeIndices.add(ripIdx);
          }
        }
      }

      // If still failed after rip-up, try with reduced turn penalty (allow more turns)
      if (!routedEdgeIndices.has(failIdx)) {
        const bottomOcc = buildOccupied('bottom', fromKey, toKey);
        const relaxedRoute = findManhattanRoute({
          from: edge.from,
          to: edge.to,
          boardWidth,
          boardHeight,
          occupied: bottomOcc,
          turnPenalty: 5, // Very relaxed — allow complex paths
          maxIterations: 80000,
        } as ExtendedRouteOptions);

        if (relaxedRoute && relaxedRoute.length >= 2) {
          const waypoints = relaxedRoute.length > 2
            ? insertSupportPoints(relaxedRoute.slice(1, -1))
            : [];
          connections.push({
            id: uuid(),
            type: 'wire',
            from: edge.from,
            to: edge.to,
            waypoints,
            side: 'bottom',
            netId: edge.netName,
          });
          routeTraces.set(failIdx, relaxedRoute);
          markRouteOccupied(relaxedRoute, 'bottom', fromKey, toKey);
          routedEdgeIndices.add(failIdx);
        }
      }
    }
  }

  // ==== Step 5: Collect results ====

  const failedNetNames = new Set<string>();
  for (let i = 0; i < allEdges.length; i++) {
    if (!routedEdgeIndices.has(i)) {
      failedNetNames.add(allEdges[i].netName);
    }
  }

  // Count unique nets that were successfully routed
  const routedNetNames = new Set<string>();
  for (let i = 0; i < allEdges.length; i++) {
    if (routedEdgeIndices.has(i)) {
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
