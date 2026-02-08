// ============================================================
// Auto-Layout — High-quality placement for perfboard components
//
// Multi-phase approach inspired by VLSI analytical placement:
//  1. Connectivity analysis & zone classification
//  2. Force-directed initial placement (Fruchterman-Reingold)
//  3. Grid legalization with overlap resolution
//  4. Simulated annealing wire-length optimisation
//  5. Mode-specific post-processing (row alignment, bounds)
//
// Cost metric: Pin-Aware Half-Perimeter Wire Length (HPWL).
// Unlike naive component-origin HPWL, this computes bounding-box
// wire length from the actual pin positions (component origin +
// rotated pad offset) for each net.  This is critical for correct
// placement — a resistor's far-end pin can be 4+ holes from the
// origin, and ignoring that offset leads to large placement errors.
//
// Zone preferences (VCC top-left, GND bottom-left, output right)
// are modelled as *soft* constraints so the optimiser can trade
// off zone placement against connectivity when needed.
// ============================================================

import type {
  GridPosition,
  PerfboardComponent,
  PerfboardDocument,
  SchematicDocument,
  ComponentDefinition,
  Net,
} from '@/types';
import { buildNetlist } from './netlist';
import { getAdjustedFootprint } from '@/lib/component-library';
import { rotatePad, getFootprintBBox, gridBBoxOverlap } from './router';
import type { GridBBox } from './router';

// ---- Public types ---------------------------------------------------

/**
 * - `compact`        — Tight packing, 1-cell routing gap
 * - `easy_soldering` — Extra room for comfortable hand-soldering
 * - `beautiful`      — Signal-flow columns, aligned rows, generous gaps
 */
export type AutoLayoutMode = 'compact' | 'easy_soldering' | 'beautiful';

export interface AutoLayoutOptions {
  /** Board width in grid holes */
  boardWidth: number;
  /** Board height in grid holes */
  boardHeight: number;
  /** Layout mode */
  mode?: AutoLayoutMode;
  /** Override margin */
  margin?: number;
  /** Override spacing */
  spacing?: number;
}

export interface AutoLayoutResult {
  /** New grid positions keyed by perfboard component id */
  positions: Map<string, GridPosition>;
  /** Components successfully placed */
  placed: number;
  /** Components that could not be placed */
  failed: number;
}

// ---- Internal types -------------------------------------------------

/** Which functional zone a component belongs to */
type CompZone = 'power' | 'gnd' | 'output' | 'general';

interface CompInfo {
  idx: number;
  comp: PerfboardComponent;
  def: ComponentDefinition | undefined;
  pads: GridPosition[];
  spanHoles: GridPosition;
  /** BBox relative to origin (0,0) — used for collision offsets */
  localBBox: GridBBox;
  w: number; // bbox width in holes
  h: number; // bbox height in holes
  zone: CompZone;
  signalDepth: number;
  /** Indices into `netInfos` that reference this component */
  netIndices: number[];
}

/**
 * Pin-level net representation.  Each entry stores the component
 * index and the *rotated* pad offset so the absolute pin position
 * is simply  pos[compIdx] + {padCol, padRow}.
 */
interface NetPinRef {
  compIdx: number;
  padCol: number;
  padRow: number;
}

interface NetInfo {
  pins: NetPinRef[];
  /** Unique component indices for adjacency / compToNets mapping */
  compIndices: number[];
}

interface ModePreset {
  margin: number;
  spacing: number;
  rowGap: number;
  alignRows: boolean;
  routingChannel: number;
}

// ---- Constants & presets --------------------------------------------

const MODE_PRESETS: Record<AutoLayoutMode, ModePreset> = {
  compact: { margin: 1, spacing: 1, rowGap: 0, alignRows: false, routingChannel: 1 },
  easy_soldering: { margin: 2, spacing: 2, rowGap: 1, alignRows: true, routingChannel: 2 },
  beautiful: { margin: 2, spacing: 3, rowGap: 2, alignRows: true, routingChannel: 2 },
};

const GND_RE = /^(gnd|vss|ground|masse|0v|gnd\d*)$/i;
const PWR_RE = /^(vcc|vdd|v\+|vin|\+\d+v?|\d+v|3v3|5v|12v|power|supply|vbat)$/i;
const OUT_RE = /^(out|output|vout|q|y|do|dout|tx|mosi|sck|sda|scl)$/i;

// ---- Zone classification -------------------------------------------

function classifyComponent(
  comp: PerfboardComponent,
  def: ComponentDefinition | undefined,
  netsForComp: Net[],
): CompZone {
  if (!def) return 'general';
  const id = def.id.toLowerCase();
  const cat = (def.category || '').toLowerCase();
  const name = def.name.toLowerCase();

  if (id === 'power_vcc' || id === 'power_vdd' || name === 'vcc' || name === 'vdd') return 'power';
  if (id === 'power_gnd' || name === 'gnd') return 'gnd';
  if (cat === 'power' || id.includes('voltage_reg')) return 'power';

  if (cat === 'connectors') {
    const nn = netsForComp.map((n) => n.name);
    const hasGnd = nn.some((s) => GND_RE.test(s));
    const hasPwr = nn.some((s) => PWR_RE.test(s));
    if (hasGnd && !hasPwr) return 'gnd';
    if (hasPwr && !hasGnd) return 'power';
    if (nn.some((s) => OUT_RE.test(s))) return 'output';
  }

  const pins = def.symbol?.pins ?? [];
  if (
    pins.length > 0 &&
    pins.every((p) => p.electricalType === 'power_in' || p.electricalType === 'power_out')
  ) {
    const pn = pins.map((p) => p.name.toLowerCase());
    if (pn.some((s) => GND_RE.test(s))) return 'gnd';
    if (pn.some((s) => PWR_RE.test(s))) return 'power';
  }

  for (const net of netsForComp) {
    if (OUT_RE.test(net.name)) {
      for (const conn of net.connections) {
        if (conn.componentId === comp.schematicComponentId && OUT_RE.test(conn.pinName))
          return 'output';
      }
    }
  }

  return 'general';
}

// ---- Signal depth (BFS from power sources) --------------------------

function computeSignalDepth(infos: CompInfo[], adj: number[][]): void {
  const n = infos.length;
  const depth = new Int32Array(n).fill(-1);
  const queue: number[] = [];

  for (let i = 0; i < n; i++) {
    if (infos[i].zone === 'power') {
      depth[i] = 0;
      queue.push(i);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (let j = 0; j < n; j++) {
      if (adj[cur][j] > 0 && depth[j] === -1 && infos[j].zone !== 'gnd') {
        depth[j] = depth[cur] + 1;
        queue.push(j);
      }
    }
  }

  // Propagate to disconnected components
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (depth[i] >= 0 || infos[i].zone === 'gnd') continue;
      let best = Infinity;
      for (let j = 0; j < n; j++) {
        if (adj[i][j] > 0 && depth[j] >= 0) best = Math.min(best, depth[j]);
      }
      if (best < Infinity) {
        depth[i] = best + 1;
        changed = true;
      }
    }
  }

  const maxD = Math.max(0, ...Array.from(depth).filter((d) => d >= 0));
  for (let i = 0; i < n; i++) {
    infos[i].signalDepth =
      infos[i].zone === 'gnd' ? maxD + 1 : depth[i] >= 0 ? depth[i] : maxD;
  }
}

// ---- Pin-Aware HPWL cost functions ---------------------------------

/**
 * Compute total HPWL using actual pin positions:
 *   absolute pin pos = pos[compIdx] + {padCol, padRow}
 */
function computeHPWL(pos: GridPosition[], nets: NetInfo[]): number {
  let total = 0;
  for (let ni = 0; ni < nets.length; ni++) {
    const pins = nets[ni].pins;
    if (pins.length < 2) continue;
    const p0 = pins[0];
    let mnC = pos[p0.compIdx].col + p0.padCol;
    let mxC = mnC;
    let mnR = pos[p0.compIdx].row + p0.padRow;
    let mxR = mnR;
    for (let k = 1; k < pins.length; k++) {
      const pk = pins[k];
      const c = pos[pk.compIdx].col + pk.padCol;
      const r = pos[pk.compIdx].row + pk.padRow;
      if (c < mnC) mnC = c;
      else if (c > mxC) mxC = c;
      if (r < mnR) mnR = r;
      else if (r > mxR) mxR = r;
    }
    total += mxC - mnC + (mxR - mnR);
  }
  return total;
}

/**
 * Incremental HPWL delta when shifting component `ci` from oldP to newP.
 * Only recomputes nets that contain a pin from ci.
 */
function hpwlDeltaShift(
  ci: number,
  oldP: GridPosition,
  newP: GridPosition,
  pos: GridPosition[],
  compToNets: number[][],
  nets: NetInfo[],
): number {
  let delta = 0;
  for (const ni of compToNets[ci]) {
    const pins = nets[ni].pins;
    let oMnC = Infinity, oMxC = -Infinity, oMnR = Infinity, oMxR = -Infinity;
    let nMnC = Infinity, nMxC = -Infinity, nMnR = Infinity, nMxR = -Infinity;
    for (const pk of pins) {
      // Old HPWL: pin positions using oldP for component ci
      const oBase = pk.compIdx === ci ? oldP : pos[pk.compIdx];
      const oc = oBase.col + pk.padCol;
      const or = oBase.row + pk.padRow;
      if (oc < oMnC) oMnC = oc; if (oc > oMxC) oMxC = oc;
      if (or < oMnR) oMnR = or; if (or > oMxR) oMxR = or;
      // New HPWL: pin positions using newP for component ci
      const nBase = pk.compIdx === ci ? newP : pos[pk.compIdx];
      const nc = nBase.col + pk.padCol;
      const nr = nBase.row + pk.padRow;
      if (nc < nMnC) nMnC = nc; if (nc > nMxC) nMxC = nc;
      if (nr < nMnR) nMnR = nr; if (nr > nMxR) nMxR = nr;
    }
    delta += (nMxC - nMnC) + (nMxR - nMnR) - (oMxC - oMnC) - (oMxR - oMnR);
  }
  return delta;
}

/**
 * Incremental HPWL delta when swapping ci↔cj.
 * `pos` must already contain the swapped positions.
 */
function hpwlDeltaSwap(
  ci: number,
  cj: number,
  oldPosI: GridPosition,
  oldPosJ: GridPosition,
  pos: GridPosition[],
  compToNets: number[][],
  nets: NetInfo[],
): number {
  // Collect unique affected net indices
  const seen = new Uint8Array(nets.length);
  const affected: number[] = [];
  for (const ni of compToNets[ci]) { if (!seen[ni]) { seen[ni] = 1; affected.push(ni); } }
  for (const ni of compToNets[cj]) { if (!seen[ni]) { seen[ni] = 1; affected.push(ni); } }

  let delta = 0;
  for (const ni of affected) {
    const pins = nets[ni].pins;
    let oMnC = Infinity, oMxC = -Infinity, oMnR = Infinity, oMxR = -Infinity;
    let nMnC = Infinity, nMxC = -Infinity, nMnR = Infinity, nMxR = -Infinity;
    for (const pk of pins) {
      // Old: ci was at oldPosI, cj was at oldPosJ
      const oBase = pk.compIdx === ci ? oldPosI : pk.compIdx === cj ? oldPosJ : pos[pk.compIdx];
      const oc = oBase.col + pk.padCol;
      const or_ = oBase.row + pk.padRow;
      if (oc < oMnC) oMnC = oc; if (oc > oMxC) oMxC = oc;
      if (or_ < oMnR) oMnR = or_; if (or_ > oMxR) oMxR = or_;
      // New: pos[ci] and pos[cj] are already swapped
      const nBase = pos[pk.compIdx];
      const nc = nBase.col + pk.padCol;
      const nr = nBase.row + pk.padRow;
      if (nc < nMnC) nMnC = nc; if (nc > nMxC) nMxC = nc;
      if (nr < nMnR) nMnR = nr; if (nr > nMxR) nMxR = nr;
    }
    delta += (nMxC - nMnC) + (nMxR - nMnR) - (oMxC - oMnC) - (oMxR - oMnR);
  }
  return delta;
}

// ---- Zone penalty ---------------------------------------------------

function zonePenalty(
  pos: GridPosition[],
  infos: CompInfo[],
  bw: number,
  bh: number,
  w: number,
): number {
  let pen = 0;
  for (let i = 0; i < infos.length; i++) {
    const p = pos[i];
    switch (infos[i].zone) {
      case 'power':  pen += w * (p.col / bw + p.row / bh); break;
      case 'gnd':    pen += w * (p.col / bw + (1 - p.row / bh)); break;
      case 'output': pen += w * (1 - p.col / bw); break;
    }
  }
  return pen;
}

function zonePenDelta(
  ci: number,
  oldP: GridPosition,
  newP: GridPosition,
  infos: CompInfo[],
  bw: number,
  bh: number,
  w: number,
): number {
  const zone = infos[ci].zone;
  if (zone === 'general') return 0;
  let ov = 0, nv = 0;
  switch (zone) {
    case 'power':
      ov = w * (oldP.col / bw + oldP.row / bh);
      nv = w * (newP.col / bw + newP.row / bh);
      break;
    case 'gnd':
      ov = w * (oldP.col / bw + (1 - oldP.row / bh));
      nv = w * (newP.col / bw + (1 - newP.row / bh));
      break;
    case 'output':
      ov = w * (1 - oldP.col / bw);
      nv = w * (1 - newP.col / bw);
      break;
  }
  return nv - ov;
}

// ---- Phase 2: Force-directed placement (continuous) -----------------

function forceDirectedPlacement(
  infos: CompInfo[],
  adj: number[][],
  bw: number,
  bh: number,
  margin: number,
  spacing: number,
): { x: number; y: number }[] {
  const n = infos.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: bw / 2, y: bh / 2 }];

  const uw = bw - 2 * margin;
  const uh = bh - 2 * margin;
  // Cap optimal distance so large boards don't spread tiny components too far
  const area = uw * uh;
  const k = Math.min(Math.sqrt(area / n) * 0.8, Math.max(uw, uh) * 0.3);

  const maxDepth = Math.max(1, ...infos.map((c) => c.signalDepth));

  // ---- Deterministic initial positions based on zone + depth --------
  const pos: { x: number; y: number }[] = new Array(n);
  {
    const zoneCounts: Record<CompZone, number> = { power: 0, gnd: 0, output: 0, general: 0 };
    const zoneIdx: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      zoneIdx[i] = zoneCounts[infos[i].zone]++;
    }

    for (let i = 0; i < n; i++) {
      const ci = infos[i];
      const zi = zoneIdx[i];
      const zn = Math.max(zoneCounts[ci.zone], 1);
      const vFrac = (zi + 0.5) / zn;
      let x: number, y: number;

      switch (ci.zone) {
        case 'power':
          x = margin + uw * 0.08;
          y = margin + uh * (0.05 + 0.35 * vFrac);
          break;
        case 'gnd':
          x = margin + uw * 0.08;
          y = margin + uh * (0.6 + 0.35 * vFrac);
          break;
        case 'output':
          x = margin + uw * 0.92;
          y = margin + uh * (0.15 + 0.7 * vFrac);
          break;
        default: {
          const dFrac = ci.signalDepth / maxDepth;
          x = margin + uw * (0.18 + 0.64 * dFrac);
          const h = ((i * 7 + 3) % 11) / 11;
          y = margin + uh * (0.15 + 0.7 * h);
          break;
        }
      }
      pos[i] = { x, y };
    }
  }

  // ---- Fruchterman-Reingold iterations ----
  const ITERS = 150;
  let temp = Math.max(uw, uh) * 0.3;
  const coolRate = temp / (ITERS + 1);

  const dxArr = new Float64Array(n);
  const dyArr = new Float64Array(n);

  for (let iter = 0; iter < ITERS; iter++) {
    dxArr.fill(0);
    dyArr.fill(0);

    // Repulsive forces — all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ddx = pos[i].x - pos[j].x;
        const ddy = pos[i].y - pos[j].y;
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        // Use component-size-aware minimum separation but CAP it
        // so large ICs don't cause massive repulsion
        const minSep = Math.min(
          (infos[i].w + infos[j].w) * 0.5 + spacing,
          k * 1.5,
        );
        const ek = Math.max(k, minSep);
        const f = (ek * ek) / dist;
        const fx = (ddx / dist) * f;
        const fy = (ddy / dist) * f;
        dxArr[i] += fx;  dyArr[i] += fy;
        dxArr[j] -= fx;  dyArr[j] -= fy;
      }
    }

    // Attractive forces — connected pairs (stronger coefficient)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const w = adj[i][j];
        if (w <= 0) continue;
        const ddx = pos[i].x - pos[j].x;
        const ddy = pos[i].y - pos[j].y;
        const dist = Math.max(Math.sqrt(ddx * ddx + ddy * ddy), 0.01);
        const f = ((dist * dist) / k) * w * 0.5;
        const fx = (ddx / dist) * f;
        const fy = (ddy / dist) * f;
        dxArr[i] -= fx;  dyArr[i] -= fy;
        dxArr[j] += fx;  dyArr[j] += fy;
      }
    }

    // Zone gravity — soft pull toward preferred regions
    const grav = 0.3 * (temp / Math.max(uw, uh));
    for (let i = 0; i < n; i++) {
      const ci = infos[i];
      let tx = pos[i].x, ty = pos[i].y;
      switch (ci.zone) {
        case 'power':
          tx = margin + uw * 0.08; ty = margin + uh * 0.15;
          break;
        case 'gnd':
          tx = margin + uw * 0.08; ty = margin + uh * 0.85;
          break;
        case 'output':
          tx = margin + uw * 0.9;  ty = margin + uh * 0.5;
          break;
        default:
          tx = margin + uw * (0.15 + 0.7 * (ci.signalDepth / maxDepth));
          ty = pos[i].y;
          break;
      }
      dxArr[i] += (tx - pos[i].x) * grav;
      dyArr[i] += (ty - pos[i].y) * grav * 0.3;
    }

    // Apply displacements, limited by temperature
    for (let i = 0; i < n; i++) {
      const mag = Math.sqrt(dxArr[i] * dxArr[i] + dyArr[i] * dyArr[i]);
      if (mag > 0) {
        const s = Math.min(mag, temp) / mag;
        pos[i].x += dxArr[i] * s;
        pos[i].y += dyArr[i] * s;
      }
      const hw = infos[i].w * 0.5;
      const hh = infos[i].h * 0.5;
      pos[i].x = Math.max(margin + hw, Math.min(bw - margin - hw, pos[i].x));
      pos[i].y = Math.max(margin + hh, Math.min(bh - margin - hh, pos[i].y));
    }

    temp -= coolRate;
  }

  return pos;
}

// ---- Phase 3: Grid legalization ------------------------------------

function legalize(
  floatPos: { x: number; y: number }[],
  infos: CompInfo[],
  bw: number,
  bh: number,
  margin: number,
  spacing: number,
  rowSnap: number,
): GridPosition[] {
  const n = infos.length;
  const positions: (GridPosition | null)[] = new Array(n).fill(null);
  const placedBBoxes: GridBBox[] = [];

  const ZPRI: Record<CompZone, number> = { power: 0, gnd: 1, output: 2, general: 3 };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const za = ZPRI[infos[a].zone], zb = ZPRI[infos[b].zone];
    if (za !== zb) return za - zb;
    return infos[b].netIndices.length - infos[a].netIndices.length;
  });

  for (const ci of order) {
    let tCol = Math.round(floatPos[ci].x);
    let tRow = Math.round(floatPos[ci].y);
    if (rowSnap > 0) tRow = Math.round((tRow - margin) / rowSnap) * rowSnap + margin;

    const pos = spiralFindFree(
      tCol, tRow, infos[ci].localBBox, placedBBoxes,
      bw, bh, margin, spacing, rowSnap,
    );
    if (pos) {
      positions[ci] = pos;
      placedBBoxes.push(
        getFootprintBBox(pos, infos[ci].comp.rotation, infos[ci].pads, infos[ci].spanHoles),
      );
    }
  }

  return positions.map((p, i) => p ?? { col: margin, row: margin + i * 3 });
}

/** Expanding-diamond search for a collision-free grid cell */
function spiralFindFree(
  tCol: number,
  tRow: number,
  localBBox: GridBBox,
  placed: GridBBox[],
  bw: number,
  bh: number,
  margin: number,
  spacing: number,
  rowSnap: number,
): GridPosition | null {
  const maxR = Math.max(bw, bh);
  if (rowSnap > 0) {
    const r = _spiral(tCol, tRow, localBBox, placed, bw, bh, margin, spacing, maxR, rowSnap);
    if (r) return r;
  }
  return _spiral(tCol, tRow, localBBox, placed, bw, bh, margin, spacing, maxR, 0);
}

function _spiral(
  tCol: number, tRow: number,
  lb: GridBBox, placed: GridBBox[],
  bw: number, bh: number,
  margin: number, spacing: number,
  maxR: number, rowSnap: number,
): GridPosition | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dc = -r; dc <= r; dc++) {
      const dr = r - Math.abs(dc);
      const cands = dr === 0 ? [0] : [-dr, dr];
      for (const dRow of cands) {
        const col = tCol + dc;
        const row = tRow + dRow;
        if (rowSnap > 0 && (row - margin) % rowSnap !== 0) continue;

        const tb: GridBBox = {
          minCol: col + lb.minCol, minRow: row + lb.minRow,
          maxCol: col + lb.maxCol, maxRow: row + lb.maxRow,
        };
        if (tb.minCol < margin || tb.minRow < margin ||
            tb.maxCol >= bw - margin || tb.maxRow >= bh - margin) continue;

        const eb: GridBBox = {
          minCol: tb.minCol - spacing, minRow: tb.minRow - spacing,
          maxCol: tb.maxCol + spacing, maxRow: tb.maxRow + spacing,
        };
        let ok = true;
        for (let i = 0; i < placed.length; i++) {
          if (gridBBoxOverlap(eb, placed[i])) { ok = false; break; }
        }
        if (ok) return { col, row };
      }
    }
  }
  return null;
}

// ---- Phase 4: Simulated annealing ----------------------------------

function simulatedAnnealing(
  positions: GridPosition[],
  infos: CompInfo[],
  nets: NetInfo[],
  bw: number,
  bh: number,
  margin: number,
  spacing: number,
  zonePenW: number,
  compToNets: number[][],
): GridPosition[] {
  const n = infos.length;
  if (n <= 1) return positions.map((p) => ({ ...p }));

  const pos = positions.map((p) => ({ ...p }));
  const bboxes: GridBBox[] = infos.map((ci, i) =>
    getFootprintBBox(pos[i], ci.comp.rotation, ci.pads, ci.spanHoles),
  );

  let curHPWL = computeHPWL(pos, nets);
  let curZP = zonePenalty(pos, infos, bw, bh, zonePenW);
  let curCost = curHPWL + curZP;

  // Scale iterations with problem size but cap for responsiveness
  const iters = Math.min(200_000, Math.max(10_000, 120 * n * n));
  const tStart = Math.sqrt(bw * bh) * 0.35;
  const tEnd = 0.005;
  const alpha = Math.pow(tEnd / tStart, 1 / iters);
  let temp = tStart;

  let bestCost = curCost;
  const bestPos = pos.map((p) => ({ ...p }));

  // Deterministic PRNG (LCG)
  let seed = 12345;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const randInt = (max: number) => Math.floor(rand() * max);

  for (let it = 0; it < iters; it++) {
    if (rand() < 0.6) {
      // ---- SHIFT move ----
      const ci = randInt(n);
      const maxS = Math.max(1, Math.ceil(temp * 0.8));
      const dc = randInt(maxS * 2 + 1) - maxS;
      const dr = randInt(maxS * 2 + 1) - maxS;
      if (dc === 0 && dr === 0) { temp *= alpha; continue; }

      const newP: GridPosition = { col: pos[ci].col + dc, row: pos[ci].row + dr };
      const lb = infos[ci].localBBox;

      // Bounds check
      if (newP.col + lb.minCol < margin || newP.row + lb.minRow < margin ||
          newP.col + lb.maxCol >= bw - margin || newP.row + lb.maxRow >= bh - margin) {
        temp *= alpha; continue;
      }

      // Collision check (expanded for routing channel)
      const eb: GridBBox = {
        minCol: newP.col + lb.minCol - spacing, minRow: newP.row + lb.minRow - spacing,
        maxCol: newP.col + lb.maxCol + spacing, maxRow: newP.row + lb.maxRow + spacing,
      };
      let collides = false;
      for (let j = 0; j < n; j++) {
        if (j === ci) continue;
        if (gridBBoxOverlap(eb, bboxes[j])) { collides = true; break; }
      }
      if (collides) { temp *= alpha; continue; }

      // Incremental cost using pin-aware HPWL
      const oldP = pos[ci];
      const dH = hpwlDeltaShift(ci, oldP, newP, pos, compToNets, nets);
      const dZ = zonePenDelta(ci, oldP, newP, infos, bw, bh, zonePenW);
      const delta = dH + dZ;

      if (delta < 0 || rand() < Math.exp(-delta / Math.max(temp, 0.001))) {
        pos[ci] = newP;
        curHPWL += dH;
        curZP += dZ;
        curCost = curHPWL + curZP;
        bboxes[ci] = getFootprintBBox(newP, infos[ci].comp.rotation, infos[ci].pads, infos[ci].spanHoles);
        if (curCost < bestCost) {
          bestCost = curCost;
          for (let j = 0; j < n; j++) { bestPos[j].col = pos[j].col; bestPos[j].row = pos[j].row; }
        }
      }
    } else {
      // ---- SWAP move ----
      const ci = randInt(n);
      let cj = randInt(n - 1);
      if (cj >= ci) cj++;

      const posI = pos[ci], posJ = pos[cj];
      const lbI = infos[ci].localBBox, lbJ = infos[cj].localBBox;

      // BBoxes at swapped positions
      const bI_atJ: GridBBox = {
        minCol: posJ.col + lbI.minCol, minRow: posJ.row + lbI.minRow,
        maxCol: posJ.col + lbI.maxCol, maxRow: posJ.row + lbI.maxRow,
      };
      const bJ_atI: GridBBox = {
        minCol: posI.col + lbJ.minCol, minRow: posI.row + lbJ.minRow,
        maxCol: posI.col + lbJ.maxCol, maxRow: posI.row + lbJ.maxRow,
      };

      // Bounds
      if (bI_atJ.minCol < margin || bI_atJ.minRow < margin ||
          bI_atJ.maxCol >= bw - margin || bI_atJ.maxRow >= bh - margin ||
          bJ_atI.minCol < margin || bJ_atI.minRow < margin ||
          bJ_atI.maxCol >= bw - margin || bJ_atI.maxRow >= bh - margin) {
        temp *= alpha; continue;
      }

      // Collision of each at other's position against all others
      const eI: GridBBox = {
        minCol: bI_atJ.minCol - spacing, minRow: bI_atJ.minRow - spacing,
        maxCol: bI_atJ.maxCol + spacing, maxRow: bI_atJ.maxRow + spacing,
      };
      const eJ: GridBBox = {
        minCol: bJ_atI.minCol - spacing, minRow: bJ_atI.minRow - spacing,
        maxCol: bJ_atI.maxCol + spacing, maxRow: bJ_atI.maxRow + spacing,
      };

      let ok = true;
      for (let k = 0; k < n; k++) {
        if (k === ci || k === cj) continue;
        if (gridBBoxOverlap(eI, bboxes[k]) || gridBBoxOverlap(eJ, bboxes[k])) { ok = false; break; }
      }
      // Mutual spacing between the two swapped components
      if (ok) ok = !gridBBoxOverlap(eI, bJ_atI);
      if (!ok) { temp *= alpha; continue; }

      // Apply swap, compute cost
      const savedI = { ...posI }, savedJ = { ...posJ };
      pos[ci] = { col: posJ.col, row: posJ.row };
      pos[cj] = { col: savedI.col, row: savedI.row };

      const dH = hpwlDeltaSwap(ci, cj, savedI, savedJ, pos, compToNets, nets);
      const dZ = zonePenDelta(ci, savedI, pos[ci], infos, bw, bh, zonePenW)
               + zonePenDelta(cj, savedJ, pos[cj], infos, bw, bh, zonePenW);
      const delta = dH + dZ;

      if (delta < 0 || rand() < Math.exp(-delta / Math.max(temp, 0.001))) {
        curHPWL += dH;
        curZP += dZ;
        curCost = curHPWL + curZP;
        bboxes[ci] = getFootprintBBox(pos[ci], infos[ci].comp.rotation, infos[ci].pads, infos[ci].spanHoles);
        bboxes[cj] = getFootprintBBox(pos[cj], infos[cj].comp.rotation, infos[cj].pads, infos[cj].spanHoles);
        if (curCost < bestCost) {
          bestCost = curCost;
          for (let j = 0; j < n; j++) { bestPos[j].col = pos[j].col; bestPos[j].row = pos[j].row; }
        }
      } else {
        pos[ci] = savedI;
        pos[cj] = savedJ;
      }
    }

    temp *= alpha;
  }

  return bestPos;
}

// ---- Phase 5: Post-processing — overlap-safe row re-alignment ------

/**
 * After SA, re-snap to row bands while guaranteeing no overlaps.
 * All components are placed through the spiral finder against a fresh
 * placement list, so the result is guaranteed overlap-free.
 * If a component cannot be row-aligned, it tries unaligned.
 * If it still fails, it's placed at ANY free position on the board.
 */
function postProcessRowAlign(
  positions: GridPosition[],
  infos: CompInfo[],
  bw: number,
  bh: number,
  margin: number,
  spacing: number,
  rowSnap: number,
): GridPosition[] {
  if (rowSnap <= 0) return positions;

  const n = infos.length;
  const result: GridPosition[] = new Array(n);
  const placedBBoxes: GridBBox[] = [];

  // Place left-to-right to preserve signal-flow column order
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => positions[a].col - positions[b].col,
  );

  for (const ci of order) {
    const tCol = positions[ci].col;
    const tRow = Math.round((positions[ci].row - margin) / rowSnap) * rowSnap + margin;

    // Try 1: row-aligned near SA position
    let pos = spiralFindFree(
      tCol, tRow, infos[ci].localBBox, placedBBoxes,
      bw, bh, margin, spacing, rowSnap,
    );
    // Try 2: unaligned near SA position
    if (!pos) {
      pos = spiralFindFree(
        tCol, positions[ci].row, infos[ci].localBBox, placedBBoxes,
        bw, bh, margin, spacing, 0,
      );
    }
    // Try 3: anywhere on the board (center as target)
    if (!pos) {
      pos = spiralFindFree(
        Math.round(bw / 2), Math.round(bh / 2),
        infos[ci].localBBox, placedBBoxes,
        bw, bh, margin, spacing, 0,
      );
    }

    if (pos) {
      result[ci] = pos;
      placedBBoxes.push(
        getFootprintBBox(pos, infos[ci].comp.rotation, infos[ci].pads, infos[ci].spanHoles),
      );
    } else {
      // Last resort — still register bbox to prevent future overlaps
      result[ci] = positions[ci];
      placedBBoxes.push(
        getFootprintBBox(positions[ci], infos[ci].comp.rotation, infos[ci].pads, infos[ci].spanHoles),
      );
    }
  }

  return result;
}

// ---- Main entry point -----------------------------------------------

export function autoLayout(
  perfboard: PerfboardDocument,
  schematic: SchematicDocument,
  allLib: ComponentDefinition[],
  options: AutoLayoutOptions,
): AutoLayoutResult {
  const mode = options.mode ?? 'easy_soldering';
  const preset = MODE_PRESETS[mode];
  const margin = options.margin ?? preset.margin;
  const spacing = Math.max(options.spacing ?? preset.spacing, preset.routingChannel);
  const { boardWidth, boardHeight } = options;

  const components = perfboard.components;
  if (components.length === 0) {
    return { positions: new Map(), placed: 0, failed: 0 };
  }

  const n = components.length;

  // ==== Phase 1: Connectivity analysis ================================

  const netlist = buildNetlist(schematic);

  const schIdToIdx = new Map<string, number>();
  components.forEach((c, i) => {
    if (c.schematicComponentId) schIdToIdx.set(c.schematicComponentId, i);
  });

  // Nets per component (for zone classification)
  const rawNetsForComp: Net[][] = Array.from({ length: n }, () => []);
  for (const net of netlist.nets) {
    for (const conn of net.connections) {
      const idx = schIdToIdx.get(conn.componentId);
      if (idx !== undefined) rawNetsForComp[idx].push(net);
    }
  }

  // Build CompInfo array (need footprints for pin-level net building)
  const infos: CompInfo[] = components.map((comp, i) => {
    const def = allLib.find((d) => d.id === comp.libraryId);
    let pads: GridPosition[] = [];
    let spanHoles: GridPosition = { col: 1, row: 1 };
    if (def) {
      const fp = getAdjustedFootprint(def, comp.properties?.holeSpan);
      pads = fp.pads.map((p) => p.gridPosition);
      spanHoles = fp.spanHoles;
    }
    const localBBox = getFootprintBBox({ col: 0, row: 0 }, comp.rotation, pads, spanHoles);
    return {
      idx: i,
      comp,
      def,
      pads,
      spanHoles,
      localBBox,
      w: localBBox.maxCol - localBBox.minCol + 1,
      h: localBBox.maxRow - localBBox.minRow + 1,
      zone: classifyComponent(comp, def, rawNetsForComp[i]),
      signalDepth: 0,
      netIndices: [],
    } as CompInfo;
  });

  // ---- Build pin-level net info ------------------------------------
  // For each net, resolve which footprint pad of which perfboard component
  // participates, and precompute rotated pad offsets.  This mirrors the
  // pin-grid-map construction in the autorouter & ratsnest renderer.

  const netInfos: NetInfo[] = [];
  for (const net of netlist.nets) {
    const pins: NetPinRef[] = [];
    const compSet = new Set<number>();
    for (const conn of net.connections) {
      const compIdx = schIdToIdx.get(conn.componentId);
      if (compIdx === undefined) continue;
      const comp = components[compIdx];
      const def = infos[compIdx].def;
      if (!def) continue;
      const { pads } = getAdjustedFootprint(def, comp.properties?.holeSpan);
      // Find the footprint pad matching this net connection's pin number
      const pad = pads.find((p) => p.number === conn.pinNumber);
      if (!pad) continue;
      const rotated = rotatePad(pad.gridPosition, comp.rotation);
      pins.push({ compIdx, padCol: rotated.col, padRow: rotated.row });
      compSet.add(compIdx);
    }
    if (pins.length >= 2) {
      netInfos.push({ pins, compIndices: Array.from(compSet) });
    }
  }

  // Adjacency matrix (weight = number of shared nets)
  const adj: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const ni of netInfos) {
    const a = ni.compIndices;
    for (let x = 0; x < a.length; x++) {
      for (let y = x + 1; y < a.length; y++) {
        adj[a[x]][a[y]] += 1;
        adj[a[y]][a[x]] += 1;
      }
    }
  }

  // Link nets → components
  const compToNets: number[][] = Array.from({ length: n }, () => []);
  netInfos.forEach((ni, idx) => {
    for (const ci of ni.compIndices) {
      infos[ci].netIndices.push(idx);
      compToNets[ci].push(idx);
    }
  });

  // Signal depth
  computeSignalDepth(infos, adj);

  // ==== Phase 2: Force-directed placement =============================

  const floatPos = forceDirectedPlacement(infos, adj, boardWidth, boardHeight, margin, spacing);

  // ==== Phase 3: Grid legalization ====================================

  const rowBand = preset.alignRows
    ? (mode === 'beautiful' ? 4 + preset.rowGap : 3 + preset.rowGap)
    : 0;
  let gridPos = legalize(floatPos, infos, boardWidth, boardHeight, margin, spacing, rowBand);

  // ==== Phase 4: Simulated annealing ==================================

  const zpw = mode === 'beautiful' ? 2.5 : mode === 'easy_soldering' ? 1.5 : 1.0;
  gridPos = simulatedAnnealing(
    gridPos, infos, netInfos,
    boardWidth, boardHeight, margin, spacing, zpw, compToNets,
  );

  // ==== Phase 5: Post-processing ======================================

  if (preset.alignRows && rowBand > 0) {
    gridPos = postProcessRowAlign(
      gridPos, infos, boardWidth, boardHeight, margin, spacing, rowBand,
    );
  }

  // Build result map — only include in-bounds components
  const posMap = new Map<string, GridPosition>();
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const p = gridPos[i];
    const lb = infos[i].localBBox;
    if (
      p.col + lb.minCol >= 0 &&
      p.row + lb.minRow >= 0 &&
      p.col + lb.maxCol < boardWidth &&
      p.row + lb.maxRow < boardHeight
    ) {
      posMap.set(components[i].id, p);
    } else {
      failed++;
    }
  }

  return { positions: posMap, placed: posMap.size, failed };
}
