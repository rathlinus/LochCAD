# LochCAD API-Referenz

> Referenz für die wichtigsten internen APIs, Typen und Stores — hilfreich für Contributors.

---

## Inhaltsverzeichnis

- [Typen](#typen)
- [Stores](#stores)
- [Engine-Module](#engine-module)
- [Bauteil-Bibliothek](#bauteil-bibliothek)
- [Export-Module](#export-module)

---

## Typen

Definiert in `src/types/index.ts`.

### Geometrie

```typescript
interface Point { x: number; y: number }
interface GridPosition { col: number; row: number }
interface Size { width: number; height: number }
interface BoundingBox { x: number; y: number; width: number; height: number }
```

### Schaltplan-Elemente

```typescript
interface SchematicComponent {
  id: string;
  libraryId: string;
  sheetId: string;
  position: Point;
  rotation: PinDirection;       // 0 | 90 | 180 | 270
  mirrored: boolean;
  reference: string;            // z.B. "R1", "U3"
  value: string;                // z.B. "10kΩ", "ATmega328P"
  properties: Record<string, string>;
}

interface Wire {
  id: string;
  sheetId: string;
  points: Point[];
  netName?: string;
}

interface NetLabel {
  id: string;
  sheetId: string;
  position: Point;
  name: string;
}
```

### Lochraster-Elemente

```typescript
interface PerfboardComponent {
  id: string;
  libraryId: string;
  gridPosition: GridPosition;
  rotation: PinDirection;
  side: ConnectionSide;         // 'top' | 'bottom'
  reference: string;
  value: string;
  holeSpan?: number;
}

interface Connection {
  id: string;
  type: ConnectionType;         // 'wire' | 'wire_bridge' | 'solder_bridge' | 'bent_lead'
  points: GridPosition[];
  side: ConnectionSide;
  netName?: string;
}

interface TrackCut {
  id: string;
  gridPosition: GridPosition;
}
```

### Bauteil-Definition

```typescript
interface ComponentDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  referencePrefix: string;
  defaultValue: string;
  symbol: {
    graphics: SymbolGraphic[];
    pins: PinDefinition[];
    boundingBox: BoundingBox;
  };
  footprint: {
    pads: FootprintPad[];
    spanHoles: GridPosition;
    bodyOutline?: BoundingBox;
  };
  spiceModel?: string;
}
```

### Editor-Typen

```typescript
type EditorView = 'schematic' | 'perfboard' | 'preview3d' | 'component-editor';
type ToolType = 'select' | 'place_component' | 'draw_wire' | 'place_label' | 'delete' | ...;
type BoardType = 'perfboard' | 'stripboard';
```

---

## Stores

### `useProjectStore`

Hauptstore für Projektdaten.

```typescript
interface ProjectStore {
  project: Project;
  currentView: EditorView;
  activeSheetId: string;
  isDirty: boolean;

  setProject(project: Project): void;
  newProject(): void;
  setCurrentView(view: EditorView): void;
  markClean(): void;
}
```

### `useSchematicStore`

Editor-State für den Schaltplan.

```typescript
interface SchematicStore {
  viewport: { x: number; y: number; scale: number };
  tool: ToolType;
  selectedIds: SelectionSet;

  setViewport(vp: Partial<Viewport>): void;
  setTool(tool: ToolType): void;
  select(ids: SelectionSet): void;
  deleteSelected(): void;
  undo(): void;
  redo(): void;
}
```

### `usePerfboardStore`

Editor-State für das Lochraster.

```typescript
interface PerfboardStore {
  viewport: { x: number; y: number; scale: number };
  tool: PerfboardToolType;
  selectedIds: string[];

  setViewport(vp: Partial<Viewport>): void;
  setTool(tool: PerfboardToolType): void;
  select(ids: string[]): void;
  deleteSelected(): void;
  undo(): void;
  redo(): void;
}
```

### `useProjectManagerStore`

Projektverwaltung.

```typescript
interface ProjectManagerStore {
  isOpen: boolean;
  projects: ProjectSummary[];

  open(): void;
  close(): void;
  openProject(id: string): void;
  saveCurrentProject(): void;
  deleteProject(id: string): void;
  exportProject(id: string): void;
  importProjectFromFile(file: File): Promise<string | 'archive' | null>;
}
```

---

## Engine-Module

### `buildNetlist(schematic)`

Baut eine Netzliste aus den Schaltplan-Daten.

```typescript
function buildNetlist(schematic: Schematic): Netlist;
```

### `runERC(schematic, netlist)`

Electrical Rules Check — gibt Fehler und Warnungen zurück.

```typescript
function runERC(schematic: Schematic, netlist: Netlist): CheckResult[];
```

### `runDRC(perfboard, netlist)`

Design Rules Check — prüft das Lochraster-Layout.

```typescript
function runDRC(perfboard: Perfboard, netlist: Netlist): CheckResult[];
```

### `autoRoute(perfboard, netlist)`

Routet alle unverbundenen Netze automatisch.

```typescript
function autoRoute(perfboard: Perfboard, netlist: Netlist): Connection[];
```

### `autoLayout(perfboard, netlist)`

Platziert Bauteile automatisch auf dem Board.

```typescript
function autoLayout(perfboard: Perfboard, netlist: Netlist): PerfboardComponent[];
```

---

## Bauteil-Bibliothek

### `getBuiltInComponents()`

Gibt alle eingebauten Bauteil-Definitionen zurück (gecacht).

```typescript
function getBuiltInComponents(): ComponentDefinition[];
```

### `getComponentById(id, customComponents?)`

Sucht ein Bauteil nach ID (zuerst Built-in, dann Custom).

```typescript
function getComponentById(
  id: string,
  customComponents?: ComponentDefinition[]
): ComponentDefinition | undefined;
```

### `getAdjustedFootprint(def, holeSpan?)`

Gibt angepasste Footprint-Pads für 2-Pin-Bauteile mit variablem Lochabstand zurück.

```typescript
function getAdjustedFootprint(
  def: ComponentDefinition,
  holeSpan?: number | string
): { pads: FootprintPad[]; spanHoles: GridPosition };
```

---

## Export-Module

### `generateSpiceNetlist(project)`

Erzeugt eine SPICE-Netzliste als String.

### `generateBOM(project)`

Erzeugt eine Stückliste (Bill of Materials).

### `bomToCsv(bom)` / `bomToHtml(bom)`

Konvertiert die Stückliste in CSV- bzw. HTML-Format.

---

*Letzte Aktualisierung: Februar 2026*
