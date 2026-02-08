// ============================================================
// ComponentEditor — Create/edit custom components
// Symbol editor + Footprint editor + Pin mapping + 3D + SPICE
// ============================================================

import React, { useState, useCallback, useMemo, useRef } from 'react';
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
} from '@/types';
import { useProjectStore } from '@/stores/projectStore';
import { COLORS, SCHEMATIC_GRID, PERFBOARD_GRID } from '@/constants';

type SymbolDrawTool = 'select' | 'line' | 'rect' | 'circle' | 'polyline' | 'text' | 'pin';
type FootprintTool = 'select' | 'add_pad' | 'move' | 'delete';

const CANVAS_SIZE = 600;
const SYM_GRID = 10;

interface EditorState {
  name: string;
  prefix: string;
  category: string;
  description: string;
  // Symbol graphics (unified)
  graphics: SymbolGraphic[];
  pins: PinDefinition[];
  // Footprint
  pads: FootprintPad[];
  footprintOutline: Point[];
  // Pin mapping
  pinToPad: Record<string, string>;
  // Properties
  defaultProperties: Record<string, string>;
  // SPICE
  spiceModel: string;
  spiceTemplate: string;
}

const defaultState: EditorState = {
  name: 'New Component',
  prefix: 'U',
  category: 'Custom',
  description: '',
  graphics: [],
  pins: [],
  pads: [],
  footprintOutline: [],
  pinToPad: {},
  defaultProperties: {},
  spiceModel: '',
  spiceTemplate: '',
};

// ---- Symbol Canvas ----

interface SymbolCanvasProps {
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
}

function SymbolCanvas({ state, setState }: SymbolCanvasProps) {
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

    const p = snapToGrid(pos.x, pos.y);

    switch (tool) {
      case 'line':
        if (drawing.length === 0) {
          setDrawing([p]);
        } else {
          const newLine: SymbolLine = {
            type: 'line',
            start: drawing[0],
            end: p,
            strokeWidth: 2,
          };
          setState(prev => ({ ...prev, graphics: [...prev.graphics, newLine] }));
          setDrawing([]);
        }
        break;

      case 'rect':
        if (drawing.length === 0) {
          setDrawing([p]);
        } else {
          const newRect: SymbolRectangle = {
            type: 'rectangle',
            start: drawing[0],
            end: p,
            strokeWidth: 2,
          };
          setState(prev => ({ ...prev, graphics: [...prev.graphics, newRect] }));
          setDrawing([]);
        }
        break;

      case 'circle':
        if (drawing.length === 0) {
          setDrawing([p]);
        } else {
          const r = Math.sqrt(
            Math.pow(p.x - drawing[0].x, 2) + Math.pow(p.y - drawing[0].y, 2)
          );
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

      case 'pin':
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
        setState(prev => ({ ...prev, pins: [...prev.pins, newPin] }));
        break;
    }
  }, [tool, drawing, state.pins.length, setState]);

  const tools: { id: SymbolDrawTool; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <Move size={16} />, label: 'Auswählen' },
    { id: 'line', icon: <Minus size={16} />, label: 'Linie' },
    { id: 'rect', icon: <Square size={16} />, label: 'Rechteck' },
    { id: 'circle', icon: <CircleIcon size={16} />, label: 'Kreis' },
    { id: 'pin', icon: <Pin size={16} />, label: 'Pin' },
  ];

  // Helper to render a graphic
  const renderGraphic = (g: SymbolGraphic, i: number) => {
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
        return <Line key={`g-${i}`} points={g.points.flatMap(p => [p.x, p.y])} stroke={COLORS.componentBody} strokeWidth={g.strokeWidth ?? 2} closed={g.closed} />;
      default:
        return null;
    }
  };

  return (
    <div>
      <div className="flex gap-1 mb-2">
        {tools.map(t => (
          <button
            key={t.id}
            onClick={() => { setTool(t.id); setDrawing([]); }}
            className={`tool-btn ${tool === t.id ? 'active bg-lochcad-accent text-white' : 'bg-lochcad-surface text-gray-300'}`}
            title={t.label}
          >
            {t.icon}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setState(prev => ({ ...prev, graphics: prev.graphics.slice(0, -1) }))}
          className="tool-btn bg-lochcad-surface text-gray-300 hover:text-red-400"
          title="Rückgängig"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="border border-gray-700 rounded overflow-hidden">
        <Stage
          width={CANVAS_SIZE}
          height={400}
          onClick={handleClick}
          style={{ background: '#232838' }}
        >
          <Layer>
            {/* Grid */}
            {Array.from({ length: Math.ceil(CANVAS_SIZE / SYM_GRID) }).map((_, i) => (
              <React.Fragment key={i}>
                <Line points={[i * SYM_GRID, 0, i * SYM_GRID, 400]} stroke="#2a2f40" strokeWidth={0.5} />
                <Line points={[0, i * SYM_GRID, CANVAS_SIZE, i * SYM_GRID]} stroke="#2a2f40" strokeWidth={0.5} />
              </React.Fragment>
            ))}

            {/* Origin crosshair */}
            <Line points={[CANVAS_SIZE / 2, 0, CANVAS_SIZE / 2, 400]} stroke="#444" strokeWidth={1} dash={[4, 4]} />
            <Line points={[0, 200, CANVAS_SIZE, 200]} stroke="#444" strokeWidth={1} dash={[4, 4]} />

            {/* Graphics */}
            {state.graphics.map((g, i) => renderGraphic(g, i))}

            {/* Pins */}
            {state.pins.map((pin) => (
              <Group key={pin.id ?? pin.number}>
                <Line
                  points={[pin.position.x, pin.position.y, pin.position.x - pin.length, pin.position.y]}
                  stroke={COLORS.componentPin}
                  strokeWidth={1.5}
                />
                <Circle
                  x={pin.position.x - pin.length}
                  y={pin.position.y}
                  radius={3}
                  fill={COLORS.junction}
                />
                <Text
                  x={pin.position.x + 4}
                  y={pin.position.y - 6}
                  text={pin.name}
                  fill={COLORS.componentText}
                  fontSize={10}
                />
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

            {/* Drawing preview */}
            {drawing.length > 0 && (
              <Circle
                x={drawing[0].x}
                y={drawing[0].y}
                radius={3}
                fill={COLORS.selected}
              />
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

// ---- Footprint Canvas ----

interface FootprintCanvasProps {
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
}

function FootprintCanvas({ state, setState }: FootprintCanvasProps) {
  const [tool, setTool] = useState<FootprintTool>('add_pad');
  const GRID = 20;
  const FP_SIZE = 400;

  const handleClick = useCallback((e: any) => {
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const col = Math.round(pos.x / GRID);
    const row = Math.round(pos.y / GRID);

    if (tool === 'add_pad') {
      // Check if pad exists at this position
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
    } else if (tool === 'delete') {
      setState(prev => ({
        ...prev,
        pads: prev.pads.filter(p => !(p.gridPosition.col === col && p.gridPosition.row === row)),
      }));
    }
  }, [tool, state.pads, setState]);

  return (
    <div>
      <div className="flex gap-1 mb-2">
        <button
          onClick={() => setTool('add_pad')}
          className={`tool-btn ${tool === 'add_pad' ? 'bg-lochcad-accent text-white' : 'bg-lochcad-surface text-gray-300'}`}
          title="Pad hinzufügen"
        >
          <Plus size={16} />
        </button>
        <button
          onClick={() => setTool('delete')}
          className={`tool-btn ${tool === 'delete' ? 'bg-red-600 text-white' : 'bg-lochcad-surface text-gray-300'}`}
          title="Pad löschen"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="border border-gray-700 rounded overflow-hidden">
        <Stage
          width={FP_SIZE}
          height={FP_SIZE}
          onClick={handleClick}
          style={{ background: '#2d1b0e' }}
        >
          <Layer>
            {/* Grid */}
            {Array.from({ length: Math.ceil(FP_SIZE / GRID) + 1 }).map((_, i) => (
              <React.Fragment key={i}>
                <Line points={[i * GRID, 0, i * GRID, FP_SIZE]} stroke="#5a3a1e" strokeWidth={0.5} />
                <Line points={[0, i * GRID, FP_SIZE, i * GRID]} stroke="#5a3a1e" strokeWidth={0.5} />
              </React.Fragment>
            ))}

            {/* Holes */}
            {Array.from({ length: Math.ceil(FP_SIZE / GRID) + 1 }).flatMap((_, r) =>
              Array.from({ length: Math.ceil(FP_SIZE / GRID) + 1 }).map((_, c) => (
                <Circle
                  key={`h-${c}-${r}`}
                  x={c * GRID}
                  y={r * GRID}
                  radius={3}
                  fill="#1b1f2b"
                  stroke="#8B7355"
                  strokeWidth={0.5}
                />
              ))
            )}

            {/* Pads */}
            {state.pads.map(pad => (
              <Group key={pad.id ?? pad.number}>
                <Circle
                  x={pad.gridPosition.col * GRID}
                  y={pad.gridPosition.row * GRID}
                  radius={8}
                  fill={COLORS.copperPad}
                  stroke={COLORS.copper}
                  strokeWidth={1}
                />
                <Circle
                  x={pad.gridPosition.col * GRID}
                  y={pad.gridPosition.row * GRID}
                  radius={3}
                  fill="#1b1f2b"
                />
                <Text
                  x={pad.gridPosition.col * GRID - 4}
                  y={pad.gridPosition.row * GRID + 10}
                  text={pad.label ?? pad.number}
                  fill="#ffffff"
                  fontSize={9}
                  align="center"
                />
              </Group>
            ))}
          </Layer>
        </Stage>
      </div>
    </div>
  );
}

// ---- Pin Mapping Panel ----

interface PinMappingPanelProps {
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
}

function PinMappingPanel({ state, setState }: PinMappingPanelProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-bold text-gray-200">Pin-zu-Pad Zuordnung</h4>
      {state.pins.length === 0 && (
        <p className="text-xs text-gray-500">Keine Pins definiert. Zeichnen Sie Pins im Symboleditor.</p>
      )}
      {state.pins.map(pin => {
        const pinKey = pin.id ?? pin.number;
        return (
        <div key={pinKey} className="flex items-center gap-2 text-xs">
          <span className="text-gray-300 w-20 truncate" title={pin.name}>
            {pin.number}: {pin.name}
          </span>
          <span className="text-gray-500">→</span>
          <select
            className="input text-xs py-0.5 flex-1"
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
        </div>
        );
      })}
    </div>
  );
}

// ---- Main Component Editor ----

const ComponentEditor: React.FC = () => {
  const [state, setState] = useState<EditorState>({ ...defaultState });
  const [activeTab, setActiveTab] = useState<'symbol' | 'footprint' | 'mapping' | 'spice'>('symbol');
  const addCustomComponent = useProjectStore(s => s.addCustomComponent);

  const handleSave = useCallback(() => {
    const symbol: ComponentSymbol = {
      graphics: state.graphics,
      pins: state.pins,
    };

    // Calculate footprint span from pads
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
      shape: 'ic_dip',
      params: { pinCount: state.pins.length },
    };

    const def: ComponentDefinition = {
      id: `custom_${uuid()}`,
      name: state.name,
      prefix: state.prefix,
      category: state.category,
      description: state.description,
      symbol,
      footprint,
      model3d,
      pinMapping: state.pinToPad,
      spiceModel: state.spiceModel || undefined,
      spiceTemplate: state.spiceTemplate || undefined,
      defaultProperties: state.defaultProperties,
    };

    addCustomComponent(def);
    alert(`Bauteil "${state.name}" wurde gespeichert!`);
  }, [state, addCustomComponent]);

  const handleExport = useCallback(() => {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.name.replace(/\s+/g, '_')}.lccomp`;
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
        } catch {
          alert('Ungültige Datei');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const tabs = [
    { id: 'symbol' as const, label: 'Symbol' },
    { id: 'footprint' as const, label: 'Footprint' },
    { id: 'mapping' as const, label: 'Pin-Mapping' },
    { id: 'spice' as const, label: 'SPICE' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-lochcad-bg text-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-lochcad-surface border-b border-gray-700">
        <h2 className="text-sm font-bold">Bauteil-Editor</h2>
        <div className="flex-1" />
        <button onClick={handleImport} className="btn text-xs flex items-center gap-1" title="Importieren">
          <Upload size={14} /> Import
        </button>
        <button onClick={handleExport} className="btn text-xs flex items-center gap-1" title="Exportieren">
          <Download size={14} /> Export
        </button>
        <button onClick={handleSave} className="btn bg-lochcad-accent text-white text-xs flex items-center gap-1">
          <Save size={14} /> Speichern
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Properties */}
        <div className="w-64 bg-lochcad-surface border-r border-gray-700 p-3 overflow-y-auto space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Name</label>
            <input
              className="input w-full text-sm"
              value={state.name}
              onChange={e => setState(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Präfix</label>
            <input
              className="input w-full text-sm"
              value={state.prefix}
              placeholder="R, C, U, ..."
              onChange={e => setState(prev => ({ ...prev, prefix: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Kategorie</label>
            <select
              className="input w-full text-sm"
              value={state.category}
              onChange={e => setState(prev => ({ ...prev, category: e.target.value }))}
            >
              {['Custom', 'Resistors', 'Capacitors', 'ICs', 'Connectors', 'Transistors', 'Diodes', 'LEDs', 'Switches', 'Crystals', 'Power'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Beschreibung</label>
            <textarea
              className="input w-full text-xs h-16 resize-none"
              value={state.description}
              onChange={e => setState(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <hr className="border-gray-700" />

          {/* Stats */}
          <div className="text-xs space-y-1 text-gray-400">
            <div>Pins: <span className="text-white">{state.pins.length}</span></div>
            <div>Pads: <span className="text-white">{state.pads.length}</span></div>
            <div>Symbol-Elemente: <span className="text-white">
              {state.graphics.length}
            </span></div>
          </div>

          <hr className="border-gray-700" />

          {/* Pins list */}
          <h4 className="text-xs font-bold text-gray-300">Pins</h4>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {state.pins.map((pin, i) => (
              <div key={pin.id ?? pin.number} className="flex items-center gap-1 text-xs">
                <span className="text-gray-500 w-5">{pin.number}</span>
                <input
                  className="input text-xs py-0 flex-1"
                  value={pin.name}
                  onChange={e => {
                    setState(prev => {
                      const pins = [...prev.pins];
                      pins[i] = { ...pins[i], name: e.target.value };
                      return { ...prev, pins };
                    });
                  }}
                />
                <select
                  className="input text-xs py-0 w-20"
                  value={pin.electricalType}
                  onChange={e => {
                    setState(prev => {
                      const pins = [...prev.pins];
                      pins[i] = { ...pins[i], electricalType: e.target.value as any };
                      return { ...prev, pins };
                    });
                  }}
                >
                  <option value="passive">Passiv</option>
                  <option value="input">Input</option>
                  <option value="output">Output</option>
                  <option value="bidirectional">Bidir.</option>
                  <option value="power_in">Power In</option>
                  <option value="power_out">Power Out</option>
                </select>
                <button
                  onClick={() => setState(prev => ({
                    ...prev,
                    pins: prev.pins.filter(p => (p.id ?? p.number) !== (pin.id ?? pin.number)),
                  }))}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Canvas area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-700 bg-lochcad-bg">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-lochcad-accent border-b-2 border-lochcad-accent'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {activeTab === 'symbol' && (
              <div>
                <p className="text-xs text-gray-400 mb-2">
                  Zeichnen Sie das Schaltplansymbol. Klicken Sie für Start- und Endpunkte.
                  Verwenden Sie das Pin-Werkzeug, um Anschlüsse hinzuzufügen.
                </p>
                <SymbolCanvas state={state} setState={setState} />
              </div>
            )}

            {activeTab === 'footprint' && (
              <div>
                <p className="text-xs text-gray-400 mb-2">
                  Definieren Sie den Footprint auf dem Lochraster. Klicken Sie auf Löcher, um Pads zu platzieren.
                </p>
                <FootprintCanvas state={state} setState={setState} />
              </div>
            )}

            {activeTab === 'mapping' && (
              <div>
                <p className="text-xs text-gray-400 mb-2">
                  Ordnen Sie jeden Schaltplan-Pin einem Footprint-Pad zu.
                </p>
                <PinMappingPanel state={state} setState={setState} />
              </div>
            )}

            {activeTab === 'spice' && (
              <div className="space-y-4">
                <p className="text-xs text-gray-400">
                  SPICE-Modell und -Vorlage für die Simulation.
                </p>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">SPICE-Modell (.model / .subckt)</label>
                  <textarea
                    className="input w-full h-32 font-mono text-xs resize-none"
                    value={state.spiceModel}
                    placeholder=".model MyDiode D(Is=1e-14 N=1.08 Rs=0.5)"
                    onChange={e => setState(prev => ({ ...prev, spiceModel: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">SPICE-Vorlage (Netzliste)</label>
                  <textarea
                    className="input w-full h-20 font-mono text-xs resize-none"
                    value={state.spiceTemplate}
                    placeholder="D{ref} {1} {2} MyDiode"
                    onChange={e => setState(prev => ({ ...prev, spiceTemplate: e.target.value }))}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComponentEditor;
