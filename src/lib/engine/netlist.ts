// ============================================================
// Netlist Builder — Derive netlist from schematic
// ============================================================

import type {
  SchematicDocument,
  Netlist,
  Net,
  SchematicComponent,
  Wire,
  Junction,
  NetLabel,
  Point,
} from '@/types';
import { v4 as uuid } from 'uuid';
import { getComponentById } from '@/lib/component-library';

/**
 * Build a netlist from a schematic document.
 * Algorithm:
 * 1. Extract all wire endpoints + component pin positions
 * 2. Build a union-find to group connected points
 * 3. Propagate net labels
 * 4. Output one Net per connected group
 */

class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  makeSet(key: string) {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
    }
  }

  find(key: string): string {
    this.makeSet(key);
    if (this.parent.get(key) !== key) {
      this.parent.set(key, this.find(this.parent.get(key)!));
    }
    return this.parent.get(key)!;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;

    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;

    if (rankA < rankB) {
      this.parent.set(ra, rb);
    } else if (rankA > rankB) {
      this.parent.set(rb, ra);
    } else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  getGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(key);
    }
    return groups;
  }
}

function pointKey(x: number, y: number): string {
  return `${Math.round(x)},${Math.round(y)}`;
}

interface PinInfo {
  componentId: string;
  componentRef: string;
  pinId: string;
  pinNumber: string;
  pinName: string;
  position: Point;
}

export function buildNetlist(schematic: SchematicDocument): Netlist {
  const uf = new UnionFind();
  const pinsByPoint = new Map<string, PinInfo[]>();
  const labelsByPoint = new Map<string, string>();

  // 1. Collect all component pin positions
  for (const comp of schematic.components) {
    const def = getComponentById(comp.libraryId);
    if (!def) continue;

    for (const pin of def.symbol.pins) {
      // Transform pin position by component position + rotation
      const { x, y } = transformPinPosition(pin.position, comp);
      const key = pointKey(x, y);
      uf.makeSet(key);

      const info: PinInfo = {
        componentId: comp.id,
        componentRef: comp.reference,
        pinId: pin.number,
        pinNumber: pin.number,
        pinName: pin.name,
        position: { x, y },
      };

      if (!pinsByPoint.has(key)) pinsByPoint.set(key, []);
      pinsByPoint.get(key)!.push(info);
    }
  }

  // 2. Union wire endpoints
  for (const wire of schematic.wires) {
    for (let i = 0; i < wire.points.length - 1; i++) {
      const kA = pointKey(wire.points[i].x, wire.points[i].y);
      const kB = pointKey(wire.points[i + 1].x, wire.points[i + 1].y);
      uf.makeSet(kA);
      uf.makeSet(kB);
      uf.union(kA, kB);
    }
  }

  // 3. Union junctions
  for (const junc of schematic.junctions) {
    const jKey = pointKey(junc.position.x, junc.position.y);
    uf.makeSet(jKey);
    // A junction connects all wires that pass through it — already handled
    // by wire endpoints coinciding
  }

  // 4. Register net labels
  for (const label of schematic.labels) {
    const key = pointKey(label.position.x, label.position.y);
    uf.makeSet(key);
    labelsByPoint.set(key, label.text);
  }

  // 5. Union pins with wires at same point
  for (const [pKey] of pinsByPoint) {
    // Already in union-find, it will merge if a wire endpoint matches
  }

  // 6. Union labels with same name (global nets)
  const labelGroups = new Map<string, string[]>();
  for (const [key, name] of labelsByPoint) {
    if (!labelGroups.has(name)) labelGroups.set(name, []);
    labelGroups.get(name)!.push(key);
  }
  for (const [, keys] of labelGroups) {
    for (let i = 1; i < keys.length; i++) {
      uf.union(keys[0], keys[i]);
    }
  }

  // 7. Build nets
  const groups = uf.getGroups();
  const nets: Net[] = [];
  let netCounter = 1;

  for (const [root, members] of groups) {
    // Collect pins in this net
    const netPins: { componentId: string; componentRef: string; pinNumber: string; pinName: string }[] = [];
    let netName: string | undefined;

    for (const member of members) {
      // Check for pins
      const pinsAtPoint = pinsByPoint.get(member);
      if (pinsAtPoint) {
        for (const p of pinsAtPoint) {
          netPins.push({
            componentId: p.componentId,
            componentRef: p.componentRef,
            pinNumber: p.pinNumber,
            pinName: p.pinName,
          });
        }
      }
      // Check for labels
      const label = labelsByPoint.get(member);
      if (label) netName = label;
    }

    if (netPins.length === 0) continue;

    nets.push({
      id: uuid(),
      name: netName || `Net_${netCounter++}`,
      connections: netPins,
    });
  }

  return {
    nets,
    components: schematic.components.map(c => ({
      id: c.id,
      reference: c.reference,
      value: c.value,
      footprint: getComponentById(c.libraryId)?.footprint,
    })),
  };
}

function transformPinPosition(
  pinPos: Point,
  comp: SchematicComponent
): Point {
  const { x: cx, y: cy } = comp.position;
  const angle = (comp.rotation * Math.PI) / 180;
  const mx = comp.mirror ? -1 : 1;

  let px = pinPos.x * mx;
  let py = pinPos.y;

  // Rotate
  const rx = px * Math.cos(angle) - py * Math.sin(angle);
  const ry = px * Math.sin(angle) + py * Math.cos(angle);

  return { x: cx + rx, y: cy + ry };
}
