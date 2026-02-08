// ============================================================
// Schematic Store — Components, wires, junctions, labels on canvas
// ============================================================

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type {
  SchematicComponent,
  Wire,
  Junction,
  NetLabel,
  Bus,
  BusEntry,
  Point,
  ToolType,
  ViewportState,
  SelectionState,
} from '@/types';
import { useProjectStore } from './projectStore';
import { SCHEMATIC_GRID } from '@/constants';
import { getBuiltInComponents } from '@/lib/component-library';
import { routeSchematicWire, getComponentBBox, getComponentPinSegments, hasComponentCollision, buildOccupiedEdges, addWireEdges, wirePassesThroughBBox, findSameNetWireIds, buildRoutingContext, getWireEdgeSet, buildOtherNetPinCells } from '@/lib/engine/schematic-router';
import type { BBox } from '@/lib/engine/schematic-router';
import { useToastStore } from './toastStore';
import type { ComponentSymbol } from '@/types';

interface SchematicState {
  // Tool
  activeTool: ToolType;
  placingComponentId: string | null; // libraryId being placed

  // Viewport
  viewport: ViewportState;

  // Selection
  selection: SelectionState;

  // Drawing state (wire/bus in progress)
  drawingPoints: Point[];
  isDrawing: boolean;

  // Undo/Redo (snapshot-based)
  undo: () => void;
  redo: () => void;
  pushSnapshot: () => void;

  // Actions — Tool
  setActiveTool: (tool: ToolType) => void;
  setPlacingComponent: (libraryId: string | null) => void;

  // Viewport
  setViewport: (vp: Partial<ViewportState>) => void;
  zoomToFit: () => void;

  // Selection
  select: (ids: Partial<SelectionState>) => void;
  clearSelection: () => void;
  toggleSelection: (type: keyof SelectionState, id: string) => void;

  // Component actions
  addComponent: (comp: Omit<SchematicComponent, 'id'>) => string;
  moveComponent: (id: string, position: Point) => boolean;
  moveComponentGroup: (ids: string[], delta: Point) => void;
  rotateComponent: (id: string) => void;
  mirrorComponent: (id: string) => void;
  deleteComponent: (id: string) => void;
  updateComponentValue: (id: string, value: string) => void;
  updateComponentRef: (id: string, reference: string) => void;
  updateComponentProperty: (id: string, key: string, value: string) => void;

  // Wire actions
  startDrawing: (point: Point) => void;
  addDrawingPoint: (point: Point) => void;
  finishDrawing: () => void;
  cancelDrawing: () => void;
  addWire: (wire: Omit<Wire, 'id'>) => string;
  deleteWire: (id: string) => void;

  // Junction
  addJunction: (position: Point, netId: string, sheetId: string) => string;
  deleteJunction: (id: string) => void;

  // Label
  addLabel: (label: Omit<NetLabel, 'id'>) => string;
  deleteLabel: (id: string) => void;
  updateLabel: (id: string, updates: Partial<NetLabel>) => void;

  // Bus
  addBus: (bus: Omit<Bus, 'id'>) => string;
  deleteBus: (id: string) => void;

  // Delete selected
  deleteSelected: () => void;

  // Snap
  snapToGrid: (point: Point) => Point;
}

const getSchematic = () => useProjectStore.getState().project.schematic;
const mutateSchematic = (fn: (s: ReturnType<typeof getSchematic>) => void) => {
  useProjectStore.setState((state) => {
    fn(state.project.schematic);
    state.project.updatedAt = new Date().toISOString();
    state.isDirty = true;
  });
};

// ---- Snapshot-based undo/redo for schematic ----
type SchSnapshot = string; // JSON of SchematicDocument
const MAX_UNDO = 50;
const _schUndoStack: SchSnapshot[] = [];
const _schRedoStack: SchSnapshot[] = [];

function getSchSnapshot(): SchSnapshot {
  return JSON.stringify(useProjectStore.getState().project.schematic);
}

function restoreSchSnapshot(snap: SchSnapshot) {
  const doc = JSON.parse(snap);
  useProjectStore.setState((state) => {
    state.project.schematic = doc;
    state.project.updatedAt = new Date().toISOString();
    state.isDirty = true;
  });
}

/** Reset all editor state when switching projects. */
export function resetSchematicEditorState() {
  _schUndoStack.length = 0;
  _schRedoStack.length = 0;
  useSchematicStore.setState({
    activeTool: 'select',
    placingComponentId: null,
    viewport: { x: 0, y: 0, scale: 1 },
    selection: { componentIds: [], wireIds: [], labelIds: [], junctionIds: [] },
    drawingPoints: [],
    isDrawing: false,
  });
}

/**
 * Get all pin connection points (world-space) for a given component.
 */
function getCompPinPositions(comp: SchematicComponent, symbol: ComponentSymbol): Point[] {
  return getComponentPinSegments(comp, symbol).map((s) => s.base);
}

const EPS = 2; // tolerance in px for matching wire endpoints to pin positions

/**
 * Check if two collinear manhattan segments overlap (share a nonzero-length span).
 * Returns true when both segments lie on the same grid line and their extents overlap.
 */
function segmentsOverlap(a0: Point, a1: Point, b0: Point, b1: Point): boolean {
  const eps = 1;
  // Both horizontal on same Y
  if (Math.abs(a0.y - a1.y) < eps && Math.abs(b0.y - b1.y) < eps && Math.abs(a0.y - b0.y) < eps) {
    const aMin = Math.min(a0.x, a1.x);
    const aMax = Math.max(a0.x, a1.x);
    const bMin = Math.min(b0.x, b1.x);
    const bMax = Math.max(b0.x, b1.x);
    return aMin < bMax - eps && aMax > bMin + eps;
  }
  // Both vertical on same X
  if (Math.abs(a0.x - a1.x) < eps && Math.abs(b0.x - b1.x) < eps && Math.abs(a0.x - b0.x) < eps) {
    const aMin = Math.min(a0.y, a1.y);
    const aMax = Math.max(a0.y, a1.y);
    const bMin = Math.min(b0.y, b1.y);
    const bMax = Math.max(b0.y, b1.y);
    return aMin < bMax - eps && aMax > bMin + eps;
  }
  return false;
}

/**
 * After a component has been transformed (moved / rotated / mirrored),
 * update all wires that were connected to its old pin positions so that
 * they track to the new pin positions, then reroute the wires.
 *
 * Mutates the schematic document in place.
 */
function rerouteConnectedWires(
  schematic: import('@/types').SchematicDocument,
  compId: string,
  oldPinPositions: Point[],
  newPinPositions: Point[],
  allLib: import('@/types').ComponentDefinition[],
) {
  // Build obstacles from all components on the same sheet (after move)
  const comp = schematic.components.find((c) => c.id === compId);
  if (!comp) return;
  const sheetId = comp.sheetId;

  const sheetComps = schematic.components.filter((c) => c.sheetId === sheetId);
  const { obstacles, allowedCells } = buildRoutingContext(sheetComps, allLib);

  // Identify which wires will be rerouted (connected to this component)
  const rerouteIds = new Set<string>();
  for (const wire of schematic.wires) {
    if (wire.sheetId !== sheetId || wire.points.length < 2) continue;
    const first = wire.points[0];
    const last = wire.points[wire.points.length - 1];
    for (const op of oldPinPositions) {
      if ((Math.abs(first.x - op.x) < EPS && Math.abs(first.y - op.y) < EPS) ||
          (Math.abs(last.x - op.x) < EPS && Math.abs(last.y - op.y) < EPS)) {
        rerouteIds.add(wire.id);
        break;
      }
    }
  }

  // Build occupied edges from all OTHER wires on this sheet (not being rerouted)
  const sheetWires = schematic.wires.filter((w) => w.sheetId === sheetId);
  const occupiedEdges = buildOccupiedEdges(
    sheetWires.filter((w) => !rerouteIds.has(w.id)),
    SCHEMATIC_GRID,
  );

  // For each wire on this sheet, check if its first or last point matched an old pin
  for (const wire of schematic.wires) {
    if (wire.sheetId !== sheetId) continue;
    if (wire.points.length < 2) continue;

    const first = wire.points[0];
    const last = wire.points[wire.points.length - 1];

    let firstPinIdx = -1;
    let lastPinIdx = -1;

    for (let i = 0; i < oldPinPositions.length; i++) {
      const op = oldPinPositions[i];
      if (Math.abs(first.x - op.x) < EPS && Math.abs(first.y - op.y) < EPS) {
        firstPinIdx = i;
      }
      if (Math.abs(last.x - op.x) < EPS && Math.abs(last.y - op.y) < EPS) {
        lastPinIdx = i;
      }
    }

    if (firstPinIdx < 0 && lastPinIdx < 0) continue; // wire not connected to this component

    // Determine new start/end positions
    const newFirst = firstPinIdx >= 0 ? newPinPositions[firstPinIdx] : first;
    const newLast = lastPinIdx >= 0 ? newPinPositions[lastPinIdx] : last;

    // Find same-net wires (exclude from overlap penalty)
    const seedPts: Point[] = [newFirst, newLast];
    if (firstPinIdx >= 0) seedPts.push(first);
    if (lastPinIdx >= 0) seedPts.push(last);
    const sameNetIds = findSameNetWireIds(seedPts, sheetWires);
    const sameNetEdges = buildOccupiedEdges(
      sheetWires.filter((w) => sameNetIds.has(w.id) && w.id !== wire.id),
      SCHEMATIC_GRID,
    );

    // Block pins from different nets
    const blockedCells = buildOtherNetPinCells(sheetComps, allLib, [newFirst, newLast], sheetWires);

    // Try to reroute the wire between new endpoints
    const routed = routeSchematicWire({
      from: newFirst,
      to: newLast,
      obstacles,
      occupiedEdges,
      sameNetEdges,
      allowedCells,
      blockedCells,
    });

    if (routed && routed.length >= 2) {
      wire.points = routed;
    } else {
      // Fallback: direct L-route if A* fails
      if (newFirst.x === newLast.x || newFirst.y === newLast.y) {
        wire.points = [newFirst, newLast];
      } else {
        wire.points = [newFirst, { x: newLast.x, y: newFirst.y }, newLast];
      }
    }

    // Update occupied edges with this wire's new path so the next wire avoids it
    addWireEdges(wire.points, SCHEMATIC_GRID, occupiedEdges);
  }
}

/**
 * Before a component is transformed, find pins that overlap with other
 * components' pins (implicit connections).  After the transform, create new
 * wires for each shared-pin pair that was pulled apart.
 *
 * Call this AFTER the component has been transformed and AFTER
 * rerouteConnectedWires so that the rerouter does not overwrite the
 * newly created wires.
 *
 * Mutates the schematic document in place.
 */
function createWiresForSharedPins(
  schematic: import('@/types').SchematicDocument,
  compId: string,
  oldPinPositions: Point[],
  newPinPositions: Point[],
  allLib: import('@/types').ComponentDefinition[],
) {
  const comp = schematic.components.find((c) => c.id === compId);
  if (!comp) return;
  const sheetId = comp.sheetId;

  // Collect all pins of OTHER components on the same sheet
  const otherPins: Point[] = [];
  for (const other of schematic.components) {
    if (other.id === compId || other.sheetId !== sheetId) continue;
    const def = allLib.find((d) => d.id === other.libraryId);
    if (!def) continue;
    for (const p of getCompPinPositions(other, def.symbol)) {
      otherPins.push(p);
    }
  }

  // For each old pin position, check if it overlapped with another component's pin
  const sharedPinIndices: number[] = [];
  for (let i = 0; i < oldPinPositions.length; i++) {
    const op = oldPinPositions[i];
    for (const ap of otherPins) {
      if (Math.abs(op.x - ap.x) < EPS && Math.abs(op.y - ap.y) < EPS) {
        sharedPinIndices.push(i);
        break;
      }
    }
  }

  if (sharedPinIndices.length === 0) return;

  // Build obstacles for routing (full bbox + pin corridors as allowed cells)
  const sheetCompsCSP = schematic.components.filter((c) => c.sheetId === sheetId);
  const { obstacles, allowedCells } = buildRoutingContext(sheetCompsCSP, allLib);

  // Build occupied edges from all existing wires on this sheet
  const sheetWires = schematic.wires.filter((w) => w.sheetId === sheetId);
  const occupiedEdges = buildOccupiedEdges(sheetWires, SCHEMATIC_GRID);

  // For each shared pin that has moved, check there isn't already a wire
  // connecting the old position to the new one, then create one
  for (const idx of sharedPinIndices) {
    const oldPos = oldPinPositions[idx];
    const newPos = newPinPositions[idx];
    // Skip if pin didn't actually move
    if (Math.abs(oldPos.x - newPos.x) < EPS && Math.abs(oldPos.y - newPos.y) < EPS) continue;

    // Check that no existing wire already connects these two points
    const alreadyConnected = schematic.wires.some((w) => {
      if (w.sheetId !== sheetId || w.points.length < 2) return false;
      const f = w.points[0];
      const l = w.points[w.points.length - 1];
      const fMatchOld = Math.abs(f.x - oldPos.x) < EPS && Math.abs(f.y - oldPos.y) < EPS;
      const fMatchNew = Math.abs(f.x - newPos.x) < EPS && Math.abs(f.y - newPos.y) < EPS;
      const lMatchOld = Math.abs(l.x - oldPos.x) < EPS && Math.abs(l.y - oldPos.y) < EPS;
      const lMatchNew = Math.abs(l.x - newPos.x) < EPS && Math.abs(l.y - newPos.y) < EPS;
      return (fMatchOld && lMatchNew) || (fMatchNew && lMatchOld);
    });
    if (alreadyConnected) continue;

    // Same-net wires should not penalise this new wire
    const sameNetIds = findSameNetWireIds([oldPos, newPos], sheetWires);
    const sameNetEdges = buildOccupiedEdges(
      sheetWires.filter((w) => sameNetIds.has(w.id)),
      SCHEMATIC_GRID,
    );

    // Route a new wire from oldPos (where the other component's pin still is) to newPos
    const blockedCells = buildOtherNetPinCells(sheetCompsCSP, allLib, [oldPos, newPos], sheetWires);
    const routed = routeSchematicWire({ from: oldPos, to: newPos, obstacles, occupiedEdges, sameNetEdges, allowedCells, blockedCells });
    let points: Point[];
    if (routed && routed.length >= 2) {
      points = routed;
    } else if (oldPos.x === newPos.x || oldPos.y === newPos.y) {
      points = [oldPos, newPos];
    } else {
      points = [oldPos, { x: newPos.x, y: oldPos.y }, newPos];
    }

    schematic.wires.push({
      id: uuid(),
      points,
      netId: '',
      sheetId,
    });
  }
}

/**
 * Reroute any wire on the sheet whose path now passes through a component's
 * bounding box.  Called after a component has been moved / rotated / mirrored
 * so that unrelated wires that were previously clear are rerouted around the
 * component's new position.
 *
 * Mutates the schematic document in place.
 */
function rerouteBlockedWires(
  schematic: import('@/types').SchematicDocument,
  sheetId: string,
  allLib: import('@/types').ComponentDefinition[],
) {
  // Build per-component info: bbox + pin positions
  const compInfos: { bbox: BBox; pins: Point[] }[] = [];
  const sheetCompsRBW = schematic.components.filter((c) => c.sheetId === sheetId);
  for (const comp of sheetCompsRBW) {
    const def = allLib.find((d) => d.id === comp.libraryId);
    if (!def) continue;
    compInfos.push({
      bbox: getComponentBBox(comp, def.symbol),
      pins: getCompPinPositions(comp, def.symbol),
    });
  }

  const fullObstacles = compInfos.map((ci) => ci.bbox);

  // Full-bbox obstacles + pin corridors for actual routing
  const { obstacles: routingObstacles, allowedCells: routingAllowed } = buildRoutingContext(sheetCompsRBW, allLib);

  // A wire is "blocked" if it passes through a component bbox that it is
  // NOT connected to (endpoints matching a pin of that component are OK).
  // Also flag wires that pass through a pin stub (base→tip segment) of
  // a pin they are NOT directly connected to, even on a component they
  // ARE connected to via another pin — this prevents wires overlapping
  // with unrelated pin stubs.
  const blockedWireIds = new Set<string>();
  for (const wire of schematic.wires) {
    if (wire.sheetId !== sheetId || wire.points.length < 2) continue;
    const wFirst = wire.points[0];
    const wLast = wire.points[wire.points.length - 1];

    for (let ciIdx = 0; ciIdx < compInfos.length; ciIdx++) {
      const ci = compInfos[ciIdx];
      if (!wirePassesThroughBBox(wire.points, ci.bbox)) continue;
      // Check if this wire is connected to a pin of this component
      const connectedToComp = ci.pins.some((p) =>
        (Math.abs(wFirst.x - p.x) < EPS && Math.abs(wFirst.y - p.y) < EPS) ||
        (Math.abs(wLast.x - p.x) < EPS && Math.abs(wLast.y - p.y) < EPS),
      );
      if (!connectedToComp) {
        blockedWireIds.add(wire.id);
        break;
      }
    }

    // Additionally check: does this wire's path pass through a pin stub
    // segment of a pin it is NOT directly connected to?
    if (!blockedWireIds.has(wire.id)) {
      outer:
      for (const comp of sheetCompsRBW) {
        const def = allLib.find((d) => d.id === comp.libraryId);
        if (!def) continue;
        const segs = getComponentPinSegments(comp, def.symbol);
        for (const seg of segs) {
          // Skip pins that the wire IS connected to
          const connectedToPin =
            (Math.abs(wFirst.x - seg.base.x) < EPS && Math.abs(wFirst.y - seg.base.y) < EPS) ||
            (Math.abs(wLast.x - seg.base.x) < EPS && Math.abs(wLast.y - seg.base.y) < EPS);
          if (connectedToPin) continue;
          // Check if any segment of the wire overlaps with this pin stub
          for (let i = 0; i < wire.points.length - 1; i++) {
            const wp = wire.points[i];
            const wn = wire.points[i + 1];
            if (segmentsOverlap(wp, wn, seg.base, seg.tip)) {
              blockedWireIds.add(wire.id);
              break outer;
            }
          }
        }
      }
    }
  }

  if (blockedWireIds.size === 0) return;

  const sheetWires = schematic.wires.filter((w) => w.sheetId === sheetId);

  // Build occupied edges from all non-blocked wires
  const occupiedEdges = buildOccupiedEdges(
    sheetWires.filter((w) => !blockedWireIds.has(w.id)),
    SCHEMATIC_GRID,
  );

  // Reroute each blocked wire
  for (const wire of schematic.wires) {
    if (!blockedWireIds.has(wire.id)) continue;
    const from = wire.points[0];
    const to = wire.points[wire.points.length - 1];

    // Same-net wires should not penalise this wire
    const sameNetIds = findSameNetWireIds([from, to], sheetWires);
    const sameNetEdges = buildOccupiedEdges(
      sheetWires.filter((w) => sameNetIds.has(w.id) && w.id !== wire.id),
      SCHEMATIC_GRID,
    );

    const blockedCells = buildOtherNetPinCells(sheetCompsRBW, allLib, [from, to], sheetWires);
    const routed = routeSchematicWire({ from, to, obstacles: routingObstacles, occupiedEdges, sameNetEdges, allowedCells: routingAllowed, blockedCells });
    if (routed && routed.length >= 2) {
      wire.points = routed;
    } else if (from.x === to.x || from.y === to.y) {
      wire.points = [from, to];
    } else {
      wire.points = [from, { x: to.x, y: from.y }, to];
    }

    // Update occupied edges so the next rerouted wire avoids this one
    addWireEdges(wire.points, SCHEMATIC_GRID, occupiedEdges);
  }
}

/**
 * Detect wires that share grid edges with wires from a different net and
 * reroute them so they separate visually.  Only the "later" wire in each
 * overlapping pair is rerouted (the first one keeps its path).
 */
function rerouteOverlappingWires(
  schematic: import('@/types').SchematicDocument,
  sheetId: string,
  allLib: import('@/types').ComponentDefinition[],
) {
  const sheetWires = schematic.wires.filter((w) => w.sheetId === sheetId && w.points.length >= 2);
  if (sheetWires.length < 2) return;

  // Build per-wire edge sets
  const wireEdgeSets = new Map<string, Set<string>>();
  for (const w of sheetWires) {
    wireEdgeSets.set(w.id, getWireEdgeSet(w.points));
  }

  // Find wires that share edges with a different-net wire
  const overlapIds = new Set<string>();
  for (let i = 0; i < sheetWires.length; i++) {
    if (overlapIds.has(sheetWires[i].id)) continue;
    const aEdges = wireEdgeSets.get(sheetWires[i].id)!;
    const aNet = findSameNetWireIds(
      [sheetWires[i].points[0], sheetWires[i].points[sheetWires[i].points.length - 1]],
      sheetWires,
    );
    for (let j = i + 1; j < sheetWires.length; j++) {
      if (overlapIds.has(sheetWires[j].id)) continue;
      // Skip if same net
      if (aNet.has(sheetWires[j].id)) continue;
      const bEdges = wireEdgeSets.get(sheetWires[j].id)!;
      // Check if they share any edge
      for (const ek of bEdges) {
        if (aEdges.has(ek)) {
          // Reroute the later wire (wire j)
          overlapIds.add(sheetWires[j].id);
          break;
        }
      }
    }
  }

  if (overlapIds.size === 0) return;

  // Build routing context
  const sheetComps = schematic.components.filter((c) => c.sheetId === sheetId);
  const { obstacles, allowedCells } = buildRoutingContext(sheetComps, allLib);

  // Build occupied edges from non-overlapping wires
  const occupiedEdges = buildOccupiedEdges(
    sheetWires.filter((w) => !overlapIds.has(w.id)),
    SCHEMATIC_GRID,
  );

  for (const wire of schematic.wires) {
    if (!overlapIds.has(wire.id)) continue;
    const from = wire.points[0];
    const to = wire.points[wire.points.length - 1];

    const sameNetIds = findSameNetWireIds([from, to], sheetWires);
    const sameNetEdges = buildOccupiedEdges(
      sheetWires.filter((w) => sameNetIds.has(w.id) && w.id !== wire.id),
      SCHEMATIC_GRID,
    );

    const blockedCells = buildOtherNetPinCells(sheetComps, allLib, [from, to], sheetWires);
    const routed = routeSchematicWire({ from, to, obstacles, occupiedEdges, sameNetEdges, allowedCells, blockedCells });
    if (routed && routed.length >= 2) {
      wire.points = routed;
    }
    // Always update occupied edges so the next overlapping wire avoids this one
    addWireEdges(wire.points, SCHEMATIC_GRID, occupiedEdges);
  }
}

export const useSchematicStore = create<SchematicState>()(
  immer((set, get) => ({
    activeTool: 'select',
    placingComponentId: null,
    viewport: { x: 0, y: 0, scale: 1 },
    selection: { componentIds: [], wireIds: [], labelIds: [], junctionIds: [] },
    drawingPoints: [],
    isDrawing: false,

    setActiveTool: (tool) =>
      set((state) => {
        state.activeTool = tool;
        if (tool !== 'place_component') state.placingComponentId = null;
        state.isDrawing = false;
        state.drawingPoints = [];
      }),

    setPlacingComponent: (libraryId) =>
      set((state) => {
        state.placingComponentId = libraryId;
        if (libraryId) state.activeTool = 'place_component';
      }),

    setViewport: (vp) =>
      set((state) => {
        Object.assign(state.viewport, vp);
      }),

    zoomToFit: () =>
      set((state) => {
        state.viewport = { x: 0, y: 0, scale: 1 };
      }),

    select: (ids) =>
      set((state) => {
        state.selection = {
          componentIds: ids.componentIds ?? [],
          wireIds: ids.wireIds ?? [],
          labelIds: ids.labelIds ?? [],
          junctionIds: ids.junctionIds ?? [],
        };
      }),

    clearSelection: () =>
      set((state) => {
        state.selection = { componentIds: [], wireIds: [], labelIds: [], junctionIds: [] };
      }),

    toggleSelection: (type, id) =>
      set((state) => {
        const arr = state.selection[type];
        const idx = arr.indexOf(id);
        if (idx >= 0) arr.splice(idx, 1);
        else arr.push(id);
      }),

    addComponent: (comp) => {
      const id = uuid();
      const schematic = getSchematic();
      const allLib = [...getBuiltInComponents(), ...useProjectStore.getState().project.componentLibrary];

      // Compute the bbox of the component being placed
      const libDef = allLib.find((c) => c.id === comp.libraryId);
      if (libDef) {
        const tmpComp = { ...comp, id: '_tmp', mirror: comp.mirror ?? false } as any;

        // Check against all existing components on the same sheet
        for (const existing of schematic.components) {
          if (existing.sheetId !== comp.sheetId) continue;
          const existingDef = allLib.find((c) => c.id === existing.libraryId);
          if (!existingDef) continue;
          if (hasComponentCollision(tmpComp, libDef.symbol, existing, existingDef.symbol)) {
            return ''; // Collision — block placement (only exact pin-on-pin allowed)
          }
        }
      }

      get().pushSnapshot();
      mutateSchematic((s) => {
        s.components.push({ ...comp, id });

        // Reroute any existing wires that now pass through the new component
        rerouteBlockedWires(s, comp.sheetId, allLib);
        rerouteOverlappingWires(s, comp.sheetId, allLib);
      });
      return id;
    },

    moveComponent: (id, position) => {
      // Snap to grid
      const snapped: Point = {
        x: Math.round(position.x / SCHEMATIC_GRID) * SCHEMATIC_GRID,
        y: Math.round(position.y / SCHEMATIC_GRID) * SCHEMATIC_GRID,
      };

      const schematic = getSchematic();
      const allLib = [...getBuiltInComponents(), ...useProjectStore.getState().project.componentLibrary];
      const comp = schematic.components.find((c) => c.id === id);
      if (!comp) return false;

      const libDef = allLib.find((c) => c.id === comp.libraryId);
      if (libDef) {
        const movedComp = { ...comp, position: snapped };
        for (const existing of schematic.components) {
          if (existing.id === id) continue;
          if (existing.sheetId !== comp.sheetId) continue;
          const existingDef = allLib.find((c) => c.id === existing.libraryId);
          if (!existingDef) continue;
          if (hasComponentCollision(movedComp, libDef.symbol, existing, existingDef.symbol)) {
            return false; // Collision — block move
          }
        }
      }

      // Capture old pin positions before the move
      const oldPins = libDef ? getCompPinPositions(comp, libDef.symbol) : [];

      get().pushSnapshot();
      mutateSchematic((s) => {
        const c = s.components.find((c) => c.id === id);
        if (!c) return;
        c.position = snapped;

        // Compute new pin positions after move and reroute
        if (libDef && oldPins.length > 0) {
          const newPins = getCompPinPositions(c as SchematicComponent, libDef.symbol);
          rerouteConnectedWires(s, id, oldPins, newPins, allLib);
          createWiresForSharedPins(s, id, oldPins, newPins, allLib);
        }

        // Reroute any unrelated wires that now pass through this component
        rerouteBlockedWires(s, comp.sheetId, allLib);
        rerouteOverlappingWires(s, comp.sheetId, allLib);
      });
      return true;
    },

    rotateComponent: (id) => {
      const schematic = getSchematic();
      const allLib = [...getBuiltInComponents(), ...useProjectStore.getState().project.componentLibrary];
      const comp = schematic.components.find((c) => c.id === id);
      if (!comp) return;
      const libDef = allLib.find((c) => c.id === comp.libraryId);
      const oldPins = libDef ? getCompPinPositions(comp, libDef.symbol) : [];

      get().pushSnapshot();
      mutateSchematic((s) => {
        const c = s.components.find((c) => c.id === id);
        if (!c) return;
        c.rotation = ((c.rotation + 90) % 360) as 0 | 90 | 180 | 270;

        if (libDef && oldPins.length > 0) {
          const newPins = getCompPinPositions(c as SchematicComponent, libDef.symbol);
          rerouteConnectedWires(s, id, oldPins, newPins, allLib);
          createWiresForSharedPins(s, id, oldPins, newPins, allLib);
        }

        // Reroute any unrelated wires that now pass through this component
        rerouteBlockedWires(s, comp.sheetId, allLib);
        rerouteOverlappingWires(s, comp.sheetId, allLib);
      });
    },

    mirrorComponent: (id) => {
      const schematic = getSchematic();
      const allLib = [...getBuiltInComponents(), ...useProjectStore.getState().project.componentLibrary];
      const comp = schematic.components.find((c) => c.id === id);
      if (!comp) return;
      const libDef = allLib.find((c) => c.id === comp.libraryId);
      const oldPins = libDef ? getCompPinPositions(comp, libDef.symbol) : [];

      get().pushSnapshot();
      mutateSchematic((s) => {
        const c = s.components.find((c) => c.id === id);
        if (!c) return;
        c.mirror = !c.mirror;

        if (libDef && oldPins.length > 0) {
          const newPins = getCompPinPositions(c as SchematicComponent, libDef.symbol);
          rerouteConnectedWires(s, id, oldPins, newPins, allLib);
          createWiresForSharedPins(s, id, oldPins, newPins, allLib);
        }

        // Reroute any unrelated wires that now pass through this component
        rerouteBlockedWires(s, comp.sheetId, allLib);
        rerouteOverlappingWires(s, comp.sheetId, allLib);
      });
    },

    moveComponentGroup: (ids, delta) => {
      const schematic = getSchematic();
      const allLib = [...getBuiltInComponents(), ...useProjectStore.getState().project.componentLibrary];
      if (ids.length === 0) return;

      const snappedDelta: Point = {
        x: Math.round(delta.x / SCHEMATIC_GRID) * SCHEMATIC_GRID,
        y: Math.round(delta.y / SCHEMATIC_GRID) * SCHEMATIC_GRID,
      };
      if (snappedDelta.x === 0 && snappedDelta.y === 0) return;

      // Collect old pin positions for wire rerouting
      const oldPinsMap = new Map<string, Point[]>();
      let sheetId = '';
      for (const id of ids) {
        const comp = schematic.components.find((c) => c.id === id);
        if (!comp) continue;
        if (!sheetId) sheetId = comp.sheetId;
        const def = allLib.find((d) => d.id === comp.libraryId);
        if (!def) continue;
        oldPinsMap.set(id, getCompPinPositions(comp, def.symbol));
      }

      get().pushSnapshot();
      mutateSchematic((s) => {
        // Move all selected components
        for (const id of ids) {
          const c = s.components.find((c) => c.id === id);
          if (!c) continue;
          c.position = {
            x: c.position.x + snappedDelta.x,
            y: c.position.y + snappedDelta.y,
          };
        }

        // Build pin mapping: old pin key → new pin position
        const pinMapping = new Map<string, Point>();
        for (const id of ids) {
          const oldPins = oldPinsMap.get(id);
          const c = s.components.find((c) => c.id === id);
          if (!c || !oldPins) continue;
          const def = allLib.find((d) => d.id === c.libraryId);
          if (!def) continue;
          const newPins = getCompPinPositions(c as SchematicComponent, def.symbol);
          for (let i = 0; i < oldPins.length; i++) {
            pinMapping.set(`${Math.round(oldPins[i].x)},${Math.round(oldPins[i].y)}`, newPins[i]);
          }
        }

        // Build obstacles from all components (full bbox + pin corridors)
        const sheetCompsMCG = s.components.filter((c) => c.sheetId === sheetId);
        const { obstacles, allowedCells } = buildRoutingContext(sheetCompsMCG as SchematicComponent[], allLib);

        // Identify wires that will be rerouted (connected to moved component pins)
        const rerouteWireIds = new Set<string>();
        for (const wire of s.wires) {
          if (wire.sheetId !== sheetId || wire.points.length < 2) continue;
          const first = wire.points[0];
          const last = wire.points[wire.points.length - 1];
          const firstKey = `${Math.round(first.x)},${Math.round(first.y)}`;
          const lastKey = `${Math.round(last.x)},${Math.round(last.y)}`;
          if (pinMapping.has(firstKey) || pinMapping.has(lastKey)) {
            rerouteWireIds.add(wire.id);
          }
        }

        // Build occupied edges from non-rerouted wires on this sheet
        const sheetWiresAll = s.wires.filter((w) => w.sheetId === sheetId);
        const occupiedEdges = buildOccupiedEdges(
          sheetWiresAll.filter((w) => !rerouteWireIds.has(w.id)),
          SCHEMATIC_GRID,
        );

        // Reroute affected wires FIRST (before creating shared-pin wires)
        for (const wire of s.wires) {
          if (wire.sheetId !== sheetId) continue;
          if (wire.points.length < 2) continue;
          const first = wire.points[0];
          const last = wire.points[wire.points.length - 1];
          const firstKey = `${Math.round(first.x)},${Math.round(first.y)}`;
          const lastKey = `${Math.round(last.x)},${Math.round(last.y)}`;
          const newFirst = pinMapping.get(firstKey);
          const newLast = pinMapping.get(lastKey);
          if (!newFirst && !newLast) continue;
          const from = newFirst || first;
          const to = newLast || last;

          // Same-net wires should not penalise this wire
          const seedPts: Point[] = [from, to, first, last];
          const sameNetIds = findSameNetWireIds(seedPts, sheetWiresAll);
          const sameNetEdges = buildOccupiedEdges(
            sheetWiresAll.filter((w) => sameNetIds.has(w.id) && w.id !== wire.id),
            SCHEMATIC_GRID,
          );

          const blockedCells = buildOtherNetPinCells(sheetCompsMCG as SchematicComponent[], allLib, [from, to], sheetWiresAll);
          const routed = routeSchematicWire({ from, to, obstacles, occupiedEdges, sameNetEdges, allowedCells, blockedCells });
          if (routed && routed.length >= 2) {
            wire.points = routed;
          } else {
            if (from.x === to.x || from.y === to.y) {
              wire.points = [from, to];
            } else {
              wire.points = [from, { x: to.x, y: from.y }, to];
            }
          }

          // Update occupied edges with this wire's new path so the next wire avoids it
          addWireEdges(wire.points, SCHEMATIC_GRID, occupiedEdges);
        }

        // Rebuild occupied edges after reroute (includes newly routed wires)
        const sheetWiresAfter = s.wires.filter((w) => w.sheetId === sheetId);
        const occupiedEdgesAfter = buildOccupiedEdges(sheetWiresAfter, SCHEMATIC_GRID);

        // Create wires for shared pins (implicit connections being pulled apart)
        const movedIdSet = new Set(ids);
        for (const id of ids) {
          const oldPins = oldPinsMap.get(id);
          const c = s.components.find((c) => c.id === id);
          if (!c || !oldPins) continue;
          const def = allLib.find((d) => d.id === c.libraryId);
          if (!def) continue;
          const newPins = getCompPinPositions(c as SchematicComponent, def.symbol);
          // Only create wires for pins shared with components NOT in the group
          for (let pidx = 0; pidx < oldPins.length; pidx++) {
            const op = oldPins[pidx];
            const np = newPins[pidx];
            if (Math.abs(op.x - np.x) < EPS && Math.abs(op.y - np.y) < EPS) continue;
            // Check if another component outside the group has a pin at the old position
            let sharedWithExternal = false;
            for (const other of schematic.components) {
              if (movedIdSet.has(other.id) || other.sheetId !== sheetId) continue;
              const oDef = allLib.find((d) => d.id === other.libraryId);
              if (!oDef) continue;
              for (const oPin of getCompPinPositions(other, oDef.symbol)) {
                if (Math.abs(op.x - oPin.x) < EPS && Math.abs(op.y - oPin.y) < EPS) {
                  sharedWithExternal = true;
                  break;
                }
              }
              if (sharedWithExternal) break;
            }
            if (!sharedWithExternal) continue;
            // Check no existing wire already connects them
            const alreadyConnected = s.wires.some((w) => {
              if (w.sheetId !== sheetId || w.points.length < 2) return false;
              const f = w.points[0], l = w.points[w.points.length - 1];
              const fO = Math.abs(f.x - op.x) < EPS && Math.abs(f.y - op.y) < EPS;
              const fN = Math.abs(f.x - np.x) < EPS && Math.abs(f.y - np.y) < EPS;
              const lO = Math.abs(l.x - op.x) < EPS && Math.abs(l.y - op.y) < EPS;
              const lN = Math.abs(l.x - np.x) < EPS && Math.abs(l.y - np.y) < EPS;
              return (fO && lN) || (fN && lO);
            });
            if (alreadyConnected) continue;
            // Same-net wires should not penalise this new wire
            const grpSameNetIds = findSameNetWireIds([op, np], sheetWiresAfter);
            const grpSameNetEdges = buildOccupiedEdges(
              sheetWiresAfter.filter((w) => grpSameNetIds.has(w.id)),
              SCHEMATIC_GRID,
            );
            const grpBlockedCells = buildOtherNetPinCells(sheetCompsMCG as SchematicComponent[], allLib, [op, np], sheetWiresAfter);
            const routed = routeSchematicWire({ from: op, to: np, obstacles, occupiedEdges: occupiedEdgesAfter, sameNetEdges: grpSameNetEdges, allowedCells, blockedCells: grpBlockedCells });
            let pts: Point[];
            if (routed && routed.length >= 2) pts = routed;
            else if (op.x === np.x || op.y === np.y) pts = [op, np];
            else pts = [op, { x: np.x, y: op.y }, np];
            s.wires.push({ id: uuid(), points: pts, netId: '', sheetId });
          }
        }

        // Reroute any unrelated wires that now pass through moved components
        rerouteBlockedWires(s, sheetId, allLib);
        rerouteOverlappingWires(s, sheetId, allLib);
      });
    },

    deleteComponent: (id) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        s.components = s.components.filter((c) => c.id !== id);
      });
    },

    updateComponentValue: (id, value) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        const comp = s.components.find((c) => c.id === id);
        if (comp) comp.value = value;
      });
    },

    updateComponentRef: (id, reference) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        const comp = s.components.find((c) => c.id === id);
        if (comp) comp.reference = reference;
      });
    },

    updateComponentProperty: (id, key, value) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        const comp = s.components.find((c) => c.id === id);
        if (comp) comp.properties[key] = value;
      });
    },

    startDrawing: (point) =>
      set((state) => {
        state.isDrawing = true;
        state.drawingPoints = [point];
      }),

    addDrawingPoint: (point) =>
      set((state) => {
        if (state.isDrawing) {
          state.drawingPoints.push(point);
        }
      }),

    finishDrawing: () => {
      const state = get();
      if (state.drawingPoints.length >= 2) {
        get().pushSnapshot();
        const sheetId = useProjectStore.getState().activeSheetId;
        const netId = uuid();
        const schematic = getSchematic();
        const allLib = [...getBuiltInComponents(), ...useProjectStore.getState().project.componentLibrary];

        if (state.activeTool === 'draw_wire') {
          // Build obstacle bboxes from sheet components (full bbox + pin corridors)
          const sheetCompsFD = schematic.components.filter((c) => c.sheetId === sheetId);
          const { obstacles, allowedCells } = buildRoutingContext(sheetCompsFD, allLib);

          // Build occupied edges from all existing wires on this sheet
          const sheetWiresFD = schematic.wires.filter((w) => w.sheetId === sheetId);
          const occupiedEdges = buildOccupiedEdges(sheetWiresFD, SCHEMATIC_GRID);

          // Same-net edges (wires sharing endpoints with drawing start/end)
          const sameNetIds = findSameNetWireIds(state.drawingPoints, sheetWiresFD);
          const sameNetEdges = buildOccupiedEdges(
            sheetWiresFD.filter((w) => sameNetIds.has(w.id)),
            SCHEMATIC_GRID,
          );

          // Block pins from different nets
          const blockedCells = buildOtherNetPinCells(sheetCompsFD, allLib, state.drawingPoints, sheetWiresFD);

          // Route each segment pair through the Manhattan A* router
          const allPoints: Point[] = [state.drawingPoints[0]];
          let routeFailed = false;
          for (let i = 0; i < state.drawingPoints.length - 1; i++) {
            const routed = routeSchematicWire({
              from: state.drawingPoints[i],
              to: state.drawingPoints[i + 1],
              obstacles,
              occupiedEdges,
              sameNetEdges,
              allowedCells,
              blockedCells,
            });
            if (!routed) {
              routeFailed = true;
              break;
            }
            // Skip first point (it's the previous segment's end)
            for (let j = 1; j < routed.length; j++) {
              allPoints.push(routed[j]);
            }
          }

          if (routeFailed) {
            useToastStore.getState().showToast('Leitung nicht möglich — Weg ist blockiert', 'warning');
          } else {
            mutateSchematic((s) => {
              s.wires.push({
                id: uuid(),
                points: allPoints,
                netId,
                sheetId,
              });
            });
          }
        }
      }
      set((s) => {
        s.isDrawing = false;
        s.drawingPoints = [];
      });
    },

    cancelDrawing: () =>
      set((state) => {
        state.isDrawing = false;
        state.drawingPoints = [];
      }),

    addWire: (wire) => {
      get().pushSnapshot();
      const id = uuid();
      mutateSchematic((s) => {
        s.wires.push({ ...wire, id });
      });
      return id;
    },

    deleteWire: (id) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        s.wires = s.wires.filter((w) => w.id !== id);
      });
    },

    addJunction: (position, netId, sheetId) => {
      get().pushSnapshot();
      const id = uuid();
      mutateSchematic((s) => {
        s.junctions.push({ id, position, netId, sheetId });
      });
      return id;
    },

    deleteJunction: (id) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        s.junctions = s.junctions.filter((j) => j.id !== id);
      });
    },

    addLabel: (label) => {
      get().pushSnapshot();
      const id = uuid();
      mutateSchematic((s) => {
        s.labels.push({ ...label, id });
      });
      return id;
    },

    deleteLabel: (id) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        s.labels = s.labels.filter((l) => l.id !== id);
      });
    },

    updateLabel: (id, updates) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        const label = s.labels.find((l) => l.id === id);
        if (label) Object.assign(label, updates);
      });
    },

    addBus: (bus) => {
      get().pushSnapshot();
      const id = uuid();
      mutateSchematic((s) => {
        s.busses.push({ ...bus, id });
      });
      return id;
    },

    deleteBus: (id) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        s.busses = s.busses.filter((b) => b.id !== id);
      });
    },

    pushSnapshot: () => {
      _schUndoStack.push(getSchSnapshot());
      if (_schUndoStack.length > MAX_UNDO) _schUndoStack.shift();
      _schRedoStack.length = 0;
    },

    undo: () => {
      if (_schUndoStack.length === 0) return;
      _schRedoStack.push(getSchSnapshot());
      const snap = _schUndoStack.pop()!;
      restoreSchSnapshot(snap);
    },

    redo: () => {
      if (_schRedoStack.length === 0) return;
      _schUndoStack.push(getSchSnapshot());
      const snap = _schRedoStack.pop()!;
      restoreSchSnapshot(snap);
    },

    deleteSelected: () => {
      get().pushSnapshot();
      const sel = get().selection;
      mutateSchematic((s) => {
        s.components = s.components.filter((c) => !sel.componentIds.includes(c.id));
        s.wires = s.wires.filter((w) => !sel.wireIds.includes(w.id));
        s.labels = s.labels.filter((l) => !sel.labelIds.includes(l.id));
        s.junctions = s.junctions.filter((j) => !sel.junctionIds.includes(j.id));
      });
      set((state) => {
        state.selection = { componentIds: [], wireIds: [], labelIds: [], junctionIds: [] };
      });
    },

    snapToGrid: (point) => ({
      x: Math.round(point.x / SCHEMATIC_GRID) * SCHEMATIC_GRID,
      y: Math.round(point.y / SCHEMATIC_GRID) * SCHEMATIC_GRID,
    }),
  }))
);
