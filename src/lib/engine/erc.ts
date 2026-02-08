// ============================================================
// ERC — Electrical Rules Check (Enhanced)
// ============================================================

import type {
  SchematicDocument,
  SchematicComponent,
  Wire,
  ERCViolation,
  PinDefinition,
  Point,
  ComponentSymbol,
} from '@/types';
import { buildNetlist } from './netlist';
import { getComponentById } from '@/lib/component-library';
import { v4 as uuid } from 'uuid';

export type ERCSeverity = 'error' | 'warning' | 'info';

export interface ERCResult {
  violations: ERCViolation[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  passed: boolean;
  timestamp: number;
}

// Pin type compatibility matrix
const PIN_COMPAT: Record<string, Record<string, 'ok' | 'warn' | 'error'>> = {
  output: {
    output: 'error',
    input: 'ok',
    bidirectional: 'ok',
    passive: 'ok',
    power_in: 'warn',
    power_out: 'error',
    tristate: 'warn',
    open_collector: 'warn',
    open_emitter: 'warn',
    unspecified: 'warn',
  },
  input: {
    output: 'ok',
    input: 'ok',
    bidirectional: 'ok',
    passive: 'ok',
    power_in: 'ok',
    power_out: 'ok',
    tristate: 'ok',
    open_collector: 'ok',
    open_emitter: 'ok',
    unspecified: 'ok',
  },
  passive: {
    output: 'ok',
    input: 'ok',
    bidirectional: 'ok',
    passive: 'ok',
    power_in: 'ok',
    power_out: 'ok',
    tristate: 'ok',
    open_collector: 'ok',
    open_emitter: 'ok',
    unspecified: 'ok',
  },
  power_in: {
    output: 'ok',
    input: 'warn',
    bidirectional: 'ok',
    passive: 'ok',
    power_in: 'ok',
    power_out: 'ok',
    tristate: 'ok',
    open_collector: 'ok',
    open_emitter: 'ok',
    unspecified: 'warn',
  },
  power_out: {
    output: 'error',
    input: 'ok',
    bidirectional: 'ok',
    passive: 'ok',
    power_in: 'ok',
    power_out: 'error',
    tristate: 'ok',
    open_collector: 'ok',
    open_emitter: 'ok',
    unspecified: 'warn',
  },
};

export function runERC(schematic: SchematicDocument): ERCResult {
  const violations: ERCViolation[] = [];

  // 1. Empty schematic — bail early
  if (schematic.components.length === 0 && schematic.wires.length === 0) {
    violations.push({
      id: uuid(),
      type: 'missing_value',
      severity: 'info',
      message: 'Schaltplan ist leer — keine Bauteile oder Drähte',
      componentIds: [],
    });
    return buildResult(violations);
  }

  // 2. Shorted components (all pins on same net)
  checkShortedComponents(schematic, violations);

  // 3. Unconnected pins
  const unconnectedPinIds = checkUnconnectedPins(schematic, violations);

  // 4. Pin type conflicts & net analysis
  checkPinConflicts(schematic, violations);

  // 5. Duplicate references
  checkDuplicateReferences(schematic, violations);

  // 6. Floating wires
  checkFloatingWires(schematic, violations);

  // 7. Single-pin nets (skip pins already flagged as unconnected)
  checkSinglePinNets(schematic, violations, unconnectedPinIds);

  // 8. Overlapping components
  checkOverlappingComponents(schematic, violations);

  return buildResult(violations);
}

function buildResult(violations: ERCViolation[]): ERCResult {
  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;
  const info = violations.filter(v => v.severity === 'info').length;

  return {
    violations,
    summary: { errors, warnings, info },
    passed: errors === 0, // only errors cause failure — warnings are informational
    timestamp: Date.now(),
  };
}

// ---- Helpers ----

/** Transform a pin's connection point (pin.position) to world coordinates */
function transformPinWorld(pin: PinDefinition, comp: SchematicComponent): Point {
  const angle = (comp.rotation * Math.PI) / 180;
  const mx = comp.mirror ? -1 : 1;
  const px = pin.position.x * mx;
  const py = pin.position.y;
  const rx = px * Math.cos(angle) - py * Math.sin(angle);
  const ry = px * Math.sin(angle) + py * Math.cos(angle);
  return { x: comp.position.x + rx, y: comp.position.y + ry };
}

/** pointKey with rounding — must match netlist.ts */
function pk(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

// ---- Check Functions ----

/**
 * Detect shorted components — all pins of a component land on the same net.
 * e.g. both pins of a resistor wired to the same node → component is bypassed.
 */
function checkShortedComponents(schematic: SchematicDocument, violations: ERCViolation[]) {
  const netlist = buildNetlist(schematic);

  // Build a map: componentId → Set of net IDs its pins appear in
  const compNets = new Map<string, Set<string>>();
  for (const net of netlist.nets) {
    for (const conn of net.connections) {
      if (!compNets.has(conn.componentId)) compNets.set(conn.componentId, new Set());
      compNets.get(conn.componentId)!.add(net.id);
    }
  }

  for (const comp of schematic.components) {
    const def = getComponentById(comp.libraryId);
    if (!def || def.symbol.pins.length < 2) continue; // single-pin or unknown — skip

    const nets = compNets.get(comp.id);
    if (!nets) continue; // no pins found in netlist (all unconnected)

    // Count how many of this component's pins are actually in a net
    let connectedPinCount = 0;
    for (const net of netlist.nets) {
      for (const conn of net.connections) {
        if (conn.componentId === comp.id) connectedPinCount++;
      }
    }

    // Shorted: component has ≥2 pins, all connected pins are on the same single net
    if (nets.size === 1 && connectedPinCount >= 2) {
      violations.push({
        id: uuid(),
        type: 'short_circuit',
        severity: 'error',
        message: `Kurzschluss: Alle Pins von ${comp.reference} liegen auf demselben Netz — Bauteil ist überbrückt`,
        componentIds: [comp.id],
        position: comp.position,
      });
    }
  }
}

/**
 * Check for pins that are not connected to any wire or other pin.
 * Returns a Set of "compId:pinNumber" strings for pins found unconnected,
 * so downstream checks can skip them (avoids duplicate violations).
 */
function checkUnconnectedPins(
  schematic: SchematicDocument,
  violations: ERCViolation[],
): Set<string> {
  const unconnectedSet = new Set<string>();

  // Collect ALL wire points (every polyline vertex)
  const wirePoints = new Set<string>();
  for (const wire of schematic.wires) {
    for (const p of wire.points) {
      wirePoints.add(pk(p.x, p.y));
    }
  }

  // Collect all label positions (labels act as connection points)
  for (const label of schematic.labels) {
    wirePoints.add(pk(label.position.x, label.position.y));
  }

  // Build a map of all pin world-positions in the schematic, keyed by point
  const allPinPositions = new Map<string, { compId: string; ref: string }[]>();
  for (const comp of schematic.components) {
    const def = getComponentById(comp.libraryId);
    if (!def) continue;
    for (const pin of def.symbol.pins) {
      const pos = transformPinWorld(pin, comp);
      const key = pk(pos.x, pos.y);
      if (!allPinPositions.has(key)) allPinPositions.set(key, []);
      allPinPositions.get(key)!.push({ compId: comp.id, ref: comp.reference });
    }
  }

  for (const comp of schematic.components) {
    const def = getComponentById(comp.libraryId);
    if (!def) continue;

    for (const pin of def.symbol.pins) {
      const pos = transformPinWorld(pin, comp);
      const key = pk(pos.x, pos.y);

      // Connected if: a wire touches this point, or another component's pin sits here
      const wireHit = wirePoints.has(key);
      const pinNeighbours = allPinPositions.get(key);
      const otherPinHit = pinNeighbours ? pinNeighbours.some(p => p.compId !== comp.id) : false;

      if (!wireHit && !otherPinHit) {
        const pinKey = `${comp.id}:${pin.number}`;
        unconnectedSet.add(pinKey);

        // Severity: power_in unconnected → error, passive → info, others → warning
        let severity: 'error' | 'warning' | 'info' = 'warning';
        if (pin.electricalType === 'power_in') severity = 'error';
        if (pin.electricalType === 'passive') severity = 'info';

        violations.push({
          id: uuid(),
          type: 'unconnected_pin',
          severity,
          message: `Nicht verbundener Pin: ${comp.reference} Pin ${pin.number} (${pin.name}) [${pin.electricalType}]`,
          componentIds: [comp.id],
          position: pos,
        });
      }
    }
  }

  return unconnectedSet;
}

function checkPinConflicts(schematic: SchematicDocument, violations: ERCViolation[]) {
  const netlist = buildNetlist(schematic);

  for (const net of netlist.nets) {
    if (net.connections.length < 2) continue;

    // Resolve pin electrical types for this net
    const pinInfos = net.connections.map(p => {
      const comp = schematic.components.find(c => c.id === p.componentId);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      const pin = def?.symbol.pins.find(pp => pp.number === p.pinNumber);
      return {
        ...p,
        electricalType: pin?.electricalType || 'unspecified',
        compId: comp?.id,
      };
    });

    // Check for multiple output drivers on same net
    const outputs = pinInfos.filter(p =>
      p.electricalType === 'output' || p.electricalType === 'power_out'
    );
    if (outputs.length > 1) {
      violations.push({
        id: uuid(),
        type: 'multiple_drivers',
        severity: 'error',
        message: `Netz "${net.name}": ${outputs.length} Treiber — Konflikt zwischen: ${outputs.map(o => `${o.componentRef}:${o.pinNumber}`).join(', ')}`,
        componentIds: outputs.map(o => o.compId).filter(Boolean) as string[],
      });
    }

    // Check if net with input pins has at least one driver
    const hasDriver = pinInfos.some(p =>
      p.electricalType === 'output' ||
      p.electricalType === 'power_out' ||
      p.electricalType === 'bidirectional' ||
      p.electricalType === 'passive'  // passive pins can drive inputs (voltage dividers etc.)
    );
    const inputPins = pinInfos.filter(p => p.electricalType === 'input');
    if (!hasDriver && inputPins.length > 0) {
      violations.push({
        id: uuid(),
        type: 'no_driver',
        severity: 'warning',
        message: `Netz "${net.name}": kein Treiber — ${inputPins.length} Eingangs-Pin(s) ungetrieben`,
        componentIds: inputPins.map(p => p.compId).filter(Boolean) as string[],
      });
    }

    // Check pin type compatibility pairs
    for (let i = 0; i < pinInfos.length; i++) {
      for (let j = i + 1; j < pinInfos.length; j++) {
        const a = pinInfos[i];
        const b = pinInfos[j];
        const compatRow = PIN_COMPAT[a.electricalType];
        const result = compatRow?.[b.electricalType];
        if (result === 'error') {
          violations.push({
            id: uuid(),
            type: 'conflicting_pin_types',
            severity: 'error',
            message: `Pin-Typ-Konflikt auf Netz "${net.name}": ${a.componentRef}:${a.pinNumber} (${a.electricalType}) ↔ ${b.componentRef}:${b.pinNumber} (${b.electricalType})`,
            componentIds: [a.compId, b.compId].filter(Boolean) as string[],
          });
        }
      }
    }
  }
}

function checkDuplicateReferences(schematic: SchematicDocument, violations: ERCViolation[]) {
  const refCounts = new Map<string, { ids: string[]; positions: Point[] }>();

  for (const comp of schematic.components) {
    if (!comp.reference || comp.reference.startsWith('#')) continue; // skip power refs
    if (!refCounts.has(comp.reference)) refCounts.set(comp.reference, { ids: [], positions: [] });
    const entry = refCounts.get(comp.reference)!;
    entry.ids.push(comp.id);
    entry.positions.push(comp.position);
  }

  for (const [ref, data] of refCounts) {
    if (data.ids.length > 1) {
      violations.push({
        id: uuid(),
        type: 'duplicate_reference',
        severity: 'error',
        message: `Doppeltes Referenzkennzeichen: ${ref} wird ${data.ids.length}x verwendet`,
        componentIds: data.ids,
        position: data.positions[0],
      });
    }
  }
}

function checkFloatingWires(schematic: SchematicDocument, violations: ERCViolation[]) {
  // Count how many times each wire start/end appears across all wires
  const endpointCounts = new Map<string, number>();
  for (const wire of schematic.wires) {
    const first = wire.points[0];
    const last = wire.points[wire.points.length - 1];
    endpointCounts.set(pk(first.x, first.y), (endpointCounts.get(pk(first.x, first.y)) || 0) + 1);
    endpointCounts.set(pk(last.x, last.y), (endpointCounts.get(pk(last.x, last.y)) || 0) + 1);
  }

  // Collect all positions that count as "connected to something"
  const connectedPoints = new Set<string>();

  // Pin positions
  for (const comp of schematic.components) {
    const def = getComponentById(comp.libraryId);
    if (!def) continue;
    for (const pin of def.symbol.pins) {
      const pos = transformPinWorld(pin, comp);
      connectedPoints.add(pk(pos.x, pos.y));
    }
  }

  // Labels
  for (const l of schematic.labels) {
    connectedPoints.add(pk(l.position.x, l.position.y));
  }

  // Junctions
  for (const j of schematic.junctions) {
    connectedPoints.add(pk(j.position.x, j.position.y));
  }

  for (const [key, count] of endpointCounts) {
    // A wire endpoint that only appears once AND doesn't touch a pin/label/junction
    if (count === 1 && !connectedPoints.has(key)) {
      const [x, y] = key.split(',').map(Number);
      violations.push({
        id: uuid(),
        type: 'floating_wire',
        severity: 'warning',
        message: `Lose Drahtende bei (${x}, ${y}) — nicht verbunden mit Pin, Label oder anderem Draht`,
        componentIds: [],
        position: { x, y },
      });
    }
  }
}

/**
 * Nets with only one connection — likely unfinished wiring.
 * Skip pins already flagged as unconnected to avoid duplicate noise.
 */
function checkSinglePinNets(
  schematic: SchematicDocument,
  violations: ERCViolation[],
  unconnectedPinIds: Set<string>,
) {
  const netlist = buildNetlist(schematic);

  for (const net of netlist.nets) {
    if (net.connections.length !== 1) continue;
    const conn = net.connections[0];
    const comp = schematic.components.find(c => c.id === conn.componentId);
    if (!comp) continue;

    // Skip if this pin was already reported as unconnected
    if (unconnectedPinIds.has(`${comp.id}:${conn.pinNumber}`)) continue;

    violations.push({
      id: uuid(),
      type: 'unconnected_pin',
      severity: 'info',
      message: `Netz "${net.name}" hat nur eine Verbindung (${conn.componentRef}:${conn.pinNumber}) — Verdrahtung unvollständig?`,
      componentIds: [comp.id],
      position: comp.position,
    });
  }
}

function checkOverlappingComponents(schematic: SchematicDocument, violations: ERCViolation[]) {
  const posMap = new Map<string, string[]>();
  for (const comp of schematic.components) {
    const key = pk(comp.position.x, comp.position.y);
    if (!posMap.has(key)) posMap.set(key, []);
    posMap.get(key)!.push(comp.id);
  }

  for (const [key, ids] of posMap) {
    if (ids.length > 1) {
      const refs = ids.map(id => schematic.components.find(c => c.id === id)?.reference || id);
      const [x, y] = key.split(',').map(Number);
      violations.push({
        id: uuid(),
        type: 'duplicate_reference',
        severity: 'warning',
        message: `${ids.length} Bauteile an gleicher Position (${x}, ${y}): ${refs.join(', ')}`,
        componentIds: ids,
        position: { x, y },
      });
    }
  }
}
