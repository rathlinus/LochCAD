import React from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';

export function StatusBar() {
  const currentView = useProjectStore((s) => s.currentView);
  const schematicTool = useSchematicStore((s) => s.activeTool);
  const perfboardTool = usePerfboardStore((s) => s.activeTool);
  const schematicViewport = useSchematicStore((s) => s.viewport);
  const schematic = useProjectStore((s) => s.project.schematic);
  const perfboard = useProjectStore((s) => s.project.perfboard);
  const isDirty = useProjectStore((s) => s.isDirty);

  const tool = currentView === 'schematic' ? schematicTool : perfboardTool;
  const compCount =
    currentView === 'schematic'
      ? schematic.components.length
      : perfboard.components.length;
  const wireCount =
    currentView === 'schematic'
      ? schematic.wires.length
      : perfboard.connections.length;

  return (
    <div className="h-6 bg-lochcad-surface border-t border-lochcad-panel/30 flex items-center px-3 text-[10px] text-lochcad-text-dim gap-4 shrink-0">
      <span>
        Ansicht: <strong className="text-lochcad-text">{currentView === 'schematic' ? 'Schaltplan' : currentView === 'perfboard' ? 'Lochraster' : currentView === 'preview3d' ? '3D Preview' : 'Bauteil-Editor'}</strong>
      </span>
      {(currentView === 'schematic' || currentView === 'perfboard') && (
        <>
          <span>Tool: <strong className="text-lochcad-accent">{tool}</strong></span>
          <span>Bauteile: {compCount}</span>
          <span>{currentView === 'schematic' ? 'Drähte' : 'Verbindungen'}: {wireCount}</span>
        </>
      )}
      {currentView === 'perfboard' && (
        <span>
          Board: {perfboard.width}×{perfboard.height} ({perfboard.boardType === 'stripboard' ? 'Streifenraster' : 'Lochraster'})
        </span>
      )}
      <div className="flex-1" />
      <span>Zoom: {Math.round(schematicViewport.scale * 100)}%</span>
      {isDirty && <span className="text-red-500">● Ungespeichert</span>}
    </div>
  );
}
