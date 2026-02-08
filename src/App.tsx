import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { useProjectManagerStore } from '@/stores/projectManagerStore';
import { ToastContainer } from '@/components/Toast';
import { ProjectManager } from '@/components/ProjectManager';
import { IntroScreen, shouldShowIntro } from '@/components/IntroScreen';

/** Trigger a file-open dialog and load a .lochcad / .json project */
function triggerImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.lochcad,.json';
  input.onchange = (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
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
}

export default function App() {
  const [showIntro, setShowIntro] = useState(shouldShowIntro);

  // Global keyboard handler — suppress browser defaults and wire up app-wide shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;

      // Suppress Ctrl+W (close tab) and Ctrl+R (reload)
      if (ctrl && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        return;
      }
      if (ctrl && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        // Let the per-editor hotkey handlers pick this up for rotation
        return;
      }

      // Ctrl+S — save project
      if (ctrl && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        const data = JSON.stringify(useProjectStore.getState().project, null, 2);
        localStorage.setItem('lochcad-autosave', data);
        localStorage.setItem('lochcad-project', data);
        // Also save to project manager store
        useProjectManagerStore.getState().saveCurrentProject();
        useProjectStore.getState().markClean();
        return;
      }

      // Ctrl+Shift+P — open project manager
      if (ctrl && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        const { isOpen, open, close } = useProjectManagerStore.getState();
        if (isOpen) close();
        else open();
        return;
      }

      // Ctrl+N — new project (with confirmation)
      if (ctrl && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        if (useProjectStore.getState().isDirty) {
          if (!confirm('Ungespeicherte Änderungen gehen verloren. Neues Projekt erstellen?')) return;
        }
        useProjectStore.getState().newProject();
        return;
      }

      // Ctrl+O — open / import project file
      if (ctrl && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        triggerImport();
        return;
      }

      // Ctrl+E — export project
      if (ctrl && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        const proj = useProjectStore.getState().project;
        const data = JSON.stringify(proj, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${proj.name}.lochcad`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      // Ctrl+Z — undo (view-aware, let per-editor hooks also handle)
      if (ctrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        const view = useProjectStore.getState().currentView;
        if (view === 'schematic') useSchematicStore.getState().undo();
        else if (view === 'perfboard') usePerfboardStore.getState().undo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z — redo (view-aware)
      if (ctrl && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
        e.preventDefault();
        const view = useProjectStore.getState().currentView;
        if (view === 'schematic') useSchematicStore.getState().redo();
        else if (view === 'perfboard') usePerfboardStore.getState().redo();
        return;
      }

      // Ctrl+A — select all (view-aware)
      if (ctrl && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        const view = useProjectStore.getState().currentView;
        if (view === 'schematic') {
          const sch = useProjectStore.getState().project.schematic;
          const sheetId = useProjectStore.getState().activeSheetId;
          useSchematicStore.getState().select({
            componentIds: sch.components.filter((c) => c.sheetId === sheetId).map((c) => c.id),
            wireIds: sch.wires.filter((w) => w.sheetId === sheetId).map((w) => w.id),
            labelIds: sch.labels.filter((l) => l.sheetId === sheetId).map((l) => l.id),
            junctionIds: sch.junctions.filter((j) => j.sheetId === sheetId).map((j) => j.id),
          });
        } else if (view === 'perfboard') {
          const pb = useProjectStore.getState().project.perfboard;
          usePerfboardStore.getState().select([
            ...pb.components.map((c) => c.id),
            ...pb.connections.map((c) => c.id),
            ...pb.trackCuts.map((t) => t.id),
          ]);
        }
        return;
      }

      // Suppress Ctrl+P — print
      if (ctrl && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        return;
      }
    };

    // Use capture phase so we intercept before the browser acts
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);

  return (
    <>
      {showIntro && <IntroScreen onClose={() => setShowIntro(false)} />}
      <AppLayout />
      <ProjectManager />
      <ToastContainer />
    </>
  );
}