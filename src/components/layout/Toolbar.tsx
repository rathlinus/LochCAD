import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import type { SyncResult } from '@/stores/projectStore';
import type { ToolType, PerfboardToolType } from '@/types';
import type { AutoLayoutMode } from '@/lib/engine/auto-layout';
import {
  MousePointer2,
  Minus,
  Type,
  Circle,
  ArrowRightLeft,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Scissors,
  RefreshCw,
  ArrowRight,
  X,
  MoreHorizontal,
  LayoutGrid,
  Cable,
  ChevronDown,
  Eraser,
} from 'lucide-react';

interface ToolDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  group?: string; // for visual grouping
}

const schematicTools: ToolDef[] = [
  { id: 'select', label: 'Auswahl', icon: <MousePointer2 size={18} />, shortcut: 'Esc', group: 'cursor' },
  { id: 'draw_wire', label: 'Draht', icon: <Minus size={18} />, shortcut: 'W', group: 'wire' },
  { id: 'place_label', label: 'Label', icon: <Type size={18} />, shortcut: 'L', group: 'annotation' },
  { id: 'delete', label: 'Löschen', icon: <Trash2 size={18} />, shortcut: 'Del', group: 'edit' },
];

const perfboardTools: ToolDef[] = [
  { id: 'select', label: 'Auswahl', icon: <MousePointer2 size={18} />, shortcut: 'Esc', group: 'cursor' },
  { id: 'draw_wire', label: 'Draht', icon: <Minus size={18} />, shortcut: 'W', group: 'wire' },
  { id: 'draw_wire_bridge', label: 'Brücke', icon: <ArrowRightLeft size={18} />, group: 'wire' },
  { id: 'draw_solder_bridge', label: 'Löt-Brücke', icon: <Circle size={18} />, group: 'wire' },
  { id: 'cut_track', label: 'Track-Cut', icon: <Scissors size={18} />, group: 'edit' },
  { id: 'delete', label: 'Löschen', icon: <Trash2 size={18} />, shortcut: 'Del', group: 'edit' },
];

// Helper to group tools with separators
function groupedTools(tools: ToolDef[]): (ToolDef | 'sep')[] {
  const result: (ToolDef | 'sep')[] = [];
  let lastGroup = '';
  for (const tool of tools) {
    if (tool.group && tool.group !== lastGroup && result.length > 0) {
      result.push('sep');
    }
    result.push(tool);
    lastGroup = tool.group || '';
  }
  return result;
}

export function Toolbar() {
  const currentView = useProjectStore((s) => s.currentView);
  const schematicTool = useSchematicStore((s) => s.activeTool);
  const setSchematicTool = useSchematicStore((s) => s.setActiveTool);
  const perfboardTool = usePerfboardStore((s) => s.activeTool);
  const setPerfboardTool = usePerfboardStore((s) => s.setActiveTool);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncDirection, setSyncDirection] = useState<'sch2pb' | 'pb2sch' | null>(null);

  const isSchematic = currentView === 'schematic';
  const isPerfboard = currentView === 'perfboard';
  const boardType = useProjectStore((s) => s.project.perfboard.boardType);

  const tools = isSchematic
    ? schematicTools
    : boardType === 'stripboard'
      ? perfboardTools
      : perfboardTools.filter((t) => t.id !== 'cut_track');
  const grouped = groupedTools(tools);
  const activeTool = isSchematic ? schematicTool : perfboardTool;
  const setTool = isSchematic
    ? (t: string) => setSchematicTool(t as ToolType)
    : (t: string) => setPerfboardTool(t as PerfboardToolType);

  // Active viewport
  const viewport = isSchematic
    ? useSchematicStore.getState().viewport
    : usePerfboardStore.getState().viewport;
  const setViewport = isSchematic
    ? useSchematicStore.getState().setViewport
    : usePerfboardStore.getState().setViewport;

  const handleAutoLayout = useCallback((mode?: AutoLayoutMode) => {
    usePerfboardStore.getState().autoLayoutComponents(mode);
  }, []);

  const handleAutoRoute = useCallback(() => {
    usePerfboardStore.getState().autoRouteConnections();
  }, []);

  const handleRemoveAllConnections = useCallback(() => {
    usePerfboardStore.getState().removeAllConnections();
  }, []);

  if (currentView === 'preview3d' || currentView === 'component-editor') return null;

  return (
    <ToolbarOverflow
      isSchematic={isSchematic}
      isPerfboard={isPerfboard}
      grouped={grouped}
      activeTool={activeTool}
      setTool={setTool}
      viewport={viewport}
      setViewport={setViewport}
      syncResult={syncResult}
      setSyncResult={setSyncResult}
      syncDirection={syncDirection}
      setSyncDirection={setSyncDirection}
      handleAutoLayout={handleAutoLayout}
      handleAutoRoute={handleAutoRoute}
      handleRemoveAllConnections={handleRemoveAllConnections}
    />
  );
}

// ======== Overflow-aware toolbar layout ========

type PopupId = 'sync' | 'more' | 'layout' | null;

interface ToolbarOverflowProps {
  isSchematic: boolean;
  isPerfboard: boolean;
  grouped: (ToolDef | 'sep')[];
  activeTool: string;
  setTool: (t: string) => void;
  viewport: { scale: number; x: number; y: number };
  setViewport: (vp: Partial<{ scale: number; x: number; y: number }>) => void;
  syncResult: SyncResult | null;
  setSyncResult: React.Dispatch<React.SetStateAction<SyncResult | null>>;
  syncDirection: 'sch2pb' | 'pb2sch' | null;
  setSyncDirection: React.Dispatch<React.SetStateAction<'sch2pb' | 'pb2sch' | null>>;
  handleAutoLayout: (mode?: AutoLayoutMode) => void;
  handleAutoRoute: () => void;
  handleRemoveAllConnections: () => void;
}

function ToolbarOverflow({
  isSchematic, isPerfboard, grouped, activeTool, setTool,
  viewport, setViewport,
  syncResult, setSyncResult, syncDirection, setSyncDirection,
  handleAutoLayout, handleAutoRoute, handleRemoveAllConnections,
}: ToolbarOverflowProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(999);
  // Single popup state: only one popup can be open at a time
  const [openPopup, setOpenPopup] = useState<PopupId>(null);

  const togglePopup = useCallback((id: Exclude<PopupId, null>) => {
    setOpenPopup((prev) => (prev === id ? null : id));
  }, []);

  // Sync button reserved width (always visible on the right)
  const SYNC_RESERVED = 90;
  const MORE_BTN_WIDTH = 40;

  // Measure sections and determine how many fit
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const measure = measureRef.current;
    if (!toolbar || !measure) return;
    const ro = new ResizeObserver(() => {
      const available = toolbar.offsetWidth - SYNC_RESERVED - MORE_BTN_WIDTH;
      const children = Array.from(measure.children) as HTMLElement[];
      let used = 0;
      let fit = 0;
      for (const child of children) {
        const w = child.offsetWidth + 18; // 18 = separator + margin
        if (used + w <= available) {
          used += w;
          fit += 1;
        } else {
          break;
        }
      }
      setVisibleCount(fit || 1);
    });
    ro.observe(toolbar);
    return () => ro.disconnect();
  }, []);

  // Close any open popup when clicking outside
  useEffect(() => {
    if (openPopup === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-toolbar-popup]')) setOpenPopup(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openPopup]);

  // Define the toolbar sections as renderable items
  const sections = useMemo(() => {
    const s: { key: string; render: (inDropdown?: boolean) => React.ReactNode }[] = [];

    // Section 0: Tool buttons
    s.push({
      key: 'tools',
      render: (inDropdown) => (
        <div className={inDropdown ? 'flex flex-wrap gap-0.5 p-1' : 'flex items-center gap-0.5'}>
          {grouped.map((item, i) =>
            item === 'sep' ? (
              <div key={`sep-${i}`} className={inDropdown ? 'w-full h-px bg-lochcad-panel/30 my-0.5' : 'w-px h-8 bg-lochcad-panel/30 mx-1'} />
            ) : (
              <button
                key={item.id}
                className={`tool-btn ${activeTool === item.id ? 'active' : ''}`}
                onClick={() => setTool(item.id)}
                data-tooltip={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ''}`}
              >
                {item.icon}
                <span className="text-[10px] leading-none">{item.label}</span>
              </button>
            )
          )}
        </div>
      ),
    });

    // Section 1: Zoom
    s.push({
      key: 'zoom',
      render: (inDropdown) => (
        <div className={inDropdown ? 'flex flex-wrap items-center gap-0.5 p-1' : 'flex items-center gap-0.5'}>
          <button
            className="btn-icon"
            onClick={() => setViewport({ scale: Math.min(viewport.scale * 1.2, 5) })}
            data-tooltip="Zoom +"
          >
            <ZoomIn size={16} />
          </button>
          <span className="text-xs text-lochcad-text-dim w-12 text-center select-none">
            {Math.round(viewport.scale * 100)}%
          </span>
          <button
            className="btn-icon"
            onClick={() => setViewport({ scale: Math.max(viewport.scale / 1.2, 0.1) })}
            data-tooltip="Zoom −"
          >
            <ZoomOut size={16} />
          </button>
          <button
            className="btn-icon"
            onClick={() => setViewport({ scale: 1, x: 0, y: 0 })}
            data-tooltip="Ansicht zurücksetzen"
          >
            <Maximize size={16} />
          </button>
        </div>
      ),
    });

    // Section 2: Auto-Layout & Autorouter (perfboard only)
    if (isPerfboard) {
      s.push({
        key: 'auto',
        render: (inDropdown) => (
          <AutoToolsSection
            inDropdown={!!inDropdown}
            handleAutoLayout={handleAutoLayout}
            handleAutoRoute={handleAutoRoute}
            handleRemoveAllConnections={handleRemoveAllConnections}
            layoutOpen={openPopup === 'layout'}
            onToggleLayout={() => togglePopup('layout')}
          />
        ),
      });
    }

    return s;
  }, [grouped, activeTool, setTool, isSchematic, isPerfboard, viewport.scale, setViewport, handleAutoLayout, handleAutoRoute, handleRemoveAllConnections, openPopup, togglePopup]);

  const visibleSections = sections.slice(0, visibleCount);
  const overflowSections = sections.slice(visibleCount);
  const hasOverflow = overflowSections.length > 0;

  return (
    <div ref={toolbarRef} data-toolbar className="h-12 bg-lochcad-surface border-b border-lochcad-panel/30 flex items-center px-2 gap-0.5 shrink-0 relative z-[100]">
      {/* Hidden measurement row — always renders ALL sections so we can measure their widths */}
      <div
        ref={measureRef}
        aria-hidden
        className="flex items-center gap-0.5"
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', height: 0, overflow: 'hidden' }}
      >
        {sections.map((sec) => (
          <div key={`m-${sec.key}`} className="shrink-0">
            {sec.render(false)}
          </div>
        ))}
      </div>

      {/* Visible sections */}
      {visibleSections.map((sec, i) => (
        <React.Fragment key={sec.key}>
          {i > 0 && <div className="w-px h-8 bg-lochcad-panel/30 mx-2 shrink-0" />}
          <div className="shrink-0">
            {sec.render(false)}
          </div>
        </React.Fragment>
      ))}

      {/* More button */}
      {hasOverflow && (
        <div className="relative shrink-0 ml-1" data-toolbar-popup>
          <button
            className={`btn-icon flex items-center gap-0.5 px-1.5 ${openPopup === 'more' ? 'bg-lochcad-panel/40' : ''}`}
            onClick={() => togglePopup('more')}
            data-tooltip="More tools"
          >
            <MoreHorizontal size={16} />
          </button>
          {openPopup === 'more' && (
            <div className="absolute top-full left-0 mt-1 z-[9990] bg-lochcad-surface border border-lochcad-panel/50 rounded-lg shadow-xl p-1.5 min-w-[180px]" data-toolbar-popup>
              {overflowSections.map((sec, i) => (
                <React.Fragment key={sec.key}>
                  {i > 0 && <div className="h-px bg-lochcad-panel/30 my-1" />}
                  <div className="text-[9px] text-gray-500 uppercase tracking-wider px-1.5 py-0.5 select-none">
                    {sec.key === 'tools' ? 'Tools' : sec.key === 'zoom' ? 'Zoom' : sec.key === 'auto' ? 'Auto' : sec.key}
                  </div>
                  {sec.render(true)}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Sync button (always visible, right side) */}
      <div className="relative shrink-0" data-toolbar-popup>
        <button
          className="btn-icon flex items-center gap-1 px-2"
          onClick={() => { togglePopup('sync'); setSyncResult(null); setSyncDirection(null); }}
          data-tooltip="Sync Schaltplan ↔ Lochraster"
        >
          <RefreshCw size={16} />
          <span className="text-[10px]">Sync</span>
        </button>

        {openPopup === 'sync' && (
          <div className="absolute top-full right-0 mt-1 z-[9990] bg-lochcad-surface border border-lochcad-panel/50 rounded-lg shadow-xl p-4 w-80" data-toolbar-popup>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">Synchronisation</span>
              <button className="btn-icon" onClick={() => setOpenPopup(null)}>
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

// ======== Auto-Layout / Autorouter section with mode dropdown ========

const LAYOUT_MODES: { id: AutoLayoutMode; label: string; desc: string }[] = [
  { id: 'extra_compact', label: 'Extra Kompakt', desc: 'Absolut minimaler Platzbedarf — so dicht wie möglich' },
  { id: 'compact', label: 'Kompakt', desc: 'Wenig Platz, aber mit Routing-Kanal' },
  { id: 'easy_soldering', label: 'Einfaches Löten', desc: 'Mehr Abstand für bequemes Handlöten' },
  { id: 'beautiful', label: 'Schönes Board', desc: 'Ästhetisch ausgerichtete Reihen, symmetrisches Layout' },
];

function AutoToolsSection({
  inDropdown,
  handleAutoLayout,
  handleAutoRoute,
  handleRemoveAllConnections,
  layoutOpen,
  onToggleLayout,
}: {
  inDropdown: boolean;
  handleAutoLayout: (mode?: AutoLayoutMode) => void;
  handleAutoRoute: () => void;
  handleRemoveAllConnections: () => void;
  layoutOpen: boolean;
  onToggleLayout: () => void;
}) {
  return (
    <div className={inDropdown ? 'flex flex-wrap gap-0.5 p-1' : 'flex items-center gap-0.5'}>
      {/* Layout button with mode dropdown */}
      <div className="relative" data-toolbar-popup>
        <button
          className="btn-icon flex items-center gap-0.5 px-2"
          onClick={onToggleLayout}
          data-tooltip="Auto-Layout — Bauteile automatisch platzieren"
        >
          <LayoutGrid size={15} />
          <span className="text-[10px]">Layout</span>
          <ChevronDown size={10} className="opacity-60" />
        </button>

        {layoutOpen && (
          <div
            className="absolute top-full left-0 mt-1 z-[9999] bg-lochcad-surface border border-lochcad-panel/50 rounded-lg shadow-xl p-1.5 min-w-[220px]"
            data-toolbar-popup
          >
            <div className="text-[9px] text-gray-500 uppercase tracking-wider px-2 py-1 select-none">
              Layout-Modus
            </div>
            {LAYOUT_MODES.map((mode) => (
              <button
                key={mode.id}
                className="w-full flex flex-col items-start px-2.5 py-1.5 rounded hover:bg-lochcad-accent/20 transition-colors text-left"
                onClick={() => {
                  handleAutoLayout(mode.id);
                }}
              >
                <span className="text-xs text-gray-200 font-medium">{mode.label}</span>
                <span className="text-[10px] text-gray-500 leading-tight">{mode.desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Route button */}
      <button
        className="btn-icon flex items-center gap-1 px-2"
        onClick={handleAutoRoute}
        data-tooltip="Autorouter — Alle Netze automatisch verdrahten"
      >
        <Cable size={15} />
        <span className="text-[10px]">Route</span>
      </button>

      {/* Remove all traces button */}
      <button
        className="btn-icon flex items-center gap-1 px-2 text-red-400 hover:text-red-300"
        onClick={handleRemoveAllConnections}
        data-tooltip="Alle Verbindungen entfernen"
      >
        <Eraser size={15} />
        <span className="text-[10px]">Clear</span>
      </button>
    </div>
  );
}