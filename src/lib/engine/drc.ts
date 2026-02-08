// ============================================================
// DRC — Design Rules Check for Perfboard Layout
// ============================================================

import type {
  PerfboardDocument,
  PerfboardComponent,
  PerfboardConnection,
  DRCViolation,
  GridPosition,
} from '@/types';
import { v4 as uuid } from 'uuid';
import { getComponentById, getAdjustedFootprint } from '@/lib/component-library';
import { getFootprintBBox, gridBBoxOverlap, rotatePad as routerRotatePad } from '@/lib/engine/router';

export interface DRCResult {
  violations: DRCViolation[];
  summary: {
    errors: number;
    warnings: number;
  };
  passed: boolean;
}

export function runDRC(perfboard: PerfboardDocument): DRCResult {
  const violations: DRCViolation[] = [];

  // 1. Overlapping components (pin holes)
  checkOverlappingComponents(perfboard, violations);

  // 1b. Body collision (spanHoles bounding boxes)
  checkBodyCollisions(perfboard, violations);

  // 2. Components outside board
  checkOutOfBounds(perfboard, violations);

  // 3. Unconnected pads (vs expected from netlist)
  // This would cross-reference with netlist — for now check basic conflicts

  // 4. Short circuits on stripboard
  if (perfboard.boardType === 'stripboard') {
    checkStripboardShorts(perfboard, violations);
  }

  // 5. Connection validity
  checkConnectionValidity(perfboard, violations);

  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;

  return {
    violations,
    summary: { errors, warnings },
    passed: errors === 0,
  };
}

function getOccupiedHoles(comp: PerfboardComponent): GridPosition[] {
  const def = getComponentById(comp.libraryId);
  const pos = comp.gridPosition;
  if (!def?.footprint) return [pos];

  return def.footprint.pads.map(pad => {
    const padPos = pad.gridPosition;
    const { col, row } = rotatePad(padPos, comp.rotation);
    return {
      col: pos.col + col,
      row: pos.row + row,
    };
  });
}

function rotatePad(pos: GridPosition, rotation: number): GridPosition {
  const { col, row } = pos;
  switch (rotation % 360) {
    case 90:
      return { col: -row, row: col };
    case 180:
      return { col: -col, row: -row };
    case 270:
      return { col: row, row: -col };
    default:
      return { col, row };
  }
}

function checkOverlappingComponents(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const holeMap = new Map<string, string>(); // "col,row" -> componentId

  for (const comp of perfboard.components) {
    const holes = getOccupiedHoles(comp);

    for (const hole of holes) {
      const key = `${hole.col},${hole.row}`;
      if (holeMap.has(key)) {
        const otherId = holeMap.get(key)!;
        const other = perfboard.components.find(c => c.id === otherId);
        violations.push({
          id: uuid(),
          type: 'overlapping_components',
          severity: 'error',
          message: `Überlappende Bauteile: ${comp.reference} und ${other?.reference || 'unbekannt'} bei (${hole.col}, ${hole.row})`,
          componentIds: [comp.id, otherId],
          position: hole,
        });
      } else {
        holeMap.set(key, comp.id);
      }
    }
  }
}

/** Check if component bodies (spanHoles bounding boxes) overlap */
function checkBodyCollisions(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const comps = perfboard.components;
  // Build bbox list
  const bboxes = comps.map((c) => {
    const def = getComponentById(c.libraryId);
    const adj = def ? getAdjustedFootprint(def, (c as any).properties?.holeSpan) : null;
    const pads = adj ? adj.pads.map((p) => p.gridPosition) : [{ col: 0, row: 0 }];
    const spanHoles = adj?.spanHoles;
    return getFootprintBBox(c.gridPosition, c.rotation, pads, spanHoles);
  });

  const reported = new Set<string>();
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      if (!gridBBoxOverlap(bboxes[i], bboxes[j])) continue;
      const key = [comps[i].id, comps[j].id].sort().join(',');
      if (reported.has(key)) continue;
      reported.add(key);
      violations.push({
        id: uuid(),
        type: 'overlapping_components',
        severity: 'warning',
        message: `Gehäuse-Kollision: ${comps[i].reference} und ${comps[j].reference} überlappen sich`,
        componentIds: [comps[i].id, comps[j].id],
        position: comps[i].gridPosition,
      });
    }
  }
}

function checkOutOfBounds(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const cols = perfboard.width;
  const rows = perfboard.height;

  for (const comp of perfboard.components) {
    const holes = getOccupiedHoles(comp);

    for (const hole of holes) {
      if (hole.col < 0 || hole.col >= cols || hole.row < 0 || hole.row >= rows) {
        violations.push({
          id: uuid(),
          type: 'out_of_bounds',
          severity: 'error',
          message: `${comp.reference} ragt über den Plattenrand hinaus bei (${hole.col}, ${hole.row})`,
          componentIds: [comp.id],
          position: hole,
        });
        break; // One violation per component is enough
      }
    }
  }
}

function checkStripboardShorts(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  // On stripboard, all holes in the same row are connected unless cut
  // Two different nets on the same strip segment = short circuit
  // This requires netlist information — for now, check if components that shouldn't
  // be on the same strip are.

  // Build strip segments (row, startCol, endCol) considering cuts
  const bRows = perfboard.height;
  for (let row = 0; row < bRows; row++) {
    const cuts = perfboard.trackCuts
      .filter(tc => tc.position.row === row)
      .map(tc => tc.position.col)
      .sort((a, b) => a - b);

    // Find components on this row
    const compsOnRow: { col: number; ref: string; pinLabel: string }[] = [];
    for (const comp of perfboard.components) {
      const holes = getOccupiedHoles(comp);
      const def = getComponentById(comp.libraryId);

      holes.forEach((h, idx) => {
        if (h.row === row) {
          compsOnRow.push({
            col: h.col,
            ref: comp.reference,
            pinLabel: def?.footprint?.pads[idx]?.label || `${idx + 1}`,
          });
        }
      });
    }

    if (compsOnRow.length < 2) continue;

    // Group by strip segment
    const getSegment = (col: number): number => {
      let seg = 0;
      for (const cut of cuts) {
        if (col > cut) seg++;
      }
      return seg;
    };

    const segments = new Map<number, typeof compsOnRow>();
    for (const c of compsOnRow) {
      const seg = getSegment(c.col);
      if (!segments.has(seg)) segments.set(seg, []);
      segments.get(seg)!.push(c);
    }

    for (const [, pins] of segments) {
      if (pins.length > 3) {
        violations.push({
          id: uuid(),
          type: 'crowded_strip',
          severity: 'warning',
          message: `Viele Pins auf Streifensegment Reihe ${row}: ${pins.map(p => `${p.ref}:${p.pinLabel}`).join(', ')}`,
          componentIds: [],
          position: { col: pins[0].col, row },
        });
      }
    }
  }
}

function checkConnectionValidity(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const cols = perfboard.width;
  const rows = perfboard.height;

  for (const conn of perfboard.connections) {
    const startPosition = conn.from;
    const endPosition = conn.to;
    if (
      startPosition.col < 0 || startPosition.col >= cols ||
      startPosition.row < 0 || startPosition.row >= rows ||
      endPosition.col < 0 || endPosition.col >= cols ||
      endPosition.row < 0 || endPosition.row >= rows
    ) {
      violations.push({
        id: uuid(),
        type: 'connection_out_of_bounds',
        severity: 'error',
        message: `Verbindung außerhalb der Platine`,
        componentIds: [],
        position: startPosition,
      });
    }
  }
}
