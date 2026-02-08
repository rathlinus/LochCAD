import React, { useState } from 'react';
import { useProjectStore } from '@/stores';
import type { EditorView } from '@/types';
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
  Menu,
  X,
} from 'lucide-react';

const viewTabs: { id: EditorView; label: string; icon: React.ReactNode }[] = [
  { id: 'schematic', label: 'Schaltplan', icon: <CircuitBoard size={16} /> },
  { id: 'perfboard', label: 'Lochraster', icon: <Cpu size={16} /> },
  { id: 'preview3d', label: '3D Ansicht', icon: <Box size={16} /> },
  { id: 'component-editor', label: 'Bauteil-Editor', icon: <PenTool size={16} /> },
];

export function TopBar() {
  const { project, currentView, setCurrentView, isDirty, newProject } = useProjectStore();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSave = () => {
    const data = JSON.stringify(useProjectStore.getState().project, null, 2);
    localStorage.setItem('lochcad-autosave', data);
    localStorage.setItem('lochcad-project', data);
    useProjectStore.getState().markClean();
  };

  const handleLoad = () => {
    const data = localStorage.getItem('lochcad-autosave') ?? localStorage.getItem('lochcad-project');
    if (data) {
      try {
        const project = JSON.parse(data);
        useProjectStore.getState().setProject(project);
      } catch (e) {
        console.error('Failed to load project:', e);
      }
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(useProjectStore.getState().project, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.lochcad`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lochcad,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const project = JSON.parse(reader.result as string);
          useProjectStore.getState().setProject(project);
        } catch (err) {
          console.error('Import failed:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className="h-10 bg-lochcad-surface border-b border-lochcad-panel/30 flex items-center px-2 gap-1 shrink-0">
      {/* Logo & Project Name */}
      <div className="flex items-center gap-2 pr-3 border-r border-lochcad-panel/30 mr-1">
        <img src="/lochcad-logo.svg" alt="LochCAD" className="w-6 h-6" />
        <span className="text-sm font-semibold text-lochcad-text truncate max-w-[150px]">
          {project.name}
        </span>
        {isDirty && <span className="text-lochcad-accent-warm text-xs">●</span>}
      </div>

      {/* File Menu */}
      <div className="relative">
        <button
          className="btn-icon"
          onClick={() => setMenuOpen(!menuOpen)}
          data-tooltip="Menü"
        >
          {menuOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
        {menuOpen && (
          <div className="context-menu left-0 top-full mt-1 animate-fade-in">
            <div className="context-menu-item" onClick={() => { newProject(); setMenuOpen(false); }}>
              <FileText size={14} /> Neues Projekt
            </div>
            <div className="context-menu-item" onClick={() => { handleSave(); setMenuOpen(false); }}>
              <Save size={14} /> Speichern
            </div>
            <div className="context-menu-item" onClick={() => { handleLoad(); setMenuOpen(false); }}>
              <FolderOpen size={14} /> Laden
            </div>
            <div className="context-menu-separator" />
            <div className="context-menu-item" onClick={() => { handleExport(); setMenuOpen(false); }}>
              <Download size={14} /> Exportieren (.lochcad)
            </div>
            <div className="context-menu-item" onClick={() => { handleImport(); setMenuOpen(false); }}>
              <Upload size={14} /> Importieren
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <button className="btn-icon" onClick={handleSave} data-tooltip="Speichern (Ctrl+S)">
        <Save size={16} />
      </button>

      {/* Separator */}
      <div className="w-px h-5 bg-lochcad-panel/30 mx-1" />

      {/* View Tabs */}
      <div className="flex items-center gap-0.5">
        {viewTabs.map((tab) => (
          <button
            key={tab.id}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all duration-150 ${
              currentView === tab.id
                ? 'bg-lochcad-accent/20 text-lochcad-accent'
                : 'text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/20'
            }`}
            onClick={() => setCurrentView(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: version info */}
      <span className="text-[10px] text-lochcad-text-dim mr-2">
        v0.3.8 by{' '}
          Linus Rath
      </span>
    </div>
  );
}
