// ============================================================
// LochCAD Constants
// ============================================================

import type { GridPosition } from '@/types';

// Grid
export const GRID_SPACING_MM = 2.54; // Standard through-hole grid
export const SCHEMATIC_GRID = 10; // px per grid unit in schematic
export const PERFBOARD_GRID = 24; // px per grid unit in perfboard view

// Board Sizes (holes)
export interface BoardSizePreset {
  name: string;
  width: number;
  height: number;
  sizeMM: { width: number; height: number };
}

export const BOARD_SIZE_PRESETS: BoardSizePreset[] = [
  { name: 'Klein (24×18)', width: 24, height: 18, sizeMM: { width: 60, height: 45 } },
  { name: 'Standard (30×20)', width: 30, height: 20, sizeMM: { width: 76, height: 50 } },
  { name: 'Mittel (40×30)', width: 40, height: 30, sizeMM: { width: 100, height: 76 } },
  { name: 'Groß (50×30)', width: 50, height: 30, sizeMM: { width: 127, height: 76 } },
  { name: 'Eurocard (64×39)', width: 64, height: 39, sizeMM: { width: 160, height: 100 } },
];

// Default board
export const DEFAULT_BOARD_WIDTH = 30;
export const DEFAULT_BOARD_HEIGHT = 20;

// Board convenience object (used by 3D preview and editors)
export const BOARD = {
  HOLE_SPACING_MM: GRID_SPACING_MM,
  DEFAULT_COLS: DEFAULT_BOARD_WIDTH,
  DEFAULT_ROWS: DEFAULT_BOARD_HEIGHT,
} as const;

// Schematic canvas
export const SCHEMATIC_WIDTH = 4000;
export const SCHEMATIC_HEIGHT = 3000;

// Colors
export const COLORS = {
  wire: '#00ff88',
  wireDim: '#00cc6a',
  bus: '#ffaa00',
  busDim: '#cc8800',
  junction: '#00ff88',
  label: '#ffffff',
  powerLabel: '#ff4444',
  selected: '#4fc3f7',
  selectedFill: 'rgba(79, 195, 247, 0.15)',
  hover: '#80deea',
  grid: '#2a2f40',
  gridMinor: '#232838',
  background: '#1b1f2b',
  componentBody: '#2176B7',
  componentBodyFill: 'rgba(33, 118, 183, 0.08)',
  componentPin: '#aaaaaa',
  componentText: '#ffffff',
  componentRef: '#4fc3f7',
  componentValue: '#ffd740',
  copper: '#b87333',
  copperPad: '#d4943f',
  copperStrip: '#a06828',
  boardGreen: '#2d5016',
  boardPerf: '#8B7355',
  boardHole: '#1b1f2b',
  solderBridge: '#c0c0c0',
  wireBridge: '#c0c0c0',
  trackCut: '#ff5252',
  ratsnest: '#ff5252',
  errorMarker: '#ff5252',
  warningMarker: '#ffd740',
  // 3D Colors
  board3d: '#2d5016',
  copper3d: '#b87333',
  resistorBody: '#d2b48c',
  capacitorBody: '#cd853f',
  elcoBody: '#1a1a1a',
  icBody: '#2a2a2a',
  ledBody: '#ff0000',
  pinMetal: '#c0c0c0',
  plastic: '#333333',
} as const;

// Pin electrical type colors
export const PIN_TYPE_COLORS: Record<string, string> = {
  input: '#00ff88',
  output: '#ff4444',
  bidirectional: '#ffaa00',
  passive: '#c0c0c0',
  power_in: '#4fc3f7',
  power_out: '#ff6b81',
  open_collector: '#9c27b0',
  open_emitter: '#9c27b0',
  tristate: '#ffaa00',
  unspecified: '#888888',
};

// Component categories with icons (lucide icon names)
export const COMPONENT_CATEGORIES = [
  'Resistors',
  'Capacitors',
  'Inductors',
  'Diodes',
  'LEDs',
  'Transistors',
  'ICs',
  'Connectors',
  'Switches',
  'Crystals',
  'Relays',
  'Transformers',
  'Sensors',
  'Displays',
  'Power',
  'Mechanical',
  'Custom',
] as const;

// Category → reference prefix mapping
export const CATEGORY_PREFIX: Record<string, string> = {
  Resistors: 'R',
  Capacitors: 'C',
  Inductors: 'L',
  Diodes: 'D',
  LEDs: 'D',
  Transistors: 'Q',
  ICs: 'U',
  Connectors: 'J',
  Switches: 'SW',
  Crystals: 'Y',
  Relays: 'K',
  Transformers: 'T',
  Sensors: 'U',
  Displays: 'DS',
  Power: '#PWR',
  Mechanical: 'MK',
  Custom: 'X',
};

/**
 * Generate the next unique reference for a given prefix,
 * scanning all existing references across schematic + perfboard.
 */
export function nextUniqueReference(
  prefix: string,
  existingRefs: string[],
): string {
  // Extract all numbers currently used with this prefix
  const re = new RegExp(`^${prefix.replace('#', '\\#')}(\\d+)$`);
  let max = 0;
  for (const ref of existingRefs) {
    const m = ref.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

// Keyboard shortcuts
export const SHORTCUTS = {
  undo: 'ctrl+z',
  redo: 'ctrl+y',
  copy: 'ctrl+c',
  paste: 'ctrl+v',
  cut: 'ctrl+x',
  selectAll: 'ctrl+a',
  delete: 'delete',
  escape: 'escape',
  rotate: 'r',
  mirror: 'x',
  wireTool: 'w',
  busTool: 'b',
  labelTool: 'l',
  moveTool: 'm',
  selectTool: 'escape',
  zoomIn: 'ctrl+=',
  zoomOut: 'ctrl+-',
  zoomFit: 'ctrl+0',
  save: 'ctrl+s',
  open: 'ctrl+o',
  newProject: 'ctrl+n',
  export: 'ctrl+e',
} as const;

// 3D constants
export const BOARD_THICKNESS_MM = 1.6;
export const COMPONENT_ELEVATION_MM = 0.5; // height above board

// Snap tolerances
export const SNAP_TOLERANCE = 5; // px
export const WIRE_SNAP_DISTANCE = 15; // px — how close to snap wire endpoint to pin/wire
