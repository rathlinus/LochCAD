// ============================================================
// LochCAD Core Types — Schematic, Perfboard, Components, Nets
// ============================================================

// ---- Geometry Primitives ----

export interface Point {
  x: number;
  y: number;
}

export interface GridPosition {
  col: number;
  row: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---- Enums ----

export type PinElectricalType =
  | 'input'
  | 'output'
  | 'bidirectional'
  | 'passive'
  | 'power_in'
  | 'power_out'
  | 'open_collector'
  | 'open_emitter'
  | 'tristate'
  | 'unspecified';

export type PinDirection = 0 | 90 | 180 | 270;

export type ToolType =
  | 'select'
  | 'place_component'
  | 'draw_wire'
  | 'place_label'
  | 'place_sheet_instance'
  | 'measure'
  | 'delete';

export type PerfboardToolType =
  | 'select'
  | 'place_component'
  | 'draw_wire'
  | 'draw_wire_bridge'
  | 'draw_solder_bridge'
  | 'cut_track'
  | 'delete';

export type EditorView = 'schematic' | 'perfboard' | 'preview3d' | 'component-editor';

export type BoardType = 'perfboard' | 'stripboard';

export type ConnectionType = 'wire' | 'wire_bridge' | 'solder_bridge' | 'bent_lead';

export type ConnectionSide = 'top' | 'bottom';

// ---- Schematic Symbol Primitives ----

export interface SymbolGraphicBase {
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface SymbolLine extends SymbolGraphicBase {
  type: 'line';
  start: Point;
  end: Point;
}

export interface SymbolRectangle extends SymbolGraphicBase {
  type: 'rectangle';
  start: Point;
  end: Point;
}

export interface SymbolCircle extends SymbolGraphicBase {
  type: 'circle';
  center: Point;
  radius: number;
}

export interface SymbolArc extends SymbolGraphicBase {
  type: 'arc';
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
}

export interface SymbolPolyline extends SymbolGraphicBase {
  type: 'polyline';
  points: Point[];
  closed?: boolean;
}

export interface SymbolText extends SymbolGraphicBase {
  type: 'text';
  position: Point;
  text: string;
  fontSize?: number;
  anchor?: 'start' | 'middle' | 'end';
}

export type SymbolGraphic =
  | SymbolLine
  | SymbolRectangle
  | SymbolCircle
  | SymbolArc
  | SymbolPolyline
  | SymbolText;

// ---- Pin Definition ----

export interface PinDefinition {
  id?: string;
  number: string;
  name: string;
  position: Point;
  length: number;
  direction: PinDirection;
  orientation?: number; // degrees form of direction
  electricalType: PinElectricalType;
  hidden?: boolean;
}

// ---- Component Symbol ----

export interface ComponentSymbol {
  graphics: SymbolGraphic[];
  pins: PinDefinition[];
  // Flattened arrays used by component editor
  lines?: SymbolLine[];
  rectangles?: SymbolRectangle[];
  circles?: SymbolCircle[];
  arcs?: SymbolArc[];
  polylines?: SymbolPolyline[];
  texts?: SymbolText[];
}

// ---- Footprint ----

export interface FootprintPad {
  id?: string;
  number: string;
  label?: string;
  position?: GridPosition; // alias for gridPosition
  gridPosition: GridPosition;
  shape: 'circle' | 'square' | 'oval' | 'round';
  diameter?: number;
  drill?: number;
}

export interface FootprintSilkscreen extends SymbolGraphicBase {
  type: 'line' | 'rectangle' | 'circle' | 'polyline';
  points?: GridPosition[];
  start?: GridPosition;
  end?: GridPosition;
  center?: GridPosition;
  radius?: number;
}

export interface ComponentFootprint {
  type: 'through_hole';
  pads: FootprintPad[];
  silkscreen: FootprintSilkscreen[];
  spanHoles: GridPosition; // width x height in grid units
}

// ---- 3D Model ----

export type Model3DType =
  | 'resistor_axial'
  | 'resistor_box'
  | 'capacitor_ceramic'
  | 'capacitor_electrolytic'
  | 'capacitor_film'
  | 'led'
  | 'diode'
  | 'transistor_to92'
  | 'transistor_to220'
  | 'ic_dip'
  | 'pin_header'
  | 'connector'
  | 'potentiometer'
  | 'crystal'
  | 'inductor'
  | 'switch'
  | 'voltage_regulator_to220'
  | 'buzzer'
  | 'screw_terminal'
  | 'tactile_switch'
  | 'custom';

export interface Model3DParametric {
  type: 'parametric';
  shape: Model3DType;
  params: Record<string, number | string>;
}

export interface Model3DCustom {
  type: 'custom';
  gltfUrl?: string;
  gltfData?: string; // base64
}

export type Model3D = Model3DParametric | Model3DCustom;

// ---- SPICE Model ----

export interface SpiceModel {
  template: string; // e.g. "R{ref} {pin1} {pin2} {value}"
  includes?: string[]; // .include file references
}

// ---- Component Definition (Library Entry) ----

export interface ComponentDefinition {
  id: string;
  name: string;
  prefix?: string;
  category: ComponentCategory | string;
  description?: string;
  keywords?: string[];
  symbol: ComponentSymbol;
  footprint: ComponentFootprint;
  model3d: Model3D;
  pinMapping: Record<string, string>;
  spice?: SpiceModel;
  spiceModel?: string;
  spiceTemplate?: string;
  defaultProperties?: Record<string, string>;
  author?: string;
  isBuiltIn?: boolean;
  isPublic?: boolean;
}

export type ComponentCategory =
  | 'Resistors'
  | 'Capacitors'
  | 'Inductors'
  | 'Diodes'
  | 'LEDs'
  | 'Transistors'
  | 'ICs'
  | 'Connectors'
  | 'Switches'
  | 'Crystals'
  | 'Relays'
  | 'Transformers'
  | 'Sensors'
  | 'Displays'
  | 'Power'
  | 'Mechanical'
  | 'Custom';

// ---- Schematic Components & Wires ----

export interface SchematicComponent {
  id: string;
  libraryId: string;
  definition?: ComponentDefinition; // resolved at runtime
  reference: string;
  value: string;
  position: Point;
  rotation: number; // 0, 90, 180, 270
  mirror: boolean;
  properties: Record<string, string>;
  sheetId: string;
}

export interface Wire {
  id: string;
  points: Point[];
  netId: string;
  sheetId: string;
}

export interface Junction {
  id: string;
  position: Point;
  netId: string;
  sheetId: string;
}

export interface NetLabel {
  id: string;
  text: string;
  position: Point;
  type: 'net' | 'power' | 'global';
  netId: string;
  rotation: number;
  sheetId: string;
}

export interface Bus {
  id: string;
  name: string;
  points: Point[];
  members: string[]; // net names
  sheetId: string;
}

export interface BusEntry {
  id: string;
  busId: string;
  netId: string;
  position: Point;
  sheetId: string;
}

export interface SheetPin {
  id: string;
  name: string;
  direction: 'input' | 'output' | 'bidirectional';
  position: Point;
  netId: string;
  sheetId: string;
}

export interface HierarchicalSheetInstance {
  id: string;
  targetSheetId: string;
  position: Point;
  size: Size;
  sheetId: string; // parent sheet
}

export interface Sheet {
  id: string;
  name: string;
  parentSheetId: string | null;
}

// ---- Schematic Document ----

export interface SchematicDocument {
  sheets: Sheet[];
  components: SchematicComponent[];
  wires: Wire[];
  junctions: Junction[];
  labels: NetLabel[];
  busses: Bus[];
  busEntries: BusEntry[];
  sheetPins: SheetPin[];
  hierarchicalSheetInstances: HierarchicalSheetInstance[];
}

// ---- Net / Netlist ----

export interface NetConnection {
  componentId: string;
  componentRef: string;
  pinNumber: string;
  pinName: string;
}

export interface Net {
  id: string;
  name: string;
  connections: NetConnection[];
}

export interface Netlist {
  nets: Net[];
  components?: {
    id: string;
    reference: string;
    value: string;
    footprint?: ComponentFootprint;
  }[];
}

// ---- Perfboard Document ----

export interface PerfboardComponent {
  id: string;
  schematicComponentId: string;
  libraryId: string;
  reference: string;
  gridPosition: GridPosition;
  rotation: number;
  side: 'top';
  /** Properties copied from schematic (e.g. holeSpan) */
  properties?: Record<string, string>;
}

export interface PerfboardConnection {
  id: string;
  type: ConnectionType;
  from: GridPosition;
  to: GridPosition;
  waypoints?: GridPosition[];
  side: ConnectionSide;
  netId?: string;
}

export interface TrackCut {
  id: string;
  position: GridPosition;
}

export interface PerfboardDocument {
  boardType: BoardType;
  width: number;
  height: number;
  components: PerfboardComponent[];
  connections: PerfboardConnection[];
  trackCuts: TrackCut[];
}

// ---- Project ----

export interface SheetDocument {
  id: string;
  name: string;
  schematic: SchematicDocument;
  perfboard: PerfboardDocument;
}

export interface ProjectNote {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  author: string;
  tags: string[];
  notes: ProjectNote[];
  schematic: SchematicDocument;
  perfboard: PerfboardDocument;
  sheets: SheetDocument[]; // multi-sheet support
  componentLibrary: ComponentDefinition[];
  customComponents?: ComponentDefinition[];
  netlist: Netlist;
  /** Per-net color overrides. Key = net label text (e.g. "VCC", "GND"). */
  netColors?: Record<string, string>;
}

/** Lightweight entry stored in the project index (no heavy data). */
export interface ProjectListEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  noteCount: number;
  componentCount: number;
  sheetCount: number;
}

// ---- Editor State Types ----

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface SelectionState {
  componentIds: string[];
  wireIds: string[];
  labelIds: string[];
  junctionIds: string[];
}

// ---- ERC / DRC ----

export type ERCViolationType =
  | 'unconnected_pin'
  | 'multiple_drivers'
  | 'no_driver'
  | 'no_power_source'
  | 'conflicting_pin_types'
  | 'unconnected_wire'
  | 'floating_wire'
  | 'duplicate_reference'
  | 'missing_value'
  | 'short_circuit';

export type DRCViolationType =
  | 'overlapping_components'
  | 'out_of_bounds'
  | 'unconnected_net'
  | 'short_circuit'
  | 'missing_track_cut'
  | 'crowded_strip'
  | 'connection_out_of_bounds';

export interface Violation {
  id: string;
  type: ERCViolationType | DRCViolationType;
  severity: 'error' | 'warning' | 'info';
  message: string;
  position?: Point | GridPosition;
  componentIds?: string[];
  netId?: string;
}

export type ERCViolation = Violation;
export type DRCViolation = Violation;

// ---- Command (Undo / Redo) ----

export interface Command {
  id: string;
  description: string;
  execute: () => void;
  undo: () => void;
}
