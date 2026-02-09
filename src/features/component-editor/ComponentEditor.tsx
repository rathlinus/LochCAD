// ============================================================
// ComponentEditor — Intuitive component creator with templates
// Quick-create from templates + advanced editor for power users
// ============================================================

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Stage, Layer, Line, Rect, Circle, Group, Text, Arrow } from 'react-konva';
import {
  Plus,
  Minus,
  Square,
  CircleIcon,
  Type,
  Move,
  Trash2,
  Save,
  RotateCw,
  Download,
  Upload,
  Grid,
  Crosshair,
  Pin,
  Cpu,
  Zap,
  ArrowLeft,
  ChevronRight,
  Check,
  Eye,
  Settings2,
  Pencil,
  Copy,
  Package,
  Info,
  Lightbulb,
  ToggleLeft,
} from 'lucide-react';
import { v4 as uuid } from 'uuid';
import type {
  ComponentDefinition,
  ComponentSymbol,
  ComponentFootprint,
  FootprintPad,
  SymbolLine,
  SymbolRectangle,
  SymbolCircle,
  SymbolText,
  SymbolPolyline,
  SymbolGraphic,
  PinDefinition,
  Point,
  Model3D,
  GridPosition,
  PinElectricalType,
  PinDirection,
} from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { COLORS, SCHEMATIC_GRID, PERFBOARD_GRID } from '@/constants';

// ============================================================
// Templates — Pre-built starting points for common components
// ============================================================

interface ComponentTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: string;
  defaultPrefix: string;
  pinCount: number;
  pinCountEditable: boolean;
  pinCountMin?: number;
  pinCountMax?: number;
  pinCountStep?: number;
  defaultPinNames: string[];
  defaultPinTypes: PinElectricalType[];
  generate: (pinCount: number, pinNames: string[], pinTypes: PinElectricalType[]) => {
    graphics: SymbolGraphic[];
    pins: PinDefinition[];
    pads: FootprintPad[];
    spanHoles: GridPosition;
    model3dShape: string;
    model3dParams: Record<string, number | string>;
  };
}

// Helper: generate a simple box symbol with pins on left/right
function generateBoxSymbol(
  pinNames: string[],
  pinTypes: PinElectricalType[],
  leftPins: number[],
  rightPins: number[],
): { graphics: SymbolGraphic[]; pins: PinDefinition[] } {
  const pinSpacing = 20;
  const maxSide = Math.max(leftPins.length, rightPins.length);
  const bodyHeight = Math.max(maxSide * pinSpacing + 10, 40);
  const bodyWidth = 60;
  const halfH = bodyHeight / 2;

  const graphics: SymbolGraphic[] = [
    {
      type: 'rectangle',
      start: { x: -bodyWidth / 2, y: -halfH },
      end: { x: bodyWidth / 2, y: halfH },
      stroke: '#2176B7',
      strokeWidth: 2,
    },
  ];

  const pins: PinDefinition[] = [];

  // Left pins
  leftPins.forEach((pinIdx, i) => {
    const y = -halfH + pinSpacing + i * pinSpacing;
    pins.push({
      id: uuid(),
      number: (pinIdx + 1).toString(),
      name: pinNames[pinIdx] || `Pin ${pinIdx + 1}`,
      position: { x: -bodyWidth / 2 - 20, y },
      length: 20,
      direction: 0,
      electricalType: pinTypes[pinIdx] || 'passive',
    });
  });

  // Right pins
  rightPins.forEach((pinIdx, i) => {
    const y = -halfH + pinSpacing + i * pinSpacing;
    pins.push({
      id: uuid(),
      number: (pinIdx + 1).toString(),
      name: pinNames[pinIdx] || `Pin ${pinIdx + 1}`,
      position: { x: bodyWidth / 2 + 20, y },
      length: 20,
      direction: 180,
      electricalType: pinTypes[pinIdx] || 'passive',
    });
  });

  return { graphics, pins };
}

// Helper: generate DIP pads
function generateDIPPads(pinCount: number): { pads: FootprintPad[]; spanHoles: GridPosition } {
  const half = pinCount / 2;
  const pads: FootprintPad[] = [];

  // Left column (pin 1 to half)
  for (let i = 0; i < half; i++) {
    pads.push({
      id: uuid(),
      number: (i + 1).toString(),
      label: (i + 1).toString(),
      gridPosition: { col: 0, row: i },
      shape: 'circle',
      diameter: 1.8,
      drill: 0.8,
    });
  }
  // Right column (pin half+1 to pinCount, bottom to top)
  for (let i = 0; i < half; i++) {
    pads.push({
      id: uuid(),
      number: (pinCount - i).toString(),
      label: (pinCount - i).toString(),
      gridPosition: { col: 3, row: i },
      shape: 'circle',
      diameter: 1.8,
      drill: 0.8,
    });
  }

  return {
    pads,
    spanHoles: { col: 4, row: half },
  };
}

// Helper: generate inline pads (2-pin, 3-pin linear)
function generateInlinePads(pinCount: number, spacing = 4): { pads: FootprintPad[]; spanHoles: GridPosition } {
  const pads: FootprintPad[] = [];
  for (let i = 0; i < pinCount; i++) {
    pads.push({
      id: uuid(),
      number: (i + 1).toString(),
      label: (i + 1).toString(),
      gridPosition: { col: i * spacing, row: 0 },
      shape: 'circle',
      diameter: 1.8,
      drill: 0.8,
    });
  }
  return {
    pads,
    spanHoles: { col: (pinCount - 1) * spacing + 1, row: 1 },
  };
}

// Helper: two-pin passive symbol (rectangle with pins on sides)
function generateTwoPinSymbol(
  pinNames: string[],
  pinTypes: PinElectricalType[],
): { graphics: SymbolGraphic[]; pins: PinDefinition[] } {
  return {
    graphics: [
      {
        type: 'rectangle',
        start: { x: -20, y: -7 },
        end: { x: 20, y: 7 },
        stroke: '#2176B7',
        strokeWidth: 2,
      },
    ],
    pins: [
      {
        id: uuid(),
        number: '1',
        name: pinNames[0] || '1',
        position: { x: -40, y: 0 },
        length: 20,
        direction: 0,
        electricalType: pinTypes[0] || 'passive',
      },
      {
        id: uuid(),
        number: '2',
        name: pinNames[1] || '2',
        position: { x: 40, y: 0 },
        length: 20,
        direction: 180,
        electricalType: pinTypes[1] || 'passive',
      },
    ],
  };
}

// Helper: three-pin transistor-style symbol
function generateThreePinSymbol(
  pinNames: string[],
  pinTypes: PinElectricalType[],
): { graphics: SymbolGraphic[]; pins: PinDefinition[] } {
  return {
    graphics: [
      {
        type: 'circle',
        center: { x: 0, y: 0 },
        radius: 20,
        stroke: '#2176B7',
        strokeWidth: 2,
      },
    ],
    pins: [
      {
        id: uuid(),
        number: '1',
        name: pinNames[0] || 'B',
        position: { x: -40, y: 0 },
        length: 20,
        direction: 0,
        electricalType: pinTypes[0] || 'input',
      },
      {
        id: uuid(),
        number: '2',
        name: pinNames[1] || 'C',
        position: { x: 20, y: -30 },
        length: 10,
        direction: 270,
        electricalType: pinTypes[1] || 'passive',
      },
      {
        id: uuid(),
        number: '3',
        name: pinNames[2] || 'E',
        position: { x: 20, y: 30 },
        length: 10,
        direction: 90,
        electricalType: pinTypes[2] || 'passive',
      },
    ],
  };
}

const TEMPLATES: ComponentTemplate[] = [
  {
    id: 'two-pin',
    name: '2-Pin Passiv',
    description: 'Widerstände, Kondensatoren, Dioden und andere 2-Pin-Bauteile',
    icon: <Minus size={24} />,
    category: 'Custom',
    defaultPrefix: 'R',
    pinCount: 2,
    pinCountEditable: false,
    defaultPinNames: ['1', '2'],
    defaultPinTypes: ['passive', 'passive'],
    generate: (_count, names, types) => {
      const { graphics, pins } = generateTwoPinSymbol(names, types);
      const { pads, spanHoles } = generateInlinePads(2, 4);
      return { graphics, pins, pads, spanHoles, model3dShape: 'resistor_axial', model3dParams: { bodyLength: 6.3, bodyDiameter: 2.5, leadDiameter: 0.6, leadSpacing: 10.16 } };
    },
  },
  {
    id: 'three-pin',
    name: '3-Pin Aktiv',
    description: 'Transistoren, Spannungsregler und andere 3-Pin-Bauteile',
    icon: <Zap size={24} />,
    category: 'Custom',
    defaultPrefix: 'Q',
    pinCount: 3,
    pinCountEditable: false,
    defaultPinNames: ['B', 'C', 'E'],
    defaultPinTypes: ['input', 'passive', 'passive'],
    generate: (_count, names, types) => {
      const { graphics, pins } = generateThreePinSymbol(names, types);
      const { pads, spanHoles } = generateInlinePads(3, 1);
      return { graphics, pins, pads, spanHoles, model3dShape: 'transistor_to92', model3dParams: { pinCount: 3 } };
    },
  },
  {
    id: 'dip-ic',
    name: 'DIP IC',
    description: 'Dual-Inline-ICs: Operationsverstärker, Timer, Mikrocontroller usw.',
    icon: <Cpu size={24} />,
    category: 'ICs',
    defaultPrefix: 'U',
    pinCount: 8,
    pinCountEditable: true,
    pinCountMin: 4,
    pinCountMax: 40,
    pinCountStep: 2,
    defaultPinNames: [],
    defaultPinTypes: [],
    generate: (count, names, types) => {
      const half = Math.ceil(count / 2);
      const leftIndices = Array.from({ length: half }, (_, i) => i);
      const rightIndices = Array.from({ length: count - half }, (_, i) => count - 1 - i);
      const { graphics, pins } = generateBoxSymbol(names, types, leftIndices, rightIndices);
      const { pads, spanHoles } = generateDIPPads(count);
      return { graphics, pins, pads, spanHoles, model3dShape: 'ic_dip', model3dParams: { pinCount: count } };
    },
  },
  {
    id: 'connector',
    name: 'Pin-Header / Stecker',
    description: 'Einreihige oder zweireihige Pin-Header und Stecker',
    icon: <Grid size={24} />,
    category: 'Connectors',
    defaultPrefix: 'J',
    pinCount: 4,
    pinCountEditable: true,
    pinCountMin: 1,
    pinCountMax: 40,
    pinCountStep: 1,
    defaultPinNames: [],
    defaultPinTypes: [],
    generate: (count, names, types) => {
      const leftIndices = Array.from({ length: count }, (_, i) => i);
      const { graphics, pins } = generateBoxSymbol(names, types, leftIndices, []);
      const pads: FootprintPad[] = [];
      for (let i = 0; i < count; i++) {
        pads.push({
          id: uuid(),
          number: (i + 1).toString(),
          label: (i + 1).toString(),
          gridPosition: { col: 0, row: i },
          shape: 'circle',
          diameter: 1.8,
          drill: 0.8,
        });
      }
      return {
        graphics, pins, pads,
        spanHoles: { col: 1, row: count },
        model3dShape: 'pin_header',
        model3dParams: { pinCount: count },
      };
    },
  },
  {
    id: 'switch',
    name: 'Schalter / Taster',
    description: 'SPST, SPDT Schalter und Taster',
    icon: <ToggleLeft size={24} />,
    category: 'Switches',
    defaultPrefix: 'SW',
    pinCount: 2,
    pinCountEditable: true,
    pinCountMin: 2,
    pinCountMax: 6,
    pinCountStep: 1,
    defaultPinNames: ['1', '2'],
    defaultPinTypes: ['passive', 'passive'],
    generate: (count, names, types) => {
      if (count === 2) {
        const { graphics, pins } = generateTwoPinSymbol(names, types);
        const { pads, spanHoles } = generateInlinePads(2, 3);
        return { graphics, pins, pads, spanHoles, model3dShape: 'switch', model3dParams: { pinCount: 2 } };
      }
      const leftIndices = Array.from({ length: Math.ceil(count / 2) }, (_, i) => i);
      const rightIndices = Array.from({ length: Math.floor(count / 2) }, (_, i) => Math.ceil(count / 2) + i);
      const { graphics, pins } = generateBoxSymbol(names, types, leftIndices, rightIndices);
      const { pads, spanHoles } = generateInlinePads(count, 2);
      return { graphics, pins, pads, spanHoles, model3dShape: 'switch', model3dParams: { pinCount: count } };
    },
  },
  {
    id: 'led',
    name: 'LED',
    description: 'Leuchtdiode mit Anode und Kathode',
    icon: <Lightbulb size={24} />,
    category: 'LEDs',
    defaultPrefix: 'D',
    pinCount: 2,
    pinCountEditable: false,
    defaultPinNames: ['A', 'K'],
    defaultPinTypes: ['passive', 'passive'],
    generate: (_count, names, types) => {
      const graphics: SymbolGraphic[] = [
        {
          type: 'polyline',
          points: [{ x: -12, y: -12 }, { x: -12, y: 12 }, { x: 12, y: 0 }],
          stroke: '#2176B7',
          strokeWidth: 2,
          closed: true,
        },
        {
          type: 'line',
          start: { x: 12, y: -12 },
          end: { x: 12, y: 12 },
          stroke: '#2176B7',
          strokeWidth: 2,
        },
      ];
      const pins: PinDefinition[] = [
        {
          id: uuid(),
          number: '1',
          name: names[0] || 'A',
          position: { x: -40, y: 0 },
          length: 28,
          direction: 0,
          electricalType: types[0] || 'passive',
        },
        {
          id: uuid(),
          number: '2',
          name: names[1] || 'K',
          position: { x: 40, y: 0 },
          length: 28,
          direction: 180,
          electricalType: types[1] || 'passive',
        },
      ];
      const { pads, spanHoles } = generateInlinePads(2, 3);
      return { graphics, pins, pads, spanHoles, model3dShape: 'led', model3dParams: { bodyDiameter: 5 } };
    },
  },
  {
    id: 'blank',
    name: 'Leer (Erweitert)',
    description: 'Von Grund auf erstellen — eigenes Symbol und Footprint zeichnen',
    icon: <Pencil size={24} />,
    category: 'Custom',
    defaultPrefix: 'X',
    pinCount: 0,
    pinCountEditable: false,
    defaultPinNames: [],
    defaultPinTypes: [],
    generate: () => ({
      graphics: [],
      pins: [],
      pads: [],
      spanHoles: { col: 1, row: 1 },
      model3dShape: 'custom',
      model3dParams: {},
    }),
  },
];

// ============================================================
// Types
// ============================================================

type SymbolDrawTool = 'select' | 'line' | 'rect' | 'circle' | 'polyline' | 'text' | 'pin';
type FootprintTool = 'select' | 'add_pad' | 'move' | 'delete';
type CreatorStep = 'template' | 'configure' | 'preview';

const SYM_GRID = 10;
const CANVAS_SIZE = 500;
const FP_GRID = 20;
const FP_CANVAS = 360;

interface EditorState {
  name: string;
  prefix: string;
  category: string;
  description: string;
  templateId: string;
  pinCount: number;
  pinNames: string[];
  pinTypes: PinElectricalType[];
  graphics: SymbolGraphic[];
  pins: PinDefinition[];
  pads: FootprintPad[];
  spanHoles: GridPosition;
  pinToPad: Record<string, string>;
  defaultProperties: Record<string, string>;
  spiceModel: string;
  spiceTemplate: string;
  model3dShape: string;
  model3dParams: Record<string, number | string>;
}

const defaultState: EditorState = {
  name: '',
  prefix: 'X',
  category: 'Custom',
  description: '',
  templateId: '',
  pinCount: 0,
  pinNames: [],
  pinTypes: [],
  graphics: [],
  pins: [],
  pads: [],
  spanHoles: { col: 1, row: 1 },
  pinToPad: {},
  defaultProperties: {},
  spiceModel: '',
  spiceTemplate: '',
  model3dShape: 'custom',
  model3dParams: {},
};

// ============================================================
// Step 1: Template Selection
// ============================================================

interface TemplateSelectionProps {
  onSelect: (template: ComponentTemplate) => void;
}

function TemplateSelection({ onSelect }: TemplateSelectionProps) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 animate-fade-in">
      <div className="max-w-2xl mx-auto px-6 py-6">
        {/* Header area — compact, left-aligned like a panel header */}
        <div className="mb-5">
          <h2 className="text-sm font-semibold text-lochcad-text flex items-center gap-2">
            <Plus size={14} className="text-lochcad-accent" />
            Neues Bauteil erstellen
          </h2>
          <p className="text-[11px] text-lochcad-text-dim mt-1 ml-[22px]">
            Wähle eine Vorlage — Symbol, Footprint und Zuordnung werden automatisch generiert.
          </p>
        </div>

        {/* Template list — styled like the sidebar component list */}
        <div className="space-y-1">
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => onSelect(tpl)}
              className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg
                bg-lochcad-surface/50 border border-lochcad-panel/20
                hover:bg-lochcad-accent/10 hover:border-lochcad-accent/30
                active:scale-[0.995] transition-all duration-100 text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-lochcad-bg border border-lochcad-panel/30
                flex items-center justify-center text-lochcad-accent
                group-hover:border-lochcad-accent/40 group-hover:bg-lochcad-accent/5 transition-colors shrink-0">
                {tpl.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-lochcad-text group-hover:text-lochcad-accent transition-colors">
                  {tpl.name}
                </div>
                <div className="text-[10px] text-lochcad-text-dim leading-snug mt-0.5 truncate">
                  {tpl.description}
                </div>
              </div>
              <div className="text-lochcad-text-dim/30 group-hover:text-lochcad-accent/50 transition-colors shrink-0">
                <ChevronRight size={14} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Step 2: Configuration Form
// ============================================================

interface ConfigurationFormProps {
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  template: ComponentTemplate;
  onBack: () => void;
  onNext: () => void;
}

const CATEGORIES = ['Custom', 'Resistors', 'Capacitors', 'Inductors', 'Diodes', 'LEDs', 'Transistors', 'ICs', 'Connectors', 'Switches', 'Crystals', 'Power', 'Sensors', 'Relays'];

function ConfigurationForm({ state, setState, template, onBack, onNext }: ConfigurationFormProps) {
  const handlePinCountChange = (newCount: number) => {
    const clamped = Math.max(
      template.pinCountMin ?? 1,
      Math.min(template.pinCountMax ?? 40, newCount),
    );
    setState(prev => {
      const names = [...prev.pinNames];
      const types = [...prev.pinTypes];
      while (names.length < clamped) {
        names.push(`Pin ${names.length + 1}`);
        types.push('passive');
      }
      return { ...prev, pinCount: clamped, pinNames: names.slice(0, clamped), pinTypes: types.slice(0, clamped) };
    });
  };

  const updatePinName = (idx: number, name: string) => {
    setState(prev => {
      const names = [...prev.pinNames];
      names[idx] = name;
      return { ...prev, pinNames: names };
    });
  };

  const updatePinType = (idx: number, type: PinElectricalType) => {
    setState(prev => {
      const types = [...prev.pinTypes];
      types[idx] = type;
      return { ...prev, pinTypes: types };
    });
  };

  const updateProp = (key: string, value: string) => {
    setState(prev => ({
      ...prev,
      defaultProperties: { ...prev.defaultProperties, [key]: value },
    }));
  };

  const isValid = state.name.trim().length > 0;

  return (
    <div className="flex-1 flex overflow-hidden min-h-0 animate-fade-in">
      {/* Left: Main form */}
      <div className="flex-1 overflow-y-auto min-h-0 p-6 pb-16">
        <div className="max-w-lg mx-auto space-y-5">
          {/* Identity */}
          <section>
            <h3 className="text-sm font-bold text-lochcad-text mb-3 flex items-center gap-2">
              <Package size={14} className="text-lochcad-accent" /> Bauteil-Identität
            </h3>
            <div className="space-y-3">
              <div>
                <label className="input-label block">Name *</label>
                <input
                  className="input w-full"
                  placeholder="e.g., 555 Timer, LM7805, My Sensor"
                  value={state.name}
                  onChange={e => setState(prev => ({ ...prev, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="input-label block">Referenz-Präfix</label>
                  <input
                    className="input w-full"
                    placeholder="R, C, U, ..."
                    value={state.prefix}
                    onChange={e => setState(prev => ({ ...prev, prefix: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="input-label block">Kategorie</label>
                  <select
                    className="input w-full"
                    value={state.category}
                    onChange={e => setState(prev => ({ ...prev, category: e.target.value }))}
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="input-label block">Beschreibung</label>
                <input
                  className="input w-full"
                  placeholder="Kurze Beschreibung des Bauteils"
                  value={state.description}
                  onChange={e => setState(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
            </div>
          </section>

          {/* Pin Count (if editable) */}
          {template.pinCountEditable && (
            <section>
              <h3 className="text-sm font-bold text-lochcad-text mb-3 flex items-center gap-2">
                <Cpu size={14} className="text-lochcad-accent" /> Pin-Anzahl
              </h3>
              <div className="flex items-center gap-3">
                <button
                  className="btn-icon border border-lochcad-panel/40 rounded-lg"
                  onClick={() => handlePinCountChange(state.pinCount - (template.pinCountStep ?? 1))}
                  disabled={state.pinCount <= (template.pinCountMin ?? 1)}
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  className="input w-20 text-center font-mono text-lg"
                  value={state.pinCount}
                  min={template.pinCountMin}
                  max={template.pinCountMax}
                  step={template.pinCountStep}
                  onChange={e => handlePinCountChange(parseInt(e.target.value) || template.pinCountMin || 1)}
                />
                <button
                  className="btn-icon border border-lochcad-panel/40 rounded-lg"
                  onClick={() => handlePinCountChange(state.pinCount + (template.pinCountStep ?? 1))}
                  disabled={state.pinCount >= (template.pinCountMax ?? 40)}
                >
                  <Plus size={14} />
                </button>
                <span className="text-xs text-lochcad-text-dim">
                  ({template.pinCountMin}–{template.pinCountMax}{template.pinCountStep === 2 ? ', nur gerade' : ''})
                </span>
              </div>
            </section>
          )}

          {/* Pin Names & Types */}
          {state.pinCount > 0 && (
            <section>
              <h3 className="text-sm font-bold text-lochcad-text mb-3 flex items-center gap-2">
                <Pin size={14} className="text-lochcad-accent" /> Pin-Konfiguration
              </h3>
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                <div className="flex items-center gap-2 text-[10px] text-lochcad-text-dim uppercase tracking-wider pb-1 border-b border-lochcad-panel/20">
                  <span className="w-8 text-center">#</span>
                  <span className="flex-1">Name</span>
                  <span className="w-28">Typ</span>
                </div>
                {state.pinNames.map((name, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-8 text-center text-xs text-lochcad-text-dim font-mono">{i + 1}</span>
                    <input
                      className="input flex-1 text-xs py-1"
                      value={name}
                      onChange={e => updatePinName(i, e.target.value)}
                      placeholder={`Pin ${i + 1}`}
                    />
                    <select
                      className="input w-28 text-xs py-1"
                      value={state.pinTypes[i] || 'passive'}
                      onChange={e => updatePinType(i, e.target.value as PinElectricalType)}
                    >
                      <option value="passive">Passiv</option>
                      <option value="input">Eingang</option>
                      <option value="output">Ausgang</option>
                      <option value="bidirectional">Bidirektional</option>
                      <option value="power_in">Versorgung Ein</option>
                      <option value="power_out">Versorgung Aus</option>
                      <option value="open_collector">Open Coll.</option>
                      <option value="tristate">Tri-State</option>
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Default Properties */}
          <section>
            <h3 className="text-sm font-bold text-lochcad-text mb-3 flex items-center gap-2">
              <Settings2 size={14} className="text-lochcad-accent" /> Standard-Eigenschaften
            </h3>
            <div className="space-y-2">
              <div>
                <label className="input-label block">Wert</label>
                <input
                  className="input w-full"
                  placeholder="z.B. 10kΩ, 100nF, NE555"
                  value={state.defaultProperties.value || ''}
                  onChange={e => updateProp('value', e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="input-label block">Toleranz</label>
                  <input
                    className="input w-full"
                    placeholder="z.B. 5%, 10%"
                    value={state.defaultProperties.tolerance || ''}
                    onChange={e => updateProp('tolerance', e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="input-label block">Gehäuse</label>
                  <input
                    className="input w-full"
                    placeholder="z.B. DIP-8, TO-92"
                    value={state.defaultProperties.package || ''}
                    onChange={e => updateProp('package', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* SPICE */}
          <section>
            <h3 className="text-sm font-bold text-lochcad-text mb-3 flex items-center gap-2">
              <Zap size={14} className="text-lochcad-accent" /> SPICE (optional)
            </h3>
            <div className="space-y-2">
              <div>
                <label className="input-label block">SPICE-Vorlage</label>
                <input
                  className="input w-full font-mono text-xs"
                  placeholder="z.B. R{ref} {1} {2} {value}"
                  value={state.spiceTemplate}
                  onChange={e => setState(prev => ({ ...prev, spiceTemplate: e.target.value }))}
                />
              </div>
              <div>
                <label className="input-label block">SPICE-Modell</label>
                <textarea
                  className="input w-full font-mono text-xs h-16 resize-none"
                  placeholder=".model MyPart ..."
                  value={state.spiceModel}
                  onChange={e => setState(prev => ({ ...prev, spiceModel: e.target.value }))}
                />
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Right: Live mini-preview */}
      <div className="w-72 bg-lochcad-bg border-l border-lochcad-panel/30 p-4 hidden lg:flex flex-col gap-4 overflow-y-auto">
        <h4 className="text-xs font-bold text-lochcad-text-dim uppercase tracking-wider">Vorschau</h4>
        <MiniPreview state={state} template={template} />

        <div className="mt-auto space-y-2">
          <button
            onClick={onBack}
            className="btn btn-ghost w-full justify-center text-xs"
          >
            <ArrowLeft size={14} /> Vorlage ändern
          </button>
          <button
            onClick={onNext}
            disabled={!isValid}
            className="btn btn-primary w-full justify-center text-sm"
          >
            Vorschau & Speichern <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Mobile bottom bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 flex gap-2 p-3 bg-lochcad-surface border-t border-lochcad-panel/30">
        <button onClick={onBack} className="btn btn-ghost flex-1 justify-center text-xs">
          <ArrowLeft size={14} /> Zurück
        </button>
        <button onClick={onNext} disabled={!isValid} className="btn btn-primary flex-1 justify-center text-xs">
          Vorschau & Speichern <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Mini Preview (used in config step sidebar)
// ============================================================

interface MiniPreviewProps {
  state: EditorState;
  template: ComponentTemplate;
}

function MiniPreview({ state, template }: MiniPreviewProps) {
  const generated = useMemo(() => {
    if (!template) return null;
    return template.generate(state.pinCount, state.pinNames, state.pinTypes);
  }, [template, state.pinCount, state.pinNames, state.pinTypes]);

  if (!generated) return null;

  const PREVIEW_SIZE = 240;
  const OFFSET = PREVIEW_SIZE / 2;

  return (
    <div className="space-y-3">
      {/* Symbol preview */}
      <div>
        <div className="text-[10px] text-lochcad-text-dim mb-1 uppercase tracking-wider">Schaltplan-Symbol</div>
        <div className="border border-lochcad-panel/30 rounded-lg overflow-hidden">
          <Stage width={PREVIEW_SIZE} height={160} style={{ background: '#1b1f2b' }}>
            <Layer>
              <Group x={OFFSET} y={80}>
                {generated.graphics.map((g, i) => renderGraphicKonva(g, i))}
                {generated.pins.map((pin) => (
                  <Group key={pin.id ?? pin.number}>
                    <Line
                      points={[pin.position.x, pin.position.y, pin.position.x - pin.length * Math.cos(pin.direction * Math.PI / 180), pin.position.y - pin.length * Math.sin(pin.direction * Math.PI / 180)]}
                      stroke={COLORS.componentPin}
                      strokeWidth={1.5}
                    />
                    <Circle
                      x={pin.position.x}
                      y={pin.position.y}
                      radius={2}
                      fill={COLORS.junction}
                    />
                  </Group>
                ))}
              </Group>
            </Layer>
          </Stage>
        </div>
      </div>

      {/* Footprint preview */}
      {generated.pads.length > 0 && (
        <div>
          <div className="text-[10px] text-lochcad-text-dim mb-1 uppercase tracking-wider">Footprint</div>
          <div className="border border-lochcad-panel/30 rounded-lg overflow-hidden">
            <Stage width={PREVIEW_SIZE} height={120} style={{ background: '#2d1b0e' }}>
              <Layer>
                <Group x={40} y={20}>
                  {generated.pads.map(pad => (
                    <Group key={pad.id ?? pad.number}>
                      <Circle
                        x={pad.gridPosition.col * 16}
                        y={pad.gridPosition.row * 16}
                        radius={6}
                        fill={COLORS.copperPad}
                        stroke={COLORS.copper}
                        strokeWidth={1}
                      />
                      <Circle
                        x={pad.gridPosition.col * 16}
                        y={pad.gridPosition.row * 16}
                        radius={2.5}
                        fill="#1b1f2b"
                      />
                      <Text
                        x={pad.gridPosition.col * 16 - 3}
                        y={pad.gridPosition.row * 16 + 8}
                        text={pad.label ?? pad.number}
                        fill="#ffffff"
                        fontSize={8}
                      />
                    </Group>
                  ))}
                </Group>
              </Layer>
            </Stage>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="text-[11px] text-lochcad-text-dim space-y-0.5">
        <div>Pins: <span className="text-lochcad-text">{generated.pins.length}</span></div>
        <div>Pads: <span className="text-lochcad-text">{generated.pads.length}</span></div>
        <div>Kategorie: <span className="text-lochcad-text">{state.category}</span></div>
        {state.defaultProperties.value && (
          <div>Wert: <span className="text-lochcad-text">{state.defaultProperties.value}</span></div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Step 3: Preview & Save + Advanced Editing
// ============================================================

interface PreviewStepProps {
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  template: ComponentTemplate;
  onBack: () => void;
  onSave: () => void;
  editingExisting?: boolean;
}

function PreviewStep({ state, setState, template, onBack, onSave, editingExisting }: PreviewStepProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'symbol' | 'footprint' | 'mapping'>('preview');

  const tabs = [
    { id: 'preview' as const, label: 'Vorschau', icon: <Eye size={13} /> },
    { id: 'symbol' as const, label: 'Symbol-Editor', icon: <Pencil size={13} /> },
    { id: 'footprint' as const, label: 'Footprint-Editor', icon: <Grid size={13} /> },
    { id: 'mapping' as const, label: 'Pin-Zuordnung', icon: <Pin size={13} /> },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-lochcad-surface border-b border-lochcad-panel/30">
        <button onClick={onBack} className="btn-icon" title="Zurück zur Konfiguration">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <span className="text-sm font-bold text-lochcad-text">{state.name || 'Unbenanntes Bauteil'}</span>
          <span className="text-xs text-lochcad-text-dim ml-2">{state.prefix} · {state.category}</span>
        </div>
        <button onClick={onSave} className="btn btn-primary text-sm">
          <Save size={14} /> {editingExisting ? 'Bauteil aktualisieren' : 'In Bibliothek speichern'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-lochcad-panel/30 bg-lochcad-bg px-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-lochcad-accent border-b-2 border-lochcad-accent'
                : 'text-lochcad-text-dim hover:text-lochcad-text'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto min-h-0 p-4">
        {activeTab === 'preview' && (
          <FullPreview state={state} />
        )}
        {activeTab === 'symbol' && (
          <AdvancedSymbolEditor state={state} setState={setState} />
        )}
        {activeTab === 'footprint' && (
          <AdvancedFootprintEditor state={state} setState={setState} />
        )}
        {activeTab === 'mapping' && (
          <PinMappingPanel state={state} setState={setState} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// Full Preview (read-only, side-by-side symbol + footprint)
// ============================================================

function FullPreview({ state }: { state: EditorState }) {
  const SYM_PREVIEW = 450;
  const FP_PREVIEW = 350;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-lochcad-accent/5 border border-lochcad-accent/20">
        <Info size={14} className="text-lochcad-accent mt-0.5 shrink-0" />
        <div className="text-xs text-lochcad-text-dim">
          Dies ist eine Vorschau deines Bauteils. Verwende die Tabs <strong>Symbol-Editor</strong> und <strong>Footprint-Editor</strong> zur Feinabstimmung, oder speichere direkt.
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        {/* Symbol */}
        <div className="flex-1 min-w-[300px]">
          <h4 className="text-xs font-bold text-lochcad-text-dim uppercase tracking-wider mb-2">Schaltplan-Symbol</h4>
          <div className="border border-lochcad-panel/30 rounded-lg overflow-hidden">
            <Stage width={SYM_PREVIEW} height={300} style={{ background: '#1b1f2b' }}>
              <Layer>
                {/* Center crosshair */}
                <Line points={[SYM_PREVIEW / 2, 0, SYM_PREVIEW / 2, 300]} stroke="#2a2f40" strokeWidth={0.5} dash={[4, 4]} />
                <Line points={[0, 150, SYM_PREVIEW, 150]} stroke="#2a2f40" strokeWidth={0.5} dash={[4, 4]} />

                <Group x={SYM_PREVIEW / 2} y={150}>
                  {state.graphics.map((g, i) => renderGraphicKonva(g, i))}
                  {state.pins.map((pin) => (
                    <Group key={pin.id ?? pin.number}>
                      <Line
                        points={pinLinePoints(pin)}
                        stroke={COLORS.componentPin}
                        strokeWidth={1.5}
                      />
                      <Circle
                        x={pin.position.x}
                        y={pin.position.y}
                        radius={3}
                        fill={COLORS.junction}
                      />
                      <Text
                        x={pin.position.x + (pin.direction === 180 ? -30 : 4)}
                        y={pin.position.y - 5}
                        text={pin.name}
                        fill={COLORS.componentText}
                        fontSize={10}
                        align={pin.direction === 180 ? 'right' : 'left'}
                      />
                      <Text
                        x={pin.position.x + (pin.direction === 0 ? -18 : pin.direction === 180 ? 18 : -4)}
                        y={pin.position.y + (pin.direction === 90 || pin.direction === 270 ? 0 : 6)}
                        text={pin.number}
                        fill={COLORS.componentRef}
                        fontSize={8}
                      />
                    </Group>
                  ))}
                </Group>
              </Layer>
            </Stage>
          </div>
        </div>

        {/* Footprint */}
        <div className="flex-1 min-w-[300px]">
          <h4 className="text-xs font-bold text-lochcad-text-dim uppercase tracking-wider mb-2">Footprint</h4>
          <div className="border border-lochcad-panel/30 rounded-lg overflow-hidden">
            <Stage width={FP_PREVIEW} height={300} style={{ background: '#2d1b0e' }}>
              <Layer>
                <Group x={60} y={40}>
                  {state.pads.map(pad => (
                    <Group key={pad.id ?? pad.number}>
                      <Circle
                        x={pad.gridPosition.col * FP_GRID}
                        y={pad.gridPosition.row * FP_GRID}
                        radius={8}
                        fill={COLORS.copperPad}
                        stroke={COLORS.copper}
                        strokeWidth={1}
                      />
                      <Circle
                        x={pad.gridPosition.col * FP_GRID}
                        y={pad.gridPosition.row * FP_GRID}
                        radius={3}
                        fill="#1b1f2b"
                      />
                      <Text
                        x={pad.gridPosition.col * FP_GRID - 4}
                        y={pad.gridPosition.row * FP_GRID + 10}
                        text={pad.label ?? pad.number}
                        fill="#ffffff"
                        fontSize={9}
                      />
                    </Group>
                  ))}
                </Group>
              </Layer>
            </Stage>
          </div>
        </div>
      </div>

      {/* Component info summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Pins', value: state.pins.length.toString() },
          { label: 'Pads', value: state.pads.length.toString() },
          { label: 'Grafiken', value: state.graphics.length.toString() },
          { label: 'Zugeordnet', value: `${Object.keys(state.pinToPad).filter(k => state.pinToPad[k]).length}/${state.pins.length}` },
        ].map(stat => (
          <div key={stat.label} className="bg-lochcad-surface rounded-lg p-3 text-center">
            <div className="text-lg font-bold text-lochcad-accent">{stat.value}</div>
            <div className="text-[10px] text-lochcad-text-dim uppercase">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Advanced Symbol Editor (canvas-based, for power users)
// ============================================================

function AdvancedSymbolEditor({ state, setState }: { state: EditorState; setState: React.Dispatch<React.SetStateAction<EditorState>> }) {
  const [tool, setTool] = useState<SymbolDrawTool>('select');
  const [drawing, setDrawing] = useState<Point[]>([]);

  const snapToGrid = (x: number, y: number): Point => ({
    x: Math.round(x / SYM_GRID) * SYM_GRID,
    y: Math.round(y / SYM_GRID) * SYM_GRID,
  });

  const handleClick = useCallback((e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const p = snapToGrid(pos.x - CANVAS_SIZE / 2, pos.y - 200);

    switch (tool) {
      case 'line':
        if (drawing.length === 0) {
          setDrawing([p]);
        } else {
          const newLine: SymbolLine = { type: 'line', start: drawing[0], end: p, strokeWidth: 2 };
          setState(prev => ({ ...prev, graphics: [...prev.graphics, newLine] }));
          setDrawing([]);
        }
        break;
      case 'rect':
        if (drawing.length === 0) {
          setDrawing([p]);
        } else {
          const newRect: SymbolRectangle = { type: 'rectangle', start: drawing[0], end: p, strokeWidth: 2 };
          setState(prev => ({ ...prev, graphics: [...prev.graphics, newRect] }));
          setDrawing([]);
        }
        break;
      case 'circle':
        if (drawing.length === 0) {
          setDrawing([p]);
        } else {
          const r = Math.sqrt(Math.pow(p.x - drawing[0].x, 2) + Math.pow(p.y - drawing[0].y, 2));
          const newCircle: SymbolCircle = {
            type: 'circle',
            center: drawing[0],
            radius: Math.round(r / SYM_GRID) * SYM_GRID || SYM_GRID,
            strokeWidth: 2,
          };
          setState(prev => ({ ...prev, graphics: [...prev.graphics, newCircle] }));
          setDrawing([]);
        }
        break;
      case 'pin': {
        const pinNum = state.pins.length + 1;
        const newPin: PinDefinition = {
          id: uuid(),
          name: `Pin ${pinNum}`,
          number: pinNum.toString(),
          electricalType: 'passive',
          position: { x: p.x, y: p.y },
          direction: 0,
          length: 20,
        };
        setState(prev => ({
          ...prev,
          pins: [...prev.pins, newPin],
          pinNames: [...prev.pinNames, newPin.name],
          pinTypes: [...prev.pinTypes, newPin.electricalType],
          pinCount: prev.pinCount + 1,
        }));
        break;
      }
    }
  }, [tool, drawing, state.pins.length, setState]);

  const tools: { id: SymbolDrawTool; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <Move size={14} />, label: 'Auswählen' },
    { id: 'line', icon: <Minus size={14} />, label: 'Linie' },
    { id: 'rect', icon: <Square size={14} />, label: 'Rechteck' },
    { id: 'circle', icon: <CircleIcon size={14} />, label: 'Kreis' },
    { id: 'pin', icon: <Pin size={14} />, label: 'Pin hinzufügen' },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-lochcad-surface border border-lochcad-panel/20">
        <div className="flex gap-1">
          {tools.map(t => (
            <button
              key={t.id}
              onClick={() => { setTool(t.id); setDrawing([]); }}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
                tool === t.id
                  ? 'bg-lochcad-accent text-white'
                  : 'bg-lochcad-bg text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/30'
              }`}
              title={t.label}
            >
              {t.icon}
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setState(prev => ({ ...prev, graphics: prev.graphics.slice(0, -1) }))}
          className="btn-icon text-lochcad-text-dim hover:text-red-400"
          title="Letzte Grafik rückgängig"
        >
          <Trash2 size={14} />
        </button>
        <span className="text-[10px] text-lochcad-text-dim">
          {state.graphics.length} Elemente · {state.pins.length} Pins
        </span>
      </div>

      <div className="border border-lochcad-panel/30 rounded-lg overflow-hidden">
        <Stage width={CANVAS_SIZE} height={400} onClick={handleClick} style={{ background: '#1b1f2b' }}>
          <Layer>
            {/* Grid */}
            {Array.from({ length: Math.ceil(CANVAS_SIZE / SYM_GRID) }).map((_, i) => (
              <React.Fragment key={i}>
                <Line points={[i * SYM_GRID, 0, i * SYM_GRID, 400]} stroke="#232838" strokeWidth={0.5} />
                <Line points={[0, i * SYM_GRID, CANVAS_SIZE, i * SYM_GRID]} stroke="#232838" strokeWidth={0.5} />
              </React.Fragment>
            ))}
            {/* Origin crosshair */}
            <Line points={[CANVAS_SIZE / 2, 0, CANVAS_SIZE / 2, 400]} stroke="#3a3f50" strokeWidth={1} dash={[4, 4]} />
            <Line points={[0, 200, CANVAS_SIZE, 200]} stroke="#3a3f50" strokeWidth={1} dash={[4, 4]} />

            <Group x={CANVAS_SIZE / 2} y={200}>
              {state.graphics.map((g, i) => renderGraphicKonva(g, i))}
              {state.pins.map((pin) => (
                <Group key={pin.id ?? pin.number}>
                  <Line
                    points={pinLinePoints(pin)}
                    stroke={COLORS.componentPin}
                    strokeWidth={1.5}
                  />
                  <Circle x={pin.position.x} y={pin.position.y} radius={3} fill={COLORS.junction} />
                  <Text x={pin.position.x + 4} y={pin.position.y - 6} text={pin.name} fill={COLORS.componentText} fontSize={10} />
                  <Text
                    x={pin.position.x - pin.length - 8}
                    y={pin.position.y - 6}
                    text={pin.number}
                    fill={COLORS.componentRef}
                    fontSize={9}
                    align="right"
                  />
                </Group>
              ))}
              {drawing.length > 0 && (
                <Circle x={drawing[0].x} y={drawing[0].y} radius={3} fill={COLORS.selected} />
              )}
            </Group>
          </Layer>
        </Stage>
      </div>

      <p className="text-[10px] text-lochcad-text-dim mt-2">
        Klicke auf die Zeichenfläche zum Zeichnen. Für Linien, Rechtecke und Kreise: Klick für Startpunkt, dann erneut klicken für Endpunkt. Ursprung ist in der Mitte (Fadenkreuz).
      </p>
    </div>
  );
}

// ============================================================
// Advanced Footprint Editor (canvas-based)
// ============================================================

function AdvancedFootprintEditor({ state, setState }: { state: EditorState; setState: React.Dispatch<React.SetStateAction<EditorState>> }) {
  const [tool, setTool] = useState<'add_pad' | 'delete'>('add_pad');

  const handleClick = useCallback((e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;
    const col = Math.round(pos.x / FP_GRID);
    const row = Math.round(pos.y / FP_GRID);

    if (tool === 'add_pad') {
      const exists = state.pads.some(p => p.gridPosition.col === col && p.gridPosition.row === row);
      if (exists) return;
      const padNum = state.pads.length + 1;
      const newPad: FootprintPad = {
        id: uuid(),
        number: padNum.toString(),
        gridPosition: { col, row },
        shape: 'round',
        diameter: 1.8,
        drill: 0.8,
        label: padNum.toString(),
      };
      setState(prev => ({
        ...prev,
        pads: [...prev.pads, newPad],
      }));
    } else {
      setState(prev => ({
        ...prev,
        pads: prev.pads.filter(p => !(p.gridPosition.col === col && p.gridPosition.row === row)),
      }));
    }
  }, [tool, state.pads, setState]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-lochcad-surface border border-lochcad-panel/20">
        <button
          onClick={() => setTool('add_pad')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
            tool === 'add_pad' ? 'bg-lochcad-accent text-white' : 'bg-lochcad-bg text-lochcad-text-dim hover:text-lochcad-text'
          }`}
        >
          <Plus size={14} /> Pad hinzufügen
        </button>
        <button
          onClick={() => setTool('delete')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
            tool === 'delete' ? 'bg-red-600 text-white' : 'bg-lochcad-bg text-lochcad-text-dim hover:text-lochcad-text'
          }`}
        >
          <Trash2 size={14} /> Pad entfernen
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-lochcad-text-dim">{state.pads.length} pads</span>
      </div>

      <div className="border border-lochcad-panel/30 rounded-lg overflow-hidden">
        <Stage width={FP_CANVAS} height={FP_CANVAS} onClick={handleClick} style={{ background: '#2d1b0e' }}>
          <Layer>
            {/* Grid + holes */}
            {Array.from({ length: Math.ceil(FP_CANVAS / FP_GRID) + 1 }).map((_, i) => (
              <React.Fragment key={i}>
                <Line points={[i * FP_GRID, 0, i * FP_GRID, FP_CANVAS]} stroke="#5a3a1e" strokeWidth={0.5} />
                <Line points={[0, i * FP_GRID, FP_CANVAS, i * FP_GRID]} stroke="#5a3a1e" strokeWidth={0.5} />
              </React.Fragment>
            ))}
            {Array.from({ length: Math.ceil(FP_CANVAS / FP_GRID) + 1 }).flatMap((_, r) =>
              Array.from({ length: Math.ceil(FP_CANVAS / FP_GRID) + 1 }).map((_, c) => (
                <Circle key={`h-${c}-${r}`} x={c * FP_GRID} y={r * FP_GRID} radius={3} fill="#1b1f2b" stroke="#8B7355" strokeWidth={0.5} />
              ))
            )}
            {/* Pads */}
            {state.pads.map(pad => (
              <Group key={pad.id ?? pad.number}>
                <Circle x={pad.gridPosition.col * FP_GRID} y={pad.gridPosition.row * FP_GRID} radius={8} fill={COLORS.copperPad} stroke={COLORS.copper} strokeWidth={1} />
                <Circle x={pad.gridPosition.col * FP_GRID} y={pad.gridPosition.row * FP_GRID} radius={3} fill="#1b1f2b" />
                <Text x={pad.gridPosition.col * FP_GRID - 4} y={pad.gridPosition.row * FP_GRID + 10} text={pad.label ?? pad.number} fill="#ffffff" fontSize={9} />
              </Group>
            ))}
          </Layer>
        </Stage>
      </div>

      <p className="text-[10px] text-lochcad-text-dim mt-2">
        Klicke auf ein Rasterloch, um ein Pad hinzuzufügen. Wechsle in den Entfernen-Modus zum Löschen.
      </p>
    </div>
  );
}

// ============================================================
// Pin Mapping Panel
// ============================================================

function PinMappingPanel({ state, setState }: { state: EditorState; setState: React.Dispatch<React.SetStateAction<EditorState>> }) {
  const autoMap = () => {
    const mapping: Record<string, string> = {};
    state.pins.forEach((pin) => {
      const matchPad = state.pads.find(p => p.number === pin.number);
      if (matchPad) {
        mapping[pin.id ?? pin.number] = matchPad.id ?? matchPad.number;
      }
    });
    setState(prev => ({ ...prev, pinToPad: mapping }));
  };

  const allMapped = state.pins.length > 0 && state.pins.every(pin => {
    const key = pin.id ?? pin.number;
    return state.pinToPad[key] && state.pinToPad[key] !== '';
  });

  return (
    <div className="max-w-lg space-y-4">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-lochcad-accent/5 border border-lochcad-accent/20">
        <Info size={14} className="text-lochcad-accent shrink-0" />
        <div className="text-xs text-lochcad-text-dim">
          Ordne jeden Schaltplan-Pin einem physischen Pad auf dem Footprint zu. Klicke auf <strong>Auto-Zuordnung</strong> zum automatischen Zuordnen.
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={autoMap} className="btn btn-secondary text-xs">
          <Zap size={12} /> Auto-Zuordnung
        </button>
        {allMapped && (
          <span className="text-xs text-lochcad-success flex items-center gap-1">
            <Check size={12} /> Alle Pins zugeordnet
          </span>
        )}
      </div>

      {state.pins.length === 0 ? (
        <p className="text-xs text-lochcad-text-dim">Noch keine Pins definiert. Füge Pins im Symbol-Editor hinzu oder gehe zurück zur Konfiguration.</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[10px] text-lochcad-text-dim uppercase tracking-wider pb-1 border-b border-lochcad-panel/20">
            <span className="w-24">Pin</span>
            <span className="w-8 text-center">&rarr;</span>
            <span className="flex-1">Pad</span>
          </div>
          {state.pins.map(pin => {
            const pinKey = pin.id ?? pin.number;
            const isMapped = state.pinToPad[pinKey] && state.pinToPad[pinKey] !== '';
            return (
              <div key={pinKey} className={`flex items-center gap-2 py-1.5 px-2 rounded ${isMapped ? 'bg-lochcad-success/5' : 'bg-lochcad-error/5'}`}>
                <span className="w-24 text-xs text-lochcad-text truncate">
                  <span className="text-lochcad-text-dim">{pin.number}:</span> {pin.name}
                </span>
                <span className="w-8 text-center text-lochcad-text-dim">&rarr;</span>
                <select
                  className="input text-xs py-1 flex-1"
                  value={state.pinToPad[pinKey] || ''}
                  onChange={e => {
                    setState(prev => ({
                      ...prev,
                      pinToPad: { ...prev.pinToPad, [pinKey]: e.target.value },
                    }));
                  }}
                >
                  <option value="">— nicht zugeordnet —</option>
                  {state.pads.map(pad => {
                    const padKey = pad.id ?? pad.number;
                    return <option key={padKey} value={padKey}>Pad {pad.label ?? pad.number} ({pad.gridPosition.col},{pad.gridPosition.row})</option>;
                  })}
                </select>
                {isMapped && <Check size={12} className="text-lochcad-success shrink-0" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Rendering Helpers
// ============================================================

function renderGraphicKonva(g: SymbolGraphic, i: number) {
  switch (g.type) {
    case 'line':
      return <Line key={`g-${i}`} points={[g.start.x, g.start.y, g.end.x, g.end.y]} stroke={COLORS.componentBody} strokeWidth={g.strokeWidth ?? 2} />;
    case 'rectangle': {
      const x = Math.min(g.start.x, g.end.x);
      const y = Math.min(g.start.y, g.end.y);
      const w = Math.abs(g.end.x - g.start.x);
      const h = Math.abs(g.end.y - g.start.y);
      return <Rect key={`g-${i}`} x={x} y={y} width={w} height={h} stroke={COLORS.componentBody} strokeWidth={g.strokeWidth ?? 2} fill={g.fill ?? undefined} />;
    }
    case 'circle':
      return <Circle key={`g-${i}`} x={g.center.x} y={g.center.y} radius={g.radius} stroke={COLORS.componentBody} strokeWidth={g.strokeWidth ?? 2} />;
    case 'polyline':
      return <Line key={`g-${i}`} points={g.points.flatMap(p => [p.x, p.y])} stroke={COLORS.componentBody} strokeWidth={g.strokeWidth ?? 2} closed={g.closed} fill={g.fill ?? undefined} />;
    default:
      return null;
  }
}

function pinLinePoints(pin: PinDefinition): number[] {
  const rad = (pin.direction * Math.PI) / 180;
  const endX = pin.position.x - pin.length * Math.cos(rad);
  const endY = pin.position.y - pin.length * Math.sin(rad);
  return [pin.position.x, pin.position.y, endX, endY];
}

// ============================================================
// Main Component Editor
// ============================================================

const ComponentEditor: React.FC = () => {
  const [step, setStep] = useState<CreatorStep>('template');
  const [state, setState] = useState<EditorState>({ ...defaultState });
  const [selectedTemplate, setSelectedTemplate] = useState<ComponentTemplate | null>(null);

  const addCustomComponent = useProjectStore(s => s.addCustomComponent);
  const setCurrentView = useProjectStore(s => s.setCurrentView);

  // Step 1: Template selected
  const handleTemplateSelect = useCallback((tpl: ComponentTemplate) => {
    const pinNames = tpl.defaultPinNames.length > 0
      ? [...tpl.defaultPinNames]
      : Array.from({ length: tpl.pinCount }, (_, i) => `Pin ${i + 1}`);
    const pinTypes = tpl.defaultPinTypes.length > 0
      ? [...tpl.defaultPinTypes]
      : Array.from({ length: tpl.pinCount }, () => 'passive' as PinElectricalType);

    // Generate initial symbol/footprint
    const generated = tpl.generate(tpl.pinCount, pinNames, pinTypes);

    // Auto-map pins to pads by number
    const pinToPad: Record<string, string> = {};
    generated.pins.forEach((pin) => {
      const matchPad = generated.pads.find(p => p.number === pin.number);
      if (matchPad) {
        pinToPad[pin.id ?? pin.number] = matchPad.id ?? matchPad.number;
      }
    });

    setState({
      ...defaultState,
      templateId: tpl.id,
      prefix: tpl.defaultPrefix,
      category: tpl.category,
      pinCount: tpl.pinCount,
      pinNames,
      pinTypes,
      graphics: generated.graphics,
      pins: generated.pins,
      pads: generated.pads,
      spanHoles: generated.spanHoles,
      pinToPad,
      model3dShape: generated.model3dShape,
      model3dParams: generated.model3dParams,
    });
    setSelectedTemplate(tpl);

    // Skip to advanced mode for blank template
    if (tpl.id === 'blank') {
      setStep('preview');
    } else {
      setStep('configure');
    }
  }, []);

  // Regenerate when pin config changes (for configure step)
  const regenerateFromConfig = useCallback(() => {
    if (!selectedTemplate) return;
    const generated = selectedTemplate.generate(state.pinCount, state.pinNames, state.pinTypes);

    // Re-auto-map
    const pinToPad: Record<string, string> = {};
    generated.pins.forEach((pin) => {
      const matchPad = generated.pads.find(p => p.number === pin.number);
      if (matchPad) {
        pinToPad[pin.id ?? pin.number] = matchPad.id ?? matchPad.number;
      }
    });

    setState(prev => ({
      ...prev,
      graphics: generated.graphics,
      pins: generated.pins,
      pads: generated.pads,
      spanHoles: generated.spanHoles,
      pinToPad,
      model3dShape: generated.model3dShape,
      model3dParams: generated.model3dParams,
    }));
  }, [selectedTemplate, state.pinCount, state.pinNames, state.pinTypes]);

  // When moving to preview, regenerate
  const handleGoToPreview = useCallback(() => {
    regenerateFromConfig();
    setStep('preview');
  }, [regenerateFromConfig]);

  // Save to library
  const handleSave = useCallback(() => {
    const symbol: ComponentSymbol = {
      graphics: state.graphics,
      pins: state.pins,
    };

    const cols = state.pads.map(p => p.gridPosition.col);
    const rows = state.pads.map(p => p.gridPosition.row);
    const spanHoles: GridPosition = {
      col: cols.length ? Math.max(...cols) - Math.min(...cols) + 1 : 1,
      row: rows.length ? Math.max(...rows) - Math.min(...rows) + 1 : 1,
    };

    const footprint: ComponentFootprint = {
      type: 'through_hole',
      pads: state.pads,
      silkscreen: [],
      spanHoles,
    };

    const model3d: Model3D = {
      type: 'parametric',
      shape: (state.model3dShape || 'custom') as any,
      params: state.model3dParams || { pinCount: state.pins.length },
    };

    // Build pin mapping: pin number -> pad number
    const pinMapping: Record<string, string> = {};
    state.pins.forEach(pin => {
      const pinKey = pin.id ?? pin.number;
      const padKey = state.pinToPad[pinKey];
      if (padKey) {
        const pad = state.pads.find(p => (p.id ?? p.number) === padKey);
        if (pad) {
          pinMapping[pin.number] = pad.number;
        }
      }
    });

    const def: ComponentDefinition = {
      id: `custom_${uuid()}`,
      name: state.name,
      prefix: state.prefix,
      category: state.category,
      description: state.description,
      keywords: [state.name.toLowerCase(), state.category.toLowerCase()],
      symbol,
      footprint,
      model3d,
      pinMapping,
      spiceModel: state.spiceModel || undefined,
      spiceTemplate: state.spiceTemplate || undefined,
      defaultProperties: Object.keys(state.defaultProperties).length > 0 ? state.defaultProperties : undefined,
    };

    addCustomComponent(def);

    // Show success and reset
    setStep('template');
    setState({ ...defaultState });
    setSelectedTemplate(null);
  }, [state, addCustomComponent]);

  // Import / Export
  const handleExport = useCallback(() => {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.name || 'component').replace(/\s+/g, '_')}.lccomp`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lccomp,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string) as EditorState;
          setState(data);
          setSelectedTemplate(TEMPLATES.find(t => t.id === data.templateId) || TEMPLATES[TEMPLATES.length - 1]);
          setStep('preview');
        } catch {
          alert('Ungültiges Dateiformat');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  return (
    <div className="flex-1 flex flex-col bg-lochcad-bg text-lochcad-text overflow-hidden min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-lochcad-surface border-b border-lochcad-panel/30 shrink-0">
        <button
          onClick={() => {
            if (step === 'template') {
              setCurrentView('schematic');
            } else {
              setStep('template');
              setSelectedTemplate(null);
              setState({ ...defaultState });
            }
          }}
          className="btn-icon text-lochcad-text-dim hover:text-lochcad-text"
          title={step === 'template' ? 'Bauteil-Editor verlassen' : 'Zurück zur Vorlagenauswahl'}
        >
          <ArrowLeft size={16} />
        </button>
        <Package size={16} className="text-lochcad-accent" />
        <h2 className="text-sm font-bold">Bauteil-Editor</h2>

        {/* Step indicator — styled like view tabs */}
        <div className="flex items-center ml-2 border-l border-lochcad-panel/30 pl-2">
          {(['template', 'configure', 'preview'] as CreatorStep[]).map((s, idx) => {
            const labels = ['Vorlage', 'Konfigurieren', 'Vorschau'];
            const stepIdx = ['template', 'configure', 'preview'].indexOf(step);
            const isActive = step === s;
            const isDone = stepIdx > idx;
            return (
              <button
                key={s}
                onClick={() => {
                  if (isDone) {
                    setStep(s);
                  }
                }}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'text-lochcad-accent'
                    : isDone
                      ? 'text-lochcad-text-dim hover:text-lochcad-text cursor-pointer'
                      : 'text-lochcad-text-dim/40 cursor-default'
                }`}
              >
                <span className={`flex items-center justify-center w-4 h-4 rounded text-[9px] font-bold ${
                  isActive
                    ? 'bg-lochcad-accent text-white'
                    : isDone
                      ? 'bg-lochcad-accent/20 text-lochcad-accent'
                      : 'bg-lochcad-panel/30 text-lochcad-text-dim/50'
                }`}>
                  {isDone ? '✓' : idx + 1}
                </span>
                {labels[idx]}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-lochcad-accent rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        <button onClick={handleImport} className="btn btn-ghost text-xs" title="Bauteil importieren">
          <Upload size={14} /> Importieren
        </button>
        {step === 'preview' && (
          <button onClick={handleExport} className="btn btn-ghost text-xs" title="Bauteil exportieren">
            <Download size={14} /> Exportieren
          </button>
        )}
      </div>

      {/* Body — step content */}
      {step === 'template' && (
        <TemplateSelection onSelect={handleTemplateSelect} />
      )}
      {step === 'configure' && selectedTemplate && (
        <ConfigurationForm
          state={state}
          setState={setState}
          template={selectedTemplate}
          onBack={() => setStep('template')}
          onNext={handleGoToPreview}
        />
      )}
      {step === 'preview' && selectedTemplate && (
        <PreviewStep
          state={state}
          setState={setState}
          template={selectedTemplate}
          onBack={() => setStep('configure')}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

export default ComponentEditor;
