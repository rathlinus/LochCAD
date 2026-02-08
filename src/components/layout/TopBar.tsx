import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { useProjectManagerStore } from '@/stores/projectManagerStore';
import { useToastStore } from '@/stores';
import type { EditorView } from '@/types';
import {
  generateSpiceNetlist,
  generateBOM,
  bomToCsv,
  bomToHtml,
} from '@/lib/export/spice-bom';
import { runERC } from '@/lib/engine/erc';
import { runDRC } from '@/lib/engine/drc';
import { buildNetlist } from '@/lib/engine/netlist';
import {
  FileText,
  Save,
  FolderOpen,
  Download,
  Upload,
  CircuitBoard,
  Cpu,
  Box,
  PenTool,
  Undo2,
  Redo2,
  RotateCw,
  FlipHorizontal2,
  Trash2,
  Copy,
  Scissors,
  ClipboardPaste,
  ZoomIn,
  ZoomOut,
  Maximize,
  Grid3X3,
  Eye,
  EyeOff,
  Layers,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileCode2,
  Globe,
  RefreshCw,
  ArrowRight,
  Settings,
  Info,
  Keyboard,
  HelpCircle,
  X,
} from 'lucide-react';

// ---- View Tabs ----
const viewTabs: { id: EditorView; label: string; icon: React.ReactNode }[] = [
  { id: 'schematic', label: 'Schaltplan', icon: <CircuitBoard size={16} /> },
  { id: 'perfboard', label: 'Lochraster', icon: <Cpu size={16} /> },
  { id: 'preview3d', label: '3D Ansicht', icon: <Box size={16} /> },
  { id: 'component-editor', label: 'Bauteil-Editor', icon: <PenTool size={16} /> },
];

// ---- Types ----
interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  children?: MenuItem[];
}

// ---- Helper: download text file ----
function downloadTextFile(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- SubMenu component for nested menu items ----
function SubMenu({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleEnter = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), 120);
  };
  const handleLeave = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(false), 200);
  };

  return (
    <div
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div
        className="context-menu-item"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-5 shrink-0 flex items-center">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        <span className="text-[10px] text-lochcad-text-dim/60 ml-4">▸</span>
      </div>
      {open && item.children && (
        <div className="context-menu left-full top-0 -mt-1 ml-0.5 animate-fade-in min-w-[200px]">
          {item.children.map((child, j) =>
            child.separator ? (
              <div key={j} className="context-menu-separator" />
            ) : (
              <div
                key={j}
                className={`context-menu-item ${child.disabled ? 'opacity-40 pointer-events-none' : ''}`}
                onClick={() => {
                  if (child.action && !child.disabled) {
                    child.action();
                    onClose();
                  }
                }}
              >
                <span className="w-5 shrink-0 flex items-center">{child.icon}</span>
                <span className="flex-1">{child.label}</span>
                {child.shortcut && (
                  <span className="text-[10px] text-lochcad-text-dim/60 ml-4">{child.shortcut}</span>
                )}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const { project, currentView, setCurrentView, isDirty, newProject } = useProjectStore();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState(project.name);
  const topBarRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (topBarRef.current && !topBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ---- File Actions ----
  const handleSave = useCallback(() => {
    useProjectManagerStore.getState().saveCurrentProject();
    useToastStore.getState().showToast('Projekt gespeichert', 'success');
  }, []);

  const handleOpenProjectManager = useCallback(() => {
    useProjectManagerStore.getState().open();
  }, []);



  const handleExportJson = useCallback(() => {
    // Save first, then export
    useProjectManagerStore.getState().saveCurrentProject();
    useProjectManagerStore.getState().exportProject(project.id);
    useToastStore.getState().showToast('Projekt exportiert', 'success');
  }, [project.name, project.id]);

  const handleImportFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lochcad,.lochcad-archive,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const result = await useProjectManagerStore.getState().importProjectFromFile(file);
      if (result === 'archive') {
        useToastStore.getState().showToast('Projektarchiv importiert', 'success');
      } else if (result) {
        // Open the imported project
        useProjectManagerStore.getState().openProject(result);
        useToastStore.getState().showToast('Projekt importiert und geöffnet', 'success');
      } else {
        useToastStore.getState().showToast('Import fehlgeschlagen', 'error');
      }
    };
    input.click();
  }, []);

  // ---- Edit Actions ----
  const isSchematic = currentView === 'schematic';
  const isPerfboard = currentView === 'perfboard';

  const handleUndo = useCallback(() => {
    if (isSchematic) useSchematicStore.getState().undo();
    else if (isPerfboard) usePerfboardStore.getState().undo();
  }, [isSchematic, isPerfboard]);

  const handleRedo = useCallback(() => {
    if (isSchematic) useSchematicStore.getState().redo();
    else if (isPerfboard) usePerfboardStore.getState().redo();
  }, [isSchematic, isPerfboard]);

  const handleDeleteSelected = useCallback(() => {
    if (isSchematic) useSchematicStore.getState().deleteSelected();
    else if (isPerfboard) usePerfboardStore.getState().deleteSelected();
  }, [isSchematic, isPerfboard]);

  const handleRotateSelected = useCallback(() => {
    if (isSchematic) {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().rotateComponent(id));
    } else if (isPerfboard) {
      const sel = usePerfboardStore.getState().selectedIds;
      sel.forEach((id) => usePerfboardStore.getState().rotateComponent(id));
    }
  }, [isSchematic, isPerfboard]);

  const handleMirrorSelected = useCallback(() => {
    if (isSchematic) {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().mirrorComponent(id));
    }
  }, [isSchematic]);

  const handleSelectAll = useCallback(() => {
    if (isSchematic) {
      const sch = useProjectStore.getState().project.schematic;
      const sheetId = useProjectStore.getState().activeSheetId;
      const compIds = sch.components.filter(c => c.sheetId === sheetId).map(c => c.id);
      const wireIds = sch.wires.filter(w => w.sheetId === sheetId).map(w => w.id);
      useSchematicStore.getState().select({ componentIds: compIds, wireIds });
    } else if (isPerfboard) {
      const pb = useProjectStore.getState().project.perfboard;
      usePerfboardStore.getState().select(pb.components.map(c => c.id));
    }
  }, [isSchematic, isPerfboard]);

  // ---- View Actions ----
  const handleZoomIn = useCallback(() => {
    if (isSchematic) {
      const vp = useSchematicStore.getState().viewport;
      useSchematicStore.getState().setViewport({ scale: Math.min(vp.scale * 1.25, 5) });
    } else if (isPerfboard) {
      const vp = usePerfboardStore.getState().viewport;
      usePerfboardStore.getState().setViewport({ scale: Math.min(vp.scale * 1.25, 5) });
    }
  }, [isSchematic, isPerfboard]);

  const handleZoomOut = useCallback(() => {
    if (isSchematic) {
      const vp = useSchematicStore.getState().viewport;
      useSchematicStore.getState().setViewport({ scale: Math.max(vp.scale / 1.25, 0.1) });
    } else if (isPerfboard) {
      const vp = usePerfboardStore.getState().viewport;
      usePerfboardStore.getState().setViewport({ scale: Math.max(vp.scale / 1.25, 0.1) });
    }
  }, [isSchematic, isPerfboard]);

  const handleZoomFit = useCallback(() => {
    if (isSchematic) {
      useSchematicStore.getState().setViewport({ scale: 1, x: 0, y: 0 });
    } else if (isPerfboard) {
      usePerfboardStore.getState().setViewport({ scale: 1, x: 0, y: 0 });
    }
  }, [isSchematic, isPerfboard]);

  // ---- Export Actions ----
  const handleExportSpice = useCallback(() => {
    const sch = useProjectStore.getState().project.schematic;
    const spice = generateSpiceNetlist(sch, project.name);
    downloadTextFile(spice, `${project.name}.spice`, 'text/plain');
    useToastStore.getState().showToast('SPICE Netlist exportiert', 'success');
  }, [project.name]);

  const handleExportBomCsv = useCallback(() => {
    const sch = useProjectStore.getState().project.schematic;
    const bom = generateBOM(sch);
    const csv = bomToCsv(bom);
    downloadTextFile(csv, `${project.name}_BOM.csv`, 'text/csv');
    useToastStore.getState().showToast(`Stückliste exportiert (${bom.length} Einträge)`, 'success');
  }, [project.name]);

  const handleExportBomHtml = useCallback(() => {
    const sch = useProjectStore.getState().project.schematic;
    const bom = generateBOM(sch);
    const html = bomToHtml(bom);
    downloadTextFile(html, `${project.name}_BOM.html`, 'text/html');
    useToastStore.getState().showToast(`Stückliste (HTML) exportiert`, 'success');
  }, [project.name]);

  const handleExportNetlist = useCallback(() => {
    const sch = useProjectStore.getState().project.schematic;
    const netlist = buildNetlist(sch);
    const json = JSON.stringify(netlist, null, 2);
    downloadTextFile(json, `${project.name}_netlist.json`, 'application/json');
    useToastStore.getState().showToast('Netlist exportiert', 'success');
  }, [project.name]);

  // ---- Check Actions ----
  const handleRunERC = useCallback(() => {
    const sch = useProjectStore.getState().project.schematic;
    const result = runERC(sch);
    if (result.passed) {
      useToastStore.getState().showToast(`ERC bestanden – keine Fehler`, 'success');
    } else {
      useToastStore.getState().showToast(
        `ERC: ${result.summary.errors} Fehler, ${result.summary.warnings} Warnungen`,
        result.summary.errors > 0 ? 'error' : 'warning'
      );
    }
  }, []);

  const handleRunDRC = useCallback(() => {
    const pb = useProjectStore.getState().project.perfboard;
    const result = runDRC(pb);
    if (result.passed) {
      useToastStore.getState().showToast(`DRC bestanden – keine Fehler`, 'success');
    } else {
      useToastStore.getState().showToast(
        `DRC: ${result.summary.errors} Fehler, ${result.summary.warnings} Warnungen`,
        result.summary.errors > 0 ? 'error' : 'warning'
      );
    }
  }, []);

  // ---- Sync ----
  const handleSyncSch2Pb = useCallback(() => {
    const r = useProjectStore.getState().syncSchematicToPerfboard();
    const total = r.added.length + r.updated.length + r.removed.length;
    useToastStore.getState().showToast(
      total > 0
        ? `Sync: ${r.added.length} hinzugefügt, ${r.updated.length} aktualisiert, ${r.removed.length} entfernt`
        : 'Alles synchron',
      total > 0 ? 'success' : 'info'
    );
  }, []);

  const handleSyncPb2Sch = useCallback(() => {
    const r = useProjectStore.getState().syncPerfboardToSchematic();
    const total = r.added.length + r.updated.length + r.removed.length;
    useToastStore.getState().showToast(
      total > 0
        ? `Sync: ${r.added.length} hinzugefügt, ${r.updated.length} aktualisiert, ${r.removed.length} entfernt`
        : 'Alles synchron',
      total > 0 ? 'success' : 'info'
    );
  }, []);

  // ---- Rename project ----
  const finishRename = useCallback(() => {
    if (projectNameDraft.trim()) {
      useProjectStore.getState().setProjectName(projectNameDraft.trim());
    }
    setRenaming(false);
  }, [projectNameDraft]);

  // ---- Keyboard shortcut for save ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSave(); }
      if (e.ctrlKey && e.key === 'n') { e.preventDefault(); newProject(); }
      if (e.ctrlKey && e.key === 'o') { e.preventDefault(); handleOpenProjectManager(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, newProject, handleOpenProjectManager]);

  // ---- Menu Definitions ----
  const editorActive = isSchematic || isPerfboard;

  const menus: { id: string; label: string; items: MenuItem[] }[] = [
    {
      id: 'file',
      label: 'Datei',
      items: [
        { label: 'Neues Projekt', icon: <FileText size={14} />, shortcut: 'Strg+N', action: () => newProject() },
        { label: 'Projekte verwalten', icon: <FolderOpen size={14} />, shortcut: 'Strg+Shift+P', action: handleOpenProjectManager },
        { separator: true, label: '' },
        { label: 'Speichern', icon: <Save size={14} />, shortcut: 'Strg+S', action: handleSave },
        { label: 'Importieren', icon: <Upload size={14} />, shortcut: 'Strg+O', action: handleImportFile },
        { label: 'Exportieren', icon: <Download size={14} />, children: [
          { label: 'Projekt (.lochcad)', icon: <Download size={14} />, action: handleExportJson },
          { separator: true, label: '' },
          { label: 'SPICE Netlist (.spice)', icon: <FileCode2 size={14} />, action: handleExportSpice },
          { label: 'Stückliste CSV', icon: <FileSpreadsheet size={14} />, action: handleExportBomCsv },
          { label: 'Stückliste HTML', icon: <Globe size={14} />, action: handleExportBomHtml },
          { label: 'Netlist JSON', icon: <Globe size={14} />, action: handleExportNetlist },
        ]},
        { separator: true, label: '' },
        { label: 'Projekt umbenennen', icon: <FileText size={14} />, action: () => { setProjectNameDraft(project.name); setRenaming(true); } },
      ],
    },
    {
      id: 'edit',
      label: 'Bearbeiten',
      items: [
        { label: 'Rückgängig', icon: <Undo2 size={14} />, shortcut: 'Strg+Z', action: handleUndo, disabled: !editorActive },
        { label: 'Wiederholen', icon: <Redo2 size={14} />, shortcut: 'Strg+Y', action: handleRedo, disabled: !editorActive },
        { separator: true, label: '' },
        { label: 'Alles auswählen', icon: <Layers size={14} />, shortcut: 'Strg+A', action: handleSelectAll, disabled: !editorActive },
        { label: 'Auswahl löschen', icon: <Trash2 size={14} />, shortcut: 'Entf', action: handleDeleteSelected, disabled: !editorActive },
        { separator: true, label: '' },
        { label: 'Drehen', icon: <RotateCw size={14} />, shortcut: 'R', action: handleRotateSelected, disabled: !editorActive },
        { label: 'Spiegeln', icon: <FlipHorizontal2 size={14} />, shortcut: 'X', action: handleMirrorSelected, disabled: !isSchematic },
      ],
    },

    {
      id: 'tools',
      label: 'Werkzeuge',
      items: [
        { label: 'Sync: Schaltplan → Lochraster', icon: <ArrowRight size={14} />, action: handleSyncSch2Pb },
        { label: 'Sync: Lochraster → Schaltplan', icon: <ArrowRight size={14} />, action: handleSyncPb2Sch },
        { separator: true, label: '' },
        { label: 'Netlist erstellen', icon: <Globe size={14} />, action: handleExportNetlist },
      ],
    },
    {
      id: 'check',
      label: 'Prüfung',
      items: [
        { label: 'ERC — Electrical Rules Check', icon: <AlertTriangle size={14} />, action: handleRunERC },
        { label: 'DRC — Design Rules Check', icon: <CheckCircle2 size={14} />, action: handleRunDRC },
      ],
    },
  ];

  const helpMenu: { id: string; label: string; items: MenuItem[] } = {
    id: 'help',
    label: 'Hilfe',
    items: [
      { label: 'Tastenkürzel', icon: <Keyboard size={14} />, action: () => {
        useToastStore.getState().showToast(
          'Esc=Auswahl, W=Draht, R=Drehen, X=Spiegeln, Del=Löschen, Strg+S=Speichern, Strg+Z=Undo', 'info'
        );
      }},
      { separator: true, label: '' },
      { label: 'Über LochCAD', icon: <Info size={14} />, action: () => {
        useToastStore.getState().showToast('LochCAD v0.3.8 — Lochraster-CAD by Linus Rath', 'info');
      }},
    ],
  };

  return (
    <div className="h-10 bg-lochcad-surface border-b border-lochcad-panel/30 flex items-center px-2 gap-0 shrink-0 relative z-[200]" ref={topBarRef}>
      {/* Logo & Project Name */}
      <div className="flex items-center gap-2 pr-2 mr-1">
        <img src="/lochcad-logo.svg" alt="LochCAD" className="w-6 h-6" />
        {renaming ? (
          <input
            className="input text-sm font-semibold w-36 py-0"
            value={projectNameDraft}
            onChange={(e) => setProjectNameDraft(e.target.value)}
            onBlur={finishRename}
            onKeyDown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setRenaming(false); }}
            autoFocus
          />
        ) : (
          <span
            className="text-sm font-semibold text-lochcad-text truncate max-w-[140px] cursor-pointer hover:text-lochcad-accent transition-colors"
            onClick={() => { setProjectNameDraft(project.name); setRenaming(true); }}
            title="Klicken zum Umbenennen"
          >
            {project.name}
          </span>
        )}
        {isDirty && <span className="text-lochcad-accent-warm text-xs" title="Ungespeicherte Änderungen">●</span>}
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-lochcad-panel/30 mx-1" />

      {/* Menu Bar */}
      <div className="flex items-center gap-0">
        {menus.map((menu) => (
          <div key={menu.id} className="relative">
            <button
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                openMenu === menu.id
                  ? 'bg-lochcad-accent/20 text-lochcad-accent'
                  : 'text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/20'
              }`}
              onClick={() => setOpenMenu(openMenu === menu.id ? null : menu.id)}
              onMouseEnter={() => { if (openMenu !== null) setOpenMenu(menu.id); }}
            >
              {menu.label}
            </button>
            {openMenu === menu.id && (
              <div className="context-menu left-0 top-full mt-0.5 animate-fade-in min-w-[220px]">
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <div key={i} className="context-menu-separator" />
                  ) : item.children ? (
                    <SubMenu key={i} item={item} onClose={() => setOpenMenu(null)} />
                  ) : (
                    <div
                      key={i}
                      className={`context-menu-item ${item.disabled ? 'opacity-40 pointer-events-none' : ''}`}
                      onClick={() => {
                        if (item.action && !item.disabled) { item.action(); setOpenMenu(null); }
                      }}
                    >
                      <span className="w-5 shrink-0 flex items-center">{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {item.shortcut && (
                        <span className="text-[10px] text-lochcad-text-dim/60 ml-4">{item.shortcut}</span>
                      )}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* === Central View Tabs (absolute center) === */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-lochcad-bg/40 rounded-lg px-1 py-0.5">
        {viewTabs.map((tab) => (
          <button
            key={tab.id}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
              currentView === tab.id
                ? 'bg-lochcad-accent/20 text-lochcad-accent shadow-sm'
                : 'text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/30'
            }`}
            onClick={() => setCurrentView(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Quick Actions */}
      <div className="flex items-center gap-0.5 mr-1">
        <button className="btn-icon" onClick={handleSave} data-tooltip="Speichern (Strg+S)">
          <Save size={15} />
        </button>
        <button className="btn-icon" onClick={handleUndo} data-tooltip="Rückgängig (Strg+Z)" disabled={!editorActive}>
          <Undo2 size={15} />
        </button>
        <button className="btn-icon" onClick={handleRedo} data-tooltip="Wiederholen (Strg+Y)" disabled={!editorActive}>
          <Redo2 size={15} />
        </button>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-lochcad-panel/30 mx-1" />

      {/* Help menu (right side) */}
      <div className="relative">
        <div className="flex items-center gap-0">
          <button
            className={`px-2 py-1 text-xs rounded transition-colors ${
              openMenu === 'help'
                ? 'bg-lochcad-accent/20 text-lochcad-accent'
                : 'text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/20'
            }`}
            onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
          >
            <HelpCircle size={15} />
          </button>
        </div>
        {openMenu === 'help' && (
          <div className="context-menu right-0 top-full mt-0.5 animate-fade-in min-w-[220px]">
            {helpMenu.items.map((item, i) =>
              item.separator ? (
                <div key={i} className="context-menu-separator" />
              ) : (
                <div
                  key={i}
                  className="context-menu-item"
                  onClick={() => { if (item.action) { item.action(); setOpenMenu(null); } }}
                >
                  <span className="w-5 shrink-0 flex items-center">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Version */}
      <span className="text-[10px] text-lochcad-text-dim ml-1 mr-2">
        v0.3.8
      </span>
    </div>
  );
}
