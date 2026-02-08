// ============================================================
// Project Store — Main project state, current view, active sheet
// ============================================================

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid';
import type {
  Project,
  SchematicDocument,
  PerfboardDocument,
  Netlist,
  EditorView,
  ComponentDefinition,
  PerfboardComponent,
  SchematicComponent,
} from '@/types';
import { DEFAULT_BOARD_WIDTH, DEFAULT_BOARD_HEIGHT, CATEGORY_PREFIX, nextUniqueReference } from '@/constants';
import { getBuiltInComponents, getComponentById } from '@/lib/component-library';

function createEmptySchematic(): SchematicDocument {
  return {
    sheets: [{ id: 'main-sheet', name: 'Main', parentSheetId: null }],
    components: [],
    wires: [],
    junctions: [],
    labels: [],
    busses: [],
    busEntries: [],
    sheetPins: [],
    hierarchicalSheetInstances: [],
  };
}

function createEmptyPerfboard(): PerfboardDocument {
  return {
    boardType: 'perfboard',
    width: DEFAULT_BOARD_WIDTH,
    height: DEFAULT_BOARD_HEIGHT,
    components: [],
    connections: [],
    trackCuts: [],
  };
}

function createEmptyProject(name: string = 'Neues Projekt'): Project {
  return {
    id: uuid(),
    name,
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schematic: createEmptySchematic(),
    perfboard: createEmptyPerfboard(),
    sheets: [],
    componentLibrary: [],
    netlist: { nets: [] },
  };
}

// ---- LocalStorage autosave ----

const STORAGE_KEY = 'lochcad-autosave';
const AUTOSAVE_DELAY = 1500; // ms debounce

function loadFromLocalStorage(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('lochcad-project');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Basic sanity check
    if (parsed && parsed.schematic && parsed.perfboard) return parsed as Project;
  } catch { /* ignore corrupt data */ }
  return null;
}

interface ProjectState {
  project: Project;
  currentView: EditorView;
  activeSheetId: string;
  isDirty: boolean;

  // Actions
  setProject: (project: Project) => void;
  newProject: (name?: string) => void;
  setProjectName: (name: string) => void;
  setCurrentView: (view: EditorView) => void;
  setActiveSheet: (sheetId: string) => void;
  addSheet: (name: string, parentSheetId?: string | null) => string;
  removeSheet: (sheetId: string) => void;
  renameSheet: (sheetId: string, name: string) => void;
  setBoardConfig: (config: Partial<PerfboardDocument>) => void;
  setNetlist: (netlist: Netlist) => void;
  addCustomComponent: (comp: ComponentDefinition) => void;
  removeCustomComponent: (id: string) => void;
  updateCustomComponent: (comp: ComponentDefinition) => void;
  markDirty: () => void;
  markClean: () => void;

  // Sync actions
  syncSchematicToPerfboard: () => SyncResult;
  syncPerfboardToSchematic: () => SyncResult;
}

export interface SyncResult {
  added: string[];     // references of components added
  updated: string[];   // references of components whose reference was updated
  removed: string[];   // references of components removed
}

const _restored = loadFromLocalStorage();

export const useProjectStore = create<ProjectState>()(
  immer((set) => ({
    project: _restored ?? createEmptyProject(),
    currentView: 'schematic',
    activeSheetId: _restored?.schematic?.sheets?.[0]?.id ?? 'main-sheet',
    isDirty: false,

    setProject: (project) =>
      set((state) => {
        state.project = project;
        state.activeSheetId = project.schematic.sheets[0]?.id ?? 'main-sheet';
        state.isDirty = false;
      }),

    newProject: (name) =>
      set((state) => {
        state.project = createEmptyProject(name);
        state.activeSheetId = 'main-sheet';
        state.currentView = 'schematic';
        state.isDirty = false;
        // Clear autosave when starting fresh
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
      }),

    setProjectName: (name) =>
      set((state) => {
        state.project.name = name;
        state.isDirty = true;
      }),

    setCurrentView: (view) =>
      set((state) => {
        state.currentView = view;
      }),

    setActiveSheet: (sheetId) =>
      set((state) => {
        state.activeSheetId = sheetId;
      }),

    addSheet: (name, parentSheetId = null) => {
      const id = uuid();
      set((state) => {
        state.project.schematic.sheets.push({ id, name, parentSheetId: parentSheetId ?? null });
        state.isDirty = true;
      });
      return id;
    },

    removeSheet: (sheetId) =>
      set((state) => {
        const s = state.project.schematic;
        s.sheets = s.sheets.filter((sh) => sh.id !== sheetId);
        s.components = s.components.filter((c) => c.sheetId !== sheetId);
        s.wires = s.wires.filter((w) => w.sheetId !== sheetId);
        s.junctions = s.junctions.filter((j) => j.sheetId !== sheetId);
        s.labels = s.labels.filter((l) => l.sheetId !== sheetId);
        if (state.activeSheetId === sheetId) {
          state.activeSheetId = s.sheets[0]?.id ?? 'main-sheet';
        }
        state.isDirty = true;
      }),

    renameSheet: (sheetId, name) =>
      set((state) => {
        const sheet = state.project.schematic.sheets.find((s) => s.id === sheetId);
        if (sheet) sheet.name = name;
        state.isDirty = true;
      }),

    setBoardConfig: (config) =>
      set((state) => {
        Object.assign(state.project.perfboard, config);
        state.isDirty = true;
      }),

    setNetlist: (netlist) =>
      set((state) => {
        state.project.netlist = netlist;
      }),

    addCustomComponent: (comp) =>
      set((state) => {
        state.project.componentLibrary.push(comp);
        state.isDirty = true;
      }),

    removeCustomComponent: (id) =>
      set((state) => {
        state.project.componentLibrary = state.project.componentLibrary.filter((c) => c.id !== id);
        state.isDirty = true;
      }),

    updateCustomComponent: (comp) =>
      set((state) => {
        const idx = state.project.componentLibrary.findIndex((c) => c.id === comp.id);
        if (idx >= 0) state.project.componentLibrary[idx] = comp;
        state.isDirty = true;
      }),

    markDirty: () => set((state) => { state.isDirty = true; }),
    markClean: () => set((state) => { state.isDirty = false; }),

    // ---- Sync: Schematic → Perfboard ----
    syncSchematicToPerfboard: () => {
      const result: SyncResult = { added: [], updated: [], removed: [] };
      set((state) => {
        const sch = state.project.schematic;
        const pb = state.project.perfboard;
        const allLib = getBuiltInComponents().concat(state.project.componentLibrary);

        // 1) Update references + properties of perfboard components linked to schematic
        for (const pComp of pb.components) {
          if (!pComp.schematicComponentId) continue;
          const sComp = sch.components.find(c => c.id === pComp.schematicComponentId);
          if (!sComp) continue;
          if (sComp.reference !== pComp.reference) {
            result.updated.push(`${pComp.reference} → ${sComp.reference}`);
            pComp.reference = sComp.reference;
          }
          // Sync layout-relevant properties (holeSpan)
          const sHoleSpan = sComp.properties.holeSpan;
          if (sHoleSpan) {
            if (!pComp.properties) pComp.properties = {};
            pComp.properties.holeSpan = sHoleSpan;
          } else if (pComp.properties?.holeSpan) {
            delete pComp.properties.holeSpan;
          }
        }

        // 2) Add unplaced schematic components to perfboard (unplaced, col 0, stacked)
        const placedSchIds = new Set(pb.components.map(c => c.schematicComponentId));
        let nextRow = 0;
        // Find max row used
        for (const c of pb.components) {
          const def = allLib.find(l => l.id === c.libraryId);
          const rows = def?.footprint?.pads
            ? Math.max(...def.footprint.pads.map(p => p.gridPosition.row)) + 1
            : 1;
          nextRow = Math.max(nextRow, c.gridPosition.row + rows);
        }

        for (const sComp of sch.components) {
          if (placedSchIds.has(sComp.id)) continue;
          const def = allLib.find(l => l.id === sComp.libraryId);
          if (!def) continue;
          const newComp: PerfboardComponent = {
            id: uuid(),
            schematicComponentId: sComp.id,
            libraryId: sComp.libraryId,
            reference: sComp.reference,
            gridPosition: { col: 1, row: nextRow + 1 },
            rotation: 0,
            side: 'top',
            properties: sComp.properties.holeSpan
              ? { holeSpan: sComp.properties.holeSpan }
              : undefined,
          };
          pb.components.push(newComp);
          result.added.push(sComp.reference);
          const rows = def?.footprint?.pads
            ? Math.max(...def.footprint.pads.map(p => p.gridPosition.row)) + 1
            : 1;
          nextRow += rows + 1;
        }

        // 3) Mark perfboard components whose schematic counterpart was removed
        const schIds = new Set(sch.components.map(c => c.id));
        const toRemove = pb.components.filter(
          c => c.schematicComponentId && !schIds.has(c.schematicComponentId)
        );
        for (const c of toRemove) {
          result.removed.push(c.reference);
        }
        pb.components = pb.components.filter(
          c => !c.schematicComponentId || schIds.has(c.schematicComponentId)
        );

        state.isDirty = true;
      });
      return result;
    },

    // ---- Sync: Perfboard → Schematic ----
    syncPerfboardToSchematic: () => {
      const result: SyncResult = { added: [], updated: [], removed: [] };
      set((state) => {
        const sch = state.project.schematic;
        const pb = state.project.perfboard;
        const allLib = getBuiltInComponents().concat(state.project.componentLibrary);
        const activeSheet = state.activeSheetId;

        // 1) Update references of schematic components linked to perfboard
        for (const pComp of pb.components) {
          if (!pComp.schematicComponentId) continue;
          const sComp = sch.components.find(c => c.id === pComp.schematicComponentId);
          if (sComp && sComp.reference !== pComp.reference) {
            result.updated.push(`${sComp.reference} → ${pComp.reference}`);
            sComp.reference = pComp.reference;
          }
        }

        // 2) Add perfboard-only components to schematic
        const linkedSchIds = new Set(
          pb.components.filter(c => c.schematicComponentId).map(c => c.schematicComponentId)
        );
        let nextX = 100;
        let nextY = 100;
        // Find max Y used in active sheet
        for (const c of sch.components.filter(c => c.sheetId === activeSheet)) {
          nextY = Math.max(nextY, c.position.y + 60);
        }

        for (const pComp of pb.components) {
          if (pComp.schematicComponentId && linkedSchIds.has(pComp.schematicComponentId)) {
            const exists = sch.components.some(c => c.id === pComp.schematicComponentId);
            if (exists) continue;
          }
          // This perfboard component has no valid schematic counterpart
          if (pComp.schematicComponentId && sch.components.some(c => c.id === pComp.schematicComponentId)) continue;
          const def = allLib.find(l => l.id === pComp.libraryId);
          if (!def) continue;
          const newId = uuid();
          const newComp: SchematicComponent = {
            id: newId,
            libraryId: pComp.libraryId,
            reference: pComp.reference,
            value: def.defaultProperties?.value ?? def.name,
            position: { x: nextX, y: nextY },
            rotation: 0,
            mirror: false,
            properties: { ...def.defaultProperties },
            sheetId: activeSheet,
          };
          sch.components.push(newComp);
          // Link perfboard component to the new schematic component
          pComp.schematicComponentId = newId;
          result.added.push(pComp.reference);
          nextX += 120;
          if (nextX > 800) {
            nextX = 100;
            nextY += 80;
          }
        }

        state.isDirty = true;
      });
      return result;
    },
  }))
);

export { createEmptyProject, createEmptySchematic, createEmptyPerfboard };

// ---- Debounced autosave subscriber ----
let _autosaveTimer: ReturnType<typeof setTimeout> | null = null;

useProjectStore.subscribe((state) => {
  // Only autosave when there are meaningful changes
  if (_autosaveTimer) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(() => {
    try {
      const data = JSON.stringify(state.project);
      localStorage.setItem(STORAGE_KEY, data);
    } catch { /* quota exceeded — silently skip */ }
  }, AUTOSAVE_DELAY);
});
