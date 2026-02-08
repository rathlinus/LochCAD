// ============================================================
// Schematic Router — Manhattan wire routing & collision for schematics
// Minimises number of turns; routes around component bounding boxes
// ============================================================

import type { Point, ComponentSymbol, SchematicComponent, ComponentDefinition } from '@/types';
import { SCHEMATIC_GRID } from '@/constants';

// ---- Bounding Box helpers ----

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Margin around component body (in px) for routing avoidance */
const COMP_MARGIN = 2;

/**
 * Compute the axis-aligned bounding box of a component symbol
 * in world space (taking position + rotation into account).
 */
export function getComponentBBox(
  comp: SchematicComponent,
  symbol: ComponentSymbol,
): BBox {
  // Gather all coordinate extremes from graphics + pins
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const g of symbol.graphics) {
    switch (g.type) {
      case 'line':
        expand(g.start.x, g.start.y);
        expand(g.end.x, g.end.y);
        break;
      case 'rectangle':
        expand(g.start.x, g.start.y);
        expand(g.end.x, g.end.y);
        break;
      case 'circle':
        expand(g.center.x - g.radius, g.center.y - g.radius);
        expand(g.center.x + g.radius, g.center.y + g.radius);
        break;
      case 'polyline':
        for (const p of g.points) expand(p.x, p.y);
        break;
      case 'arc':
        expand(g.center.x - g.radius, g.center.y - g.radius);
        expand(g.center.x + g.radius, g.center.y + g.radius);
        break;
    }
  }
  for (const pin of symbol.pins) {
    expand(pin.position.x, pin.position.y);
    // Also include pin endpoint
    const angle = (pin.direction * Math.PI) / 180;
    expand(
      pin.position.x + Math.cos(angle) * pin.length,
      pin.position.y + Math.sin(angle) * pin.length,
    );
  }

  // Fallback for empty symbols
  if (!isFinite(minX)) {
    minX = -20; minY = -20; maxX = 20; maxY = 20;
  }

  // Rotate local bounding corners by comp.rotation, apply mirror, then translate
  const corners: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
  for (const c of corners) {
    let lx = comp.mirror ? -c.x : c.x;
    let ly = c.y;
    // Rotate
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    const wx = comp.position.x + rx;
    const wy = comp.position.y + ry;
    if (wx < wMinX) wMinX = wx;
    if (wy < wMinY) wMinY = wy;
    if (wx > wMaxX) wMaxX = wx;
    if (wy > wMaxY) wMaxY = wy;
  }

  return {
    x: wMinX - COMP_MARGIN,
    y: wMinY - COMP_MARGIN,
    width: wMaxX - wMinX + COMP_MARGIN * 2,
    height: wMaxY - wMinY + COMP_MARGIN * 2,
  };
}

/**
 * Compute body-only bounding box (excludes pin lines) — used for placement collision.
 * Components whose bodies don't overlap can have touching pins.
 */
export function getComponentBodyBBox(
  comp: SchematicComponent,
  symbol: ComponentSymbol,
): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  // Only graphics — no pins
  for (const g of symbol.graphics) {
    switch (g.type) {
      case 'line':
        expand(g.start.x, g.start.y);
        expand(g.end.x, g.end.y);
        break;
      case 'rectangle':
        expand(g.start.x, g.start.y);
        expand(g.end.x, g.end.y);
        break;
      case 'circle':
        expand(g.center.x - g.radius, g.center.y - g.radius);
        expand(g.center.x + g.radius, g.center.y + g.radius);
        break;
      case 'polyline':
        for (const p of g.points) expand(p.x, p.y);
        break;
      case 'arc':
        expand(g.center.x - g.radius, g.center.y - g.radius);
        expand(g.center.x + g.radius, g.center.y + g.radius);
        break;
    }
  }

  if (!isFinite(minX)) {
    minX = -10; minY = -10; maxX = 10; maxY = 10;
  }

  const corners: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];

  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  let wMinX = Infinity, wMinY = Infinity, wMaxX = -Infinity, wMaxY = -Infinity;
  for (const c of corners) {
    let lx = comp.mirror ? -c.x : c.x;
    let ly = c.y;
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    const wx = comp.position.x + rx;
    const wy = comp.position.y + ry;
    if (wx < wMinX) wMinX = wx;
    if (wy < wMinY) wMinY = wy;
    if (wx > wMaxX) wMaxX = wx;
    if (wy > wMaxY) wMaxY = wy;
  }

  return {
    x: wMinX - COMP_MARGIN,
    y: wMinY - COMP_MARGIN,
    width: wMaxX - wMinX + COMP_MARGIN * 2,
    height: wMaxY - wMinY + COMP_MARGIN * 2,
  };
}

/** Check if two bounding boxes overlap */
export function bboxOverlap(a: BBox, b: BBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Transform a local point to world space given component transform */
function localToWorld(lx: number, ly: number, comp: SchematicComponent): Point {
  const mlx = comp.mirror ? -lx : lx;
  const rad = (comp.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: comp.position.x + mlx * cos - ly * sin,
    y: comp.position.y + mlx * sin + ly * cos,
  };
}

/** Get all pin segments (base → tip) in world space for a component */
export function getComponentPinSegments(
  comp: SchematicComponent,
  symbol: ComponentSymbol,
): { base: Point; tip: Point }[] {
  return symbol.pins.map((pin) => {
    const angle = (pin.direction * Math.PI) / 180;
    const tipX = pin.position.x + Math.cos(angle) * pin.length;
    const tipY = pin.position.y + Math.sin(angle) * pin.length;
    return {
      base: localToWorld(pin.position.x, pin.position.y, comp),
      tip: localToWorld(tipX, tipY, comp),
    };
  });
}

/** Get all pin-tip world positions for a component */
export function getComponentPinTips(
  comp: SchematicComponent,
  symbol: ComponentSymbol,
): Point[] {
  return getComponentPinSegments(comp, symbol).map((s) => s.tip);
}

/**
 * Build routing obstacles (body bboxes with a minimum size so even narrow
 * components like capacitors block properly) plus pin-corridor allowed cells
 * so the A* router can still reach pin connection points through their stubs.
 *
 * Body bboxes are used instead of full bboxes so that pin stub *areas* (above
 * and below the drawn stub lines) remain free for routing.  Only the grid
 * cells that lie ON a pin segment AND inside the obstacle bbox are marked as
 * allowed – this lets wires approach pins along the stub direction without
 * being able to freely traverse the body.
 */
export function buildRoutingContext(
  components: SchematicComponent[],
  allLib: ComponentDefinition[],
  grid: number = SCHEMATIC_GRID,
): { obstacles: BBox[]; allowedCells: Set<string> } {
  const obstacles: BBox[] = [];
  const allowedCells = new Set<string>();

  // Minimum obstacle dimension — ensures even very narrow body graphics
  // (e.g. capacitor plates) produce a meaningful routing obstacle.
  const MIN_DIM = grid * 3;

  for (const comp of components) {
    const def = allLib.find((d) => d.id === comp.libraryId);
    if (!def) continue;

    // Body-only bbox (excludes pin stubs)
    const bbox = getComponentBodyBBox(comp, def.symbol);

    // Enforce minimum dimensions (expand symmetrically around centre)
    if (bbox.width < MIN_DIM) {
      const cx = bbox.x + bbox.width / 2;
      bbox.x = cx - MIN_DIM / 2;
      bbox.width = MIN_DIM;
    }
    if (bbox.height < MIN_DIM) {
      const cy = bbox.y + bbox.height / 2;
      bbox.y = cy - MIN_DIM / 2;
      bbox.height = MIN_DIM;
    }

    obstacles.push(bbox);

    // Create allowed-cell corridors so the router can reach pin connection
    // points (base) that may lie inside the (expanded) body bbox.
    //
    // IMPORTANT: only allow cells from the base toward the OUTSIDE of the
    // body (opposite direction of base→tip).  Do NOT extend the corridor
    // from base toward the tip (deeper into the body) — that would let
    // wires shortcut through the component body.
    const segs = getComponentPinSegments(comp, def.symbol);
    for (const seg of segs) {
      const bx = Math.round(seg.base.x / grid) * grid;
      const by = Math.round(seg.base.y / grid) * grid;
      const tx = Math.round(seg.tip.x / grid) * grid;
      const ty = Math.round(seg.tip.y / grid) * grid;

      // Always allow the base cell itself (connection point)
      if (pointInBBox(bx, by, bbox)) allowedCells.add(gk(bx, by));

      if (by === ty && bx !== tx) {
        // Horizontal pin — walk from base OUTWARD (away from tip)
        const outStep = tx > bx ? -grid : grid;
        for (let x = bx + outStep; ; x += outStep) {
          if (!pointInBBox(x, by, bbox)) break;
          allowedCells.add(gk(x, by));
        }
      } else if (bx === tx && by !== ty) {
        // Vertical pin — walk from base OUTWARD (away from tip)
        const outStep = ty > by ? -grid : grid;
        for (let y = by + outStep; ; y += outStep) {
          if (!pointInBBox(bx, y, bbox)) break;
          allowedCells.add(gk(bx, y));
        }
      }
      // Diagonal/zero-length: base cell already added above
    }
  }

  return { obstacles, allowedCells };
}

/**
 * Check if a line segment (p0→p1) intersects an axis-aligned bounding box.
 * Uses Liang-Barsky algorithm.
 */
function segmentIntersectsBBox(
  p0x: number, p0y: number, p1x: number, p1y: number,
  box: BBox,
): boolean {
  const dx = p1x - p0x;
  const dy = p1y - p0y;
  const bx2 = box.x + box.width;
  const by2 = box.y + box.height;

  let tMin = 0;
  let tMax = 1;

  const edges = [
    { p: -dx, q: p0x - box.x },   // left
    { p: dx,  q: bx2 - p0x },     // right
    { p: -dy, q: p0y - box.y },   // top
    { p: dy,  q: by2 - p0y },     // bottom
  ];

  for (const { p, q } of edges) {
    if (Math.abs(p) < 1e-10) {
      // Parallel to this edge
      if (q < 0) return false; // Outside
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > tMax) return false;
        if (t > tMin) tMin = t;
      } else {
        if (t < tMin) return false;
        if (t < tMax) tMax = t;
      }
    }
  }

  return tMin <= tMax;
}

/**
 * Comprehensive collision check between two components.
 * Uses full bboxes (including pins). The ONLY allowed overlap is exact pin-tip on pin-tip.
 */
export function hasComponentCollision(
  newComp: SchematicComponent,
  newSymbol: ComponentSymbol,
  existingComp: SchematicComponent,
  existingSymbol: ComponentSymbol,
): boolean {
  // Quick exit: full bboxes (with pins) don't overlap at all
  const newFull = getComponentBBox(newComp, newSymbol);
  const existFull = getComponentBBox(existingComp, existingSymbol);
  if (!bboxOverlap(newFull, existFull)) return false;

  // Body-body overlap → always blocked
  const newBody = getComponentBodyBBox(newComp, newSymbol);
  const existBody = getComponentBodyBBox(existingComp, existingSymbol);
  if (bboxOverlap(newBody, existBody)) return true;

  const newSegs = getComponentPinSegments(newComp, newSymbol);
  const existSegs = getComponentPinSegments(existingComp, existingSymbol);
  // Base = outer connectable endpoint; tip = inner body-edge point
  const newBases = newSegs.map((s) => s.base);
  const existBases = existSegs.map((s) => s.base);

  const EPS = 1.0; // tolerance for snapped-grid pin matching
  const pinsMatch = (a: Point, b: Point) =>
    Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

  // Pin-line vs body → always blocked
  for (const s of newSegs) {
    if (segmentIntersectsBBox(s.base.x, s.base.y, s.tip.x, s.tip.y, existBody)) return true;
  }
  for (const s of existSegs) {
    if (segmentIntersectsBBox(s.base.x, s.base.y, s.tip.x, s.tip.y, newBody)) return true;
  }

  // For pin-zone overlap (pin enters the other component's full area but NOT body):
  // Only allow if the pin tip matches an existing pin tip exactly.
  // Use tight bboxes (shrink by margin) so padding doesn't cause false positives.
  const newTight: BBox = {
    x: newFull.x + COMP_MARGIN, y: newFull.y + COMP_MARGIN,
    width: newFull.width - COMP_MARGIN * 2, height: newFull.height - COMP_MARGIN * 2,
  };
  const existTight: BBox = {
    x: existFull.x + COMP_MARGIN, y: existFull.y + COMP_MARGIN,
    width: existFull.width - COMP_MARGIN * 2, height: existFull.height - COMP_MARGIN * 2,
  };

  for (let i = 0; i < newSegs.length; i++) {
    const s = newSegs[i];
    // Does this pin segment geometrically enter the existing component's tight area?
    if (segmentIntersectsBBox(s.base.x, s.base.y, s.tip.x, s.tip.y, existTight)) {
      // Only allowed if pin connectable endpoint matches an existing pin endpoint
      if (!existBases.some((eb) => pinsMatch(newBases[i], eb))) return true;
    }
  }

  for (let i = 0; i < existSegs.length; i++) {
    const s = existSegs[i];
    if (segmentIntersectsBBox(s.base.x, s.base.y, s.tip.x, s.tip.y, newTight)) {
      if (!newBases.some((nb) => pinsMatch(existBases[i], nb))) return true;
    }
  }

  return false;
}

/** Check if a point (snapped) lies inside a bbox */
function pointInBBox(px: number, py: number, box: BBox): boolean {
  return px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height;
}

// ---- Wire-edge occupancy helpers ----

/** Canonical key for a grid edge between two adjacent cells */
function edgeKey(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 < x2 || (x1 === x2 && y1 < y2)) return `${x1},${y1}>${x2},${y2}`;
  return `${x2},${y2}>${x1},${y1}`;
}

/**
 * Check if any segment of a wire's point list intersects a bounding box.
 * Endpoints that are exactly on the bbox border (e.g. connected pins) are ignored.
 */
export function wirePassesThroughBBox(points: Point[], box: BBox): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsBBox(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, box)) {
      return true;
    }
  }
  return false;
}

/**
 * Find all wire IDs on the same electrical net as the given seed points.
 * Uses BFS through shared wire endpoints to discover transitive connectivity.
 */
export function findSameNetWireIds(
  seedPoints: Point[],
  sheetWires: { id: string; points: Point[] }[],
  eps = 2,
): Set<string> {
  const match = (a: Point, b: Point) => Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

  const result = new Set<string>();
  const knownPoints: Point[] = seedPoints.map(p => ({ x: p.x, y: p.y }));
  let changed = true;

  while (changed) {
    changed = false;
    for (const wire of sheetWires) {
      if (result.has(wire.id) || wire.points.length < 2) continue;
      const f = wire.points[0];
      const l = wire.points[wire.points.length - 1];

      if (knownPoints.some(p => match(p, f) || match(p, l))) {
        result.add(wire.id);
        if (!knownPoints.some(p => match(p, f))) { knownPoints.push({ x: f.x, y: f.y }); changed = true; }
        if (!knownPoints.some(p => match(p, l))) { knownPoints.push({ x: l.x, y: l.y }); changed = true; }
      }
    }
  }

  return result;
}

/**
 * Build a set of occupied grid-edge keys from existing wire point arrays.
 * Used so the A* router can penalise paths that would overlap other wires.
 */
export function buildOccupiedEdges(
  wires: { points: Point[] }[],
  grid: number,
): Set<string> {
  const edges = new Set<string>();
  for (const wire of wires) {
    addWireEdges(wire.points, grid, edges);
  }
  return edges;
}

/**
 * Add grid-edge keys for a single wire's points to an existing set.
 * Use this to incrementally update occupied edges after routing a wire.
 */
export function addWireEdges(
  points: Point[],
  grid: number,
  edges: Set<string>,
): void {
  for (let i = 0; i < points.length - 1; i++) {
    const ax = Math.round(points[i].x / grid) * grid;
    const ay = Math.round(points[i].y / grid) * grid;
    const bx = Math.round(points[i + 1].x / grid) * grid;
    const by = Math.round(points[i + 1].y / grid) * grid;
    // Horizontal segment
    if (ay === by) {
      const minX = Math.min(ax, bx);
      const maxX = Math.max(ax, bx);
      for (let x = minX; x < maxX; x += grid) {
        edges.add(edgeKey(x, ay, x + grid, ay));
      }
    // Vertical segment
    } else if (ax === bx) {
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      for (let y = minY; y < maxY; y += grid) {
        edges.add(edgeKey(ax, y, ax, y + grid));
      }
    }
  }
}

/**
 * Return the set of grid-edge keys for a single wire's points.
 */
export function getWireEdgeSet(points: Point[], grid: number = SCHEMATIC_GRID): Set<string> {
  const s = new Set<string>();
  addWireEdges(points, grid, s);
  return s;
}

// ---- Manhattan routing ----

type GridKey = string;
function gk(x: number, y: number): GridKey { return `${x},${y}`; }

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

interface SchRouteOpts {
  from: Point;
  to: Point;
  /** Bounding boxes to avoid (components on this sheet) */
  obstacles: BBox[];
  /** Grid resolution — default SCHEMATIC_GRID */
  grid?: number;
  /** Maximum search area in grid cells from the bounding rect of from/to */
  maxExpand?: number;
  /** Grid edges already occupied by other wires — penalised to avoid overlap */
  occupiedEdges?: Set<string>;
  /** Grid edges belonging to same-net wires — exempt from overlap penalty */
  sameNetEdges?: Set<string>;
  /** Grid cells that are inside obstacle bboxes but should NOT be blocked
   *  (e.g. cells along component pin segments so wires can reach pins). */
  allowedCells?: Set<string>;
  /** Grid cells that must be blocked regardless of allowedCells
   *  (e.g. pin positions from different nets to prevent net-pin overlap). */
  blockedCells?: Set<string>;
}

/**
 * A* Manhattan router for schematic wires.
 * Works in SCHEMATIC_GRID-snapped pixel coordinates.
 * Minimises turns (adds a small penalty for every direction change).
 *
 * Returns an array of Point (corners only, start + end included).
 */
export function routeSchematicWire(opts: SchRouteOpts): Point[] | null {
  const grid = opts.grid ?? SCHEMATIC_GRID;
  const { from, to, obstacles } = opts;
  const maxExpand = opts.maxExpand ?? 60;
  const occupiedEdges = opts.occupiedEdges;
  const sameNetEdges = opts.sameNetEdges;
  const allowedCells = opts.allowedCells;
  const blockedCells = opts.blockedCells;

  // Snap endpoints to grid
  const sx = Math.round(from.x / grid) * grid;
  const sy = Math.round(from.y / grid) * grid;
  const ex = Math.round(to.x / grid) * grid;
  const ey = Math.round(to.y / grid) * grid;

  if (sx === ex && sy === ey) return [{ x: sx, y: sy }];

  // Search bounds
  const lo_x = Math.min(sx, ex) - maxExpand * grid;
  const hi_x = Math.max(sx, ex) + maxExpand * grid;
  const lo_y = Math.min(sy, ey) - maxExpand * grid;
  const hi_y = Math.max(sy, ey) + maxExpand * grid;

  // Check if a grid cell is blocked by an obstacle
  // Start and end positions are always allowed (so wires can reach pins)
  const startKey = gk(sx, sy);
  const endKey = gk(ex, ey);
  const isBlocked = (px: number, py: number): boolean => {
    const key = gk(px, py);
    if (key === startKey || key === endKey) return false;
    if (blockedCells && blockedCells.has(key)) return true;
    if (allowedCells && allowedCells.has(key)) return false;
    for (const box of obstacles) {
      if (pointInBBox(px, py, box)) return true;
    }
    return false;
  };

  // Heuristic — Manhattan distance in grid steps
  const h = (x: number, y: number) =>
    (Math.abs(x - ex) + Math.abs(y - ey)) / grid;

  // Turn penalty — we penalise each direction change to minimize turns
  const TURN_PENALTY = 0.3;

  // State: gk → [gScore, direction-index-that-arrived-here]
  const gScore = new Map<GridKey, number>();
  const cameFrom = new Map<GridKey, GridKey>();
  const dirTo = new Map<GridKey, number>(); // direction index used to arrive

  gScore.set(startKey, 0);

  // Open set as array (board regions are small enough)
  const fScore = new Map<GridKey, number>();
  fScore.set(startKey, h(sx, sy));
  const openSet: GridKey[] = [startKey];
  const inOpen = new Set<GridKey>([startKey]);
  const closed = new Set<GridKey>();

  while (openSet.length > 0) {
    // Pick lowest fScore
    let bestIdx = 0;
    let bestF = fScore.get(openSet[0]) ?? Infinity;
    for (let i = 1; i < openSet.length; i++) {
      const f = fScore.get(openSet[i]) ?? Infinity;
      if (f < bestF) { bestF = f; bestIdx = i; }
    }
    const currentKey = openSet.splice(bestIdx, 1)[0];
    inOpen.delete(currentKey);

    if (currentKey === endKey) {
      return reconstructAndSimplify(cameFrom, endKey, grid);
    }

    closed.add(currentKey);
    const [cx, cy] = currentKey.split(',').map(Number);
    const currentG = gScore.get(currentKey) ?? Infinity;
    const currentDir = dirTo.get(currentKey); // undefined at start

    for (let di = 0; di < DIRS.length; di++) {
      const [dx, dy] = DIRS[di];
      const nx = cx + dx * grid;
      const ny = cy + dy * grid;

      // Bounds
      if (nx < lo_x || nx > hi_x || ny < lo_y || ny > hi_y) continue;

      const nKey = gk(nx, ny);
      if (closed.has(nKey)) continue;

      // Allow endpoints even if inside obstacle
      if (nKey !== startKey && nKey !== endKey && isBlocked(nx, ny)) continue;

      // Cost: 1 per step + turn penalty + overlap penalty
      const isTurn = currentDir !== undefined && currentDir !== di;
      const OVERLAP_PENALTY = 50;
      const ek = edgeKey(cx, cy, nx, ny);
      const edgeOccupied = occupiedEdges
        ? occupiedEdges.has(ek) && !(sameNetEdges && sameNetEdges.has(ek))
        : false;
      const tentativeG = currentG + 1 + (isTurn ? TURN_PENALTY : 0) + (edgeOccupied ? OVERLAP_PENALTY : 0);
      const prevG = gScore.get(nKey) ?? Infinity;

      if (tentativeG < prevG) {
        cameFrom.set(nKey, currentKey);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + h(nx, ny));
        dirTo.set(nKey, di);
        if (!inOpen.has(nKey)) {
          openSet.push(nKey);
          inOpen.add(nKey);
        }
      }
    }
  }

  // A* exhausted — no valid route found
  return null;
}

function reconstructAndSimplify(
  cameFrom: Map<GridKey, GridKey>,
  endKey: GridKey,
  _grid: number,
): Point[] {
  const raw: Point[] = [];
  let key: GridKey | undefined = endKey;
  while (key) {
    const [x, y] = key.split(',').map(Number);
    raw.unshift({ x, y });
    key = cameFrom.get(key);
  }

  // Simplify — keep only corners (direction changes)
  if (raw.length <= 2) return raw;
  const result: Point[] = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const prev = raw[i - 1];
    const curr = raw[i];
    const next = raw[i + 1];
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    if (dx1 !== dx2 || dy1 !== dy2) {
      result.push(curr);
    }
  }
  result.push(raw[raw.length - 1]);
  return result;
}

/**
 * Build a set of grid cell keys for pin positions (and their corridor cells)
 * that do NOT belong to the same electrical net as the given wire endpoints.
 * These cells should be blocked during routing to prevent wires from
 * overlapping with pins of different nets.
 */
export function buildOtherNetPinCells(
  components: SchematicComponent[],
  allLib: { id: string; symbol: ComponentSymbol }[],
  wireEndpoints: Point[],
  sheetWires: { id: string; points: Point[] }[],
  grid: number = SCHEMATIC_GRID,
): Set<string> {
  // Determine same-net connectivity via wire graph
  const sameNetIds = findSameNetWireIds(wireEndpoints, sheetWires);
  const sameNetPoints: Point[] = [...wireEndpoints];
  for (const w of sheetWires) {
    if (sameNetIds.has(w.id) && w.points.length >= 2) {
      sameNetPoints.push(w.points[0]);
      sameNetPoints.push(w.points[w.points.length - 1]);
    }
  }

  const PIN_EPS = 2;
  const isSameNet = (p: Point) => sameNetPoints.some(
    sp => Math.abs(sp.x - p.x) < PIN_EPS && Math.abs(sp.y - p.y) < PIN_EPS,
  );

  const blocked = new Set<string>();
  for (const comp of components) {
    const def = allLib.find(d => d.id === comp.libraryId);
    if (!def) continue;
    const segs = getComponentPinSegments(comp, def.symbol);
    for (const seg of segs) {
      if (isSameNet(seg.base)) continue;
      // Block pin base cell and corridor cells along the pin segment (base → tip)
      const bx = Math.round(seg.base.x / grid) * grid;
      const by = Math.round(seg.base.y / grid) * grid;
      const tx = Math.round(seg.tip.x / grid) * grid;
      const ty = Math.round(seg.tip.y / grid) * grid;
      blocked.add(`${bx},${by}`);
      if (by === ty) {
        const minX = Math.min(bx, tx);
        const maxX = Math.max(bx, tx);
        for (let x = minX; x <= maxX; x += grid) {
          blocked.add(`${x},${by}`);
        }
      } else if (bx === tx) {
        const minY = Math.min(by, ty);
        const maxY = Math.max(by, ty);
        for (let y = minY; y <= maxY; y += grid) {
          blocked.add(`${bx},${y}`);
        }
      }
    }
  }
  return blocked;
}

function lRoute(from: Point, to: Point): Point[] {
  if (from.x === to.x || from.y === to.y) return [from, to];
  return [from, { x: to.x, y: from.y }, to];
}
