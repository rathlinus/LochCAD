// ============================================================
// Check Store — DRC / ERC results, check-mode state, highlighting
// ============================================================

import { create } from 'zustand';
import type { Violation } from '@/types';
import { runERC } from '@/lib/engine/erc';
import type { ERCResult } from '@/lib/engine/erc';
import { runDRC } from '@/lib/engine/drc';
import type { DRCResult } from '@/lib/engine/drc';
import { useProjectStore } from './projectStore';

export type CheckType = 'erc' | 'drc';

export interface CheckState {
  // Whether the check panel is visible
  panelOpen: boolean;

  // Which check mode is active (null = none)
  activeCheck: CheckType | null;

  // Results
  ercResult: ERCResult | null;
  drcResult: DRCResult | null;

  // Currently highlighted violation (for click-to-locate)
  highlightedViolationId: string | null;

  // Set of component IDs that have violations (for overlay rendering)
  ercErrorComponentIds: Set<string>;
  ercWarningComponentIds: Set<string>;
  drcErrorComponentIds: Set<string>;
  drcWarningComponentIds: Set<string>;

  // Error positions for point-based markers (wires, positions)
  ercErrorPositions: Array<{ x: number; y: number; id: string }>;
  drcErrorPositions: Array<{ col: number; row: number; id: string }>;

  // Actions
  togglePanel: () => void;
  openPanel: (check: CheckType) => void;
  closePanel: () => void;
  runERCCheck: () => void;
  runDRCCheck: () => void;
  clearResults: (type?: CheckType) => void;
  highlightViolation: (id: string | null) => void;
  setActiveCheck: (check: CheckType | null) => void;
}

function buildComponentSets(violations: Violation[], severity: 'error' | 'warning'): Set<string> {
  const ids = new Set<string>();
  for (const v of violations) {
    if (v.severity === severity && v.componentIds) {
      for (const cid of v.componentIds) ids.add(cid);
    }
  }
  return ids;
}

function buildERCPositions(violations: Violation[]): Array<{ x: number; y: number; id: string }> {
  const positions: Array<{ x: number; y: number; id: string }> = [];
  for (const v of violations) {
    if (v.position && 'x' in v.position) {
      positions.push({ x: v.position.x, y: v.position.y, id: v.id });
    }
  }
  return positions;
}

function buildDRCPositions(violations: Violation[]): Array<{ col: number; row: number; id: string }> {
  const positions: Array<{ col: number; row: number; id: string }> = [];
  for (const v of violations) {
    if (v.position && 'col' in v.position) {
      positions.push({ col: v.position.col, row: v.position.row, id: v.id });
    }
  }
  return positions;
}

export const useCheckStore = create<CheckState>((set) => ({
  panelOpen: false,
  activeCheck: null,
  ercResult: null,
  drcResult: null,
  highlightedViolationId: null,
  ercErrorComponentIds: new Set(),
  ercWarningComponentIds: new Set(),
  drcErrorComponentIds: new Set(),
  drcWarningComponentIds: new Set(),
  ercErrorPositions: [],
  drcErrorPositions: [],

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openPanel: (check) => set({ panelOpen: true, activeCheck: check }),
  closePanel: () => set({ panelOpen: false, highlightedViolationId: null }),
  setActiveCheck: (check) => set({ activeCheck: check }),

  runERCCheck: () => {
    const schematic = useProjectStore.getState().project.schematic;
    const result = runERC(schematic);
    set({
      ercResult: result,
      activeCheck: 'erc',
      panelOpen: true,
      ercErrorComponentIds: buildComponentSets(result.violations, 'error'),
      ercWarningComponentIds: buildComponentSets(result.violations, 'warning'),
      ercErrorPositions: buildERCPositions(result.violations),
      highlightedViolationId: null,
    });
  },

  runDRCCheck: () => {
    const project = useProjectStore.getState().project;
    const result = runDRC(project.perfboard, project.schematic);
    set({
      drcResult: result,
      activeCheck: 'drc',
      panelOpen: true,
      drcErrorComponentIds: buildComponentSets(result.violations, 'error'),
      drcWarningComponentIds: buildComponentSets(result.violations, 'warning'),
      drcErrorPositions: buildDRCPositions(result.violations),
      highlightedViolationId: null,
    });
  },

  clearResults: (type) => {
    if (type === 'erc' || !type) {
      set({
        ercResult: null,
        ercErrorComponentIds: new Set(),
        ercWarningComponentIds: new Set(),
        ercErrorPositions: [],
      });
    }
    if (type === 'drc' || !type) {
      set({
        drcResult: null,
        drcErrorComponentIds: new Set(),
        drcWarningComponentIds: new Set(),
        drcErrorPositions: [],
      });
    }
    if (!type) {
      set({ panelOpen: false, activeCheck: null, highlightedViolationId: null });
    }
  },

  highlightViolation: (id) => set({ highlightedViolationId: id }),
}));

// ============================================================
// Auto-rerun: re-run DRC/ERC when project data changes
// (only if a result already exists, i.e. user has run it once)
// ============================================================

let ercTimer: ReturnType<typeof setTimeout> | null = null;
let drcTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 400;

let prevSchematic = useProjectStore.getState().project.schematic;
let prevPerfboard = useProjectStore.getState().project.perfboard;

useProjectStore.subscribe((state) => {
  const schematic = state.project.schematic;
  const perfboard = state.project.perfboard;

  if (schematic !== prevSchematic) {
    prevSchematic = schematic;
    if (useCheckStore.getState().ercResult) {
      if (ercTimer) clearTimeout(ercTimer);
      ercTimer = setTimeout(() => {
        useCheckStore.getState().runERCCheck();
      }, DEBOUNCE_MS);
    }
  }

  if (perfboard !== prevPerfboard) {
    prevPerfboard = perfboard;
    if (useCheckStore.getState().drcResult) {
      if (drcTimer) clearTimeout(drcTimer);
      drcTimer = setTimeout(() => {
        useCheckStore.getState().runDRCCheck();
      }, DEBOUNCE_MS);
    }
  }
});
