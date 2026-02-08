// ============================================================
// Autorouter — Automatic connection routing for perfboard
// Routes all unconnected nets using the Manhattan A* router.
// ============================================================

import type {
  GridPosition,
  PerfboardDocument,
  PerfboardConnection,
  SchematicDocument,
  ComponentDefinition,
  Netlist,
  Net,
  ConnectionType,
  ConnectionSide,
} from '@/types';
import { v4 as uuid } from 'uuid';
import { buildNetlist } from './netlist';
import { getAdjustedFootprint } from '@/lib/component-library';
import {
  rotatePad,
  gridKey,
  getOccupiedHoles,
  getConnectionOccupiedHoles,
  findManhattanRoute,
  insertSupportPoints,
  isAdjacent,
  solderBridgeCrossesExisting,
} from './router';

// ---- Types ----

export interface AutorouteOptions {
  /** Board width in grid holes */
  boardWidth: number;
  /** Board height in grid holes */
  boardHeight: number;
  /** Connection type for new wires */
  connectionType?: ConnectionType;
  /** Side to route on */
  connectionSide?: ConnectionSide;
  /** Whether to clear existing connections before routing */
  clearExisting?: boolean;
  /** Maximum number of retry passes with rip-up-and-reroute */
  maxPasses?: number;
}

export interface AutorouteResult {
  /** New connections to add */
  connections: PerfboardConnection[];
  /** Number of nets successfully routed */
  routed: number;
  /** Number of nets that failed to route */
  failed: number;
  /** Names of failed nets */
  failedNets: string[];
}

interface PinPosition {
  schematicComponentId: string;
  pinNumber: string;
  gridPos: GridPosition;
}

// ---- Autorouter ----

/**
 * Automatically route all unconnected nets on the perfboard.
 *
 * Strategy:
 * 1. Build netlist from schematic.
 * 2. Map schematic pins to perfboard grid positions.
 * 3. Determine which pin pairs still need connections (ratsnest).
 * 4. Sort nets by estimated difficulty (short nets first).
 * 5. For each net, build a minimum spanning tree of the pins and route
 *    each edge using the Manhattan A* router.
 * 6. If a route fails, record it and try again in a later pass.
 */
export function autoRoute(
  perfboard: PerfboardDocument,
  schematic: SchematicDocument,
  allLib: ComponentDefinition[],
  options: AutorouteOptions,
): AutorouteResult {
  const {
    boardWidth,
    boardHeight,
    connectionType = 'wire',
    connectionSide = 'bottom',
    clearExisting = false,
    maxPasses = 3,
  } = options;

  const netlist = buildNetlist(schematic);

  // Build pin grid-position map: "schCompId:pinNum" → GridPosition
  const pinGridMap = new Map<string, GridPosition>();
  for (const pbComp of perfboard.components) {
    const def = allLib.find((d) => d.id === pbComp.libraryId);
    if (!def) continue;
    const { pads } = getAdjustedFootprint(def, pbComp.properties?.holeSpan);
    for (const pad of pads) {
      const rotated = rotatePad(pad.gridPosition, pbComp.rotation);
      const gridPos: GridPosition = {
        col: pbComp.gridPosition.col + rotated.col,
        row: pbComp.gridPosition.row + rotated.row,
      };
      pinGridMap.set(`${pbComp.schematicComponentId}:${pad.number}`, gridPos);
    }
  }

  // Build component occupied-holes set
  const compData = perfboard.components.map((c) => {
    const def = allLib.find((d) => d.id === c.libraryId);
    const adj = def
      ? getAdjustedFootprint(def, c.properties?.holeSpan)
      : { pads: [], spanHoles: { col: 1, row: 1 } };
    return {
      gridPosition: c.gridPosition,
      rotation: c.rotation,
      pads: adj.pads.map((p) => p.gridPosition),
    };
  });
  const componentOccupied = getOccupiedHoles(compData);

  // Build union-find for existing connections (to know what's already connected)
  const existingConnections = clearExisting ? [] : [...perfboard.connections];

  // Collect net routing tasks
  interface NetTask {
    net: Net;
    pins: GridPosition[];
    edges: [GridPosition, GridPosition][]; // MST edges to route
  }

  const tasks: NetTask[] = [];

  for (const net of netlist.nets) {
    if (net.connections.length < 2) continue;

    // Collect placed pin positions for this net
    const pins: GridPosition[] = [];
    for (const conn of net.connections) {
      const key = `${conn.componentId}:${conn.pinNumber}`;
      const gp = pinGridMap.get(key);
      if (gp) pins.push(gp);
    }
    if (pins.length < 2) continue;

    // Check what's already connected using existing connections
    const connectedGroups = buildConnectedGroups(pins, existingConnections);
    if (connectedGroups.length <= 1) continue; // Fully connected already

    // Build minimum spanning tree edges between groups
    const edges = buildMSTEdges(connectedGroups);
    if (edges.length > 0) {
      tasks.push({ net, pins, edges });
    }
  }

  // Sort tasks: shortest estimated wire length first (easier to route)
  tasks.sort((a, b) => {
    const costA = a.edges.reduce((s, [f, t]) =>
      s + Math.abs(f.col - t.col) + Math.abs(f.row - t.row), 0);
    const costB = b.edges.reduce((s, [f, t]) =>
      s + Math.abs(f.col - t.col) + Math.abs(f.row - t.row), 0);
    return costA - costB;
  });

  // Route!
  const newConnections: PerfboardConnection[] = [];
  const failedNets: string[] = [];
  let routed = 0;
  let failed = 0;

  // Multi-pass: try to route, then retry failed ones
  let remaining = [...tasks];

  for (let pass = 0; pass < maxPasses && remaining.length > 0; pass++) {
    const nextRemaining: NetTask[] = [];

    for (const task of remaining) {
      let allEdgesOk = true;

      for (const [from, to] of task.edges) {
        // Check if this edge was already routed in a previous iteration
        if (isAlreadyConnected(from, to, [...existingConnections, ...newConnections])) {
          continue;
        }

        const result = routeSingleEdge(
          from, to,
          boardWidth, boardHeight,
          componentOccupied,
          [...existingConnections, ...newConnections],
          connectionType,
          connectionSide,
        );

        if (result) {
          newConnections.push(result);
        } else {
          allEdgesOk = false;
        }
      }

      if (allEdgesOk) {
        routed++;
      } else {
        nextRemaining.push(task);
      }
    }

    remaining = nextRemaining;
  }

  // Count final failures
  for (const task of remaining) {
    failed++;
    failedNets.push(task.net.name);
  }

  return {
    connections: newConnections,
    routed,
    failed,
    failedNets,
  };
}

/**
 * Route a single edge (from → to) using the Manhattan router.
 * Returns a PerfboardConnection or null if no route found.
 */
function routeSingleEdge(
  from: GridPosition,
  to: GridPosition,
  boardWidth: number,
  boardHeight: number,
  componentOccupied: Set<string>,
  existingConnections: PerfboardConnection[],
  connectionType: ConnectionType,
  connectionSide: ConnectionSide,
): PerfboardConnection | null {
  const fromKey = gridKey(from.col, from.row);
  const toKey = gridKey(to.col, to.row);
  const endpointKeys = new Set([fromKey, toKey]);

  // Build occupied set: component holes + same-side connection holes
  const occupied = new Set(componentOccupied);
  const connOcc = getConnectionOccupiedHoles(existingConnections, connectionSide, endpointKeys);
  for (const k of connOcc) occupied.add(k);
  occupied.delete(fromKey);
  occupied.delete(toKey);

  // Check if adjacent → try solder bridge
  if (isAdjacent(from, to)) {
    if (!solderBridgeCrossesExisting(from, to, existingConnections, 'bottom')) {
      return {
        id: uuid(),
        type: 'solder_bridge',
        from: { ...from },
        to: { ...to },
        side: 'bottom',
      };
    }
  }

  // A* Manhattan route
  const route = findManhattanRoute({
    from,
    to,
    boardWidth,
    boardHeight,
    occupied,
  });

  if (!route || route.length < 2) return null;

  // Insert support Lötpunkte
  const withSupport = insertSupportPoints(route);
  const waypoints = withSupport.length > 2 ? withSupport.slice(1, -1) : undefined;

  return {
    id: uuid(),
    type: connectionType,
    from: { ...withSupport[0] },
    to: { ...withSupport[withSupport.length - 1] },
    waypoints,
    side: connectionSide,
  };
}

/**
 * Build connected groups using union-find over existing connections.
 * Returns arrays of GridPositions grouped by connectivity.
 */
function buildConnectedGroups(
  pins: GridPosition[],
  connections: PerfboardConnection[],
): GridPosition[][] {
  const parent = new Map<string, string>();

  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    if (parent.get(k) !== k) parent.set(k, find(parent.get(k)!));
    return parent.get(k)!;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Initialize all pins
  for (const pin of pins) {
    find(gridKey(pin.col, pin.row));
  }

  // Union via existing connections
  for (const conn of connections) {
    const fk = gridKey(conn.from.col, conn.from.row);
    const tk = gridKey(conn.to.col, conn.to.row);
    union(fk, tk);
    if (conn.waypoints) {
      for (const wp of conn.waypoints) {
        union(fk, gridKey(wp.col, wp.row));
        union(tk, gridKey(wp.col, wp.row));
      }
    }
  }

  // Group pin positions by root
  const groups = new Map<string, GridPosition[]>();
  for (const pin of pins) {
    const root = find(gridKey(pin.col, pin.row));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(pin);
  }

  return Array.from(groups.values());
}

/**
 * Build a minimum spanning tree over connected-groups, choosing the
 * closest pair of pins between groups as the edge weight.
 * Returns a list of [from, to] pairs to route.
 */
function buildMSTEdges(groups: GridPosition[][]): [GridPosition, GridPosition][] {
  if (groups.length <= 1) return [];

  const n = groups.length;
  const inMST = new Set<number>();
  const edges: [GridPosition, GridPosition][] = [];

  // Prim's algorithm
  inMST.add(0);

  while (inMST.size < n) {
    let bestDist = Infinity;
    let bestFrom: GridPosition | null = null;
    let bestTo: GridPosition | null = null;
    let bestGroup = -1;

    for (const gi of inMST) {
      for (let gj = 0; gj < n; gj++) {
        if (inMST.has(gj)) continue;

        // Find closest pair between groups gi and gj
        for (const pi of groups[gi]) {
          for (const pj of groups[gj]) {
            const dist = Math.abs(pi.col - pj.col) + Math.abs(pi.row - pj.row);
            if (dist < bestDist) {
              bestDist = dist;
              bestFrom = pi;
              bestTo = pj;
              bestGroup = gj;
            }
          }
        }
      }
    }

    if (bestFrom && bestTo && bestGroup >= 0) {
      edges.push([bestFrom, bestTo]);
      inMST.add(bestGroup);
    } else {
      break; // No more reachable groups
    }
  }

  return edges;
}

/**
 * Check if two grid positions are already connected (directly or through a chain).
 */
function isAlreadyConnected(
  a: GridPosition,
  b: GridPosition,
  connections: PerfboardConnection[],
): boolean {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    if (parent.get(k) !== k) parent.set(k, find(parent.get(k)!));
    return parent.get(k)!;
  };
  const union = (x: string, y: string) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  for (const conn of connections) {
    const fk = gridKey(conn.from.col, conn.from.row);
    const tk = gridKey(conn.to.col, conn.to.row);
    union(fk, tk);
    if (conn.waypoints) {
      for (const wp of conn.waypoints) {
        union(fk, gridKey(wp.col, wp.row));
      }
    }
  }

  return find(gridKey(a.col, a.row)) === find(gridKey(b.col, b.row));
}
