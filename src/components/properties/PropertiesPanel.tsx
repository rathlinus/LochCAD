import React, { useState } from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { getBuiltInComponents, getAdjustedFootprint } from '@/lib/component-library';
import type { ComponentDefinition, SchematicComponent, PerfboardComponent } from '@/types';
import { BOARD_SIZE_PRESETS } from '@/constants';
import { Settings, ChevronDown, ChevronRight } from 'lucide-react';

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
  const { updateComponentValue, updateComponentRef, updateComponentProperty } = useSchematicStore();

  if (selection.componentIds.length === 0) {
    return (
      <div className="p-3 text-xs text-lochcad-text-dim">
        Wähle ein Bauteil aus, um seine Eigenschaften zu bearbeiten.
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

        {/* Value */}
        <div className="space-y-1">
          <label className="input-label">Wert</label>
          <input
            className="input w-full"
            value={comp.value}
            onChange={(e) => updateComponentValue(comp.id, e.target.value)}
          />
        </div>

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
