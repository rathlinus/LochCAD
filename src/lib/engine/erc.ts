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

  // 6. Single-pin nets (nets with only one connection)
  checkSinglePinNets(schematic, violations);

  // 7. Power pins without power source
  checkPowerPins(schematic, violations);

  // 8. Bidirectional pin conflicts
  checkBidirectionalConflicts(schematic, violations);

  // 9. Empty schematic
  checkEmptySchematic(schematic, violations);

  // 10. Overlapping components
  checkOverlappingComponents(schematic, violations);

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

function transformPinWorld(pin: PinDefinition, comp: SchematicComponent): Point {
  const angle = (comp.rotation * Math.PI) / 180;
  const mx = comp.mirror ? -1 : 1;
  let px = pin.position.x * mx;
  let py = pin.position.y;
  const rx = px * Math.cos(angle) - py * Math.sin(angle);
  const ry = px * Math.sin(angle) + py * Math.cos(angle);
  return { x: comp.position.x + rx, y: comp.position.y + ry };
}

// ---- Check Functions ----

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
            message: `Unconnected pin: ${comp.reference} pin ${pin.number} (${pin.name}) [${pin.electricalType}]`,
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
        const compIds = inputPins.map(p => {
          const comp = schematic.components.find(c => c.reference === p.componentRef);
          return comp?.id;
        }).filter(Boolean) as string[];

        violations.push({
          id: uuid(),
          type: 'no_driver',
          severity: 'warning',
          message: `Net "${net.name}" has no driver — ${inputPins.length} input pin(s) undriven: ${inputPins.map(p => `${p.componentRef}:${p.pinNumber}`).join(', ')}`,
          componentIds: compIds,
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
      const compIds = outputs.map(p => {
        const comp = schematic.components.find(c => c.reference === p.componentRef);
        return comp?.id;
      }).filter(Boolean) as string[];

      violations.push({
        id: uuid(),
        type: 'multiple_drivers',
        severity: 'error',
        message: `Net "${net.name}" has ${outputs.length} drivers — contention between: ${outputs.map(o => `${o.componentRef}:${o.pinNumber}`).join(', ')}`,
        componentIds: compIds,
      });
    }

    // Check pin type compatibility pairs
    const pinInfos = net.connections.map(p => {
      const comp = schematic.components.find(c => c.reference === p.componentRef);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      const pin = def?.symbol.pins.find(pp => pp.number === p.pinNumber);
      return { ...p, electricalType: pin?.electricalType || 'unspecified', compId: comp?.id };
    });

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
            message: `Pin type conflict on net "${net.name}": ${a.componentRef}:${a.pinNumber} (${a.electricalType}) conflicts with ${b.componentRef}:${b.pinNumber} (${b.electricalType})`,
            componentIds: [a.compId, b.compId].filter(Boolean) as string[],
          });
        } else if (result === 'warn') {
          violations.push({
            id: uuid(),
            type: 'conflicting_pin_types',
            severity: 'warning',
            message: `Suspicious pin combination on net "${net.name}": ${a.componentRef}:${a.pinNumber} (${a.electricalType}) ↔ ${b.componentRef}:${b.pinNumber} (${b.electricalType})`,
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
    if (!comp.reference) continue;
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
        message: `Duplicate reference designator: ${ref} is used ${data.ids.length} times`,
        componentIds: data.ids,
        position: data.positions[0],
      });
    }
  }
}

function checkMissingValues(schematic: SchematicDocument, violations: ERCViolation[]) {
  for (const comp of schematic.components) {
    if (!comp.value || comp.value.trim() === '') {
      const def = getComponentById(comp.libraryId);
      violations.push({
        id: uuid(),
        type: 'missing_value',
        severity: 'info',
        message: `Missing value for ${comp.reference} (${def?.name || comp.libraryId})`,
        componentIds: [comp.id],
        position: comp.position,
      });
    }
  }
}

function checkFloatingWires(schematic: SchematicDocument, violations: ERCViolation[]) {
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
        message: `Floating wire endpoint at (${x}, ${y}) — not connected to any pin, junction, or label`,
        componentIds: [],
        position: { x, y },
      });
    }
  }
}

function checkSinglePinNets(schematic: SchematicDocument, violations: ERCViolation[]) {
  const netlist = buildNetlist(schematic);

  for (const net of netlist.nets) {
    if (net.connections.length === 1) {
      const conn = net.connections[0];
      const comp = schematic.components.find(c => c.reference === conn.componentRef);
      violations.push({
        id: uuid(),
        type: 'unconnected_pin',
        severity: 'warning',
        message: `Net "${net.name}" has only one connection (${conn.componentRef}:${conn.pinNumber}) — likely unfinished wiring`,
        componentIds: comp ? [comp.id] : [],
        position: comp?.position,
      });
    }
  }
}

function checkPowerPins(schematic: SchematicDocument, violations: ERCViolation[]) {
  const netlist = buildNetlist(schematic);

  for (const net of netlist.nets) {
    const powerInPins = net.connections.filter(p => {
      const comp = schematic.components.find(c => c.reference === p.componentRef);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      const pin = def?.symbol.pins.find(pp => pp.number === p.pinNumber);
      return pin?.electricalType === 'power_in';
    });

    const hasPowerSource = net.connections.some(p => {
      const comp = schematic.components.find(c => c.reference === p.componentRef);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      const pin = def?.symbol.pins.find(pp => pp.number === p.pinNumber);
      return pin?.electricalType === 'power_out';
    });

    // Also count labels as power sources (e.g., VCC label)
    const hasPowerLabel = schematic.labels.some(l =>
      l.type === 'power' && l.netId === net.id
    );

    if (powerInPins.length > 0 && !hasPowerSource && !hasPowerLabel) {
      const compIds = powerInPins.map(p => {
        const comp = schematic.components.find(c => c.reference === p.componentRef);
        return comp?.id;
      }).filter(Boolean) as string[];

      violations.push({
        id: uuid(),
        type: 'no_power_source',
        severity: 'error',
        message: `Net "${net.name}" has ${powerInPins.length} power input pin(s) but no power source: ${powerInPins.map(p => `${p.componentRef}:${p.pinNumber}`).join(', ')}`,
        componentIds: compIds,
      });
    }
  }
}

function checkBidirectionalConflicts(schematic: SchematicDocument, violations: ERCViolation[]) {
  const netlist = buildNetlist(schematic);

  for (const net of netlist.nets) {
    const bidiPins = net.connections.filter(p => {
      const comp = schematic.components.find(c => c.reference === p.componentRef);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      const pin = def?.symbol.pins.find(pp => pp.number === p.pinNumber);
      return pin?.electricalType === 'bidirectional';
    });

    const outputPins = net.connections.filter(p => {
      const comp = schematic.components.find(c => c.reference === p.componentRef);
      const def = comp ? getComponentById(comp.libraryId) : undefined;
      const pin = def?.symbol.pins.find(pp => pp.number === p.pinNumber);
      return pin?.electricalType === 'output';
    });

    // Multiple bidirectional + output is suspicious
    if (bidiPins.length > 0 && outputPins.length > 0) {
      violations.push({
        id: uuid(),
        type: 'conflicting_pin_types',
        severity: 'warning',
        message: `Net "${net.name}" mixes bidirectional and output pins — potential bus conflict`,
        componentIds: [],
      });
    }
  }
}

function checkEmptySchematic(schematic: SchematicDocument, violations: ERCViolation[]) {
  if (schematic.components.length === 0 && schematic.wires.length === 0) {
    violations.push({
      id: uuid(),
      type: 'missing_value',
      severity: 'info',
      message: 'Schematic is empty — no components or wires placed',
      componentIds: [],
    });
  }
}

function checkOverlappingComponents(schematic: SchematicDocument, violations: ERCViolation[]) {
  // Check if two components are placed at the exact same position
  const posMap = new Map<string, string[]>();
  for (const comp of schematic.components) {
    const key = `${Math.round(comp.position.x)},${Math.round(comp.position.y)}`;
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
        message: `${ids.length} components stacked at same position (${x}, ${y}): ${refs.join(', ')}`,
        componentIds: ids,
        position: { x, y },
      });
    }
  }
}
