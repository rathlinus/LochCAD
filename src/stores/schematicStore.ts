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
import { routeSchematicWire, getComponentBBox, hasComponentCollision } from '@/lib/engine/schematic-router';
import { useToastStore } from './toastStore';

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

      get().pushSnapshot();
      mutateSchematic((s) => {
        const c = s.components.find((c) => c.id === id);
        if (c) c.position = snapped;
      });
      return true;
    },

    rotateComponent: (id) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        const comp = s.components.find((c) => c.id === id);
        if (comp) comp.rotation = ((comp.rotation + 90) % 360) as 0 | 90 | 180 | 270;
      });
    },

    mirrorComponent: (id) => {
      get().pushSnapshot();
      mutateSchematic((s) => {
        const comp = s.components.find((c) => c.id === id);
        if (comp) comp.mirror = !comp.mirror;
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
          // Build obstacle bboxes from sheet components
          const obstacles = schematic.components
            .filter((c) => c.sheetId === sheetId)
            .map((c) => {
              const def = allLib.find((d) => d.id === c.libraryId);
              return def ? getComponentBBox(c, def.symbol) : null;
            })
            .filter((b): b is NonNullable<typeof b> => b !== null);

          // Route each segment pair through the Manhattan A* router
          const allPoints: Point[] = [state.drawingPoints[0]];
          let routeFailed = false;
          for (let i = 0; i < state.drawingPoints.length - 1; i++) {
            const routed = routeSchematicWire({
              from: state.drawingPoints[i],
              to: state.drawingPoints[i + 1],
              obstacles,
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
        } else if (state.activeTool === 'draw_bus') {
          mutateSchematic((s) => {
            s.busses.push({
              id: uuid(),
              name: 'BUS',
              points: [...state.drawingPoints],
              members: [],
              sheetId,
            });
          });
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
