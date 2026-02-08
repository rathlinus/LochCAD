// ============================================================
// DRC — Design Rules Check for Perfboard Layout (Enhanced)
// ============================================================

import type {
  PerfboardDocument,
  PerfboardComponent,
  PerfboardConnection,
  DRCViolation,
  GridPosition,
  SchematicDocument,
  Net,
} from '@/types';
import { v4 as uuid } from 'uuid';
import { getComponentById, getAdjustedFootprint } from '@/lib/component-library';
import { getFootprintBBox, gridBBoxOverlap, rotatePad as routerRotatePad } from '@/lib/engine/router';
import { buildNetlist } from './netlist';

export interface DRCResult {
  violations: DRCViolation[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  passed: boolean;
  timestamp: number;
}

export function runDRC(perfboard: PerfboardDocument, schematic?: SchematicDocument): DRCResult {
  const violations: DRCViolation[] = [];

  // Build hole→net mapping from schematic for net-aware checks
  const holeNetMap = schematic ? buildHoleNetMap(perfboard, schematic) : null;

  // 1. Overlapping components (pin holes)
  checkOverlappingComponents(perfboard, violations);

  // 1b. Body collision (spanHoles bounding boxes)
  checkBodyCollisions(perfboard, violations);

  // 2. Components outside board
  checkOutOfBounds(perfboard, violations);

  // 3. Short circuits on stripboard
  if (perfboard.boardType === 'stripboard') {
    checkStripboardShorts(perfboard, violations);
  }

  // 4. Connection validity
  checkConnectionValidity(perfboard, violations);

  // 5. Duplicate connections (same from→to)
  checkDuplicateConnections(perfboard, violations);

  // 6. Zero-length connections
  checkZeroLengthConnections(perfboard, violations);

  // 7. Unconnected component pins (isolated pins with no wire)
  checkUnconnectedPins(perfboard, violations);

  // 8. Wire crosses another wire on the same side — check against schematic nets
  checkWireCrossings(perfboard, violations, holeNetMap);

  // 9. Components with no connections at all
  checkIsolatedComponents(perfboard, violations);

  // 10. Board is empty
  checkEmptyBoard(perfboard, violations);

  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;
  const info = violations.filter(v => v.severity === 'info').length;

  return {
    violations,
    summary: { errors, warnings, info },
    passed: errors === 0 && warnings === 0,
    timestamp: Date.now(),
  };
}

// ---- Helpers ----

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

// ---- Check Functions ----

function checkOverlappingComponents(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const holeMap = new Map<string, string>();

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
          message: `Overlapping components: ${comp.reference} and ${other?.reference || 'unknown'} share hole at (${hole.col}, ${hole.row})`,
          componentIds: [comp.id, otherId],
          position: hole,
        });
      } else {
        holeMap.set(key, comp.id);
      }
    }
  }
}

function checkBodyCollisions(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const comps = perfboard.components;
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
        message: `Body collision: ${comps[i].reference} and ${comps[j].reference} package outlines overlap`,
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
          message: `${comp.reference} extends beyond board edge at hole (${hole.col}, ${hole.row}) — board is ${cols}×${rows}`,
          componentIds: [comp.id],
          position: hole,
        });
        break;
      }
    }
  }
}

function checkStripboardShorts(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const bRows = perfboard.height;
  for (let row = 0; row < bRows; row++) {
    const cuts = perfboard.trackCuts
      .filter(tc => tc.position.row === row)
      .map(tc => tc.position.col)
      .sort((a, b) => a - b);

    const compsOnRow: { col: number; ref: string; id: string; pinLabel: string }[] = [];
    for (const comp of perfboard.components) {
      const holes = getOccupiedHoles(comp);
      const def = getComponentById(comp.libraryId);

      holes.forEach((h, idx) => {
        if (h.row === row) {
          compsOnRow.push({
            col: h.col,
            ref: comp.reference,
            id: comp.id,
            pinLabel: def?.footprint?.pads[idx]?.label || `${idx + 1}`,
          });
        }
      });
    }

    if (compsOnRow.length < 2) continue;

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
          message: `Crowded strip segment on row ${row}: ${pins.map(p => `${p.ref}:${p.pinLabel}`).join(', ')} (${pins.length} pins)`,
          componentIds: [...new Set(pins.map(p => p.id))],
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
        message: `Connection from (${startPosition.col},${startPosition.row}) to (${endPosition.col},${endPosition.row}) extends outside board`,
        componentIds: [],
        position: startPosition,
      });
    }
  }
}

function checkDuplicateConnections(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const seen = new Map<string, string>();
  for (const conn of perfboard.connections) {
    const keyA = `${conn.from.col},${conn.from.row}-${conn.to.col},${conn.to.row}-${conn.side}`;
    const keyB = `${conn.to.col},${conn.to.row}-${conn.from.col},${conn.from.row}-${conn.side}`;
    const canonical = keyA < keyB ? keyA : keyB;
    if (seen.has(canonical)) {
      violations.push({
        id: uuid(),
        type: 'short_circuit',
        severity: 'error',
        message: `Duplicate connection between (${conn.from.col},${conn.from.row}) and (${conn.to.col},${conn.to.row}) on ${conn.side} side`,
        componentIds: [],
        position: conn.from,
      });
    } else {
      seen.set(canonical, conn.id);
    }
  }
}

function checkZeroLengthConnections(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  for (const conn of perfboard.connections) {
    if (conn.from.col === conn.to.col && conn.from.row === conn.to.row) {
      violations.push({
        id: uuid(),
        type: 'short_circuit',
        severity: 'error',
        message: `Zero-length connection at (${conn.from.col},${conn.from.row}) — start and end are the same hole`,
        componentIds: [],
        position: conn.from,
      });
    }
  }
}

function checkUnconnectedPins(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  const wiredHoles = new Set<string>();
  for (const conn of perfboard.connections) {
    wiredHoles.add(`${conn.from.col},${conn.from.row}`);
    wiredHoles.add(`${conn.to.col},${conn.to.row}`);
    if (conn.waypoints) {
      for (const wp of conn.waypoints) {
        wiredHoles.add(`${wp.col},${wp.row}`);
      }
    }
  }

  const isStripboard = perfboard.boardType === 'stripboard';

  for (const comp of perfboard.components) {
    const holes = getOccupiedHoles(comp);
    const def = getComponentById(comp.libraryId);
    if (!def || holes.length <= 1) continue;

    let connectedPins = 0;
    const totalPins = holes.length;

    for (let i = 0; i < holes.length; i++) {
      const key = `${holes[i].col},${holes[i].row}`;
      if (wiredHoles.has(key)) {
        connectedPins++;
        continue;
      }
      if (isStripboard) {
        connectedPins++;
        continue;
      }
    }

    if (connectedPins < totalPins && !isStripboard) {
      const unconnected = totalPins - connectedPins;
      violations.push({
        id: uuid(),
        type: 'unconnected_net',
        severity: 'warning',
        message: `${comp.reference} has ${unconnected} of ${totalPins} pins with no wire connection`,
        componentIds: [comp.id],
        position: comp.gridPosition,
      });
    }
  }
}

/**
 * Build a mapping from hole position key ("col,row") to the schematic net name.
 * Uses the netlist from the schematic + perfboard component placements to
 * determine which net each component pin hole belongs to.
 */
function buildHoleNetMap(
  perfboard: PerfboardDocument,
  schematic: SchematicDocument,
): Map<string, string> {
  const netlist = buildNetlist(schematic);
  const holeToNet = new Map<string, string>();

  // For each perfboard component, find its schematic component,
  // then map each footprint pad hole to the net that pin belongs to.
  for (const pbComp of perfboard.components) {
    // Find schematic component by ID
    const sComp = schematic.components.find(c => c.id === pbComp.schematicComponentId);
    if (!sComp) continue;

    const def = getComponentById(pbComp.libraryId);
    if (!def?.footprint) continue;

    const { pads } = getAdjustedFootprint(def, pbComp.properties?.holeSpan);

    for (const pad of pads) {
      // Get the absolute hole position on the board
      const rotated = rotatePad(pad.gridPosition, pbComp.rotation);
      const absCol = pbComp.gridPosition.col + rotated.col;
      const absRow = pbComp.gridPosition.row + rotated.row;
      const holeKey = `${absCol},${absRow}`;

      // Find which net this pin belongs to by matching
      // componentRef + pinNumber in the netlist
      const pinNumber = pad.label || String(pads.indexOf(pad) + 1);
      for (const net of netlist.nets) {
        const match = net.connections.find(
          nc => nc.componentRef === sComp.reference && nc.pinNumber === pinNumber
        );
        if (match) {
          holeToNet.set(holeKey, net.name);
          break;
        }
      }
    }
  }

  return holeToNet;
}

/**
 * Resolve the net of a connection by looking at its endpoint holes.
 * If a connection has a netId set (from autorouter), use that.
 * Otherwise, check if the from/to holes sit on a known net from the schematic.
 */
function resolveConnectionNet(
  conn: PerfboardConnection,
  holeNetMap: Map<string, string> | null,
): string | null {
  // Explicit netId (set by autorouter)
  if (conn.netId) return conn.netId;
  if (!holeNetMap) return null;

  // Check endpoints — if either sits on a component pin, use that net
  const fromKey = `${conn.from.col},${conn.from.row}`;
  const toKey = `${conn.to.col},${conn.to.row}`;
  const fromNet = holeNetMap.get(fromKey);
  const toNet = holeNetMap.get(toKey);

  // If both endpoints have nets, they should match; return whichever is available
  return fromNet || toNet || null;
}

function checkWireCrossings(
  perfboard: PerfboardDocument,
  violations: DRCViolation[],
  holeNetMap: Map<string, string> | null,
) {
  // Map: "col,row-side" → list of connection IDs sharing that hole
  const holeUsage = new Map<string, string[]>();

  for (const conn of perfboard.connections) {
    const allPoints = [conn.from, ...(conn.waypoints || []), conn.to];
    // Wire bridges occupy through-holes — register on BOTH sides
    const sides = conn.type === 'wire_bridge' ? ['top', 'bottom'] : [conn.side];
    for (const pt of allPoints) {
      for (const side of sides) {
        const key = `${pt.col},${pt.row}-${side}`;
        if (!holeUsage.has(key)) holeUsage.set(key, []);
        holeUsage.get(key)!.push(conn.id);
      }
    }
  }

  // Build connId → resolved net lookup
  const connNetMap = new Map<string, string | null>();
  for (const conn of perfboard.connections) {
    connNetMap.set(conn.id, resolveConnectionNet(conn, holeNetMap));
  }

  const reported = new Set<string>();
  for (const [key, connIds] of holeUsage) {
    if (connIds.length <= 1) continue;
    const canonical = [...connIds].sort().join(',');
    if (reported.has(canonical)) continue;
    reported.add(canonical);

    const [coords] = key.split('-');
    const [col, row] = coords.split(',').map(Number);

    // Resolve nets for all connections sharing this hole
    const nets = new Set<string>();
    let hasUnknown = false;
    for (const cid of connIds) {
      const net = connNetMap.get(cid);
      if (net) {
        nets.add(net);
      } else {
        hasUnknown = true;
      }
    }

    if (nets.size <= 1 && !hasUnknown) {
      // All connections on the same net — this is an intentional junction, OK
      // No violation needed
      continue;
    }

    if (nets.size > 1) {
      // Different nets sharing a hole — this is a SHORT CIRCUIT
      const netNames = [...nets].join(', ');
      violations.push({
        id: uuid(),
        type: 'short_circuit',
        severity: 'error',
        message: `Kurzschluss bei (${col},${row}) — ${connIds.length} Leitungen verbinden verschiedene Netze: ${netNames}`,
        componentIds: [],
        position: { col, row },
      });
    } else if (hasUnknown && nets.size === 1) {
      // Some connections have a known net, others don't — warn
      violations.push({
        id: uuid(),
        type: 'short_circuit',
        severity: 'warning',
        message: `${connIds.length} Leitungen teilen Loch (${col},${row}) — Netz ${[...nets][0]}, einige Verbindungen ohne Netzzuordnung`,
        componentIds: [],
        position: { col, row },
      });
    } else {
      // No net info at all — can't verify, just warn
      violations.push({
        id: uuid(),
        type: 'short_circuit',
        severity: 'warning',
        message: `${connIds.length} Leitungen teilen Loch (${col},${row}) — kein Schaltplan zur Überprüfung`,
        componentIds: [],
        position: { col, row },
      });
    }
  }
}

function checkIsolatedComponents(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  if (perfboard.components.length < 2) return;

  const connectedCompIds = new Set<string>();

  const compHoles = new Map<string, Set<string>>();
  for (const comp of perfboard.components) {
    const holes = getOccupiedHoles(comp);
    const holeKeys = new Set(holes.map(h => `${h.col},${h.row}`));
    compHoles.set(comp.id, holeKeys);
  }

  for (const conn of perfboard.connections) {
    const fromKey = `${conn.from.col},${conn.from.row}`;
    const toKey = `${conn.to.col},${conn.to.row}`;
    for (const [compId, holeSet] of compHoles) {
      if (holeSet.has(fromKey) || holeSet.has(toKey)) {
        connectedCompIds.add(compId);
      }
    }
  }

  if (perfboard.boardType === 'stripboard') return;

  for (const comp of perfboard.components) {
    if (!connectedCompIds.has(comp.id)) {
      violations.push({
        id: uuid(),
        type: 'unconnected_net',
        severity: 'info',
        message: `${comp.reference} has no wire connections to other components`,
        componentIds: [comp.id],
        position: comp.gridPosition,
      });
    }
  }
}

function checkEmptyBoard(perfboard: PerfboardDocument, violations: DRCViolation[]) {
  if (perfboard.components.length === 0 && perfboard.connections.length === 0) {
    violations.push({
      id: uuid(),
      type: 'unconnected_net',
      severity: 'info',
      message: 'Board is empty — no components or connections placed',
      componentIds: [],
      position: { col: 0, row: 0 },
    });
  }
}
