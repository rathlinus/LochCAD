// ============================================================
// ERC — Electrical Rules Check
// ============================================================

import type {
  SchematicDocument,
  SchematicComponent,
  Wire,
  ERCViolation,
  PinDefinition,
  Point,
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
}

// Pin type compatibility matrix
// Rows = driver, Cols = driven
// 'ok' | 'warn' | 'error'
const PIN_COMPAT: Record<string, Record<string, 'ok' | 'warn' | 'error'>> = {
  output: {
    output: 'error', // Two outputs on same net
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
    power_in: 'ok', // Multiple power inputs OK (e.g., VCC pins)
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

  // 1. Unconnected pins
  checkUnconnectedPins(schematic, violations);

  // 2. Pin type conflicts
  checkPinConflicts(schematic, violations);

  // 3. Duplicate references
  checkDuplicateReferences(schematic, violations);

  // 4. Missing values
  checkMissingValues(schematic, violations);

  // 5. Floating wires (endpoints not connected to anything)
  checkFloatingWires(schematic, violations);

  const errors = violations.filter(v => v.severity === 'error').length;
  const warnings = violations.filter(v => v.severity === 'warning').length;
  const info = violations.filter(v => v.severity === 'info').length;

  return {
    violations,
    summary: { errors, warnings, info },
    passed: errors === 0,
  };
}

function checkUnconnectedPins(schematic: SchematicDocument, violations: ERCViolation[]) {
  const wirePoints = new Set<string>();

  for (const wire of schematic.wires) {
    for (const p of wire.points) {
      wirePoints.add(`${Math.round(p.x)},${Math.round(p.y)}`);
    }
  }

  for (const comp of schematic.components) {
    const def = getComponentById(comp.libraryId);
    if (!def) continue;

    for (const pin of def.symbol.pins) {
      const pos = transformPinWorld(pin, comp);
      const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
      const pinDir = pin.direction ?? 0;
      const tipKey = `${Math.round(pos.x - pin.length * Math.cos(pinDir * Math.PI / 180))},${Math.round(pos.y - pin.length * Math.sin(pinDir * Math.PI / 180))}`;

      if (!wirePoints.has(key) && !wirePoints.has(tipKey)) {
        // Check if another pin sits at the same point
        let connected = false;
        for (const other of schematic.components) {
          if (other.id === comp.id) continue;
          const otherDef = getComponentById(other.libraryId);
          if (!otherDef) continue;
          for (const oPin of otherDef.symbol.pins) {
            const oPos = transformPinWorld(oPin, other);
            if (Math.abs(oPos.x - pos.x) < 2 && Math.abs(oPos.y - pos.y) < 2) {
              connected = true;
              break;
            }
          }
          if (connected) break;
        }

        if (!connected && pin.electricalType !== 'passive') {
          violations.push({
            id: uuid(),
            type: 'unconnected_pin',
            severity: pin.electricalType === 'power_in' ? 'error' : 'warning',
            message: `Nicht angeschlossener Pin: ${comp.reference} Pin ${pin.number} (${pin.name})`,
            componentIds: [comp.id],
            position: pos,
          });
        }
      }
    }
  }
}

function checkPinConflicts(schematic: SchematicDocument, violations: ERCViolation[]) {
  const netlist = buildNetlist(schematic);

  for (const net of netlist.nets) {
    if (net.connections.length < 2) continue;

    // Check if net has a driver
    const hasDriver = net.connections.some(p => {
      const comp = schematic.components.find(c => c.reference === p.componentRef);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      if (!def) return false;
      const pin = def.symbol.pins.find(pp => pp.number === p.pinNumber);
      return pin?.electricalType === 'output' ||
        pin?.electricalType === 'power_out' ||
        pin?.electricalType === 'bidirectional';
    });

    if (!hasDriver) {
      const inputPins = net.connections.filter(p => {
        const comp = schematic.components.find(c => c.reference === p.componentRef);
        const def = comp ? getComponentById(comp.libraryId) : undefined;
        if (!def) return false;
        const pin = def.symbol.pins.find(pp => pp.number === p.pinNumber);
        return pin?.electricalType === 'input';
      });

      if (inputPins.length > 0) {
        violations.push({
          id: uuid(),
          type: 'no_driver',
          severity: 'warning',
          message: `Netz "${net.name}" hat keinen Treiber (${inputPins.length} Eingänge)`,
          componentIds: [],
        });
      }
    }

    // Check for multiple outputs on the same net
    const outputs = net.connections.filter(p => {
      const comp = schematic.components.find(c => c.reference === p.componentRef);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      if (!def) return false;
      const pin = def.symbol.pins.find(pp => pp.number === p.pinNumber);
      return pin?.electricalType === 'output' || pin?.electricalType === 'power_out';
    });

    if (outputs.length > 1) {
      violations.push({
        id: uuid(),
        type: 'multiple_drivers',
        severity: 'error',
        message: `Netz "${net.name}" hat ${outputs.length} Treiber: ${outputs.map(o => `${o.componentRef}:${o.pinNumber}`).join(', ')}`,
        componentIds: [],
      });
    }
  }
}

function checkDuplicateReferences(schematic: SchematicDocument, violations: ERCViolation[]) {
  const refCounts = new Map<string, string[]>();

  for (const comp of schematic.components) {
    if (!comp.reference) continue;
    if (!refCounts.has(comp.reference)) refCounts.set(comp.reference, []);
    refCounts.get(comp.reference)!.push(comp.id);
  }

  for (const [ref, ids] of refCounts) {
    if (ids.length > 1) {
      violations.push({
        id: uuid(),
        type: 'duplicate_reference',
        severity: 'error',
        message: `Doppelte Referenz: ${ref} (${ids.length}×)`,
        componentIds: ids,
      });
    }
  }
}

function checkMissingValues(schematic: SchematicDocument, violations: ERCViolation[]) {
  for (const comp of schematic.components) {
    if (!comp.value || comp.value.trim() === '') {
      violations.push({
        id: uuid(),
        type: 'missing_value',
        severity: 'info',
        message: `Fehlender Wert für ${comp.reference}`,
        componentIds: [comp.id],
        position: comp.position,
      });
    }
  }
}

function checkFloatingWires(schematic: SchematicDocument, violations: ERCViolation[]) {
  // Collect all endpoints into a count map
  const endpointCounts = new Map<string, number>();

  for (const wire of schematic.wires) {
    const first = wire.points[0];
    const last = wire.points[wire.points.length - 1];
    const fKey = `${Math.round(first.x)},${Math.round(first.y)}`;
    const lKey = `${Math.round(last.x)},${Math.round(last.y)}`;
    endpointCounts.set(fKey, (endpointCounts.get(fKey) || 0) + 1);
    endpointCounts.set(lKey, (endpointCounts.get(lKey) || 0) + 1);
  }

  // Pin positions
  const pinPositions = new Set<string>();
  for (const comp of schematic.components) {
    const def = getComponentById(comp.libraryId);
    if (!def) continue;
    for (const pin of def.symbol.pins) {
      const pos = transformPinWorld(pin, comp);
      pinPositions.add(`${Math.round(pos.x)},${Math.round(pos.y)}`);
    }
  }

  // Junction positions
  for (const j of schematic.junctions) {
    pinPositions.add(`${Math.round(j.position.x)},${Math.round(j.position.y)}`);
  }

  // Label positions
  for (const l of schematic.labels) {
    pinPositions.add(`${Math.round(l.position.x)},${Math.round(l.position.y)}`);
  }

  for (const [key, count] of endpointCounts) {
    if (count === 1 && !pinPositions.has(key)) {
      const [x, y] = key.split(',').map(Number);
      violations.push({
        id: uuid(),
        type: 'floating_wire',
        severity: 'warning',
        message: `Offenes Drahtende bei (${x}, ${y})`,
        componentIds: [],
        position: { x, y },
      });
    }
  }
}

function transformPinWorld(pin: PinDefinition, comp: SchematicComponent): Point {
  const angle = (comp.rotation * Math.PI) / 180;
  const mx = comp.mirror ? -1 : 1;
  let px = pin.position.x * mx;
  let py = pin.position.y;
  const rx = px * Math.cos(angle) - py * Math.sin(angle);
  const ry = px * Math.sin(angle) + py * Math.cos(angle);
  return { x: comp.position.x + rx, y: comp.position.y + ry };
}
