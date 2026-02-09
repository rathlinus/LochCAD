import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { getBuiltInComponents, getAdjustedFootprint } from '@/lib/component-library';
import type { ComponentDefinition, SchematicComponent, PerfboardComponent } from '@/types';
import { BOARD_SIZE_PRESETS, COLORS } from '@/constants';
import { Settings, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { validateComponentValue, formatValue, unitForCategory } from '@/lib/units';
import { buildNetlist } from '@/lib/engine/netlist';

/** German labels for common property keys */
const PROPERTY_LABELS: Record<string, string> = {
  value: 'Wert',
  tolerance: 'Toleranz',
  power: 'Leistung',
  voltage: 'Spannung',
  forwardVoltage: 'Vorwärtsspannung',
  maxCurrent: 'Max. Strom',
  color: 'Farbe',
  frequency: 'Frequenz',
  holeSpan: 'Lochabstand',
};

/** Common value presets per property key */
const VALUE_PRESETS: Record<string, string[]> = {
  tolerance: ['1%', '2%', '5%', '10%', '20%'],
  power: ['0.125W', '0.25W', '0.5W', '1W', '2W', '5W'],
  voltage: ['5V', '10V', '16V', '25V', '35V', '50V', '63V', '100V', '250V', '400V'],
  forwardVoltage: ['1.8V', '2.0V', '2.2V', '3.0V', '3.3V'],
  maxCurrent: ['10mA', '20mA', '30mA', '50mA'],
  color: ['Red', 'Green', 'Blue', 'Yellow', 'White', 'Orange', 'UV', 'IR'],
};

/** Components that support adjustable hole span (2-pin axial/radial) */
const ADJUSTABLE_SPAN_IDS = new Set([
  'resistor_axial', 'capacitor_ceramic', 'capacitor_electrolytic',
  'inductor', 'diode', 'crystal', 'switch_spst',
]);

/** Min/max hole spans per component type */
const SPAN_RANGE: Record<string, { min: number; max: number; default: number }> = {
  resistor_axial: { min: 3, max: 8, default: 5 },
  capacitor_ceramic: { min: 2, max: 6, default: 3 },
  capacitor_electrolytic: { min: 2, max: 6, default: 3 },
  inductor: { min: 3, max: 8, default: 5 },
  diode: { min: 3, max: 7, default: 4 },
  crystal: { min: 2, max: 6, default: 3 },
  switch_spst: { min: 2, max: 5, default: 3 },
};

export function PropertiesPanel() {
  const currentView = useProjectStore((s) => s.currentView);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`bg-lochcad-surface border-l border-lochcad-panel/30 flex flex-col shrink-0 transition-all ${collapsed ? 'w-8' : 'w-56'}`}>
      <button
        className="panel-header cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        {!collapsed && (
          <>
            <Settings size={14} />
            <span>Eigenschaften</span>
          </>
        )}
      </button>

      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {currentView === 'schematic' && <SchematicProperties />}
          {currentView === 'perfboard' && <PerfboardProperties />}
          {currentView === 'preview3d' && <Preview3DProperties />}
          {currentView === 'component-editor' && <ComponentEditorProperties />}
        </div>
      )}
    </div>
  );
}

/** Renders either a <select> with presets or a plain <input> for a property */
function PropertyInput({
  propKey,
  value,
  onChange,
}: {
  propKey: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const presets = VALUE_PRESETS[propKey];
  if (presets) {
    const isCustom = !presets.includes(value);
    return (
      <select
        className="input w-full"
        value={isCustom ? '__custom__' : value}
        onChange={(e) => {
          if (e.target.value === '__custom__') return;
          onChange(e.target.value);
        }}
      >
        {isCustom && <option value="__custom__">{value}</option>}
        {presets.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="input w-full"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Value input with real-time validation and normalisation hint */
function ValueInput({
  comp,
  libComp,
  updateValue,
}: {
  comp: SchematicComponent;
  libComp: ComponentDefinition | undefined;
  updateValue: (id: string, value: string) => void;
}) {
  const category = libComp?.category ?? '';
  const validation = useMemo(
    () => validateComponentValue(comp.value, category),
    [comp.value, category],
  );

  return (
    <div className="space-y-1">
      <label className="input-label">Wert</label>
      <input
        className={`input w-full ${
          !validation.valid
            ? 'border-red-500/60 focus:ring-red-500/40'
            : validation.warning
            ? 'border-yellow-500/60 focus:ring-yellow-500/40'
            : ''
        }`}
        value={comp.value}
        onChange={(e) => updateValue(comp.id, e.target.value)}
      />
      {/* Validation feedback */}
      {validation.valid && validation.normalized && validation.normalized !== comp.value && (
        <button
          className="text-[10px] text-lochcad-accent hover:underline cursor-pointer flex items-center gap-1"
          onClick={() => updateValue(comp.id, validation.normalized!)}
          title="Klick zum Übernehmen"
        >
          <CheckCircle2 size={10} /> → {validation.normalized}
        </button>
      )}
      {validation.warning && (
        <div className="text-[10px] text-yellow-400 flex items-center gap-1">
          <AlertTriangle size={10} /> {validation.warning}
        </div>
      )}
      {!validation.valid && validation.error && (
        <div className="text-[10px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={10} /> {validation.error}
        </div>
      )}
    </div>
  );
}

/** Hole-span selector for 2-pin axial/radial components */
function HoleSpanInput({
  comp,
  libComp,
  updateProperty,
}: {
  comp: SchematicComponent;
  libComp: ComponentDefinition;
  updateProperty: (id: string, key: string, value: string) => void;
}) {
  const rangeInfo = SPAN_RANGE[comp.libraryId];
  if (!rangeInfo) return null;

  const currentSpan = comp.properties.holeSpan
    ? parseInt(comp.properties.holeSpan, 10)
    : rangeInfo.default;

  const options: number[] = [];
  for (let i = rangeInfo.min; i <= rangeInfo.max; i++) options.push(i);

  return (
    <div className="space-y-1">
      <label className="input-label">Lochabstand (Löcher)</label>
      <select
        className="input w-full"
        value={currentSpan}
        onChange={(e) => updateProperty(comp.id, 'holeSpan', e.target.value)}
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n} Löcher ({((n - 1) * 2.54).toFixed(2)} mm)
          </option>
        ))}
      </select>
    </div>
  );
}

function SchematicProperties() {
  const selection = useSchematicStore((s) => s.selection);
  const schematic = useProjectStore((s) => s.project.schematic);
  const netColors = useProjectStore((s) => s.project.netColors) ?? {};
  const { updateComponentValue, updateComponentRef, updateComponentProperty } = useSchematicStore();

  if (selection.componentIds.length === 0) {
    return (
      <div className="p-2 space-y-2">
        <div className="text-xs text-lochcad-text-dim pb-1">
          Wähle ein Bauteil aus, um seine Eigenschaften zu bearbeiten.
        </div>
        <NetColorManager />
      </div>
    );
  }

  if (selection.componentIds.length === 1) {
    const comp = schematic.components.find((c) => c.id === selection.componentIds[0]);
    if (!comp) return null;

    const allComponents = [...getBuiltInComponents(), ...useProjectStore.getState().project.componentLibrary];
    const libComp = allComponents.find((c) => c.id === comp.libraryId);

    // Separate "value" key from the other properties (value is already its own field)
    const extraProps = Object.entries(comp.properties).filter(([k]) => k !== 'value');
    const showHoleSpan = ADJUSTABLE_SPAN_IDS.has(comp.libraryId);

    return (
      <div className="p-2 space-y-2">
        <div className="text-xs font-semibold text-lochcad-accent">{libComp?.name ?? 'Unbekannt'}</div>

        {/* Reference */}
        <div className="space-y-1">
          <label className="input-label">Referenz</label>
          <input
            className="input w-full"
            value={comp.reference}
            onChange={(e) => updateComponentRef(comp.id, e.target.value)}
          />
        </div>

        {/* Value with validation */}
        <ValueInput comp={comp} libComp={libComp} updateValue={updateComponentValue} />

        {/* Divider */}
        {extraProps.length > 0 && (
          <div className="border-t border-lochcad-panel/30 pt-1 mt-1">
            <div className="text-[10px] font-semibold text-lochcad-text-dim uppercase tracking-wider mb-1">
              Eigenschaften
            </div>
          </div>
        )}

        {/* All editable extra properties */}
        {extraProps.map(([key, value]) => {
          if (key === 'holeSpan') return null; // rendered separately below
          const label = PROPERTY_LABELS[key] ?? key;
          return (
            <div key={key} className="space-y-1">
              <label className="input-label">{label}</label>
              <PropertyInput
                propKey={key}
                value={value}
                onChange={(v) => updateComponentProperty(comp.id, key, v)}
              />
            </div>
          );
        })}

        {/* Hole span selector */}
        {showHoleSpan && libComp && (
          <HoleSpanInput
            comp={comp}
            libComp={libComp}
            updateProperty={updateComponentProperty}
          />
        )}

        {/* Position & Rotation (read-only) */}
        <div className="border-t border-lochcad-panel/30 pt-1 mt-1">
          <div className="text-[10px] font-semibold text-lochcad-text-dim uppercase tracking-wider mb-1">
            Layout
          </div>
        </div>

        <div className="space-y-1">
          <label className="input-label">Position</label>
          <div className="text-xs text-lochcad-text-dim">
            X: {comp.position.x} Y: {comp.position.y}
          </div>
        </div>

        <div className="space-y-1">
          <label className="input-label">Rotation</label>
          <div className="text-xs text-lochcad-text-dim">{comp.rotation}°</div>
        </div>

        {/* Footprint info */}
        {libComp?.footprint && (() => {
          const { pads: adjPads, spanHoles: adjSpan } = getAdjustedFootprint(libComp, comp.properties.holeSpan);
          return (
            <div className="space-y-1">
              <label className="input-label">Footprint</label>
              <div className="text-xs text-lochcad-text-dim">
                {adjPads.length} Pads, Span: {adjSpan.col}×{adjSpan.row}
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  return (
    <div className="p-3 text-xs text-lochcad-text-dim">
      {selection.componentIds.length} Bauteile ausgewählt
    </div>
  );
}

/** Swatch palette for the custom color picker */
const COLOR_SWATCHES = [
  // Row 1 — vivid
  '#ff4444', '#ff8800', '#ffcc00', '#44cc44', '#00ff88', '#00cccc',
  '#4488ff', '#aa44ff', '#ff66b2', '#ffffff', '#c0c0c0', '#888888',
  // Row 2 — muted/dark
  '#cc2222', '#cc6600', '#aa8800', '#228822', '#00aa66', '#008888',
  '#2266cc', '#7722cc', '#cc4488', '#444444', '#222222', '#000000',
];

/** Default wire color (the standard green) */
const DEFAULT_NET_COLOR = '#00ff88';

/** Well-known net names mapped to a sensible default color */
const KNOWN_NET_COLORS: Record<string, string> = {
  VCC: '#ff4444', '+5V': '#ff4444', '+3.3V': '#ff6644', '+12V': '#ff8800',
  GND: '#444444', CLK: '#aa44ff', SCL: '#4488ff', SDA: '#44cc44',
};

// ---- Inline Color Picker (dropdown) ----

function ColorPickerPopup({
  color,
  onChange,
  onClose,
}: {
  color: string;
  onChange: (c: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState(color);

  // Sync external color changes
  useEffect(() => setHex(color), [color]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const applyHex = () => {
    const clean = hex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) onChange(clean);
    else if (/^[0-9a-fA-F]{6}$/.test(clean)) onChange('#' + clean);
  };

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 z-50 bg-lochcad-surface border border-lochcad-panel/40 rounded-md shadow-lg p-1.5 w-[186px]"
    >
      {/* Swatch grid */}
      <div className="grid grid-cols-6 gap-0.5 mb-1.5">
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            className={`w-6 h-6 rounded-sm border-2 transition-transform hover:scale-110 ${
              color === c ? 'border-white scale-110' : 'border-transparent'
            }`}
            style={{ backgroundColor: c }}
            onClick={() => { onChange(c); }}
            title={c}
          />
        ))}
      </div>
      {/* Hex input */}
      <div className="flex items-center gap-1">
        <div
          className="w-6 h-6 rounded-sm border border-white/20 flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <input
          className="input text-[10px] flex-1 font-mono px-1 py-0.5"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={applyHex}
          onKeyDown={(e) => { if (e.key === 'Enter') { applyHex(); onClose(); } }}
          spellCheck={false}
          maxLength={7}
        />
      </div>
    </div>
  );
}

// ---- Net Color Manager ----

function NetColorManager() {
  const schematic = useProjectStore((s) => s.project.schematic);
  const netColors = useProjectStore((s) => s.project.netColors) ?? {};
  const { setNetColor, removeNetColor } = useProjectStore();
  const [expanded, setExpanded] = useState(true);
  const [pickerOpen, setPickerOpen] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');

  const { updateLabel } = useSchematicStore();

  const closePicker = useCallback(() => setPickerOpen(null), []);

  // Compute the netlist to discover all nets
  const computedNetlist = useMemo(() => buildNetlist(schematic), [schematic]);

  // All detected net names — labeled nets first, then auto-named
  const allNets = useMemo(() => {
    const labeled: string[] = [];
    const auto: string[] = [];
    for (const net of computedNetlist.nets) {
      if (net.name.startsWith('Net_')) auto.push(net.name);
      else labeled.push(net.name);
    }
    labeled.sort();
    auto.sort((a, b) => {
      const na = parseInt(a.replace('Net_', ''), 10);
      const nb = parseInt(b.replace('Net_', ''), 10);
      return na - nb;
    });
    return [...labeled, ...auto];
  }, [computedNetlist]);

  // Default color for a net
  const defaultColor = (name: string) => KNOWN_NET_COLORS[name] || DEFAULT_NET_COLOR;

  // Finish renaming a net — updates schematic labels + net color entry
  const finishRename = (oldName: string) => {
    const trimmed = editedName.trim();
    if (trimmed && trimmed !== oldName) {
      // Rename all schematic labels with the old name
      const labels = schematic.labels.filter((l) => l.text === oldName);
      for (const label of labels) {
        updateLabel(label.id, { text: trimmed });
      }
      // Transfer net color to new name
      const oldColor = netColors[oldName];
      if (oldColor) {
        removeNetColor(oldName);
        setNetColor(trimmed, oldColor);
      }
    }
    setEditingName(null);
  };

  const coloredCount = Object.keys(netColors).length;

  return (
    <div className="border-t border-lochcad-panel/30 pt-2">
      <button
        className="text-[10px] font-semibold text-lochcad-text-dim uppercase tracking-wider mb-1 flex items-center gap-1 w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Netzliste
        {coloredCount > 0 && (
          <span className="ml-auto text-lochcad-accent font-normal normal-case">{coloredCount} eingefärbt</span>
        )}
      </button>

      {expanded && (
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {allNets.length === 0 ? (
            <div className="text-[10px] text-lochcad-text-dim px-1 py-1">
              Keine Netze erkannt. Verbinde Bauteile mit Leitungen.
            </div>
          ) : (
            allNets.map((name) => {
              const color = netColors[name];
              const isColored = !!color;
              return (
                <div
                  key={name}
                  className={`flex items-center gap-1.5 px-1 py-0.5 rounded relative ${
                    isColored ? 'bg-lochcad-panel/15' : 'hover:bg-lochcad-panel/10'
                  } group`}
                >
                  {/* Color swatch — click to open picker or assign default color */}
                  {isColored ? (
                    <button
                      className="w-4 h-4 rounded-sm flex-shrink-0 border border-white/20 hover:border-white transition-colors"
                      style={{ backgroundColor: color }}
                      onClick={() => setPickerOpen(pickerOpen === name ? null : name)}
                      title="Farbe anpassen"
                    />
                  ) : (
                    <button
                      className="w-4 h-4 rounded-sm border border-dashed border-lochcad-text-dim/30 flex-shrink-0 hover:border-lochcad-accent transition-colors"
                      style={{ backgroundColor: 'transparent' }}
                      onClick={() => setNetColor(name, defaultColor(name))}
                      title="Farbe zuweisen"
                    />
                  )}

                  {/* Net name — double-click to rename */}
                  {editingName === name ? (
                    <input
                      className="input text-[10px] flex-1 py-0 px-1 min-w-0"
                      value={editedName}
                      onChange={(e) => setEditedName(e.target.value)}
                      onBlur={() => finishRename(name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename(name);
                        if (e.key === 'Escape') setEditingName(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      className={`text-[10px] flex-1 truncate select-none cursor-text ${
                        isColored ? 'text-lochcad-text font-medium' : 'text-lochcad-text-dim'
                      }`}
                      style={isColored ? { color } : undefined}
                      onDoubleClick={() => {
                        setEditingName(name);
                        setEditedName(name);
                      }}
                      title="Doppelklick zum Umbenennen"
                    >
                      {name}
                    </span>
                  )}

                  {/* Remove button */}
                  {isColored && (
                    <button
                      className="text-[10px] text-lochcad-error opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={() => { removeNetColor(name); setPickerOpen(null); }}
                      title="Farbe entfernen"
                    >
                      ✕
                    </button>
                  )}

                  {/* Color picker popup */}
                  {pickerOpen === name && isColored && (
                    <ColorPickerPopup
                      color={color}
                      onChange={(c) => setNetColor(name, c)}
                      onClose={closePicker}
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


function PerfboardProperties() {
  const perfboard = useProjectStore((s) => s.project.perfboard);
  const { setBoardConfig } = useProjectStore();
  const selectedIds = usePerfboardStore((s) => s.selectedIds);

  return (
    <div className="p-2 space-y-3">
      <div className="text-xs font-semibold text-lochcad-text">Board-Einstellungen</div>

      <div className="space-y-1">
        <label className="input-label">Board-Typ</label>
        <select
          className="input w-full"
          value={perfboard.boardType}
          onChange={(e) => setBoardConfig({ boardType: e.target.value as 'perfboard' | 'stripboard' })}
        >
          <option value="perfboard">Lochraster</option>
          <option value="stripboard">Streifenraster</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="input-label">Vorlagen</label>
        <select
          className="input w-full"
          onChange={(e) => {
            const preset = BOARD_SIZE_PRESETS[+e.target.value];
            if (preset) setBoardConfig({ width: preset.width, height: preset.height });
          }}
        >
          {BOARD_SIZE_PRESETS.map((p, i) => (
            <option key={i} value={i}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="input-label">Breite</label>
          <input
            className="input w-full"
            type="number"
            min={5}
            max={100}
            value={perfboard.width}
            onChange={(e) => setBoardConfig({ width: +e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="input-label">Höhe</label>
          <input
            className="input w-full"
            type="number"
            min={5}
            max={100}
            value={perfboard.height}
            onChange={(e) => setBoardConfig({ height: +e.target.value })}
          />
        </div>
      </div>

      <div className="text-xs text-lochcad-text-dim">
        Real: {(perfboard.width * 2.54).toFixed(1)} × {(perfboard.height * 2.54).toFixed(1)} mm
      </div>

      {selectedIds.length > 0 && (
        <div className="border-t border-lochcad-panel/30 pt-2 mt-2">
          <div className="text-xs text-lochcad-text-dim">
            {selectedIds.length} Element(e) ausgewählt
          </div>
        </div>
      )}

      <NetColorManager />
    </div>
  );
}

function Preview3DProperties() {
  return (
    <div className="p-3 text-xs text-lochcad-text-dim space-y-2">
      <div className="font-semibold text-lochcad-text">3D Ansicht</div>
      <div>Steuerung:</div>
      <div className="ml-2">
        • Drehen: Linke Maustaste<br />
        • Zoom: Mausrad<br />
        • Verschieben: Rechte Maustaste
      </div>
    </div>
  );
}

function ComponentEditorProperties() {
  return (
    <div className="p-3 text-xs text-lochcad-text-dim">
      Bauteil-Editor Eigenschaften
    </div>
  );
}
