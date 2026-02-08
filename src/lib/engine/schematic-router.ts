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

      // Cost: 1 per step + turn penalty
      const isTurn = currentDir !== undefined && currentDir !== di;
      const tentativeG = currentG + 1 + (isTurn ? TURN_PENALTY : 0);
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

function lRoute(from: Point, to: Point): Point[] {
  if (from.x === to.x || from.y === to.y) return [from, to];
  return [from, { x: to.x, y: from.y }, to];
}
