import React from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { useCollabStore } from '@/stores/collabStore';

const viewLabels: Record<string, string> = {
  schematic: 'Schaltplan',
  perfboard: 'Lochraster',
  preview3d: '3D Ansicht',
  'component-editor': 'Bauteil-Editor',
};

const toolLabels: Record<string, string> = {
  select: 'Auswahl',
  place_component: 'Bauteil platzieren',
  draw_wire: 'Draht zeichnen',
  place_label: 'Label',
  delete: 'Löschen',
  draw_wire_bridge: 'Drahtbrücke',
  draw_solder_bridge: 'Lötbrücke',
  cut_track: 'Track-Cut',
};

export function StatusBar() {
  const currentView = useProjectStore((s) => s.currentView);
  const schematicTool = useSchematicStore((s) => s.activeTool);
  const perfboardTool = usePerfboardStore((s) => s.activeTool);
  const schematicViewport = useSchematicStore((s) => s.viewport);
  const perfboardViewport = usePerfboardStore((s) => s.viewport);
  const schematic = useProjectStore((s) => s.project.schematic);
  const perfboard = useProjectStore((s) => s.project.perfboard);
  const isDirty = useProjectStore((s) => s.isDirty);
  const activeSheetId = useProjectStore((s) => s.activeSheetId);
  const schematicSelection = useSchematicStore((s) => s.selection);
  const perfboardSelection = usePerfboardStore((s) => s.selectedIds);
  const collabConnected = useCollabStore((s) => s.connected);
  const collabRoomId = useCollabStore((s) => s.roomId);
  const collabPeers = useCollabStore((s) => s.peers);

  const isSchematic = currentView === 'schematic';
  const isPerfboard = currentView === 'perfboard';
  const editorActive = isSchematic || isPerfboard;

  const tool = isSchematic ? schematicTool : perfboardTool;
  const viewport = isSchematic ? schematicViewport : perfboardViewport;

  const compCount = isSchematic
    ? schematic.components.filter((c) => c.sheetId === activeSheetId).length
    : perfboard.components.length;
  const wireCount = isSchematic
    ? schematic.wires.filter((w) => w.sheetId === activeSheetId).length
    : perfboard.connections.length;

  const selectionCount = isSchematic
    ? schematicSelection.componentIds.length + schematicSelection.wireIds.length
    : perfboardSelection.length;

  const activeSheet = schematic.sheets.find((s) => s.id === activeSheetId);

  return (
    <div className="h-6 bg-lochcad-surface border-t border-lochcad-panel/30 flex items-center px-3 text-[10px] text-lochcad-text-dim gap-3 shrink-0 select-none">
      {/* View name */}
      <span className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-lochcad-accent inline-block" />
        <strong className="text-lochcad-text">{viewLabels[currentView] || currentView}</strong>
      </span>

      {/* Active tool */}
      {editorActive && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span>
            Werkzeug: <strong className="text-lochcad-accent">{toolLabels[tool] || tool}</strong>
          </span>
        </>
      )}

      {/* Sheet name (schematic only) */}
      {isSchematic && activeSheet && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span>Blatt: <strong className="text-lochcad-text">{activeSheet.name}</strong></span>
        </>
      )}

      {/* Counts */}
      {editorActive && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span>Bauteile: {compCount}</span>
          <span>{isSchematic ? 'Drähte' : 'Verbindungen'}: {wireCount}</span>
        </>
      )}

      {/* Selection */}
      {editorActive && selectionCount > 0 && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span className="text-lochcad-accent">{selectionCount} ausgewählt</span>
        </>
      )}

      {/* Board info (perfboard) */}
      {isPerfboard && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span>
            Board: {perfboard.width}×{perfboard.height} · {perfboard.boardType === 'stripboard' ? 'Streifenraster' : 'Punktraster'}
          </span>
        </>
      )}

      <div className="flex-1" />

      {/* Zoom */}
      {editorActive && (
        <span>Zoom: {Math.round(viewport.scale * 100)}%</span>
      )}

      {/* Grid info */}
      {editorActive && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span>Raster: {isSchematic ? '20px' : '2.54mm'}</span>
        </>
      )}

      {/* Dirty indicator */}
      {isDirty && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span className="text-lochcad-accent-warm">● Ungespeichert</span>
        </>
      )}

      {/* Collaboration status */}
      {collabConnected && collabRoomId && (
        <>
          <span className="text-lochcad-panel/40">│</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            <span className="text-green-400">Live</span>
            <span className="text-lochcad-text-dim">· {collabPeers.size + 1} Nutzer</span>
          </span>
        </>
      )}
    </div>
  );
}
