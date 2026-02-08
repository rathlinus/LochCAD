// ============================================================
// Auto-Layout — Human-like perfboard component placement
//
// Strategy:
//   1. Connectivity analysis & zone classification
//   2. Anchor VCC power pin at hole (0,0) — top-left origin
//   3. Greedy connectivity-based placement with rotation search
//   4. Simulated annealing wire-length refinement
//   5. Mode-specific post-processing
//
// Zone layout (signal flows left → right):
//   ┌─VCC(0,0)───────────────────────────┐
//   │  Power          General      Output │
//   │  components     left→right    pins  │
//   │                 signal flow          │
//   │  GND──────────────────────(or)─GND──┤
//   └─────────────────────────────────────┘
//
// Modes:
//   extra_compact  — Spacing 0, no margin. Maximum density.
//   compact        — Spacing 1, margin 1. Tight but routable.
//   easy_soldering — Spacing 2, margin 2. Comfortable hand-soldering.
//   beautiful      — Spacing 3, margin 2. Aesthetic aligned rows.
//
// Example placements (VCC → R1 → LED → GND on 30×15 board):
//
//  EXTRA COMPACT:              COMPACT:
//  VCC R1────D1                 VCC  R1─────D1
//              GND                              GND
//
//  EASY TO SOLDER:              BEAUTIFUL:
//  VCC                          VCC
//                               ·
//       R1──────D1                   R1 ──────── D1
//                               ·
//                   GND                              GND
//
// More complex example (voltage regulator + LED circuit):
//  VCC
//   │
//   C1    U1(7805)    R1──LED
//   │      │  │        │
//   └──────┘  C2───────┘
//              │
//             GND
//
// Each component is tried in all 4 rotations, picking the one
// that minimises Manhattan wire length to already-placed neighbours —
// just like a human would orient parts on a real perfboard.
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
import { rotatePad, getFootprintBBox, gridBBoxOverlap, findManhattanRoute, gridKey, isAdjacent } from './router';
import type { GridBBox, ExtendedRouteOptions } from './router';

// ---- Public types ---------------------------------------------------

/**
 * - `extra_compact`  — No gaps, maximum density. For tiny boards.
 * - `compact`        — 1-cell routing gap. Tight but functional.
 * - `easy_soldering` — Extra room for comfortable hand-soldering.
 * - `beautiful`      — Signal-flow columns, aligned rows, generous gaps.
 */
export type AutoLayoutMode = 'extra_compact' | 'compact' | 'easy_soldering' | 'beautiful';

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
  /** New rotations keyed by perfboard component id */
  rotations: Map<string, number>;
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
  /** BBox relative to origin (0,0) — recomputed when rotation changes */
  localBBox: GridBBox;
  w: number;
  h: number;
  zone: CompZone;
  signalDepth: number;
  /** Indices into `netInfos` that reference this component */
  netIndices: number[];
  /** Mutable rotation (comp.rotation is frozen by Immer) */
  rotation: number;
}

/**
 * Pin-level net reference with *rotated* pad offsets.
 * Built after rotation decisions are final (before SA).
 */
interface NetPinRef {
  compIdx: number;
  padCol: number;
  padRow: number;
}

/**
 * Pin-level net reference with *unrotated* pad offsets.
 * Built once and used during greedy placement for on-the-fly rotation eval.
 */
interface RawNetPin {
  compIdx: number;
  rawPadCol: number;
  rawPadRow: number;
}

interface NetInfo {
  pins: NetPinRef[];
  compIndices: number[];
}

interface RawNetInfo {
  pins: RawNetPin[];
  compIndices: number[];
}

type ZonePin = {
  compIdx: number;
  padCol: number;
  padRow: number;
  zone: Exclude<CompZone, 'general'>;
};

interface ModePreset {
  margin: number;
  spacing: number;
  rowGap: number;
  alignRows: boolean;
  routingChannel: number;
  /** Zone bias strength during greedy placement (0–1) */
  zoneBias: number;
  /** SA iterations multiplier */
  saMultiplier: number;
}

type ZoneBounds = {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
};

// ---- Constants & presets --------------------------------------------

const MODE_PRESETS: Record<AutoLayoutMode, ModePreset> = {
  extra_compact: {
    margin: 0, spacing: 0, rowGap: 0,
    alignRows: false, routingChannel: 0,
    zoneBias: 0.15, saMultiplier: 0.5,
  },
  compact: {
    margin: 1, spacing: 1, rowGap: 0,
    alignRows: false, routingChannel: 2,
    zoneBias: 0.25, saMultiplier: 1.0,
  },
  easy_soldering: {
    margin: 2, spacing: 2, rowGap: 1,
    alignRows: true, routingChannel: 3,
    zoneBias: 0.35, saMultiplier: 1.0,
  },
  beautiful: {
    margin: 2, spacing: 3, rowGap: 2,
    alignRows: true, routingChannel: 2,
    zoneBias: 0.45, saMultiplier: 1.4,
  },
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
    if (infos[i].zone === 'power') { depth[i] = 0; queue.push(i); }
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

  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (depth[i] >= 0 || infos[i].zone === 'gnd') continue;
      let best = Infinity;
      for (let j = 0; j < n; j++) {
        if (adj[i][j] > 0 && depth[j] >= 0) best = Math.min(best, depth[j]);
      }
      if (best < Infinity) { depth[i] = best + 1; changed = true; }
    }
  }

  const maxD = Math.max(0, ...Array.from(depth).filter((d) => d >= 0));
  for (let i = 0; i < n; i++) {
    infos[i].signalDepth =
      infos[i].zone === 'gnd' ? maxD + 1 : depth[i] >= 0 ? depth[i] : maxD;
  }
}

// ---- Pin-Aware HPWL cost functions ---------------------------------

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
      if (c < mnC) mnC = c; else if (c > mxC) mxC = c;
      if (r < mnR) mnR = r; else if (r > mxR) mxR = r;
    }
    total += mxC - mnC + (mxR - mnR);
  }
  return total;
}

function hpwlDeltaShift(
  ci: number, oldP: GridPosition, newP: GridPosition,
  pos: GridPosition[], compToNets: number[][], nets: NetInfo[],
): number {
  let delta = 0;
  for (const ni of compToNets[ci]) {
    const pins = nets[ni].pins;
    let oMnC = Infinity, oMxC = -Infinity, oMnR = Infinity, oMxR = -Infinity;
    let nMnC = Infinity, nMxC = -Infinity, nMnR = Infinity, nMxR = -Infinity;
    for (const pk of pins) {
      const oBase = pk.compIdx === ci ? oldP : pos[pk.compIdx];
      const oc = oBase.col + pk.padCol;
      const or_ = oBase.row + pk.padRow;
      if (oc < oMnC) oMnC = oc; if (oc > oMxC) oMxC = oc;
      if (or_ < oMnR) oMnR = or_; if (or_ > oMxR) oMxR = or_;
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

function hpwlDeltaSwap(
  ci: number, cj: number, oldPosI: GridPosition, oldPosJ: GridPosition,
  pos: GridPosition[], compToNets: number[][], nets: NetInfo[],
): number {
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
      const oBase = pk.compIdx === ci ? oldPosI : pk.compIdx === cj ? oldPosJ : pos[pk.compIdx];
      const oc = oBase.col + pk.padCol;
      const or_ = oBase.row + pk.padRow;
      if (oc < oMnC) oMnC = oc; if (oc > oMxC) oMxC = oc;
      if (or_ < oMnR) oMnR = or_; if (or_ > oMxR) oMxR = or_;
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

// ---- Zone penalty functions (for SA) --------------------------------

function zonePenalty(
  pos: GridPosition[], infos: CompInfo[], bw: number, bh: number, w: number,
): number {
  let pen = 0;
  const dbw = Math.max(1, bw);
  const dbh = Math.max(1, bh);
  for (let i = 0; i < infos.length; i++) {
    const p = pos[i];
    // Row-major gravity: rows cost 3x columns (pack horizontally first)
    pen += w * 0.15 * (p.col / dbw) + w * 0.45 * (p.row / dbh);
    switch (infos[i].zone) {
      // VCC/power → top-left (low col, low row)
      case 'power':
        pen += w * 1.5 * (p.col / dbw + p.row / dbh);
        break;
      // GND → bottom-left (high row, low col)
      case 'gnd':
        pen += w * 2.0 * (1 - p.row / dbh);
        pen += w * 0.5 * (p.col / dbw);
        break;
      // Output → right (high col)
      case 'output':
        pen += w * (1 - p.col / dbw);
        break;
    }
  }
  return pen;
}

function zonePenDelta(
  ci: number, oldP: GridPosition, newP: GridPosition,
  infos: CompInfo[], bw: number, bh: number, w: number,
): number {
  const zone = infos[ci].zone;
  let ov = 0, nv = 0;
  const dbw = Math.max(1, bw);
  const dbh = Math.max(1, bh);
  // Row-major gravity for all
  ov += w * 0.15 * (oldP.col / dbw) + w * 0.45 * (oldP.row / dbh);
  nv += w * 0.15 * (newP.col / dbw) + w * 0.45 * (newP.row / dbh);
  switch (zone) {
    case 'power':
      ov += w * 1.5 * (oldP.col / dbw + oldP.row / dbh);
      nv += w * 1.5 * (newP.col / dbw + newP.row / dbh);
      break;
    case 'gnd':
      ov += w * 2.0 * (1 - oldP.row / dbh) + w * 0.5 * (oldP.col / dbw);
      nv += w * 2.0 * (1 - newP.row / dbh) + w * 0.5 * (newP.col / dbw);
      break;
    case 'output':
      ov += w * (1 - oldP.col / dbw);
      nv += w * (1 - newP.col / dbw);
      break;
  }
  return nv - ov;
}

function pinZoneTerm(
  zone: ZonePin['zone'], col: number, row: number, bw: number, bh: number,
): number {
  const denomC = Math.max(1, bw - 1);
  const denomR = Math.max(1, bh - 1);
  const nx = col / denomC;
  const ny = row / denomR;
  switch (zone) {
    case 'power':
      return nx * nx + ny * ny;
    case 'gnd':
      return (1 - ny) * (1 - ny) + 0.1 * Math.min(nx, 1 - nx) * Math.min(nx, 1 - nx);
    case 'output':
      return (1 - nx) * (1 - nx) + 0.15 * (ny - 0.5) * (ny - 0.5);
  }
  return 0;
}

function pinZonePenalty(
  pos: GridPosition[], compZonePins: ZonePin[][], bw: number, bh: number, w: number,
): number {
  let pen = 0;
  for (let i = 0; i < compZonePins.length; i++) {
    const pins = compZonePins[i];
    if (pins.length === 0) continue;
    const base = pos[i];
    for (const pin of pins) {
      const col = base.col + pin.padCol;
      const row = base.row + pin.padRow;
      pen += w * pinZoneTerm(pin.zone, col, row, bw, bh);
    }
  }
  return pen;
}

function pinZoneDeltaShift(
  ci: number, oldP: GridPosition, newP: GridPosition,
  compZonePins: ZonePin[][], bw: number, bh: number, w: number,
): number {
  const pins = compZonePins[ci];
  if (!pins || pins.length === 0) return 0;
  let delta = 0;
  for (const pin of pins) {
    const oCol = oldP.col + pin.padCol;
    const oRow = oldP.row + pin.padRow;
    const nCol = newP.col + pin.padCol;
    const nRow = newP.row + pin.padRow;
    delta += w * (
      pinZoneTerm(pin.zone, nCol, nRow, bw, bh) -
      pinZoneTerm(pin.zone, oCol, oRow, bw, bh)
    );
  }
  return delta;
}

// ---- Zone bounds (soft regions for SA) ------------------------------

function clampToBounds(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function zoneBoundsFor(
  bw: number, bh: number, margin: number, zone: CompZone,
): ZoneBounds {
  const minCol = margin;
  const minRow = margin;
  const maxCol = Math.max(minCol, bw - margin - 1);
  const maxRow = Math.max(minRow, bh - margin - 1);
  const w = Math.max(1, maxCol - minCol);
  const h = Math.max(1, maxRow - minRow);

  const clamp = (b: ZoneBounds): ZoneBounds => ({
    minCol: clampToBounds(b.minCol, minCol, maxCol),
    maxCol: clampToBounds(b.maxCol, minCol, maxCol),
    minRow: clampToBounds(b.minRow, minRow, maxRow),
    maxRow: clampToBounds(b.maxRow, minRow, maxRow),
  });

  switch (zone) {
    case 'power':
      // Top-left region — VCC anchors at (0,0)
      return clamp({
        minCol: 0,
        minRow: 0,
        maxCol: minCol + Math.max(2, Math.round(w * 0.40)),
        maxRow: minRow + Math.max(2, Math.round(h * 0.40)),
      });
    case 'gnd':
      // Bottom strip — full width, prefer corners
      return clamp({
        minCol,
        minRow: Math.max(minRow, maxRow - Math.max(2, Math.round(h * 0.35))),
        maxCol,
        maxRow,
      });
    case 'output':
      // Right strip
      return clamp({
        minCol: Math.max(minCol, maxCol - Math.max(2, Math.round(w * 0.30))),
        minRow,
        maxCol,
        maxRow,
      });
    default:
      return { minCol, minRow, maxCol, maxRow };
  }
}

function zoneBoxPenalty(
  pos: GridPosition[], infos: CompInfo[],
  boundsByZone: Record<CompZone, ZoneBounds>, w: number,
): number {
  let pen = 0;
  for (let i = 0; i < infos.length; i++) {
    const zone = infos[i].zone;
    if (zone === 'general') continue;
    const b = boundsByZone[zone];
    const p = pos[i];
    const dx = p.col < b.minCol ? b.minCol - p.col : p.col > b.maxCol ? p.col - b.maxCol : 0;
    const dy = p.row < b.minRow ? b.minRow - p.row : p.row > b.maxRow ? p.row - b.maxRow : 0;
    pen += w * (dx * dx + dy * dy);
  }
  return pen;
}

function zoneBoxDeltaShift(
  ci: number, oldP: GridPosition, newP: GridPosition,
  infos: CompInfo[], boundsByZone: Record<CompZone, ZoneBounds>, w: number,
): number {
  const zone = infos[ci].zone;
  if (zone === 'general') return 0;
  const b = boundsByZone[zone];
  const oDx = oldP.col < b.minCol ? b.minCol - oldP.col : oldP.col > b.maxCol ? oldP.col - b.maxCol : 0;
  const oDy = oldP.row < b.minRow ? b.minRow - oldP.row : oldP.row > b.maxRow ? oldP.row - b.maxRow : 0;
  const nDx = newP.col < b.minCol ? b.minCol - newP.col : newP.col > b.maxCol ? newP.col - b.maxCol : 0;
  const nDy = newP.row < b.minRow ? b.minRow - newP.row : newP.row > b.maxRow ? newP.row - b.maxRow : 0;
  return w * ((nDx * nDx + nDy * nDy) - (oDx * oDx + oDy * oDy));
}

// ---- Routability helpers -------------------------------------------

/**
 * Build a set of all grid cells occupied by component pads at their
 * current positions and rotations.
 */
function buildPadOccupiedSet(
  positions: GridPosition[], infos: CompInfo[],
): Set<string> {
  const occ = new Set<string>();
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    for (const pad of infos[i].pads) {
      const rp = rotatePad(pad, infos[i].rotation);
      occ.add(`${pos.col + rp.col},${pos.row + rp.row}`);
    }
  }
  return occ;
}

/**
 * Check if a straight segment is clear of occupied holes,
 * excluding the given skip keys (typically pin endpoints).
 */
function isSegClearOfPads(
  a: GridPosition, b: GridPosition,
  occupied: Set<string>,
  skip: Set<string>,
): boolean {
  const dc = Math.sign(b.col - a.col);
  const dr = Math.sign(b.row - a.row);
  if (dc === 0 && dr === 0) return true;
  let c = a.col + dc, r = a.row + dr;
  while (c !== b.col || r !== b.row) {
    const key = `${c},${r}`;
    if (!skip.has(key) && occupied.has(key)) return false;
    c += dc; r += dr;
  }
  return true;
}

/**
 * Check if two pins can be connected via a straight line or L-route
 * (1-corner Manhattan path), avoiding occupied holes.
 */
function canLRouteBetween(
  from: GridPosition, to: GridPosition,
  occupied: Set<string>,
): boolean {
  if (from.col === to.col && from.row === to.row) return true;
  if (Math.abs(from.col - to.col) + Math.abs(from.row - to.row) <= 1) return true;
  const skip = new Set([`${from.col},${from.row}`, `${to.col},${to.row}`]);
  // Straight line
  if (from.col === to.col || from.row === to.row) {
    if (isSegClearOfPads(from, to, occupied, skip)) return true;
  }
  // L-route variant 1: horizontal then vertical
  const mid1: GridPosition = { col: to.col, row: from.row };
  const mid1Key = `${mid1.col},${mid1.row}`;
  if (!occupied.has(mid1Key) || skip.has(mid1Key)) {
    if (isSegClearOfPads(from, mid1, occupied, skip) &&
        isSegClearOfPads(mid1, to, occupied, skip)) return true;
  }
  // L-route variant 2: vertical then horizontal
  const mid2: GridPosition = { col: from.col, row: to.row };
  const mid2Key = `${mid2.col},${mid2.row}`;
  if (!occupied.has(mid2Key) || skip.has(mid2Key)) {
    if (isSegClearOfPads(from, mid2, occupied, skip) &&
        isSegClearOfPads(mid2, to, occupied, skip)) return true;
  }
  return false;
}

/**
 * Check if two pins can be connected via a Z-route (2-corner Manhattan
 * path). Tries intermediate rows/cols offset from both endpoints.
 */
function canZRouteBetween(
  from: GridPosition, to: GridPosition,
  occupied: Set<string>,
  bw: number, bh: number,
): boolean {
  const skip = new Set([`${from.col},${from.row}`, `${to.col},${to.row}`]);
  const offsets = [-1, 1, -2, 2];
  // H → V → H: from → (from.col, midRow) → (to.col, midRow) → to
  for (const base of [from.row, to.row]) {
    for (const off of offsets) {
      const midRow = base + off;
      if (midRow < 0 || midRow >= bh) continue;
      const m1: GridPosition = { col: from.col, row: midRow };
      const m2: GridPosition = { col: to.col, row: midRow };
      const m1k = `${m1.col},${m1.row}`;
      const m2k = `${m2.col},${m2.row}`;
      if ((occupied.has(m1k) && !skip.has(m1k)) ||
          (occupied.has(m2k) && !skip.has(m2k))) continue;
      if (isSegClearOfPads(from, m1, occupied, skip) &&
          isSegClearOfPads(m1, m2, occupied, skip) &&
          isSegClearOfPads(m2, to, occupied, skip)) return true;
    }
  }
  // V → H → V: from → (midCol, from.row) → (midCol, to.row) → to
  for (const base of [from.col, to.col]) {
    for (const off of offsets) {
      const midCol = base + off;
      if (midCol < 0 || midCol >= bw) continue;
      const m1: GridPosition = { col: midCol, row: from.row };
      const m2: GridPosition = { col: midCol, row: to.row };
      const m1k = `${m1.col},${m1.row}`;
      const m2k = `${m2.col},${m2.row}`;
      if ((occupied.has(m1k) && !skip.has(m1k)) ||
          (occupied.has(m2k) && !skip.has(m2k))) continue;
      if (isSegClearOfPads(from, m1, occupied, skip) &&
          isSegClearOfPads(m1, m2, occupied, skip) &&
          isSegClearOfPads(m2, to, occupied, skip)) return true;
    }
  }
  return false;
}

/**
 * BFS reachability: can two pins be connected via ANY Manhattan path
 * on the grid, avoiding occupied holes?
 */
function canReachBFS(
  from: GridPosition, to: GridPosition,
  occupied: Set<string>,
  bw: number, bh: number,
): boolean {
  if (from.col === to.col && from.row === to.row) return true;
  if (Math.abs(from.col - to.col) + Math.abs(from.row - to.row) <= 1) return true;
  const toKey = `${to.col},${to.row}`;
  const visited = new Set<string>();
  visited.add(`${from.col},${from.row}`);
  const queue: GridPosition[] = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = cur.col + dc, nr = cur.row + dr;
      if (nc < 0 || nc >= bw || nr < 0 || nr >= bh) continue;
      const key = `${nc},${nr}`;
      if (key === toKey) return true;
      if (visited.has(key) || occupied.has(key)) continue;
      visited.add(key);
      queue.push({ col: nc, row: nr });
    }
  }
  return false;
}

/**
 * Fast routability check for SA: can two pins be connected via
 * straight, L, or Z-routes, avoiding occupied holes?
 * Falls back to bounded BFS if geometric checks fail.
 * Faster than full A* but more thorough than just L-route checks.
 */
function canPairRoute(
  from: GridPosition, to: GridPosition,
  occupied: Set<string>,
  bw: number, bh: number,
): boolean {
  if (from.col === to.col && from.row === to.row) return true;
  const dist = Math.abs(from.col - to.col) + Math.abs(from.row - to.row);
  if (dist <= 1) return true;

  // Try geometric routes first (fast)
  if (canLRouteBetween(from, to, occupied)) return true;
  if (canZRouteBetween(from, to, occupied, bw, bh)) return true;

  // Bounded BFS: check reachability within a corridor around the two pins.
  // Limit search area to prevent expensive full-grid BFS during SA.
  const minC = Math.max(0, Math.min(from.col, to.col) - 4);
  const maxC = Math.min(bw - 1, Math.max(from.col, to.col) + 4);
  const minR = Math.max(0, Math.min(from.row, to.row) - 4);
  const maxR = Math.min(bh - 1, Math.max(from.row, to.row) + 4);

  const toKey = `${to.col},${to.row}`;
  const visited = new Set<string>();
  visited.add(`${from.col},${from.row}`);
  const queue: GridPosition[] = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = cur.col + dc, nr = cur.row + dr;
      if (nc < minC || nc > maxC || nr < minR || nr > maxR) continue;
      const key = `${nc},${nr}`;
      if (key === toKey) return true;
      if (visited.has(key) || occupied.has(key)) continue;
      visited.add(key);
      queue.push({ col: nc, row: nr });
    }
  }
  return false;
}

// ---- Grid helpers ---------------------------------------------------

/**
 * Search for a free grid cell using a row-major scan biased search.
 * Tries positions in reading order (right → down) from the target,
 * which produces natural left-to-right, top-to-bottom packing.
 * Falls back to expanding diamond if row-scan finds nothing nearby.
 */
function spiralFindFree(
  tCol: number, tRow: number,
  localBBox: GridBBox, placed: GridBBox[],
  bw: number, bh: number,
  margin: number, spacing: number,
  rowSnap: number,
  bounds?: ZoneBounds,
): GridPosition | null {
  const maxR = Math.max(bw, bh);
  // Try row-major scan first (strongly prefers right-then-down)
  const rm = _rowMajorScan(tCol, tRow, localBBox, placed, bw, bh, margin, spacing, maxR, rowSnap, bounds);
  if (rm) return rm;
  // Fallback: diamond spiral
  if (rowSnap > 0) {
    const r = _spiral(tCol, tRow, localBBox, placed, bw, bh, margin, spacing, maxR, rowSnap, bounds);
    if (r) return r;
  }
  return _spiral(tCol, tRow, localBBox, placed, bw, bh, margin, spacing, maxR, 0, bounds);
}

/**
 * Row-major scan: searches in expanding concentric "rows" from the
 * target position. For each distance d, it first tries all positions
 * on the same row (d columns to the right, then left), then moves to
 * the next row down, then up. This creates natural horizontal packing.
 */
function _rowMajorScan(
  tCol: number, tRow: number,
  lb: GridBBox, placed: GridBBox[],
  bw: number, bh: number,
  margin: number, spacing: number,
  maxR: number, rowSnap: number,
  bounds?: ZoneBounds,
): GridPosition | null {
  const b = bounds ?? {
    minCol: margin, minRow: margin,
    maxCol: Math.max(margin, bw - margin - 1),
    maxRow: Math.max(margin, bh - margin - 1),
  };

  const tryPos = (col: number, row: number): GridPosition | null => {
    if (rowSnap > 0 && (row - margin) % rowSnap !== 0) return null;
    const tb: GridBBox = {
      minCol: col + lb.minCol, minRow: row + lb.minRow,
      maxCol: col + lb.maxCol, maxRow: row + lb.maxRow,
    };
    if (tb.minCol < 0 || tb.minRow < 0 || tb.maxCol >= bw || tb.maxRow >= bh) return null;
    const eb: GridBBox = {
      minCol: tb.minCol - spacing, minRow: tb.minRow - spacing,
      maxCol: tb.maxCol + spacing, maxRow: tb.maxRow + spacing,
    };
    for (let i = 0; i < placed.length; i++) {
      if (gridBBoxOverlap(eb, placed[i])) return null;
    }
    return { col, row };
  };

  // Search in row-major order: for each row offset (0, +1, -1, +2, -2, ...)
  // within each row, scan columns (0, +1, -1, +2, -2, ...)
  for (let dRow = 0; dRow <= maxR; dRow++) {
    const rowOffsets = dRow === 0 ? [0] : [dRow, -dRow];
    for (const ro of rowOffsets) {
      const row = tRow + ro;
      if (row < 0 || row >= bh) continue;
      for (let dCol = 0; dCol <= maxR; dCol++) {
        const colOffsets = dCol === 0 ? [0] : [dCol, -dCol];
        for (const co of colOffsets) {
          const col = tCol + co;
          if (col < 0 || col >= bw) continue;
          // Limit total search distance
          if (Math.abs(co) + Math.abs(ro) > maxR) continue;
          const r = tryPos(col, row);
          if (r) return r;
        }
      }
    }
  }
  return null;
}

function _spiral(
  tCol: number, tRow: number,
  lb: GridBBox, placed: GridBBox[],
  bw: number, bh: number,
  margin: number, spacing: number,
  maxR: number, rowSnap: number,
  bounds?: ZoneBounds,
): GridPosition | null {
  const b = bounds ?? {
    minCol: margin, minRow: margin,
    maxCol: Math.max(margin, bw - margin - 1),
    maxRow: Math.max(margin, bh - margin - 1),
  };
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
        // Check board bounds (allow col/row 0 even with margin for VCC)
        if (tb.minCol < 0 || tb.minRow < 0 ||
            tb.maxCol >= bw || tb.maxRow >= bh) continue;
        // Soft zone bounds — prefer but don't require
        if (tb.minCol < b.minCol || tb.minRow < b.minRow ||
            tb.maxCol > b.maxCol || tb.maxRow > b.maxRow) {
          // Allow but only at larger radii (checked naturally by spiral)
        }

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

// ---- Phase 2+3: Greedy connectivity placement with rotation search --

/**
 * Place components one by one in connectivity order, starting with
 * VCC at hole (0,0). For each component, try all 4 rotations and
 * pick the position + rotation that minimises pin-level Manhattan
 * distance to already-placed neighbours.
 *
 * This produces naturally human-like layouts:
 * - Connected components cluster together
 * - Pin orientation faces connected neighbours
 * - Power at top-left, ground at bottom, output on right
 */
function greedyPlacement(
  infos: CompInfo[],
  adj: number[][],
  rawNets: RawNetInfo[],
  compToRawNets: number[][],
  bw: number,
  bh: number,
  margin: number,
  spacing: number,
  zoneBias: number,
): { positions: GridPosition[]; rotations: number[] } {
  const n = infos.length;
  const positions: (GridPosition | null)[] = new Array(n).fill(null);
  const rotations: number[] = infos.map((ci) => ci.rotation);
  const placedBBoxes: GridBBox[] = [];
  const placedSet = new Set<number>();
  // Occupied pad holes (for routability checks during placement)
  const occupiedPads = new Set<string>();

  // Helper: check if a route exists between two pins.
  // Uses fast geometric checks first, then falls back to actual A* routing.
  const canRouteBetween = (
    from: GridPosition, to: GridPosition,
  ): boolean => {
    if (from.col === to.col && from.row === to.row) return true;
    // Adjacent pins are always routable (solder bridge)
    if (Math.abs(from.col - to.col) + Math.abs(from.row - to.row) <= 1) return true;

    // Straight line
    if (from.col === to.col || from.row === to.row) {
      if (isSegClear(from, to)) return true;
    }
    // L-route variant 1: horizontal first
    const mid1: GridPosition = { col: to.col, row: from.row };
    const mid1Key = `${mid1.col},${mid1.row}`;
    if (!occupiedPads.has(mid1Key) && isSegClear(from, mid1) && isSegClear(mid1, to)) return true;
    // L-route variant 2: vertical first
    const mid2: GridPosition = { col: from.col, row: to.row };
    const mid2Key = `${mid2.col},${mid2.row}`;
    if (!occupiedPads.has(mid2Key) && isSegClear(from, mid2) && isSegClear(mid2, to)) return true;

    // Z-routes: 2-corner paths with small offsets
    const zOffsets = [-1, 1, -2, 2, -3, 3];
    // H → V → H
    for (const base of [from.row, to.row]) {
      for (const dy of zOffsets) {
        const midRow = base + dy;
        if (midRow < 0 || midRow >= bh) continue;
        const m1: GridPosition = { col: from.col, row: midRow };
        const m2: GridPosition = { col: to.col, row: midRow };
        if (occupiedPads.has(`${m1.col},${m1.row}`) ||
            occupiedPads.has(`${m2.col},${m2.row}`)) continue;
        if (isSegClear(from, m1) && isSegClear(m1, m2) && isSegClear(m2, to)) return true;
      }
    }
    // V → H → V
    for (const base of [from.col, to.col]) {
      for (const dx of zOffsets) {
        const midCol = base + dx;
        if (midCol < 0 || midCol >= bw) continue;
        const m1: GridPosition = { col: midCol, row: from.row };
        const m2: GridPosition = { col: midCol, row: to.row };
        if (occupiedPads.has(`${m1.col},${m1.row}`) ||
            occupiedPads.has(`${m2.col},${m2.row}`)) continue;
        if (isSegClear(from, m1) && isSegClear(m1, m2) && isSegClear(m2, to)) return true;
      }
    }

    // Fall back to actual A* routing for complex cases
    // Build temporary occupied set excluding endpoints
    const tempOcc = new Set(occupiedPads);
    tempOcc.delete(`${from.col},${from.row}`);
    tempOcc.delete(`${to.col},${to.row}`);
    const route = findManhattanRoute({
      from, to,
      boardWidth: bw, boardHeight: bh,
      occupied: tempOcc,
      turnPenalty: 10,
      maxIterations: 3000, // Keep fast — just needs reachability
    } as ExtendedRouteOptions);
    return route !== null;
  };

  const isSegClear = (a: GridPosition, b: GridPosition): boolean => {
    const dc = Math.sign(b.col - a.col);
    const dr = Math.sign(b.row - a.row);
    let c = a.col + dc, r = a.row + dr;
    while (c !== b.col || r !== b.row) {
      if (c < 0 || c >= bw || r < 0 || r >= bh) return false;
      if (occupiedPads.has(`${c},${r}`)) return false;
      c += dc; r += dr;
    }
    return true;
  };

  // Helper: update CompInfo after rotation change
  const applyRotation = (ci: number, rot: number) => {
    const info = infos[ci];
    rotations[ci] = rot;
    info.rotation = rot;
    const lb = getFootprintBBox({ col: 0, row: 0 }, rot, info.pads, info.spanHoles);
    info.localBBox = lb;
    info.w = lb.maxCol - lb.minCol + 1;
    info.h = lb.maxRow - lb.minRow + 1;
  };

  // Helper: compute placement cost.
  // PRIMARY: bounding-box expansion (keeps layout compact without top-row bias).
  // SECONDARY: wire length (keeps connected components close).
  // TERTIARY: mild reading-order tiebreaker.
  const computeCost = (
    ci: number, pos: GridPosition, rot: number,
  ): number => {
    const lb = getFootprintBBox({ col: 0, row: 0 }, rot, infos[ci].pads, infos[ci].spanHoles);
    const dbw = Math.max(1, bw - 1);
    const dbh = Math.max(1, bh - 1);

    // === Primary: bounding-box area expansion ===
    // Measures how much the overall layout envelope grows by placing here.
    // 0 if the component fits within the existing envelope, positive otherwise.
    let packScore = 0;
    if (placedBBoxes.length > 0) {
      let eMinC = Infinity, eMinR = Infinity, eMaxC = -Infinity, eMaxR = -Infinity;
      for (const bb of placedBBoxes) {
        if (bb.minCol < eMinC) eMinC = bb.minCol;
        if (bb.minRow < eMinR) eMinR = bb.minRow;
        if (bb.maxCol > eMaxC) eMaxC = bb.maxCol;
        if (bb.maxRow > eMaxR) eMaxR = bb.maxRow;
      }
      const nMinC = Math.min(eMinC, pos.col + lb.minCol);
      const nMinR = Math.min(eMinR, pos.row + lb.minRow);
      const nMaxC = Math.max(eMaxC, pos.col + lb.maxCol);
      const nMaxR = Math.max(eMaxR, pos.row + lb.maxRow);
      const oldArea = (eMaxC - eMinC + 1) * (eMaxR - eMinR + 1);
      const newArea = (nMaxC - nMinC + 1) * (nMaxR - nMinR + 1);
      packScore = (newArea - oldArea) * 0.5;
    }

    // Mild reading-order tiebreaker (breaks ties between equal-area positions)
    packScore += 0.25 * (pos.row / dbh) + 0.08 * (pos.col / dbw);

    // === Secondary: pin-level wire length to placed neighbours ===
    let wireLen = 0;
    let hasNeighbour = false;
    for (const ni of compToRawNets[ci]) {
      const rn = rawNets[ni];
      for (const mp of rn.pins) {
        if (mp.compIdx !== ci) continue;
        const rp = rotatePad({ col: mp.rawPadCol, row: mp.rawPadRow }, rot);
        const myCol = pos.col + rp.col;
        const myRow = pos.row + rp.row;
        for (const op of rn.pins) {
          if (op.compIdx === ci || !placedSet.has(op.compIdx)) continue;
          hasNeighbour = true;
          const orp = rotatePad(
            { col: op.rawPadCol, row: op.rawPadRow },
            rotations[op.compIdx],
          );
          const oCol = positions[op.compIdx]!.col + orp.col;
          const oRow = positions[op.compIdx]!.row + orp.row;
          wireLen += Math.abs(myCol - oCol) + Math.abs(myRow - oRow);
        }
      }
    }
    // Normalise wire length to 0-1 range relative to board diagonal
    const diag = Math.max(1, bw + bh);
    const normWire = wireLen / diag;

    // Wire length matters more when there ARE placed neighbours,
    // but packing always dominates to prevent scatter.
    const wireFactor = hasNeighbour ? 3.0 : 0.0;

    // === Zone bias ===
    let zoneCost = 0;
    switch (infos[ci].zone) {
      case 'power':
        zoneCost = zoneBias * 6 * ((pos.col / dbw) + (pos.row / dbh));
        break;
      case 'gnd':
        zoneCost = zoneBias * 8 * (1 - pos.row / dbh) + zoneBias * 2 * (pos.col / dbw);
        break;
      case 'output':
        zoneCost = zoneBias * 6 * (1 - pos.col / dbw);
        break;
    }

    // === Routability: penalise positions where connected pins
    //     can't reach their neighbours via any Manhattan route ===
    // Uses actual A* routing for verification — ensures the layout
    // only places components in positions that can actually be routed.
    let routePenalty = 0;
    {
      let totalPairs = 0;
      let blockedPairs = 0;
      let totalRouteDist = 0;
      for (const ni of compToRawNets[ci]) {
        const rn = rawNets[ni];
        for (const mp of rn.pins) {
          if (mp.compIdx !== ci) continue;
          const rp = rotatePad({ col: mp.rawPadCol, row: mp.rawPadRow }, rot);
          const myPos: GridPosition = { col: pos.col + rp.col, row: pos.row + rp.row };
          for (const op of rn.pins) {
            if (op.compIdx === ci || !placedSet.has(op.compIdx)) continue;
            const orp = rotatePad(
              { col: op.rawPadCol, row: op.rawPadRow },
              rotations[op.compIdx],
            );
            const oPos: GridPosition = {
              col: positions[op.compIdx]!.col + orp.col,
              row: positions[op.compIdx]!.row + orp.row,
            };
            totalPairs++;
            const dist = Math.abs(myPos.col - oPos.col) + Math.abs(myPos.row - oPos.row);
            totalRouteDist += dist;
            if (!canRouteBetween(myPos, oPos)) blockedPairs++;
          }
        }
      }
      if (totalPairs > 0) {
        // Heavy penalty: each blocked pair adds 30 to cost,
        // making unroutable positions strongly disfavoured.
        routePenalty = 30.0 * blockedPairs;
        // Also add mild penalty for route distance (prefer shorter real routes)
        routePenalty += 0.1 * totalRouteDist / Math.max(1, totalPairs);
      }
    }

    return packScore + wireFactor * normWire + zoneCost + routePenalty;
  };

  // Helper: find best placement by scanning ALL free board positions.
  // Evaluates every valid position × 4 rotations and picks minimum cost.
  // This prevents single-row packing that spiral search causes.
  const findBestPlacement = (
    ci: number,
  ): { pos: GridPosition; rot: number } | null => {
    let bestPos: GridPosition | null = null;
    let bestRot = rotations[ci];
    let bestCost = Infinity;

    // Determine scan area: envelope of placed components + generous padding.
    // For small boards, this is effectively the whole board.
    let scanMinC = 0, scanMinR = 0, scanMaxC = bw - 1, scanMaxR = bh - 1;
    if (placedBBoxes.length > 0) {
      let eMinC = Infinity, eMinR = Infinity, eMaxC = -Infinity, eMaxR = -Infinity;
      for (const bb of placedBBoxes) {
        if (bb.minCol < eMinC) eMinC = bb.minCol;
        if (bb.minRow < eMinR) eMinR = bb.minRow;
        if (bb.maxCol > eMaxC) eMaxC = bb.maxCol;
        if (bb.maxRow > eMaxR) eMaxR = bb.maxRow;
      }
      const pad = Math.max(10, ...infos.map((inf) => Math.max(inf.w, inf.h) + spacing * 2));
      scanMinC = Math.max(0, eMinC - pad);
      scanMinR = Math.max(0, eMinR - pad);
      scanMaxC = Math.min(bw - 1, eMaxC + pad * 2);
      scanMaxR = Math.min(bh - 1, eMaxR + pad * 2);
    }

    for (const rot of [0, 90, 180, 270]) {
      const lb = getFootprintBBox({ col: 0, row: 0 }, rot, infos[ci].pads, infos[ci].spanHoles);
      for (let row = scanMinR; row <= scanMaxR; row++) {
        for (let col = scanMinC; col <= scanMaxC; col++) {
          // Board bounds
          if (col + lb.minCol < 0 || row + lb.minRow < 0 ||
              col + lb.maxCol >= bw || row + lb.maxRow >= bh) continue;
          // Collision with spacing
          const eb: GridBBox = {
            minCol: col + lb.minCol - spacing,
            minRow: row + lb.minRow - spacing,
            maxCol: col + lb.maxCol + spacing,
            maxRow: row + lb.maxRow + spacing,
          };
          let ok = true;
          for (let j = 0; j < placedBBoxes.length; j++) {
            if (gridBBoxOverlap(eb, placedBBoxes[j])) { ok = false; break; }
          }
          if (!ok) continue;
          const cost = computeCost(ci, { col, row }, rot);
          if (cost < bestCost) {
            bestCost = cost;
            bestPos = { col, row };
            bestRot = rot;
          }
        }
      }
    }

    if (bestPos) return { pos: bestPos, rot: bestRot };

    // Fallback: full board spiral from center
    for (const rot of [0, 90, 180, 270]) {
      const lb = getFootprintBBox({ col: 0, row: 0 }, rot, infos[ci].pads, infos[ci].spanHoles);
      const pos = spiralFindFree(
        Math.round(bw / 2), Math.round(bh / 2), lb, placedBBoxes,
        bw, bh, margin, spacing, 0,
      );
      if (pos) return { pos, rot };
    }

    return null;
  };

  // Helper: find nearest placement using spiral search from a target position.
  // Used for GND components that must be placed at the bottom.
  const findNearestPlacement = (
    ci: number, targetCol: number, targetRow: number,
  ): { pos: GridPosition; rot: number } | null => {
    let bestPos: GridPosition | null = null;
    let bestRot = rotations[ci];
    let bestCost = Infinity;

    for (const rot of [0, 90, 180, 270]) {
      const lb = getFootprintBBox({ col: 0, row: 0 }, rot, infos[ci].pads, infos[ci].spanHoles);
      const pos = spiralFindFree(
        targetCol, targetRow, lb, placedBBoxes,
        bw, bh, margin, spacing, 0,
      );
      if (!pos) continue;
      const cost = computeCost(ci, pos, rot);
      if (cost < bestCost) {
        bestCost = cost;
        bestPos = pos;
        bestRot = rot;
      }
    }

    if (bestPos) return { pos: bestPos, rot: bestRot };
    return null;
  };

  // Helper: place a component and record it
  const placeAt = (ci: number, pos: GridPosition, rot: number) => {
    applyRotation(ci, rot);
    positions[ci] = pos;
    placedBBoxes.push(getFootprintBBox(pos, rot, infos[ci].pads, infos[ci].spanHoles));
    placedSet.add(ci);
    // Record pad holes as occupied for routability checks
    for (const pad of infos[ci].pads) {
      const rp = rotatePad(pad, rot);
      occupiedPads.add(`${pos.col + rp.col},${pos.row + rp.row}`);
    }
  };

  // ===== Step 1: Place VCC component with pin at hole (0,0) =====

  let vccIdx = -1;
  for (let i = 0; i < n; i++) {
    if (infos[i].zone !== 'power') continue;
    const def = infos[i].def;
    if (!def) continue;
    const id = def.id.toLowerCase();
    const name = def.name.toLowerCase();
    if (id === 'power_vcc' || id === 'power_vdd' || name === 'vcc' || name === 'vdd') {
      vccIdx = i;
      break;
    }
  }

  if (vccIdx >= 0) {
    const ci = infos[vccIdx];
    let placed = false;
    // Try each rotation so the first pad lands at (0,0)
    for (const rot of [0, 90, 180, 270]) {
      const rp = rotatePad(ci.pads[0] ?? { col: 0, row: 0 }, rot);
      const compPos: GridPosition = { col: -rp.col, row: -rp.row };
      const lb = getFootprintBBox({ col: 0, row: 0 }, rot, ci.pads, ci.spanHoles);
      // Verify all pads are within board
      if (compPos.col + lb.minCol >= 0 && compPos.row + lb.minRow >= 0 &&
          compPos.col + lb.maxCol < bw && compPos.row + lb.maxRow < bh) {
        placeAt(vccIdx, compPos, rot);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Fallback: place at (0,0) with default rotation
      placeAt(vccIdx, { col: 0, row: 0 }, ci.rotation);
    }
  }

  // ===== Step 2: Separate remaining into non-GND and GND =====

  const remaining: number[] = [];
  const gndIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (placedSet.has(i)) continue;
    if (infos[i].zone === 'gnd') {
      gndIndices.push(i);
    } else {
      remaining.push(i);
    }
  }

  // ===== Step 3: Place non-GND components by connectivity =====

  while (remaining.length > 0) {
    // Pick the unplaced component with the most connections to placed components
    let bestIdx = 0;
    let bestConn = -1;
    for (let i = 0; i < remaining.length; i++) {
      let conn = 0;
      for (const j of placedSet) {
        conn += adj[remaining[i]][j];
      }
      // Slight boost for power components (place them early)
      if (infos[remaining[i]].zone === 'power') conn += 0.5;
      if (conn > bestConn) { bestConn = conn; bestIdx = i; }
    }

    const ci = remaining.splice(bestIdx, 1)[0];

    // Grid scan finds the globally best position considering
    // bounding-box expansion, wire length, and zone bias.
    const result = findBestPlacement(ci);
    if (result) {
      placeAt(ci, result.pos, result.rot);
    }
  }

  // ===== Step 4: Place GND components at bottom =====
  // Choose bottom-left or bottom-right based on where connections are

  for (const ci of gndIndices) {
    const info = infos[ci];

    // Find centroid of connected placed components
    let centroidCol = 0, centroidRow = 0, totalW = 0;
    for (const j of placedSet) {
      if (adj[ci][j] <= 0) continue;
      centroidCol += positions[j]!.col * adj[ci][j];
      centroidRow += positions[j]!.row * adj[ci][j];
      totalW += adj[ci][j];
    }

    let idealCol: number;
    const idealRow = bh - margin - 1; // Bottom of board

    if (totalW > 0) {
      centroidCol /= totalW;
      // Place GND at bottom-left or bottom-right, whichever is closer.
      // Bias toward bottom-left (prefer left unless clearly right-side)
      const distLeft = Math.abs(centroidCol - margin);
      const distRight = Math.abs(centroidCol - (bw - margin - 1));
      idealCol = distRight < distLeft * 0.6 ? bw - margin - 2 : margin;
    } else {
      // Default: bottom-left corner
      idealCol = margin;
    }

    const result = findNearestPlacement(ci, idealCol, idealRow);
    if (result) {
      placeAt(ci, result.pos, result.rot);
    }
  }

  // Fill any null positions (should not happen but safety net)
  const finalPositions: GridPosition[] = positions.map((p, i) =>
    p ?? { col: margin, row: margin + i * 3 },
  );

  return { positions: finalPositions, rotations };
}

// ---- Build rotation-dependent net structures -------------------------

function buildNetInfos(
  infos: CompInfo[],
  components: PerfboardComponent[],
  netlist: ReturnType<typeof buildNetlist>,
  allLib: ComponentDefinition[],
  schIdToIdx: Map<string, number>,
): { netInfos: NetInfo[]; compToNets: number[][]; compZonePins: ZonePin[][] } {
  const n = components.length;
  const netInfos: NetInfo[] = [];
  const compZonePins: ZonePin[][] = Array.from({ length: n }, () => []);

  for (const net of netlist.nets) {
    const pins: NetPinRef[] = [];
    const compSet = new Set<number>();
    const netZone = GND_RE.test(net.name)
      ? 'gnd'
      : PWR_RE.test(net.name)
        ? 'power'
        : OUT_RE.test(net.name)
          ? 'output'
          : null;

    for (const conn of net.connections) {
      const compIdx = schIdToIdx.get(conn.componentId);
      if (compIdx === undefined) continue;
      const comp = components[compIdx];
      const def = infos[compIdx].def;
      if (!def) continue;
      const { pads } = getAdjustedFootprint(def, comp.properties?.holeSpan);
      const mappedPin = def.pinMapping?.[conn.pinNumber] ?? conn.pinNumber;
      const pad = pads.find((p) => p.number === mappedPin);
      if (!pad) continue;
      const rotated = rotatePad(pad.gridPosition, infos[compIdx].rotation);
      pins.push({ compIdx, padCol: rotated.col, padRow: rotated.row });
      if (netZone) {
        compZonePins[compIdx].push({
          compIdx, padCol: rotated.col, padRow: rotated.row, zone: netZone,
        });
      }
      compSet.add(compIdx);
    }
    if (pins.length >= 2) {
      netInfos.push({ pins, compIndices: Array.from(compSet) });
    }
  }

  const compToNets: number[][] = Array.from({ length: n }, () => []);
  netInfos.forEach((ni, idx) => {
    for (const ci of ni.compIndices) {
      compToNets[ci].push(idx);
    }
  });

  return { netInfos, compToNets, compZonePins };
}

// ---- Phase 4: Simulated annealing -----------------------------------

function simulatedAnnealing(
  positions: GridPosition[],
  infos: CompInfo[],
  nets: NetInfo[],
  bw: number,
  bh: number,
  margin: number,
  spacing: number,
  zonePenW: number,
  pinZoneW: number,
  compToNets: number[][],
  compZonePins: ZonePin[][],
  boundsByZone: Record<CompZone, ZoneBounds>,
  saMultiplier: number,
): GridPosition[] {
  const n = infos.length;
  if (n <= 1) return positions.map((p) => ({ ...p }));

  const pos = positions.map((p) => ({ ...p }));
  const bboxes: GridBBox[] = infos.map((ci, i) =>
    getFootprintBBox(pos[i], ci.rotation, ci.pads, ci.spanHoles),
  );

  // --- Routability scoring for SA ---
  // Periodically check actual route feasibility and add penalty.
  // This ensures SA converges toward routable configurations.
  const ROUTE_CHECK_INTERVAL = 500; // Check every N iterations
  let curRoutePen = 0;

  /** Compute routability penalty by checking if net pin pairs can be routed */
  const computeRoutePenalty = (positions: GridPosition[]): number => {
    const padOcc = new Set<string>();
    for (let i = 0; i < n; i++) {
      for (const pad of infos[i].pads) {
        const rp = rotatePad(pad, infos[i].rotation);
        padOcc.add(`${positions[i].col + rp.col},${positions[i].row + rp.row}`);
      }
    }

    let blocked = 0;
    let total = 0;
    for (let ni = 0; ni < nets.length; ni++) {
      const net = nets[ni];
      for (let a = 0; a < net.pins.length; a++) {
        const pa = net.pins[a];
        const fromC = positions[pa.compIdx].col + pa.padCol;
        const fromR = positions[pa.compIdx].row + pa.padRow;
        for (let b = a + 1; b < net.pins.length; b++) {
          if (net.pins[b].compIdx === pa.compIdx) continue;
          const pb = net.pins[b];
          const toC = positions[pb.compIdx].col + pb.padCol;
          const toR = positions[pb.compIdx].row + pb.padRow;
          total++;
          // Quick L/Z-route feasibility check
          const from = { col: fromC, row: fromR };
          const to = { col: toC, row: toR };
          if (isAdjacent(from, to)) continue;
          if (!canPairRoute(from, to, padOcc, bw, bh)) blocked++;
        }
      }
    }
    return total > 0 ? 15.0 * blocked : 0;
  };

  curRoutePen = computeRoutePenalty(pos);

  let curHPWL = computeHPWL(pos, nets);
  let curZP = zonePenalty(pos, infos, bw, bh, zonePenW);
  let curPZ = pinZonePenalty(pos, compZonePins, bw, bh, pinZoneW);
  let curBZ = zoneBoxPenalty(pos, infos, boundsByZone, zonePenW * 2.2);
  let curCost = curHPWL + curZP + curPZ + curBZ + curRoutePen;

  const iters = Math.min(
    400_000,
    Math.max(20_000, Math.round(200 * n * n * saMultiplier)),
  );
  const tStart = Math.sqrt(bw * bh) * 0.35;
  const tEnd = 0.005;
  const alpha = Math.pow(tEnd / tStart, 1 / iters);
  let temp = tStart;

  let bestCost = curCost;
  const bestPos = pos.map((p) => ({ ...p }));

  const rand = () => Math.random();
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

      // Hard board bounds
      if (newP.col + lb.minCol < 0 || newP.row + lb.minRow < 0 ||
          newP.col + lb.maxCol >= bw || newP.row + lb.maxRow >= bh) {
        temp *= alpha; continue;
      }

      // Collision check
      const eb: GridBBox = {
        minCol: newP.col + lb.minCol - spacing,
        minRow: newP.row + lb.minRow - spacing,
        maxCol: newP.col + lb.maxCol + spacing,
        maxRow: newP.row + lb.maxRow + spacing,
      };
      let collides = false;
      for (let j = 0; j < n; j++) {
        if (j === ci) continue;
        if (gridBBoxOverlap(eb, bboxes[j])) { collides = true; break; }
      }
      if (collides) { temp *= alpha; continue; }

      const oldP = pos[ci];
      const dH = hpwlDeltaShift(ci, oldP, newP, pos, compToNets, nets);
      const dZ = zonePenDelta(ci, oldP, newP, infos, bw, bh, zonePenW);
      const dP = pinZoneDeltaShift(ci, oldP, newP, compZonePins, bw, bh, pinZoneW);
      const dB = zoneBoxDeltaShift(ci, oldP, newP, infos, boundsByZone, zonePenW * 2.2);
      const delta = dH + dZ + dP + dB;

      if (delta < 0 || rand() < Math.exp(-delta / Math.max(temp, 0.001))) {
        pos[ci] = newP;
        curHPWL += dH; curZP += dZ; curPZ += dP; curBZ += dB;
        curCost = curHPWL + curZP + curPZ + curBZ + curRoutePen;
        bboxes[ci] = getFootprintBBox(newP, infos[ci].rotation, infos[ci].pads, infos[ci].spanHoles);
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

      const bI_atJ: GridBBox = {
        minCol: posJ.col + lbI.minCol, minRow: posJ.row + lbI.minRow,
        maxCol: posJ.col + lbI.maxCol, maxRow: posJ.row + lbI.maxRow,
      };
      const bJ_atI: GridBBox = {
        minCol: posI.col + lbJ.minCol, minRow: posI.row + lbJ.minRow,
        maxCol: posI.col + lbJ.maxCol, maxRow: posI.row + lbJ.maxRow,
      };

      if (bI_atJ.minCol < 0 || bI_atJ.minRow < 0 ||
          bI_atJ.maxCol >= bw || bI_atJ.maxRow >= bh ||
          bJ_atI.minCol < 0 || bJ_atI.minRow < 0 ||
          bJ_atI.maxCol >= bw || bJ_atI.maxRow >= bh) {
        temp *= alpha; continue;
      }

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
      if (ok) ok = !gridBBoxOverlap(eI, bJ_atI);
      if (!ok) { temp *= alpha; continue; }

      const savedI = { ...posI }, savedJ = { ...posJ };
      pos[ci] = { col: posJ.col, row: posJ.row };
      pos[cj] = { col: savedI.col, row: savedI.row };

      const dH = hpwlDeltaSwap(ci, cj, savedI, savedJ, pos, compToNets, nets);
      const dZ = zonePenDelta(ci, savedI, pos[ci], infos, bw, bh, zonePenW)
               + zonePenDelta(cj, savedJ, pos[cj], infos, bw, bh, zonePenW);
      const dP = pinZoneDeltaShift(ci, savedI, pos[ci], compZonePins, bw, bh, pinZoneW)
               + pinZoneDeltaShift(cj, savedJ, pos[cj], compZonePins, bw, bh, pinZoneW);
      const dB = zoneBoxDeltaShift(ci, savedI, pos[ci], infos, boundsByZone, zonePenW * 2.2)
               + zoneBoxDeltaShift(cj, savedJ, pos[cj], infos, boundsByZone, zonePenW * 2.2);
      const delta = dH + dZ + dP + dB;

      if (delta < 0 || rand() < Math.exp(-delta / Math.max(temp, 0.001))) {
        curHPWL += dH; curZP += dZ; curPZ += dP; curBZ += dB;
        curCost = curHPWL + curZP + curPZ + curBZ + curRoutePen;
        bboxes[ci] = getFootprintBBox(pos[ci], infos[ci].rotation, infos[ci].pads, infos[ci].spanHoles);
        bboxes[cj] = getFootprintBBox(pos[cj], infos[cj].rotation, infos[cj].pads, infos[cj].spanHoles);
        if (curCost < bestCost) {
          bestCost = curCost;
          for (let j = 0; j < n; j++) { bestPos[j].col = pos[j].col; bestPos[j].row = pos[j].row; }
        }
      } else {
        pos[ci] = savedI;
        pos[cj] = savedJ;
      }
    }

    // Periodically recompute route penalty to guide SA toward routable layouts
    if (it > 0 && it % ROUTE_CHECK_INTERVAL === 0) {
      curRoutePen = computeRoutePenalty(pos);
      curCost = curHPWL + curZP + curPZ + curBZ + curRoutePen;
      if (curCost < bestCost) {
        bestCost = curCost;
        for (let j = 0; j < n; j++) { bestPos[j].col = pos[j].col; bestPos[j].row = pos[j].row; }
      }
    }

    temp *= alpha;
  }

  return bestPos;
}

// ---- Phase 5: Post-processing — row alignment & VCC anchor ----------

/**
 * Re-snap components to row bands while maintaining overlap-free placement.
 * All components go through the spiral finder against a fresh placement list.
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
    // Try 3: anywhere on the board
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
        getFootprintBBox(pos, infos[ci].rotation, infos[ci].pads, infos[ci].spanHoles),
      );
    } else {
      result[ci] = positions[ci];
      placedBBoxes.push(
        getFootprintBBox(positions[ci], infos[ci].rotation, infos[ci].pads, infos[ci].spanHoles),
      );
    }
  }

  return result;
}

/**
 * Final pass: ensure VCC pin is exactly at hole (0,0).
 * Shifts the entire layout if needed so the VCC power pin lands at origin.
 */
function anchorVCCAtOrigin(
  positions: GridPosition[],
  infos: CompInfo[],
  netlist: ReturnType<typeof buildNetlist>,
  schIdToIdx: Map<string, number>,
  boardWidth: number,
  boardHeight: number,
): GridPosition[] {
  // Find VCC net pin
  type Candidate = { compIdx: number; pad: GridPosition; rank: number };
  const candidates: Candidate[] = [];

  for (const net of netlist.nets) {
    if (!PWR_RE.test(net.name)) continue;
    const rank = /^(vcc|vdd)$/i.test(net.name) ? 0 : 1;
    for (const conn of net.connections) {
      const compIdx = schIdToIdx.get(conn.componentId);
      if (compIdx === undefined) continue;
      const info = infos[compIdx];
      if (!info.def) continue;
      const { pads } = getAdjustedFootprint(info.def, info.comp.properties?.holeSpan);
      const mappedPin = info.def.pinMapping?.[conn.pinNumber] ?? conn.pinNumber;
      const pad = pads.find((p) => p.number === mappedPin);
      if (!pad) continue;
      candidates.push({ compIdx, pad: pad.gridPosition, rank });
    }
  }

  if (candidates.length === 0) return positions;
  candidates.sort((a, b) => a.rank - b.rank);

  // Try to shift entire layout so VCC pin lands at (0,0)
  for (const cand of candidates) {
    const info = infos[cand.compIdx];
    const rotated = rotatePad(cand.pad, info.rotation);
    const p = positions[cand.compIdx];
    const shiftCol = -(p.col + rotated.col);
    const shiftRow = -(p.row + rotated.row);

    if (shiftCol === 0 && shiftRow === 0) return positions; // Already at origin

    // Check all components stay in bounds after shift
    let ok = true;
    for (let i = 0; i < positions.length; i++) {
      const np = { col: positions[i].col + shiftCol, row: positions[i].row + shiftRow };
      const lb = infos[i].localBBox;
      if (np.col + lb.minCol < 0 || np.row + lb.minRow < 0 ||
          np.col + lb.maxCol >= boardWidth || np.row + lb.maxRow >= boardHeight) {
        ok = false;
        break;
      }
    }

    if (ok) {
      return positions.map((p0) => ({
        col: p0.col + shiftCol,
        row: p0.row + shiftRow,
      }));
    }
  }

  return positions;
}

// ---- Phase 5b: Compact entire layout to top-left corner ------------

/**
 * Aggressively compact the layout toward the top-left corner.
 * First shifts the entire bounding box to start at (margin, margin),
 * then individually tries to move each component closer to (0,0)
 * without causing overlaps. This closes gaps left by the greedy/SA phases.
 */
function compactToTopLeft(
  positions: GridPosition[],
  infos: CompInfo[],
  boardWidth: number,
  boardHeight: number,
  margin: number,
  spacing: number,
  nets: NetInfo[],
  compToNets: number[][],
): GridPosition[] {
  if (positions.length === 0) return positions;
  const n = positions.length;

  // Step 1: Uniform shift — move entire layout so top-leftmost edge is at margin
  let minCol = Infinity, minRow = Infinity;
  for (let i = 0; i < n; i++) {
    const p = positions[i];
    const lb = infos[i].localBBox;
    minCol = Math.min(minCol, p.col + lb.minCol);
    minRow = Math.min(minRow, p.row + lb.minRow);
  }

  const shiftCol = margin - minCol;
  const shiftRow = margin - minRow;

  const pos = positions.map((p) => ({
    col: p.col + shiftCol,
    row: p.row + shiftRow,
  }));

  // Verify shift is valid
  for (let i = 0; i < n; i++) {
    const lb = infos[i].localBBox;
    if (pos[i].col + lb.minCol < 0 || pos[i].row + lb.minRow < 0 ||
        pos[i].col + lb.maxCol >= boardWidth || pos[i].row + lb.maxRow >= boardHeight) {
      // Shift failed — revert to original
      return positions;
    }
  }

  // Step 2: Individual compaction with routability checking.
  const bboxes: GridBBox[] = pos.map((p, i) =>
    getFootprintBBox(p, infos[i].rotation, infos[i].pads, infos[i].spanHoles),
  );

  // Build pad occupancy set maintained incrementally for route checks
  const padOcc = buildPadOccupiedSet(pos, infos);

  // Helper: incrementally update pad occupancy for a component move
  const updatePadOcc = (ci: number, oldP: GridPosition, newP: GridPosition) => {
    const rot = infos[ci].rotation;
    for (const pad of infos[ci].pads) {
      const rp = rotatePad(pad, rot);
      padOcc.delete(`${oldP.col + rp.col},${oldP.row + rp.row}`);
    }
    for (const pad of infos[ci].pads) {
      const rp = rotatePad(pad, rot);
      padOcc.add(`${newP.col + rp.col},${newP.row + rp.row}`);
    }
  };

  // Helper: check routability for a component's net connections
  const checkRouteOk = (ci: number, compPos: GridPosition): boolean => {
    for (const ni of compToNets[ci]) {
      const net = nets[ni];
      for (const pa of net.pins) {
        if (pa.compIdx !== ci) continue;
        const from: GridPosition = {
          col: compPos.col + pa.padCol,
          row: compPos.row + pa.padRow,
        };
        for (const pb of net.pins) {
          if (pb.compIdx === ci) continue;
          const to: GridPosition = {
            col: pos[pb.compIdx].col + pb.padCol,
            row: pos[pb.compIdx].row + pb.padRow,
          };
          const fk = `${from.col},${from.row}`;
          const tk = `${to.col},${to.row}`;
          const hadF = padOcc.has(fk); if (hadF) padOcc.delete(fk);
          const hadT = padOcc.has(tk); if (hadT) padOcc.delete(tk);
          const ok = canLRouteBetween(from, to, padOcc) ||
                     canZRouteBetween(from, to, padOcc, boardWidth, boardHeight);
          if (hadF) padOcc.add(fk);
          if (hadT) padOcc.add(tk);
          if (!ok) return false;
        }
      }
    }
    return true;
  };

  // Sort by position (top-left first) — compact front components first
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (pos[a].row + pos[a].col) - (pos[b].row + pos[b].col),
  );

  let moved = true;
  let passes = 0;
  while (moved && passes < 50) {
    moved = false;
    passes++;
    for (const ci of order) {
      const lb = infos[ci].localBBox;

      // Try moving left
      for (;;) {
        const np = { col: pos[ci].col - 1, row: pos[ci].row };
        if (np.col + lb.minCol < 0) break;
        const eb: GridBBox = {
          minCol: np.col + lb.minCol - spacing,
          minRow: np.row + lb.minRow - spacing,
          maxCol: np.col + lb.maxCol + spacing,
          maxRow: np.row + lb.maxRow + spacing,
        };
        let ok = true;
        for (let j = 0; j < n; j++) {
          if (j === ci) continue;
          if (gridBBoxOverlap(eb, bboxes[j])) { ok = false; break; }
        }
        if (!ok) break;

        // Routability check: update pad occupancy and verify routes
        const oldPL = { ...pos[ci] };
        updatePadOcc(ci, oldPL, np);
        if (!checkRouteOk(ci, np)) {
          updatePadOcc(ci, np, oldPL); // revert
          break;
        }

        pos[ci] = np;
        bboxes[ci] = getFootprintBBox(np, infos[ci].rotation, infos[ci].pads, infos[ci].spanHoles);
        moved = true;
      }

      // Try moving up
      for (;;) {
        const np = { col: pos[ci].col, row: pos[ci].row - 1 };
        if (np.row + lb.minRow < 0) break;
        const eb: GridBBox = {
          minCol: np.col + lb.minCol - spacing,
          minRow: np.row + lb.minRow - spacing,
          maxCol: np.col + lb.maxCol + spacing,
          maxRow: np.row + lb.maxRow + spacing,
        };
        let ok = true;
        for (let j = 0; j < n; j++) {
          if (j === ci) continue;
          if (gridBBoxOverlap(eb, bboxes[j])) { ok = false; break; }
        }
        if (!ok) break;

        // Routability check: update pad occupancy and verify routes
        const oldPU = { ...pos[ci] };
        updatePadOcc(ci, oldPU, np);
        if (!checkRouteOk(ci, np)) {
          updatePadOcc(ci, np, oldPU); // revert
          break;
        }

        pos[ci] = np;
        bboxes[ci] = getFootprintBBox(np, infos[ci].rotation, infos[ci].pads, infos[ci].spanHoles);
        moved = true;
      }
    }
  }

  return pos;
}

// ---- Phase 6: Trial routing + repair --------------------------------

interface TrialRouteFailure {
  netIdx: number;
  pinA: NetPinRef;
  pinB: NetPinRef;
  from: GridPosition;
  to: GridPosition;
}

/**
 * Simulate the actual autorouter logic: build MST edges for each net,
 * sort by distance, and route each edge with the real A* router.
 * Successful routes mark cells as occupied, exactly like the real router.
 * Returns which pairs could NOT be routed.
 */
function trialRoute(
  positions: GridPosition[],
  infos: CompInfo[],
  nets: NetInfo[],
  boardWidth: number,
  boardHeight: number,
): TrialRouteFailure[] {
  // Build component occupied holes (identical to autorouter)
  const componentOccupied = new Set<string>();
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    for (const pad of infos[i].pads) {
      const rp = rotatePad(pad, infos[i].rotation);
      componentOccupied.add(gridKey(pos.col + rp.col, pos.row + rp.row));
    }
  }

  // Build MST edges for each net (same as autorouter)
  interface RouteEdge {
    netIdx: number;
    from: GridPosition;
    to: GridPosition;
    pinA: NetPinRef;
    pinB: NetPinRef;
    dist: number;
  }
  const edges: RouteEdge[] = [];

  for (let ni = 0; ni < nets.length; ni++) {
    const net = nets[ni];
    const pinPos: { pos: GridPosition; pin: NetPinRef; ci: number }[] = [];
    for (const pin of net.pins) {
      pinPos.push({
        ci: pin.compIdx,
        pos: {
          col: positions[pin.compIdx].col + pin.padCol,
          row: positions[pin.compIdx].row + pin.padRow,
        },
        pin,
      });
    }
    if (pinPos.length < 2) continue;

    // Prim's MST — only cross-component edges
    const inMST = new Set([0]);
    while (inMST.size < pinPos.length) {
      let bestDist = Infinity;
      let bestI = -1, bestJ = -1;
      for (const i of inMST) {
        for (let j = 0; j < pinPos.length; j++) {
          if (inMST.has(j)) continue;
          if (pinPos[i].ci === pinPos[j].ci) continue;
          const d = Math.abs(pinPos[i].pos.col - pinPos[j].pos.col) +
                    Math.abs(pinPos[i].pos.row - pinPos[j].pos.row);
          if (d < bestDist) { bestDist = d; bestI = i; bestJ = j; }
        }
      }
      if (bestJ < 0) {
        // Some pins from the same component — add anyway
        for (let j = 0; j < pinPos.length; j++) {
          if (!inMST.has(j)) { inMST.add(j); break; }
        }
        continue;
      }
      inMST.add(bestJ);
      edges.push({
        netIdx: ni,
        from: pinPos[bestI].pos,
        to: pinPos[bestJ].pos,
        pinA: pinPos[bestI].pin,
        pinB: pinPos[bestJ].pin,
        dist: bestDist,
      });
    }
  }

  // Sort short edges first (same as autorouter)
  edges.sort((a, b) => a.dist - b.dist);

  // Route each edge, tracking occupied cells from successful routes.
  // Uses multi-strategy approach: bottom A*, relaxed A*, then top-side A*.
  const bottomOccupied = new Set<string>();
  const topOccupied = new Set<string>();
  const failures: TrialRouteFailure[] = [];

  for (const edge of edges) {
    const fromKey = gridKey(edge.from.col, edge.from.row);
    const toKey = gridKey(edge.to.col, edge.to.row);

    // Adjacent → always routable (solder bridge)
    if (isAdjacent(edge.from, edge.to)) continue;

    // Build occupied set: component pads + previously routed cells (bottom)
    const occupied = new Set(componentOccupied);
    for (const k of bottomOccupied) occupied.add(k);
    occupied.delete(fromKey);
    occupied.delete(toKey);

    // Try 1: Normal bottom-side A* routing
    let route = findManhattanRoute({
      from: edge.from,
      to: edge.to,
      boardWidth,
      boardHeight,
      occupied,
      turnPenalty: 20,
      maxIterations: 50000,
    } as ExtendedRouteOptions);

    // Try 2: Relaxed bottom-side A* (allow more turns)
    if (!route) {
      route = findManhattanRoute({
        from: edge.from,
        to: edge.to,
        boardWidth,
        boardHeight,
        occupied,
        turnPenalty: 5,
        maxIterations: 60000,
      } as ExtendedRouteOptions);
    }

    // Try 3: Top-side routing (wire bridge)
    if (!route) {
      const topOcc = new Set(componentOccupied);
      for (const k of topOccupied) topOcc.add(k);
      topOcc.delete(fromKey);
      topOcc.delete(toKey);
      route = findManhattanRoute({
        from: edge.from,
        to: edge.to,
        boardWidth,
        boardHeight,
        occupied: topOcc,
        turnPenalty: 10,
        maxIterations: 50000,
      } as ExtendedRouteOptions);

      if (route && route.length >= 2) {
        // Mark on top side
        for (let i = 0; i < route.length - 1; i++) {
          const a = route[i], b = route[i + 1];
          const dc = Math.sign(b.col - a.col);
          const dr = Math.sign(b.row - a.row);
          let c = a.col, r = a.row;
          while (c !== b.col || r !== b.row) {
            const key = gridKey(c, r);
            if (key !== fromKey && key !== toKey) topOccupied.add(key);
            c += dc; r += dr;
          }
        }
        continue; // Successfully routed on top
      }
    }

    if (route && route.length >= 2) {
      // Mark route cells as occupied for subsequent routes (bottom)
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i], b = route[i + 1];
        const dc = Math.sign(b.col - a.col);
        const dr = Math.sign(b.row - a.row);
        let c = a.col, r = a.row;
        while (c !== b.col || r !== b.row) {
          const key = gridKey(c, r);
          if (key !== fromKey && key !== toKey) bottomOccupied.add(key);
          c += dc; r += dr;
        }
      }
    } else {
      failures.push({
        netIdx: edge.netIdx,
        pinA: edge.pinA,
        pinB: edge.pinB,
        from: edge.from,
        to: edge.to,
      });
    }
  }

  return failures;
}

/**
 * Repair unroutable nets by nudging and/or rotating involved components.
 * For each failure, tries:
 *   1. Small position nudges on endpoint components
 *   2. Rotation changes (90°, 180°, 270°) for endpoint components
 *   3. Combined nudge + rotation
 * Verifies the specific pair becomes A*-routable and all existing
 * connections remain valid.
 */
function repairUnroutableNets(
  positions: GridPosition[],
  infos: CompInfo[],
  nets: NetInfo[],
  boardWidth: number,
  boardHeight: number,
  spacing: number,
  failures: TrialRouteFailure[],
): GridPosition[] {
  if (failures.length === 0) return positions;

  const n = positions.length;
  const pos = positions.map((p) => ({ ...p }));
  const bboxes: GridBBox[] = pos.map((p, i) =>
    getFootprintBBox(p, infos[i].rotation, infos[i].pads, infos[i].spanHoles),
  );

  const nudges: GridPosition[] = [
    { col: 0, row: 0 }, // No nudge (for rotation-only repairs)
    { col: 0, row: -1 }, { col: 0, row: 1 },
    { col: -1, row: 0 }, { col: 1, row: 0 },
    { col: 0, row: -2 }, { col: 0, row: 2 },
    { col: -2, row: 0 }, { col: 2, row: 0 },
    { col: 1, row: -1 }, { col: -1, row: -1 },
    { col: 1, row: 1 }, { col: -1, row: 1 },
    { col: 0, row: -3 }, { col: 0, row: 3 },
    { col: -3, row: 0 }, { col: 3, row: 0 },
    { col: -4, row: 0 }, { col: 4, row: 0 },
    { col: 0, row: -4 }, { col: 0, row: 4 },
    { col: 2, row: -2 }, { col: -2, row: -2 },
    { col: 2, row: 2 }, { col: -2, row: 2 },
  ];

  const rotations = [0, 90, 180, 270];

  // Helper: build full occupied set for A* check
  const buildOccupied = (): Set<string> => {
    const occ = new Set<string>();
    for (let i = 0; i < n; i++) {
      for (const pad of infos[i].pads) {
        const rp = rotatePad(pad, infos[i].rotation);
        occ.add(gridKey(pos[i].col + rp.col, pos[i].row + rp.row));
      }
    }
    return occ;
  };

  // Helper: check if a specific pin pair can be A*-routed
  const canRoute = (from: GridPosition, to: GridPosition, occ: Set<string>): boolean => {
    if (isAdjacent(from, to)) return true;
    const fk = gridKey(from.col, from.row);
    const tk = gridKey(to.col, to.row);
    occ.delete(fk); occ.delete(tk);
    // Try with normal turn penalty first, then relaxed
    let route = findManhattanRoute({
      from, to, boardWidth, boardHeight, occupied: occ,
      turnPenalty: 20, maxIterations: 30000,
    } as ExtendedRouteOptions);
    if (!route) {
      route = findManhattanRoute({
        from, to, boardWidth, boardHeight, occupied: occ,
        turnPenalty: 5, maxIterations: 40000,
      } as ExtendedRouteOptions);
    }
    occ.add(fk); occ.add(tk);
    return route !== null && route.length >= 2;
  };

  // Helper: get pin absolute position considering component rotation
  const getPinAbsPos = (pin: NetPinRef, compPos: GridPosition, rot: number): GridPosition => {
    // Pin padCol/padRow are already rotated to the current rotation.
    // If we change rotation, we need to recalculate from raw pads.
    return {
      col: compPos.col + pin.padCol,
      row: compPos.row + pin.padRow,
    };
  };

  for (const fail of failures) {
    let fixed = false;

    for (const ci of [fail.pinA.compIdx, fail.pinB.compIdx]) {
      if (fixed) break;
      const origRot = infos[ci].rotation;

      // Try each rotation (including current)
      for (const rot of rotations) {
        if (fixed) break;

        // Compute new localBBox for this rotation
        const newLb = getFootprintBBox({ col: 0, row: 0 }, rot, infos[ci].pads, infos[ci].spanHoles);

        for (const nudge of nudges) {
          // Skip identity (no nudge + same rotation)
          if (nudge.col === 0 && nudge.row === 0 && rot === origRot) continue;

          const np: GridPosition = {
            col: pos[ci].col + nudge.col,
            row: pos[ci].row + nudge.row,
          };

          // Board bounds
          if (np.col + newLb.minCol < 0 || np.row + newLb.minRow < 0 ||
              np.col + newLb.maxCol >= boardWidth || np.row + newLb.maxRow >= boardHeight) continue;

          // Collision check with spacing
          const eb: GridBBox = {
            minCol: np.col + newLb.minCol - spacing,
            minRow: np.row + newLb.minRow - spacing,
            maxCol: np.col + newLb.maxCol + spacing,
            maxRow: np.row + newLb.maxRow + spacing,
          };
          let bad = false;
          for (let j = 0; j < n; j++) {
            if (j === ci) continue;
            if (gridBBoxOverlap(eb, bboxes[j])) { bad = true; break; }
          }
          if (bad) continue;

          // Apply changes temporarily
          const savedPos = { ...pos[ci] };
          const savedRot = infos[ci].rotation;
          pos[ci] = np;
          infos[ci].rotation = rot;
          const occ = buildOccupied();

          // Compute failing pair's new positions
          const from: GridPosition = getPinAbsPos(fail.pinA, pos[fail.pinA.compIdx], infos[fail.pinA.compIdx].rotation);
          const to: GridPosition = getPinAbsPos(fail.pinB, pos[fail.pinB.compIdx], infos[fail.pinB.compIdx].rotation);

          if (!canRoute(from, to, occ)) {
            pos[ci] = savedPos;
            infos[ci].rotation = savedRot;
            continue;
          }

          // Also verify all other nets of the moved component still route
          let allOk = true;
          for (const ni of (infos[ci].netIndices ?? [])) {
            if (!allOk) break;
            const net = nets[ni];
            if (!net) continue;
            for (const pa of net.pins) {
              if (!allOk || pa.compIdx !== ci) continue;
              const fp: GridPosition = {
                col: pos[pa.compIdx].col + pa.padCol,
                row: pos[pa.compIdx].row + pa.padRow,
              };
              for (const pb of net.pins) {
                if (pb.compIdx === ci) continue;
                const tp: GridPosition = {
                  col: pos[pb.compIdx].col + pb.padCol,
                  row: pos[pb.compIdx].row + pb.padRow,
                };
                if (!canRoute(fp, tp, occ)) { allOk = false; break; }
              }
            }
          }

          if (allOk) {
            bboxes[ci] = getFootprintBBox(np, rot, infos[ci].pads, infos[ci].spanHoles);
            infos[ci].localBBox = getFootprintBBox({ col: 0, row: 0 }, rot, infos[ci].pads, infos[ci].spanHoles);
            infos[ci].w = infos[ci].localBBox.maxCol - infos[ci].localBBox.minCol + 1;
            infos[ci].h = infos[ci].localBBox.maxRow - infos[ci].localBBox.minRow + 1;
            fixed = true;
            break;
          }

          pos[ci] = savedPos;
          infos[ci].rotation = savedRot;
        }
      }
    }
  }

  return pos;
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
    return { positions: new Map(), rotations: new Map(), placed: 0, failed: 0 };
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

  // Build CompInfo array
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
      rotation: comp.rotation,
    } as CompInfo;
  });

  // Build raw (rotation-independent) net info for greedy placement
  const rawNets: RawNetInfo[] = [];
  const compToRawNets: number[][] = Array.from({ length: n }, () => []);

  for (const net of netlist.nets) {
    const pins: RawNetPin[] = [];
    const compSet = new Set<number>();
    for (const conn of net.connections) {
      const compIdx = schIdToIdx.get(conn.componentId);
      if (compIdx === undefined) continue;
      const def = infos[compIdx].def;
      if (!def) continue;
      const { pads } = getAdjustedFootprint(def, components[compIdx].properties?.holeSpan);
      const mappedPin = def.pinMapping?.[conn.pinNumber] ?? conn.pinNumber;
      const pad = pads.find((p) => p.number === mappedPin);
      if (!pad) continue;
      pins.push({ compIdx, rawPadCol: pad.gridPosition.col, rawPadRow: pad.gridPosition.row });
      compSet.add(compIdx);
    }
    if (pins.length >= 2) {
      const idx = rawNets.length;
      rawNets.push({ pins, compIndices: Array.from(compSet) });
      for (const ci of compSet) compToRawNets[ci].push(idx);
    }
  }

  // Adjacency matrix (weight = number of shared nets)
  const adj: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const rn of rawNets) {
    const a = rn.compIndices;
    for (let x = 0; x < a.length; x++) {
      for (let y = x + 1; y < a.length; y++) {
        adj[a[x]][a[y]] += 1;
        adj[a[y]][a[x]] += 1;
      }
    }
  }

  // Signal depth (BFS from power)
  computeSignalDepth(infos, adj);

  // Link raw nets → infos for netIndices
  rawNets.forEach((rn, idx) => {
    for (const ci of rn.compIndices) {
      infos[ci].netIndices.push(idx);
    }
  });

  // ==== Phase 2+3: Greedy connectivity placement ======================

  const { positions: greedyPos, rotations: greedyRot } = greedyPlacement(
    infos, adj, rawNets, compToRawNets,
    boardWidth, boardHeight, margin, spacing,
    preset.zoneBias,
  );

  // Apply greedy rotations to CompInfo (mutable rotation field, not frozen comp)
  // Now rebuild rotation-dependent structures for SA
  for (let i = 0; i < n; i++) {
    infos[i].rotation = greedyRot[i];
    const lb = getFootprintBBox({ col: 0, row: 0 }, greedyRot[i], infos[i].pads, infos[i].spanHoles);
    infos[i].localBBox = lb;
    infos[i].w = lb.maxCol - lb.minCol + 1;
    infos[i].h = lb.maxRow - lb.minRow + 1;
  }

  const { netInfos, compToNets, compZonePins } = buildNetInfos(
    infos, components, netlist, allLib, schIdToIdx,
  );

  // Update infos.netIndices for SA cost functions
  for (let i = 0; i < n; i++) infos[i].netIndices = [];
  netInfos.forEach((ni, idx) => {
    for (const ci of ni.compIndices) {
      infos[ci].netIndices.push(idx);
    }
  });

  // ==== Phase 4: Simulated annealing ==================================

  const boundsByZone: Record<CompZone, ZoneBounds> = {
    power: zoneBoundsFor(boardWidth, boardHeight, margin, 'power'),
    gnd: zoneBoundsFor(boardWidth, boardHeight, margin, 'gnd'),
    output: zoneBoundsFor(boardWidth, boardHeight, margin, 'output'),
    general: zoneBoundsFor(boardWidth, boardHeight, margin, 'general'),
  };

  const zpw = mode === 'beautiful' ? 2.2 : mode === 'easy_soldering' ? 1.4 : 1.0;
  const pzw = mode === 'beautiful' ? 4.5 : mode === 'easy_soldering' ? 3.2 : 2.4;

  let gridPos: GridPosition[];

  // For extra_compact, skip SA entirely — greedy connectivity-based
  // packing already gives maximum density and SA would scatter things.
  if (mode === 'extra_compact') {
    gridPos = greedyPos;
  } else {
    gridPos = simulatedAnnealing(
      greedyPos, infos, netInfos,
      boardWidth, boardHeight, margin, spacing,
      zpw, pzw, compToNets, compZonePins, boundsByZone,
      preset.saMultiplier,
    );
  }

  // ==== Phase 5: Post-processing ======================================

  // Row alignment for easy_soldering and beautiful
  if (preset.alignRows) {
    const rowBand = mode === 'beautiful'
      ? 4 + preset.rowGap
      : 3 + preset.rowGap;
    gridPos = postProcessRowAlign(
      gridPos, infos, boardWidth, boardHeight, margin, spacing, rowBand,
    );
  }

  // Compact everything to top-left corner (routing-aware compaction)
  gridPos = compactToTopLeft(
    gridPos, infos, boardWidth, boardHeight, margin, spacing,
    netInfos, compToNets,
  );

  // ==== Phase 6: Trial route validation + repair =====================
  // Simulate the actual A* autorouter to verify all nets can be routed.
  // If any fail, nudge/rotate components to create routing channels and re-verify.
  // Multiple repair passes with increasing aggressiveness:
  //   1-3: Standard nudge+rotation repair
  //   4-6: Re-trial with rebuilt net structures (rotation changes invalidate pins)
  let lastFailCount = Infinity;
  for (let attempt = 0; attempt < 6; attempt++) {
    // Rebuild net infos if rotations may have changed during repair
    if (attempt > 0) {
      const rebuilt = buildNetInfos(infos, components, netlist, allLib, schIdToIdx);
      // Update netInfos in-place for trial routing
      netInfos.length = 0;
      rebuilt.netInfos.forEach(ni => netInfos.push(ni));
      for (let i = 0; i < n; i++) infos[i].netIndices = [];
      netInfos.forEach((ni, idx) => {
        for (const ci of ni.compIndices) { infos[ci].netIndices.push(idx); }
      });
    }

    const failures = trialRoute(gridPos, infos, netInfos, boardWidth, boardHeight);
    if (failures.length === 0) break;

    // If no progress, stop trying
    if (failures.length >= lastFailCount && attempt > 2) break;
    lastFailCount = failures.length;

    gridPos = repairUnroutableNets(
      gridPos, infos, netInfos, boardWidth, boardHeight, spacing, failures,
    );
  }

  // Then anchor VCC pin at (0,0) — uniform shift preserves routability
  gridPos = anchorVCCAtOrigin(
    gridPos, infos, netlist, schIdToIdx, boardWidth, boardHeight,
  );

  // Build result map — only include in-bounds components
  const posMap = new Map<string, GridPosition>();
  const rotMap = new Map<string, number>();
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
      rotMap.set(components[i].id, infos[i].rotation);
    } else {
      failed++;
    }
  }

  return { positions: posMap, rotations: rotMap, placed: posMap.size, failed };
}
