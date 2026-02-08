// ============================================================
// Perfboard Store — Component placement, wiring, track cuts
// ============================================================

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type {
  PerfboardComponent,
  PerfboardConnection,
  TrackCut,
  GridPosition,
  PerfboardToolType,
  ViewportState,
  ConnectionType,
  ConnectionSide,
} from '@/types';
import { useProjectStore } from './projectStore';
import { PERFBOARD_GRID } from '@/constants';
import { getBuiltInComponents, getAdjustedFootprint } from '@/lib/component-library';
import { findManhattanRoute, getOccupiedHoles, getConnectionOccupiedHoles, solderBridgeCrossesExisting, gridKey, hasCollision, hasFootprintCollision, isAdjacent, insertSupportPoints } from '@/lib/engine/router';
import { autoLayout } from '@/lib/engine/auto-layout';
import type { AutoLayoutMode } from '@/lib/engine/auto-layout';
import { autoRoute } from '@/lib/engine/autorouter';
import { useToastStore } from './toastStore';

interface PerfboardState {
  activeTool: PerfboardToolType;
  viewport: ViewportState;
  selectedIds: string[];
  placingComponentId: string | null;

  // Drawing state
  isDrawing: boolean;
  drawingFrom: GridPosition | null;
  drawingTo: GridPosition | null;
  drawingType: ConnectionType;
  drawingSide: ConnectionSide;

  // Actions
  setActiveTool: (tool: PerfboardToolType) => void;
  setViewport: (vp: Partial<ViewportState>) => void;
  setPlacingComponent: (id: string | null) => void;

  // Selection
  select: (ids: string[]) => void;
  clearSelection: () => void;
  toggleSelection: (id: string) => void;

  // Component placement
  placeComponent: (comp: Omit<PerfboardComponent, 'id'>) => string;
  moveComponent: (id: string, gridPosition: GridPosition) => boolean;
  moveComponentGroup: (ids: string[], colDelta: number, rowDelta: number) => void;
  rotateComponent: (id: string) => void;
  removeComponent: (id: string) => void;

  // Connections
  startDrawingConnection: (from: GridPosition) => void;
  updateDrawingConnection: (to: GridPosition) => void;
  finishDrawingConnection: () => void;
  cancelDrawing: () => void;
  addConnection: (conn: Omit<PerfboardConnection, 'id'>) => string;
  removeConnection: (id: string) => void;

  // Track cuts (stripboard)
  addTrackCut: (position: GridPosition) => string;
  removeTrackCut: (id: string) => void;
  toggleTrackCut: (position: GridPosition) => void;

  // Delete selected
  deleteSelected: () => void;

  // Auto-layout & autorouter
  autoLayoutComponents: (mode?: AutoLayoutMode) => void;
  autoRouteConnections: () => void;
  removeAllConnections: () => void;

  // Undo/Redo (snapshot-based)
  undo: () => void;
  redo: () => void;
  pushSnapshot: () => void;

  // Helpers
  snapToGrid: (x: number, y: number) => GridPosition;
  gridToPixel: (pos: GridPosition) => { x: number; y: number };
}

const mutatePerfboard = (fn: (p: ReturnType<() => import('@/types').PerfboardDocument>) => void) => {
  useProjectStore.setState((state) => {
    fn(state.project.perfboard);
    state.project.updatedAt = new Date().toISOString();
    state.isDirty = true;
  });
};

// ---- Snapshot-based undo/redo for perfboard ----
type PBSnapshot = string; // JSON of PerfboardDocument
const MAX_UNDO = 50;
const _pbUndoStack: PBSnapshot[] = [];
const _pbRedoStack: PBSnapshot[] = [];

function getPBSnapshot(): PBSnapshot {
  return JSON.stringify(useProjectStore.getState().project.perfboard);
}

function restorePBSnapshot(snap: PBSnapshot) {
  const doc = JSON.parse(snap);
  useProjectStore.setState((state) => {
    state.project.perfboard = doc;
    state.project.updatedAt = new Date().toISOString();
    state.isDirty = true;
  });
}

/** Reset all editor state when switching projects. */
export function resetPerfboardEditorState() {
  _pbUndoStack.length = 0;
  _pbRedoStack.length = 0;
  usePerfboardStore.setState({
    activeTool: 'select',
    placingComponentId: null,
    viewport: { x: 0, y: 0, scale: 1 },
    selectedIds: [],
    isDrawing: false,
    drawingFrom: null,
    drawingTo: null,
  });
}

export const usePerfboardStore = create<PerfboardState>()(
  immer((set, get) => ({
    activeTool: 'select',
    viewport: { x: 0, y: 0, scale: 1 },
    selectedIds: [],
    placingComponentId: null,
    isDrawing: false,
    drawingFrom: null,
    drawingTo: null,
    drawingType: 'wire',
    drawingSide: 'bottom',

    setActiveTool: (tool) =>
      set((state) => {
        state.activeTool = tool;
        state.isDrawing = false;
        state.drawingFrom = null;
        state.drawingTo = null;
        if (tool === 'draw_wire') {
          state.drawingType = 'wire';
          state.drawingSide = 'bottom';
        } else if (tool === 'draw_wire_bridge') {
          state.drawingType = 'wire_bridge';
          state.drawingSide = 'top';
        } else if (tool === 'draw_solder_bridge') {
          state.drawingType = 'solder_bridge';
          state.drawingSide = 'bottom';
        }
      }),

    setViewport: (vp) =>
      set((state) => {
        Object.assign(state.viewport, vp);
      }),

    setPlacingComponent: (id) =>
      set((state) => {
        state.placingComponentId = id;
        if (id) state.activeTool = 'place_component';
      }),

    select: (ids) => set((state) => { state.selectedIds = ids; }),
    clearSelection: () => set((state) => { state.selectedIds = []; }),
    toggleSelection: (id) =>
      set((state) => {
        const idx = state.selectedIds.indexOf(id);
        if (idx >= 0) state.selectedIds.splice(idx, 1);
        else state.selectedIds.push(id);
      }),

    placeComponent: (comp) => {
      get().pushSnapshot();
      const id = uuid();
      const perfboard = useProjectStore.getState().project.perfboard;
      const customComps = useProjectStore.getState().project.componentLibrary;
      const allLib = [...getBuiltInComponents(), ...customComps];

      // Resolve pads for the component being placed (with holeSpan adjustment)
      const libDef = allLib.find((c) => c.id === comp.libraryId);
      const adjusted = libDef
        ? getAdjustedFootprint(libDef, comp.properties?.holeSpan)
        : { pads: [], spanHoles: { col: 1, row: 1 } };
      const newPads = adjusted.pads.map((p) => p.gridPosition);
      const newSpanHoles = adjusted.spanHoles;

      // Build occupied set from existing components
      const existingComps = perfboard.components.map((c) => {
        const def = allLib.find((d) => d.id === c.libraryId);
        const adj = def
          ? getAdjustedFootprint(def, c.properties?.holeSpan)
          : { pads: [], spanHoles: { col: 1, row: 1 } };
        return {
          gridPosition: c.gridPosition,
          rotation: c.rotation,
          pads: adj.pads.map((p) => p.gridPosition),
          spanHoles: adj.spanHoles,
        };
      });
      const occupied = getOccupiedHoles(existingComps);

      // Collision check — block if footprint bboxes overlap (no overlap allowed on Lochraster)
      if (hasFootprintCollision(newPads, comp.gridPosition, comp.rotation, existingComps, newSpanHoles)) {
        return ''; // Placement blocked
      }

      mutatePerfboard((p) => {
        p.components.push({ ...comp, id });
      });
      return id;
    },

    moveComponent: (id, gridPosition) => {
      get().pushSnapshot();
      const perfboard = useProjectStore.getState().project.perfboard;
      const customComps = useProjectStore.getState().project.componentLibrary;
      const allLib = [...getBuiltInComponents(), ...customComps];

      const comp = perfboard.components.find((c) => c.id === id);
      if (!comp) return false;

      const libDef = allLib.find((c) => c.id === comp.libraryId);
      const adjusted = libDef
        ? getAdjustedFootprint(libDef, comp.properties?.holeSpan)
        : { pads: [], spanHoles: { col: 1, row: 1 } };
      const pads = adjusted.pads.map((p) => p.gridPosition);
      const moveSpanHoles = adjusted.spanHoles;

      // Build existing components list excluding the one being moved
      const existingComps = perfboard.components
        .filter((c) => c.id !== id)
        .map((c) => {
          const def = allLib.find((d) => d.id === c.libraryId);
          const adj = def
            ? getAdjustedFootprint(def, c.properties?.holeSpan)
            : { pads: [], spanHoles: { col: 1, row: 1 } };
          return {
            gridPosition: c.gridPosition,
            rotation: c.rotation,
            pads: adj.pads.map((p) => p.gridPosition),
            spanHoles: adj.spanHoles,
          };
        });

      // Footprint collision check
      if (hasFootprintCollision(pads, gridPosition, comp.rotation, existingComps, moveSpanHoles)) {
        return false; // Collision — block move
      }

      mutatePerfboard((p) => {
        const c = p.components.find((c) => c.id === id);
        if (c) c.gridPosition = gridPosition;
      });
      return true;
    },

    moveComponentGroup: (ids, colDelta, rowDelta) => {
      if (ids.length === 0 || (colDelta === 0 && rowDelta === 0)) return;
      get().pushSnapshot();
      mutatePerfboard((p) => {
        for (const id of ids) {
          const c = p.components.find((c) => c.id === id);
          if (!c) continue;
          c.gridPosition = {
            col: c.gridPosition.col + colDelta,
            row: c.gridPosition.row + rowDelta,
          };
        }
      });
    },

    rotateComponent: (id) => {
      get().pushSnapshot();
      mutatePerfboard((p) => {
        const comp = p.components.find((c) => c.id === id);
        if (comp) comp.rotation = ((comp.rotation + 90) % 360) as 0 | 90 | 180 | 270;
      });
    },

    removeComponent: (id) => {
      get().pushSnapshot();
      mutatePerfboard((p) => {
        p.components = p.components.filter((c) => c.id !== id);
      });
    },

    startDrawingConnection: (from) =>
      set((state) => {
        state.isDrawing = true;
        state.drawingFrom = from;
        state.drawingTo = from;
      }),

    updateDrawingConnection: (to) =>
      set((state) => {
        if (state.isDrawing) state.drawingTo = to;
      }),

    finishDrawingConnection: () => {
      const { drawingFrom, drawingTo, drawingType, drawingSide, isDrawing } = get();
      if (isDrawing && drawingFrom && drawingTo) {
        if (drawingFrom.col !== drawingTo.col || drawingFrom.row !== drawingTo.row) {
          get().pushSnapshot();
          const perfboard = useProjectStore.getState().project.perfboard;
          const customComps = useProjectStore.getState().project.componentLibrary;
          const allLib = [...getBuiltInComponents(), ...customComps];

          // Build occupied-holes set from placed components
          const compData = perfboard.components.map((c) => {
            const def = allLib.find((d) => d.id === c.libraryId);
            return {
              gridPosition: c.gridPosition,
              rotation: c.rotation,
              pads: def
                ? getAdjustedFootprint(def, c.properties?.holeSpan).pads.map((p) => p.gridPosition)
                : [],
            };
          });
          const occupied = getOccupiedHoles(compData);

          // Also block holes used by existing connections on the same side
          const fromKey = gridKey(drawingFrom.col, drawingFrom.row);
          const toKey = gridKey(drawingTo.col, drawingTo.row);
          const endpointKeys = new Set([fromKey, toKey]);
          const connOccupied = getConnectionOccupiedHoles(
            perfboard.connections, drawingSide, endpointKeys,
          );
          for (const key of connOccupied) occupied.add(key);

          // Allow routing to start/end on component pins
          occupied.delete(fromKey);
          occupied.delete(toKey);

          // Auto solder bridge for directly adjacent pins (1 hole apart, H or V)
          if (isAdjacent(drawingFrom, drawingTo)) {
            // Check solder bridge doesn't cross existing traces on same side
            if (solderBridgeCrossesExisting(drawingFrom, drawingTo, perfboard.connections, 'bottom')) {
              useToastStore.getState().showToast('Lötbrücke kreuzt bestehende Verbindung', 'warning');
            } else {
              mutatePerfboard((p) => {
                p.connections.push({
                  id: uuid(),
                  type: 'solder_bridge',
                  from: { ...drawingFrom },
                  to: { ...drawingTo },
                  side: 'bottom',
                });
              });
            }
          } else {
            // A* Manhattan route (turn-minimised)
            const route = findManhattanRoute({
              from: drawingFrom,
              to: drawingTo,
              boardWidth: perfboard.width,
              boardHeight: perfboard.height,
              occupied,
            });

            if (route && route.length >= 2) {
              // Insert support Lötpunkte every 5 holes on long straight segments
              const withSupport = insertSupportPoints(route);
              const waypoints = withSupport.length > 2 ? withSupport.slice(1, -1) : undefined;
              mutatePerfboard((p) => {
                p.connections.push({
                  id: uuid(),
                  type: drawingType,
                  from: { ...withSupport[0] },
                  to: { ...withSupport[withSupport.length - 1] },
                  waypoints,
                  side: drawingSide,
                });
              });
            } else {
              useToastStore.getState().showToast('Verbindung nicht möglich — Weg ist blockiert', 'warning');
            }
          }
        }
      }
      set((state) => {
        state.isDrawing = false;
        state.drawingFrom = null;
        state.drawingTo = null;
      });
    },

    cancelDrawing: () =>
      set((state) => {
        state.isDrawing = false;
        state.drawingFrom = null;
        state.drawingTo = null;
      }),

    addConnection: (conn) => {
      get().pushSnapshot();
      const id = uuid();
      mutatePerfboard((p) => {
        p.connections.push({ ...conn, id });
      });
      return id;
    },

    removeConnection: (id) => {
      get().pushSnapshot();
      mutatePerfboard((p) => {
        p.connections = p.connections.filter((c) => c.id !== id);
      });
    },

    addTrackCut: (position) => {
      const id = uuid();
      mutatePerfboard((p) => {
        p.trackCuts.push({ id, position });
      });
      return id;
    },

    removeTrackCut: (id) => {
      mutatePerfboard((p) => {
        p.trackCuts = p.trackCuts.filter((t) => t.id !== id);
      });
    },

    toggleTrackCut: (position) => {
      get().pushSnapshot();
      const perfboard = useProjectStore.getState().project.perfboard;
      const existing = perfboard.trackCuts.find(
        (t) => t.position.col === position.col && t.position.row === position.row
      );
      if (existing) {
        mutatePerfboard((p) => {
          p.trackCuts = p.trackCuts.filter((t) => t.id !== existing.id);
        });
      } else {
        const id = uuid();
        mutatePerfboard((p) => {
          p.trackCuts.push({ id, position });
        });
      }
    },

    deleteSelected: () => {
      get().pushSnapshot();
      const ids = get().selectedIds;
      mutatePerfboard((p) => {
        p.components = p.components.filter((c) => !ids.includes(c.id));
        p.connections = p.connections.filter((c) => !ids.includes(c.id));
        p.trackCuts = p.trackCuts.filter((t) => !ids.includes(t.id));
      });
      set((state) => { state.selectedIds = []; });
    },

    // ---- Remove all connections ----
    removeAllConnections: () => {
      const perfboard = useProjectStore.getState().project.perfboard;
      if (perfboard.connections.length === 0) {
        useToastStore.getState().showToast('Keine Verbindungen vorhanden', 'warning');
        return;
      }
      get().pushSnapshot();
      const count = perfboard.connections.length;
      mutatePerfboard((p) => {
        p.connections = [];
      });
      useToastStore.getState().showToast(`${count} Verbindungen entfernt`, 'success');
    },

    // ---- Auto-Layout ----
    autoLayoutComponents: (mode?: AutoLayoutMode) => {
      const perfboard = useProjectStore.getState().project.perfboard;
      const schematic = useProjectStore.getState().project.schematic;
      const customComps = useProjectStore.getState().project.componentLibrary;
      const allLib = [...getBuiltInComponents(), ...customComps];

      if (perfboard.components.length === 0) {
        useToastStore.getState().showToast('Keine Bauteile zum Platzieren vorhanden', 'warning');
        return;
      }

      get().pushSnapshot();

      // Clear all existing connections before re-layout
      mutatePerfboard((p) => {
        p.connections = [];
      });

      const layoutMode = mode ?? 'easy_soldering';

      // Re-read perfboard after clearing connections
      const freshPerfboard = useProjectStore.getState().project.perfboard;

      const result = autoLayout(freshPerfboard, schematic, allLib, {
        boardWidth: freshPerfboard.width,
        boardHeight: freshPerfboard.height,
        mode: layoutMode,
      });

      if (result.placed > 0) {
        mutatePerfboard((p) => {
          for (const comp of p.components) {
            const newPos = result.positions.get(comp.id);
            if (newPos) {
              comp.gridPosition = newPos;
            }
          }
        });
      }

      if (result.failed > 0) {
        useToastStore.getState().showToast(
          `Auto-Layout: ${result.placed} platziert, ${result.failed} fehlgeschlagen (Board zu klein?)`,
          'warning',
        );
      } else {
        useToastStore.getState().showToast(
          `Auto-Layout: ${result.placed} Bauteile platziert`,
          'success',
        );
      }
    },

    // ---- Autorouter ----
    autoRouteConnections: () => {
      const perfboard = useProjectStore.getState().project.perfboard;
      const schematic = useProjectStore.getState().project.schematic;
      const customComps = useProjectStore.getState().project.componentLibrary;
      const allLib = [...getBuiltInComponents(), ...customComps];

      if (perfboard.components.length === 0) {
        useToastStore.getState().showToast('Keine Bauteile vorhanden — zuerst synchronisieren', 'warning');
        return;
      }

      get().pushSnapshot();

      // Clear all existing connections before re-routing
      mutatePerfboard((p) => {
        p.connections = [];
      });

      // Re-read perfboard after clearing
      const freshPerfboard = useProjectStore.getState().project.perfboard;

      const result = autoRoute(freshPerfboard, schematic, allLib, {
        boardWidth: freshPerfboard.width,
        boardHeight: freshPerfboard.height,
        connectionType: 'wire',
        connectionSide: 'bottom',
        clearExisting: false,
        maxPasses: 3,
      });

      if (result.connections.length > 0) {
        mutatePerfboard((p) => {
          p.connections.push(...result.connections);
        });
      }

      if (result.failed > 0) {
        useToastStore.getState().showToast(
          `Autorouter: ${result.routed} Netze geroutet, ${result.failed} fehlgeschlagen (${result.failedNets.join(', ')})`,
          'warning',
        );
      } else if (result.routed === 0) {
        useToastStore.getState().showToast('Autorouter: Alle Netze bereits verbunden', 'success');
      } else {
        useToastStore.getState().showToast(
          `Autorouter: ${result.routed} Netze erfolgreich geroutet`,
          'success',
        );
      }
    },

    // ---- Undo / Redo ----
    pushSnapshot: () => {
      _pbUndoStack.push(getPBSnapshot());
      if (_pbUndoStack.length > MAX_UNDO) _pbUndoStack.shift();
      _pbRedoStack.length = 0; // clear redo on new action
    },

    undo: () => {
      if (_pbUndoStack.length === 0) return;
      _pbRedoStack.push(getPBSnapshot());
      const snap = _pbUndoStack.pop()!;
      restorePBSnapshot(snap);
    },

    redo: () => {
      if (_pbRedoStack.length === 0) return;
      _pbUndoStack.push(getPBSnapshot());
      const snap = _pbRedoStack.pop()!;
      restorePBSnapshot(snap);
    },

    snapToGrid: (x, y) => ({
      col: Math.round(x / PERFBOARD_GRID),
      row: Math.round(y / PERFBOARD_GRID),
    }),

    gridToPixel: (pos) => ({
      x: pos.col * PERFBOARD_GRID,
      y: pos.row * PERFBOARD_GRID,
    }),
  }))
);
