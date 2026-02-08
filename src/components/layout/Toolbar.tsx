import React, { useState } from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import type { SyncResult } from '@/stores/projectStore';
import type { ToolType, PerfboardToolType } from '@/types';
import {
  MousePointer2,
  Minus,
  Component,
  Type,
  Circle,
  GitBranch,
  ArrowRightLeft,
  FileInput,
  Layers,
  Trash2,
  Ruler,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Scissors,
  RefreshCw,
  ArrowRight,
  X,
} from 'lucide-react';

interface ToolDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
}

const schematicTools: ToolDef[] = [
  { id: 'select', label: 'Auswahl', icon: <MousePointer2 size={18} />, shortcut: 'Esc' },
  { id: 'place_component', label: 'Bauteil', icon: <Component size={18} />, shortcut: '' },
  { id: 'draw_wire', label: 'Draht', icon: <Minus size={18} />, shortcut: 'W' },
  { id: 'draw_bus', label: 'Bus', icon: <GitBranch size={18} />, shortcut: 'B' },
  { id: 'place_label', label: 'Label', icon: <Type size={18} />, shortcut: 'L' },
  { id: 'place_junction', label: 'Knoten', icon: <Circle size={18} /> },
  { id: 'place_bus_entry', label: 'Bus-Abzw.', icon: <ArrowRightLeft size={18} /> },
  { id: 'place_power', label: 'Power', icon: <FileInput size={18} /> },
  { id: 'place_hierarchical_sheet', label: 'Sub-Sheet', icon: <Layers size={18} /> },
  { id: 'delete', label: 'Löschen', icon: <Trash2 size={18} />, shortcut: 'Del' },
];

const perfboardTools: ToolDef[] = [
  { id: 'select', label: 'Auswahl', icon: <MousePointer2 size={18} />, shortcut: 'Esc' },
  { id: 'place_component', label: 'Bauteil', icon: <Component size={18} /> },
  { id: 'draw_wire', label: 'Draht', icon: <Minus size={18} />, shortcut: 'W' },
  { id: 'draw_wire_bridge', label: 'Brücke', icon: <ArrowRightLeft size={18} /> },
  { id: 'draw_solder_bridge', label: 'Löt-Brücke', icon: <Circle size={18} /> },
  { id: 'cut_track', label: 'Track-Cut', icon: <Scissors size={18} /> },
  { id: 'delete', label: 'Löschen', icon: <Trash2 size={18} />, shortcut: 'Del' },
];

export function Toolbar() {
  const currentView = useProjectStore((s) => s.currentView);
  const schematicTool = useSchematicStore((s) => s.activeTool);
  const setSchematicTool = useSchematicStore((s) => s.setActiveTool);
  const perfboardTool = usePerfboardStore((s) => s.activeTool);
  const setPerfboardTool = usePerfboardStore((s) => s.setActiveTool);
  const { undo, redo } = useSchematicStore();
  const schematicViewport = useSchematicStore((s) => s.viewport);
  const setSchematicViewport = useSchematicStore((s) => s.setViewport);
  const [syncPopup, setSyncPopup] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncDirection, setSyncDirection] = useState<'sch2pb' | 'pb2sch' | null>(null);

  if (currentView === 'preview3d') return null;

  const tools = currentView === 'schematic' ? schematicTools : currentView === 'perfboard' ? perfboardTools : [];
  const activeTool = currentView === 'schematic' ? schematicTool : perfboardTool;
  const setTool = currentView === 'schematic'
    ? (t: string) => setSchematicTool(t as ToolType)
    : (t: string) => setPerfboardTool(t as PerfboardToolType);

  if (currentView === 'component-editor') return null;

  return (
    <div className="h-14 bg-lochcad-surface border-b border-lochcad-panel/30 flex items-center px-2 gap-1 shrink-0">
      {/* Tools */}
      <div className="flex items-center gap-0.5">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`tool-btn ${activeTool === tool.id ? 'active' : ''}`}
            onClick={() => setTool(tool.id)}
            data-tooltip={`${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}`}
          >
            {tool.icon}
            <span className="text-[10px] leading-none">{tool.label}</span>
          </button>
        ))}
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-lochcad-panel/30 mx-2" />

      {/* Undo / Redo */}
      {currentView === 'schematic' && (
        <div className="flex items-center gap-0.5">
          <button className="btn-icon" onClick={undo} data-tooltip="Rückgängig (Ctrl+Z)">
            <Undo2 size={16} />
          </button>
          <button className="btn-icon" onClick={redo} data-tooltip="Wiederholen (Ctrl+Y)">
            <Redo2 size={16} />
          </button>
        </div>
      )}

      {/* Separator */}
      <div className="w-px h-8 bg-lochcad-panel/30 mx-2" />

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5">
        <button
          className="btn-icon"
          onClick={() => setSchematicViewport({ scale: Math.min(schematicViewport.scale * 1.2, 5) })}
          data-tooltip="Zoom +"
        >
          <ZoomIn size={16} />
        </button>
        <span className="text-xs text-lochcad-text-dim w-12 text-center">
          {Math.round(schematicViewport.scale * 100)}%
        </span>
        <button
          className="btn-icon"
          onClick={() => setSchematicViewport({ scale: Math.max(schematicViewport.scale / 1.2, 0.1) })}
          data-tooltip="Zoom -"
        >
          <ZoomOut size={16} />
        </button>
        <button
          className="btn-icon"
          onClick={() => setSchematicViewport({ scale: 1, x: 0, y: 0 })}
          data-tooltip="Einpassen"
        >
          <Maximize size={16} />
        </button>
      </div>

      {/* Separator */}
      <div className="w-px h-8 bg-lochcad-panel/30 mx-2" />

      {/* Sync button */}
      <div className="relative">
        <button
          className="btn-icon flex items-center gap-1 px-2"
          onClick={() => { setSyncPopup(!syncPopup); setSyncResult(null); setSyncDirection(null); }}
          data-tooltip="Sync Schaltplan ↔ Lochraster"
        >
          <RefreshCw size={16} />
          <span className="text-[10px]">Sync</span>
        </button>

        {syncPopup && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-lochcad-surface border border-lochcad-panel/50 rounded-lg shadow-xl p-4 w-80">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">Sync</span>
              <button className="btn-icon" onClick={() => setSyncPopup(false)}>
                <X size={14} />
              </button>
            </div>

            {!syncResult ? (
              <div className="space-y-2">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 rounded bg-lochcad-panel/30 hover:bg-lochcad-accent/20 text-xs text-gray-200 transition-colors"
                  onClick={() => {
                    const r = useProjectStore.getState().syncSchematicToPerfboard();
                    setSyncResult(r);
                    setSyncDirection('sch2pb');
                  }}
                >
                  <span className="font-medium">Schaltplan</span>
                  <ArrowRight size={14} />
                  <span className="font-medium">Lochraster</span>
                </button>
                <p className="text-[10px] text-gray-400 ml-1">
                  Bauteile &amp; Referenzen vom Schaltplan ins Lochraster übernehmen.
                </p>

                <button
                  className="w-full flex items-center gap-2 px-3 py-2 rounded bg-lochcad-panel/30 hover:bg-lochcad-accent/20 text-xs text-gray-200 transition-colors"
                  onClick={() => {
                    const r = useProjectStore.getState().syncPerfboardToSchematic();
                    setSyncResult(r);
                    setSyncDirection('pb2sch');
                  }}
                >
                  <span className="font-medium">Lochraster</span>
                  <ArrowRight size={14} />
                  <span className="font-medium">Schaltplan</span>
                </button>
                <p className="text-[10px] text-gray-400 ml-1">
                  Bauteile &amp; Referenzen vom Lochraster in den Schaltplan übernehmen.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium text-lochcad-accent">
                  {syncDirection === 'sch2pb' ? 'Schaltplan → Lochraster' : 'Lochraster → Schaltplan'}
                </div>
                {syncResult.added.length > 0 && (
                  <div className="text-[11px]">
                    <span className="text-green-400">Hinzugefügt:</span>{' '}
                    <span className="text-gray-300">{syncResult.added.join(', ')}</span>
                  </div>
                )}
                {syncResult.updated.length > 0 && (
                  <div className="text-[11px]">
                    <span className="text-yellow-400">Aktualisiert:</span>{' '}
                    <span className="text-gray-300">{syncResult.updated.join(', ')}</span>
                  </div>
                )}
                {syncResult.removed.length > 0 && (
                  <div className="text-[11px]">
                    <span className="text-red-400">Entfernt:</span>{' '}
                    <span className="text-gray-300">{syncResult.removed.join(', ')}</span>
                  </div>
                )}
                {syncResult.added.length === 0 && syncResult.updated.length === 0 && syncResult.removed.length === 0 && (
                  <div className="text-[11px] text-gray-400">Alles synchron — keine Änderungen.</div>
                )}
                <button
                  className="mt-2 px-3 py-1 rounded bg-lochcad-panel/30 hover:bg-lochcad-panel/50 text-xs text-gray-300 transition-colors"
                  onClick={() => { setSyncResult(null); setSyncDirection(null); }}
                >
                  Zurück
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
