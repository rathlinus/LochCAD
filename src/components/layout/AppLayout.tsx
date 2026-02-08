import React, { Suspense, lazy } from 'react';
import { useProjectStore } from '@/stores';
import { TopBar } from './TopBar';
import { Toolbar } from './Toolbar';
import { Sidebar } from '../sidebar/Sidebar';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { SheetTabs } from './SheetTabs';
import { StatusBar } from './StatusBar';

const SchematicEditor = lazy(() => import('@/features/schematic-editor/SchematicEditor'));
const PerfboardEditor = lazy(() => import('@/features/perfboard-editor/PerfboardEditor'));
const Preview3D = lazy(() => import('@/features/preview-3d/Preview3D'));
const ComponentEditor = lazy(() => import('@/features/component-editor/ComponentEditor'));

function LoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center bg-lochcad-bg">
      <div className="text-lochcad-text-dim text-sm">Laden...</div>
    </div>
  );
}

export function AppLayout() {
  const currentView = useProjectStore((s) => s.currentView);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* Top Bar — Project name, menu, view tabs */}
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar — Component library, sheets */}
        <Sidebar />

        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Toolbar — Tools for current view */}
          <Toolbar />

          {/* Main Canvas */}
          <div className="flex-1 relative overflow-hidden">
            <Suspense fallback={<LoadingFallback />}>
              {currentView === 'schematic' && <SchematicEditor />}
              {currentView === 'perfboard' && <PerfboardEditor />}
              {currentView === 'preview3d' && <Preview3D />}
              {currentView === 'component-editor' && <ComponentEditor />}
            </Suspense>
          </div>

          {/* Sheet Tabs (only for schematic view) */}
          {currentView === 'schematic' && <SheetTabs />}
        </div>

        {/* Right Panel — Properties */}
        <PropertiesPanel />
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}
