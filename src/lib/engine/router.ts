// ============================================================
// Manhattan Router — A* pathfinding for perfboard connections
// Routes only horizontal/vertical, avoids occupied holes
// ============================================================

import type { GridPosition, PerfboardConnection, ConnectionSide } from '@/types';

interface RouteOptions {
  from: GridPosition;
  to: GridPosition;
  boardWidth: number;
  boardHeight: number;
  occupied: Set<string>; // "col,row" keys of occupied holes
}

/** Encode a grid position as a string key */
export function gridKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Get all holes occupied by placed components (using footprint pads + rotation) */
export function getOccupiedHoles(
  components: { gridPosition: GridPosition; rotation: number; pads: GridPosition[] }[],
  excludeComponentIndex?: number
): Set<string> {
  const occupied = new Set<string>();
  for (let i = 0; i < components.length; i++) {
    if (i === excludeComponentIndex) continue;
    const comp = components[i];
    for (const pad of comp.pads) {
      const { col, row } = rotatePad(pad, comp.rotation);
      occupied.add(gridKey(comp.gridPosition.col + col, comp.gridPosition.row + row));
    }
  }
  return occupied;
}

/**
 * Walk a Manhattan segment from a to b and yield every intermediate grid hole key.
 * a and b must share a row or column (pure horizontal or vertical).
 */
function segmentHoles(a: GridPosition, b: GridPosition): string[] {
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

/**
 * Get all holes occupied by existing connections on a given side.
 * Walks every segment (from → waypoints → to) and collects every
 * intermediate hole so new traces on the same side cannot cross them.
 */
export function getConnectionOccupiedHoles(
  connections: PerfboardConnection[],
  side: ConnectionSide,
  excludeEndpoints?: Set<string>,
): Set<string> {
  const occupied = new Set<string>();
  for (const conn of connections) {
    if (conn.side !== side) continue;
    const fullPath: GridPosition[] = [conn.from, ...(conn.waypoints ?? []), conn.to];
    for (let i = 0; i < fullPath.length - 1; i++) {
      for (const key of segmentHoles(fullPath[i], fullPath[i + 1])) {
        occupied.add(key);
      }
    }
  }
  // Don't block the new connection's own start/end
  if (excludeEndpoints) {
    for (const key of excludeEndpoints) occupied.delete(key);
  }
  return occupied;
}

/**
 * Get all through-holes occupied by wire_bridge connections.
 * Wire bridges behave like 0-ohm resistors — every point along their path
 * is a physical through-hole that blocks routing on ALL sides.
 */
export function getWireBridgeOccupiedHoles(
  connections: PerfboardConnection[],
  excludeEndpoints?: Set<string>,
): Set<string> {
  const occupied = new Set<string>();
  for (const conn of connections) {
    if (conn.type !== 'wire_bridge') continue;
    const fullPath: GridPosition[] = [conn.from, ...(conn.waypoints ?? []), conn.to];
    for (let i = 0; i < fullPath.length - 1; i++) {
      for (const key of segmentHoles(fullPath[i], fullPath[i + 1])) {
        occupied.add(key);
      }
    }
  }
  if (excludeEndpoints) {
    for (const key of excludeEndpoints) occupied.delete(key);
  }
  return occupied;
}

/**
 * Check if a straight-line bridge route is possible (same row or same column).
 * Bridges can ONLY go in a straight line — no bends or turns.
 * Returns the route (array of grid positions) if clear, or null if blocked.
 * The occupied set should contain ALL holes that block the bridge (components + all-side connections).
 */
export function findStraightBridgeRoute(
  from: GridPosition,
  to: GridPosition,
  occupied: Set<string>,
): GridPosition[] | null {
  // Must be on same row or same column
  if (from.col !== to.col && from.row !== to.row) return null;
  // Must not be the same point
  if (from.col === to.col && from.row === to.row) return null;

  // Walk every hole along the straight line and check for obstructions
  const route: GridPosition[] = [];
  const dc = Math.sign(to.col - from.col);
  const dr = Math.sign(to.row - from.row);
  let c = from.col, r = from.row;
  while (c !== to.col || r !== to.row) {
    route.push({ col: c, row: r });
    c += dc;
    r += dr;
  }
  route.push({ col: to.col, row: to.row });

  // Check intermediate holes (skip endpoints — those are the pins)
  for (let i = 1; i < route.length - 1; i++) {
    const key = gridKey(route[i].col, route[i].row);
    if (occupied.has(key)) return null; // blocked
  }

  return route;
}

/** Check if a solder-bridge (adjacent 1-hole segment) would cross an existing connection on the same side */
export function solderBridgeCrossesExisting(
  from: GridPosition,
  to: GridPosition,
  connections: PerfboardConnection[],
  side: ConnectionSide,
): boolean {
  // A solder bridge occupies exactly from→to (adjacent).
  // It crosses an existing connection if any intermediate hole of an existing
  // connection's segment crosses the bridge segment perpendicularly.
  const bridgeIsHoriz = from.row === to.row;
  const bridgeCol = Math.min(from.col, to.col);
  const bridgeRow = Math.min(from.row, to.row);

  for (const conn of connections) {
    if (conn.side !== side) continue;
    const fullPath: GridPosition[] = [conn.from, ...(conn.waypoints ?? []), conn.to];
    for (let i = 0; i < fullPath.length - 1; i++) {
      const a = fullPath[i], b = fullPath[i + 1];
      const segIsHoriz = a.row === b.row;

      // Only perpendicular segments can cross
      if (segIsHoriz === bridgeIsHoriz) continue;

      if (bridgeIsHoriz) {
        // bridge is horizontal (row fixed), segment is vertical (col fixed)
        const segCol = a.col;
        const segMinRow = Math.min(a.row, b.row);
        const segMaxRow = Math.max(a.row, b.row);
        const bMinCol = Math.min(from.col, to.col);
        const bMaxCol = Math.max(from.col, to.col);
        if (segCol >= bMinCol && segCol <= bMaxCol &&
            from.row >= segMinRow && from.row <= segMaxRow) {
          return true;
        }
      } else {
        // bridge is vertical (col fixed), segment is horizontal (row fixed)
        const segRow = a.row;
        const segMinCol = Math.min(a.col, b.col);
        const segMaxCol = Math.max(a.col, b.col);
        const bMinRow = Math.min(from.row, to.row);
        const bMaxRow = Math.max(from.row, to.row);
        if (segRow >= bMinRow && segRow <= bMaxRow &&
            from.col >= segMinCol && from.col <= segMaxCol) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Rotate a pad offset around (0,0) by the given angle */
export function rotatePad(pad: GridPosition, rotation: number): GridPosition {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 0: return { col: pad.col, row: pad.row };
    case 90: return { col: -pad.row, row: pad.col };
    case 180: return { col: -pad.col, row: -pad.row };
    case 270: return { col: pad.row, row: -pad.col };
    default: return pad;
  }
}

// ---- Footprint bounding box collision ----

export interface GridBBox {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
}

/**
 * Get the footprint bounding box for a placed component (in absolute grid coords).
 * When spanHoles is provided, the bbox is expanded to cover the full body area
 * (centred on the pad bbox, so the body extends equally in all directions).
 */
export function getFootprintBBox(
  gridPos: GridPosition,
  rotation: number,
  pads: GridPosition[],
  spanHoles?: GridPosition,
): GridBBox {
  if (pads.length === 0) {
    return { minCol: gridPos.col, minRow: gridPos.row, maxCol: gridPos.col, maxRow: gridPos.row };
  }
  let minCol = Infinity, minRow = Infinity, maxCol = -Infinity, maxRow = -Infinity;
  for (const pad of pads) {
    const rp = rotatePad(pad, rotation);
    const c = gridPos.col + rp.col;
    const r = gridPos.row + rp.row;
    if (c < minCol) minCol = c;
    if (r < minRow) minRow = r;
    if (c > maxCol) maxCol = c;
    if (r > maxRow) maxRow = r;
  }

  // Expand bbox to cover the full body area described by spanHoles
  if (spanHoles) {
    const rotatedSpan = rotatePad(
      { col: spanHoles.col - 1, row: spanHoles.row - 1 },
      rotation,
    );
    const spanCols = Math.abs(rotatedSpan.col) + 1;
    const spanRows = Math.abs(rotatedSpan.row) + 1;
    const padCols = maxCol - minCol + 1;
    const padRows = maxRow - minRow + 1;
    const extraCols = spanCols - padCols;
    const extraRows = spanRows - padRows;
    if (extraCols > 0) {
      minCol -= Math.floor(extraCols / 2);
      maxCol += Math.ceil(extraCols / 2);
    }
    if (extraRows > 0) {
      minRow -= Math.floor(extraRows / 2);
      maxRow += Math.ceil(extraRows / 2);
    }
  }

  return { minCol, minRow, maxCol, maxRow };
}

/** Check if two grid bounding boxes overlap (inclusive, so touching edges count) */
export function gridBBoxOverlap(a: GridBBox, b: GridBBox): boolean {
  return a.minCol <= b.maxCol && a.maxCol >= b.minCol
      && a.minRow <= b.maxRow && a.maxRow >= b.minRow;
}

/** Check if the component's footprint bbox overlaps any existing component's footprint bbox */
export function hasFootprintCollision(
  pads: GridPosition[],
  gridPos: GridPosition,
  rotation: number,
  existingComponents: { gridPosition: GridPosition; rotation: number; pads: GridPosition[]; spanHoles?: GridPosition }[],
  spanHoles?: GridPosition,
): boolean {
  const newBBox = getFootprintBBox(gridPos, rotation, pads, spanHoles);
  for (const comp of existingComponents) {
    const existingBBox = getFootprintBBox(comp.gridPosition, comp.rotation, comp.pads, comp.spanHoles);
    if (gridBBoxOverlap(newBBox, existingBBox)) return true;
  }
  return false;
}

/** Check if placing a component at gridPos would overlap with any occupied holes */
export function hasCollision(
  pads: GridPosition[],
  gridPos: GridPosition,
  rotation: number,
  occupied: Set<string>
): boolean {
  for (const pad of pads) {
    const rp = rotatePad(pad, rotation);
    const key = gridKey(gridPos.col + rp.col, gridPos.row + rp.row);
    if (occupied.has(key)) return true;
  }
  return false;
}

// Manhattan-only neighbors (no diagonals)
const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

/** How many holes between mandatory Lötpunkte (support solder points) on straight runs */
export const SUPPORT_INTERVAL = 5;

/** Very high turn penalty so the router strongly prefers straight runs */
const TURN_PENALTY = 20;

// Direction encoding for A*: 0=right, 1=left, 2=down, 3=up, 4=start
type DirIdx = 0 | 1 | 2 | 3 | 4;

// ---- Binary Min-Heap for A* priority queue ----

interface HeapNode {
  key: string;
  f: number;
}

class MinHeap {
  private data: HeapNode[] = [];

  get size(): number { return this.data.length; }

  push(node: HeapNode): void {
    this.data.push(node);
    this._bubbleUp(this.data.length - 1);
  }

  pop(): HeapNode | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else break;
    }
  }

  private _sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else break;
    }
  }
}

/**
 * Check if two grid positions are directly adjacent (distance == 1, no diagonal).
 * Used to auto-detect solder-bridge candidates.
 */
export function isAdjacent(a: GridPosition, b: GridPosition): boolean {
  return (Math.abs(a.col - b.col) + Math.abs(a.row - b.row)) === 1;
}

export interface ExtendedRouteOptions extends RouteOptions {
  /** Turn penalty override (default: 20). Lower = more turns allowed. */
  turnPenalty?: number;
  /** Additional penalty for cells near obstacles (congestion avoidance) */
  congestionMap?: Map<string, number>;
  /** Maximum number of A* iterations before giving up */
  maxIterations?: number;
}

/**
 * A* Manhattan router optimised for simple, straight routing:
 * - Huge turn penalty → produces paths with as few corners as possible
 * - Binary heap priority queue for O(n log n) performance
 * - Returns simplified corner-only waypoints (collinear points removed)
 * - Returns null only when no path exists at all
 */
export function findManhattanRoute(opts: RouteOptions | ExtendedRouteOptions): GridPosition[] | null {
  const { from, to, boardWidth, boardHeight, occupied } = opts;
  const turnPen = ('turnPenalty' in opts && opts.turnPenalty !== undefined) ? opts.turnPenalty : TURN_PENALTY;
  const congestion = ('congestionMap' in opts) ? (opts as ExtendedRouteOptions).congestionMap : undefined;
  const maxIter = ('maxIterations' in opts && opts.maxIterations !== undefined) ? opts.maxIterations : 50000;

  const startKey = gridKey(from.col, from.row);
  const endKey = gridKey(to.col, to.row);

  if (startKey === endKey) return [from];

  // Straight line (same row or col) with no obstacles → direct
  const directPath = tryDirectLine(from, to, boardWidth, boardHeight, occupied, startKey, endKey);
  if (directPath) return directPath;

  // Try simple L-route (1 corner) before full A*
  const lPath = tryLRoute(from, to, boardWidth, boardHeight, occupied, startKey, endKey);
  if (lPath) return lPath;

  // Try Z-routes (2 corners) before full A* — faster than full search
  const zPath = tryZRoute(from, to, boardWidth, boardHeight, occupied, startKey, endKey);
  if (zPath) return zPath;

  // Full A* with direction-aware state using binary heap
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();

  const h = (col: number, row: number) =>
    Math.abs(col - to.col) + Math.abs(row - to.row);

  const startDir: DirIdx = 4; // special "no direction yet"
  const sk = `${startKey},${startDir}`;
  gScore.set(sk, 0);

  const heap = new MinHeap();
  heap.push({ key: sk, f: h(from.col, from.row) });
  const inOpen = new Set<string>([sk]);
  const closed = new Set<string>();

  const blocked = (col: number, row: number): boolean => {
    const key = gridKey(col, row);
    if (key === startKey || key === endKey) return false;
    return occupied.has(key);
  };

  let iterations = 0;

  while (heap.size > 0) {
    if (++iterations > maxIter) return null; // Prevent runaway

    const node = heap.pop()!;
    const current = node.key;
    inOpen.delete(current);

    const parts = current.split(',');
    const cc = +parts[0], cr = +parts[1], cdir = +parts[2] as DirIdx;
    const posKey = gridKey(cc, cr);

    if (posKey === endKey) {
      // Reconstruct
      const rawPath: GridPosition[] = [];
      let k: string | undefined = current;
      while (k) {
        const p = k.split(',');
        rawPath.unshift({ col: +p[0], row: +p[1] });
        k = cameFrom.get(k);
      }
      return simplifyPath(rawPath);
    }

    closed.add(current);
    const currentG = gScore.get(current) ?? Infinity;

    for (let d = 0; d < 4; d++) {
      const [dc, dr] = DIRS[d];
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nc >= boardWidth || nr < 0 || nr >= boardHeight) continue;
      if (blocked(nc, nr)) continue;

      const nk = `${gridKey(nc, nr)},${d}`;
      if (closed.has(nk)) continue;

      // Cost: 1 per step + turn penalty when direction changes
      const isTurn = cdir !== 4 && d !== cdir;
      const stepCost = 1 + (isTurn ? turnPen : 0);
      // Add congestion cost if provided
      const congCost = congestion ? (congestion.get(gridKey(nc, nr)) ?? 0) : 0;
      const tentativeG = currentG + stepCost + congCost;
      const prevG = gScore.get(nk) ?? Infinity;

      if (tentativeG < prevG) {
        cameFrom.set(nk, current);
        gScore.set(nk, tentativeG);
        const f = tentativeG + h(nc, nr);
        if (!inOpen.has(nk)) {
          heap.push({ key: nk, f });
          inOpen.add(nk);
        }
      }
    }
  }

  // A* exhausted — no valid route found
  return null;
}

/**
 * Try Z-route: 2 corners (3 segments). Tries horizontal-vertical-horizontal
 * and vertical-horizontal-vertical via nearby intermediate rows/columns.
 */
function tryZRoute(
  from: GridPosition, to: GridPosition,
  bw: number, bh: number,
  occupied: Set<string>,
  startKey: string, endKey: string,
): GridPosition[] | null {
  if (from.col === to.col || from.row === to.row) return null;

  // H-V-H: horizontal from 'from', vertical in middle, horizontal to 'to'
  const midCol = Math.round((from.col + to.col) / 2);
  for (let offset = 0; offset <= Math.max(bw, bh); offset++) {
    for (const mc of offset === 0 ? [midCol] : [midCol - offset, midCol + offset]) {
      if (mc < 0 || mc >= bw) continue;
      const m1: GridPosition = { col: mc, row: from.row };
      const m2: GridPosition = { col: mc, row: to.row };
      const path = [from, m1, m2, to];
      if (pathClear(path, bw, bh, occupied, startKey, endKey)) return simplifyPath([from, m1, m2, to]);
    }
  }

  // V-H-V: vertical from 'from', horizontal in middle, vertical to 'to'
  const midRow = Math.round((from.row + to.row) / 2);
  for (let offset = 0; offset <= Math.max(bw, bh); offset++) {
    for (const mr of offset === 0 ? [midRow] : [midRow - offset, midRow + offset]) {
      if (mr < 0 || mr >= bh) continue;
      const m1: GridPosition = { col: from.col, row: mr };
      const m2: GridPosition = { col: to.col, row: mr };
      const path = [from, m1, m2, to];
      if (pathClear(path, bw, bh, occupied, startKey, endKey)) return simplifyPath([from, m1, m2, to]);
    }
  }

  return null;
}

/** Try a perfectly straight line (horizontal or vertical) */
function tryDirectLine(
  from: GridPosition, to: GridPosition,
  bw: number, bh: number,
  occupied: Set<string>,
  startKey: string, endKey: string,
): GridPosition[] | null {
  if (from.col !== to.col && from.row !== to.row) return null;
  const isHoriz = from.row === to.row;
  const start = isHoriz ? Math.min(from.col, to.col) : Math.min(from.row, to.row);
  const end = isHoriz ? Math.max(from.col, to.col) : Math.max(from.row, to.row);
  for (let i = start; i <= end; i++) {
    const col = isHoriz ? i : from.col;
    const row = isHoriz ? from.row : i;
    if (col < 0 || col >= bw || row < 0 || row >= bh) return null;
    const k = gridKey(col, row);
    if (k !== startKey && k !== endKey && occupied.has(k)) return null;
  }
  return [from, to];
}

/** Try both L-route variants (horiz-first and vert-first), pick unblocked one */
function tryLRoute(
  from: GridPosition, to: GridPosition,
  bw: number, bh: number,
  occupied: Set<string>,
  startKey: string, endKey: string,
): GridPosition[] | null {
  if (from.col === to.col || from.row === to.row) return null; // straight, not L

  const variants: GridPosition[][] = [
    [from, { col: to.col, row: from.row }, to],  // horiz then vert
    [from, { col: from.col, row: to.row }, to],  // vert then horiz
  ];

  for (const path of variants) {
    if (pathClear(path, bw, bh, occupied, startKey, endKey)) return path;
  }
  return null;
}

/** Check that every segment of a path is unblocked */
function pathClear(
  path: GridPosition[], bw: number, bh: number,
  occupied: Set<string>, startKey: string, endKey: string,
): boolean {
  for (let s = 0; s < path.length - 1; s++) {
    const a = path[s], b = path[s + 1];
    const isHoriz = a.row === b.row;
    const lo = isHoriz ? Math.min(a.col, b.col) : Math.min(a.row, b.row);
    const hi = isHoriz ? Math.max(a.col, b.col) : Math.max(a.row, b.row);
    for (let i = lo; i <= hi; i++) {
      const col = isHoriz ? i : a.col;
      const row = isHoriz ? a.row : i;
      if (col < 0 || col >= bw || row < 0 || row >= bh) return false;
      const k = gridKey(col, row);
      if (k !== startKey && k !== endKey && occupied.has(k)) return false;
    }
  }
  return true;
}

/**
 * Simplify a raw cell-by-cell path: keep only start, end, and corner/turn points.
 */
function simplifyPath(path: GridPosition[]): GridPosition[] {
  if (path.length <= 2) return path;
  const result: GridPosition[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];
    const dx1 = curr.col - prev.col;
    const dy1 = curr.row - prev.row;
    const dx2 = next.col - curr.col;
    const dy2 = next.row - curr.row;
    if (dx1 !== dx2 || dy1 !== dy2) {
      result.push(curr);
    }
  }
  result.push(path[path.length - 1]);
  return result;
}

/**
 * Insert support Lötpunkte every SUPPORT_INTERVAL holes along each straight
 * segment of a simplified path.  Returns a new array of all waypoints
 * (corners + support points).
 */
export function insertSupportPoints(path: GridPosition[]): GridPosition[] {
  if (path.length < 2) return path;
  const result: GridPosition[] = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const dc = Math.sign(b.col - a.col);
    const dr = Math.sign(b.row - a.row);
    const dist = Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    // Insert intermediate support points every SUPPORT_INTERVAL holes
    if (dist > SUPPORT_INTERVAL) {
      const steps = Math.floor(dist / SUPPORT_INTERVAL);
      for (let s = 1; s <= steps; s++) {
        const n = s * SUPPORT_INTERVAL;
        if (n < dist) {
          result.push({ col: a.col + dc * n, row: a.row + dr * n });
        }
      }
    }
    result.push(b);
  }
  return result;
}

/**
 * Given a simplified corner-only path, return the list of grid positions
 * where a Lötpunkt should be rendered:
 * - Every corner (direction change)
 * - Every SUPPORT_INTERVAL holes along straight segments
 * (Excludes the very first and last point — those are the connection endpoints.)
 */
export function getLötpunkte(path: GridPosition[]): GridPosition[] {
  if (path.length < 2) return [];
  const points: GridPosition[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];

    // Corner points (not start/end)
    if (i > 0) {
      points.push(a);
    }

    // Support points along segment
    const dc = Math.sign(b.col - a.col);
    const dr = Math.sign(b.row - a.row);
    const dist = Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    if (dist > SUPPORT_INTERVAL) {
      const steps = Math.floor(dist / SUPPORT_INTERVAL);
      for (let s = 1; s <= steps; s++) {
        const n = s * SUPPORT_INTERVAL;
        if (n < dist) {
          const pt = { col: a.col + dc * n, row: a.row + dr * n };
          // Don't duplicate corner points
          if (!points.some(p => p.col === pt.col && p.row === pt.row)) {
            points.push(pt);
          }
        }
      }
    }
  }
  return points;
}

/**
 * Simple L-shaped fallback (ignores obstacles).
 * Prefers the variant that uses the longer straight segment first.
 */
function fallbackLRoute(from: GridPosition, to: GridPosition): GridPosition[] {
  if (from.col === to.col || from.row === to.row) return [from, to];
  const dh = Math.abs(to.col - from.col);
  const dv = Math.abs(to.row - from.row);
  // Put the longer segment first for a cleaner look
  if (dh >= dv) {
    return [from, { col: to.col, row: from.row }, to];
  }
  return [from, { col: from.col, row: to.row }, to];
}
