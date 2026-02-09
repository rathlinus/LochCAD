// ============================================================
// Clipboard Manager — Copy, cut, paste for schematic & perfboard
// ============================================================

import type {
  SchematicComponent,
  Wire,
  Junction,
  NetLabel,
  Point,
  GridPosition,
  PerfboardComponent,
  PerfboardConnection,
  TrackCut,
} from '@/types';
import { v4 as uuid } from 'uuid';
import { SCHEMATIC_GRID, PERFBOARD_GRID } from '@/constants';

// ---- Schematic Clipboard ----

export interface SchematicClipboardData {
  type: 'schematic';
  components: SchematicComponent[];
  wires: Wire[];
  junctions: Junction[];
  labels: NetLabel[];
  /** Anchor point — centre of copied items (for offset pasting) */
  anchor: Point;
}

export interface PerfboardClipboardData {
  type: 'perfboard';
  components: PerfboardComponent[];
  connections: PerfboardConnection[];
  trackCuts: TrackCut[];
  /** Anchor point — centre of copied items (for offset pasting) */
  anchor: GridPosition;
}

export type ClipboardData = SchematicClipboardData | PerfboardClipboardData;

/** In-memory clipboard (shared across editors) */
let _clipboard: ClipboardData | null = null;

/** Paste offset counter — increments each paste to avoid stacking */
let _pasteCount = 0;
const PASTE_OFFSET_PX = SCHEMATIC_GRID * 2;  // 20px
const PASTE_OFFSET_GRID = 2; // 2 holes

export function getClipboard(): ClipboardData | null {
  return _clipboard;
}

export function clearClipboard(): void {
  _clipboard = null;
  _pasteCount = 0;
}

// ---- Schematic operations ----

/**
 * Copy selected schematic elements to the clipboard.
 * Deep-clones everything so the clipboard is independent of the store.
 */
export function copySchematicSelection(
  components: SchematicComponent[],
  wires: Wire[],
  junctions: Junction[],
  labels: NetLabel[],
): void {
  if (components.length === 0 && wires.length === 0 && labels.length === 0 && junctions.length === 0) return;

  // Calculate anchor point (centroid of components, or of wire points if no components)
  let anchor: Point;
  if (components.length > 0) {
    const sumX = components.reduce((s, c) => s + c.position.x, 0);
    const sumY = components.reduce((s, c) => s + c.position.y, 0);
    anchor = {
      x: Math.round(sumX / components.length / SCHEMATIC_GRID) * SCHEMATIC_GRID,
      y: Math.round(sumY / components.length / SCHEMATIC_GRID) * SCHEMATIC_GRID,
    };
  } else if (wires.length > 0) {
    const allPts = wires.flatMap((w) => w.points);
    const sumX = allPts.reduce((s, p) => s + p.x, 0);
    const sumY = allPts.reduce((s, p) => s + p.y, 0);
    anchor = {
      x: Math.round(sumX / allPts.length / SCHEMATIC_GRID) * SCHEMATIC_GRID,
      y: Math.round(sumY / allPts.length / SCHEMATIC_GRID) * SCHEMATIC_GRID,
    };
  } else {
    anchor = { x: 0, y: 0 };
  }

  _clipboard = {
    type: 'schematic',
    components: structuredClone(components),
    wires: structuredClone(wires),
    junctions: structuredClone(junctions),
    labels: structuredClone(labels),
    anchor,
  };
  _pasteCount = 0;
}

/**
 * Generate paste data from a schematic clipboard.
 * Each paste produces new IDs and applies an offset.
 */
export function pasteSchematicClipboard(
  sheetId: string,
  existingRefs: string[],
): {
  components: SchematicComponent[];
  wires: Wire[];
  junctions: Junction[];
  labels: NetLabel[];
} | null {
  if (!_clipboard || _clipboard.type !== 'schematic') return null;
  const data = _clipboard;

  _pasteCount++;
  const offsetX = PASTE_OFFSET_PX * _pasteCount;
  const offsetY = PASTE_OFFSET_PX * _pasteCount;

  // Map old IDs to new IDs for cross-referencing
  const idMap = new Map<string, string>();
  const mapId = (oldId: string): string => {
    if (!idMap.has(oldId)) idMap.set(oldId, uuid());
    return idMap.get(oldId)!;
  };

  // Increment references (e.g. R1 → R<next>)
  const refMap = new Map<string, string>();
  const getNewRef = (oldRef: string): string => {
    if (refMap.has(oldRef)) return refMap.get(oldRef)!;
    // Extract prefix + number
    const match = oldRef.match(/^([A-Za-z#]+)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const re = new RegExp(`^${prefix.replace('#', '\\#')}(\\d+)$`);
      let max = 0;
      for (const r of existingRefs) {
        const m = r.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      const newRef = `${prefix}${max + 1}`;
      refMap.set(oldRef, newRef);
      existingRefs.push(newRef); // prevent duplicates within the same paste
      return newRef;
    }
    return oldRef;
  };

  const components = data.components.map((c) => ({
    ...structuredClone(c),
    id: mapId(c.id),
    reference: getNewRef(c.reference),
    position: { x: c.position.x + offsetX, y: c.position.y + offsetY },
    sheetId,
  }));

  const wires = data.wires.map((w) => ({
    ...structuredClone(w),
    id: mapId(w.id),
    points: w.points.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
    sheetId,
  }));

  const junctions = data.junctions.map((j) => ({
    ...structuredClone(j),
    id: mapId(j.id),
    position: { x: j.position.x + offsetX, y: j.position.y + offsetY },
    sheetId,
  }));

  const labels = data.labels.map((l) => ({
    ...structuredClone(l),
    id: mapId(l.id),
    position: { x: l.position.x + offsetX, y: l.position.y + offsetY },
    sheetId,
  }));

  return { components, wires, junctions, labels };
}

// ---- Perfboard operations ----

/**
 * Copy selected perfboard elements to the clipboard.
 */
export function copyPerfboardSelection(
  components: PerfboardComponent[],
  connections: PerfboardConnection[],
  trackCuts: TrackCut[],
): void {
  if (components.length === 0 && connections.length === 0 && trackCuts.length === 0) return;

  let anchor: GridPosition;
  if (components.length > 0) {
    const sumC = components.reduce((s, c) => s + c.gridPosition.col, 0);
    const sumR = components.reduce((s, c) => s + c.gridPosition.row, 0);
    anchor = {
      col: Math.round(sumC / components.length),
      row: Math.round(sumR / components.length),
    };
  } else {
    anchor = { col: 0, row: 0 };
  }

  _clipboard = {
    type: 'perfboard',
    components: structuredClone(components),
    connections: structuredClone(connections),
    trackCuts: structuredClone(trackCuts),
    anchor,
  };
  _pasteCount = 0;
}

/**
 * Generate paste data from a perfboard clipboard.
 */
export function pastePerfboardClipboard(
  existingRefs: string[],
): {
  components: PerfboardComponent[];
  connections: PerfboardConnection[];
  trackCuts: TrackCut[];
} | null {
  if (!_clipboard || _clipboard.type !== 'perfboard') return null;
  const data = _clipboard;

  _pasteCount++;
  const offsetCol = PASTE_OFFSET_GRID * _pasteCount;
  const offsetRow = PASTE_OFFSET_GRID * _pasteCount;

  const idMap = new Map<string, string>();
  const mapId = (oldId: string): string => {
    if (!idMap.has(oldId)) idMap.set(oldId, uuid());
    return idMap.get(oldId)!;
  };

  const refMap = new Map<string, string>();
  const getNewRef = (oldRef: string): string => {
    if (refMap.has(oldRef)) return refMap.get(oldRef)!;
    const match = oldRef.match(/^([A-Za-z#]+)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const re = new RegExp(`^${prefix.replace('#', '\\#')}(\\d+)$`);
      let max = 0;
      for (const r of existingRefs) {
        const m = r.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      const newRef = `${prefix}${max + 1}`;
      refMap.set(oldRef, newRef);
      existingRefs.push(newRef);
      return newRef;
    }
    return oldRef;
  };

  const offsetGrid = (p: GridPosition): GridPosition => ({
    col: p.col + offsetCol,
    row: p.row + offsetRow,
  });

  const components = data.components.map((c) => ({
    ...structuredClone(c),
    id: mapId(c.id),
    reference: getNewRef(c.reference),
    schematicComponentId: '', // pasted perfboard components lose schematic link
    gridPosition: offsetGrid(c.gridPosition),
  }));

  const connections = data.connections.map((conn) => ({
    ...structuredClone(conn),
    id: mapId(conn.id),
    from: offsetGrid(conn.from),
    to: offsetGrid(conn.to),
    waypoints: conn.waypoints?.map(offsetGrid),
  }));

  const trackCuts = data.trackCuts.map((t) => ({
    ...structuredClone(t),
    id: mapId(t.id),
    position: offsetGrid(t.position),
  }));

  return { components, connections, trackCuts };
}
