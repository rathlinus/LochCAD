import React, { useState, useMemo } from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { getBuiltInComponents } from '@/lib/component-library';
import type { ComponentDefinition, ComponentCategory } from '@/types';
import { COMPONENT_CATEGORIES } from '@/constants';
import {
  ChevronRight,
  ChevronDown,
  Search,
  Package,
  Layers,
} from 'lucide-react';

export function Sidebar() {
  const currentView = useProjectStore((s) => s.currentView);
  const customComponents = useProjectStore((s) => s.project.componentLibrary);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Resistors', 'Capacitors']));
  const [activeTab, setActiveTab] = useState<'library' | 'project'>('library');

  const builtIn = useMemo(() => getBuiltInComponents(), []);
  const allComponents = useMemo(() => [...builtIn, ...customComponents], [builtIn, customComponents]);

  const filteredComponents = useMemo(() => {
    if (!searchQuery.trim()) return allComponents;
    const q = searchQuery.toLowerCase();
    return allComponents.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.keywords?.some((k) => k.toLowerCase().includes(q))
    );
  }, [allComponents, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, ComponentDefinition[]>();
    for (const cat of COMPONENT_CATEGORIES) {
      const items = filteredComponents.filter((c) => c.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [filteredComponents]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handlePlaceComponent = (comp: ComponentDefinition) => {
    if (currentView === 'schematic') {
      useSchematicStore.getState().setPlacingComponent(comp.id);
      useSchematicStore.getState().setActiveTool('place_component');
    } else if (currentView === 'perfboard') {
      usePerfboardStore.getState().setPlacingComponent(comp.id);
      usePerfboardStore.getState().setActiveTool('place_component');
    }
  };

  if (currentView === 'preview3d') {
    return (
      <div className="w-52 bg-lochcad-surface border-r border-lochcad-panel/30 flex flex-col shrink-0">
        <div className="panel-header">
          <Layers size={14} />
          3D Ansicht
        </div>
        <div className="p-3 text-xs text-lochcad-text-dim">
          Orbit: Linke Maustaste<br />
          Zoom: Mausrad<br />
          Pan: Rechte Maustaste
        </div>
      </div>
    );
  }

  return (
    <div className="w-52 bg-lochcad-surface border-r border-lochcad-panel/30 flex flex-col shrink-0 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-lochcad-panel/30">
        <button
          className={`tab flex-1 text-xs ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          <Package size={12} className="inline mr-1" />
          Bibliothek
        </button>
        <button
          className={`tab flex-1 text-xs ${activeTab === 'project' ? 'active' : ''}`}
          onClick={() => setActiveTab('project')}
        >
          <Layers size={12} className="inline mr-1" />
          Projekt
        </button>
      </div>

      {activeTab === 'library' && (
        <>
          {/* Search */}
          <div className="p-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-lochcad-text-dim" />
              <input
                className="input w-full pl-7 text-xs"
                placeholder="Bauteil suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Component Tree */}
          <div className="flex-1 overflow-y-auto pb-2">
            {Array.from(grouped.entries()).map(([category, components]) => (
              <div key={category}>
                <button
                  className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/10 transition-colors"
                  onClick={() => toggleCategory(category)}
                >
                  {expandedCategories.has(category) ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  {category}
                  <span className="ml-auto text-[10px] text-lochcad-text-dim/60">{components.length}</span>
                </button>
                {expandedCategories.has(category) && (
                  <div className="ml-2">
                    {components.map((comp) => (
                      <button
                        key={comp.id}
                        className="w-full text-left px-3 py-1 text-xs text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-accent/10 rounded-sm transition-colors cursor-grab active:cursor-grabbing"
                        onClick={() => handlePlaceComponent(comp)}
                        title={comp.description}
                      >
                        {comp.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {grouped.size === 0 && (
              <div className="px-3 py-4 text-xs text-lochcad-text-dim text-center">
                Keine Bauteile gefunden
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'project' && (
        <div className="flex-1 overflow-y-auto p-2">
          <ProjectTreeView />
        </div>
      )}
    </div>
  );
}

function ProjectTreeView() {
  const project = useProjectStore((s) => s.project);
  const schematic = project.schematic;
  const perfboard = project.perfboard;

  return (
    <div className="text-xs space-y-2">
      <div>
        <div className="font-semibold text-lochcad-text mb-1">Schaltplan</div>
        <div className="ml-2 text-lochcad-text-dim">
          <div>{schematic.sheets.length} Sheet(s)</div>
          <div>{schematic.components.length} Bauteile</div>
          <div>{schematic.wires.length} Drähte</div>
          <div>{schematic.labels.length} Labels</div>
        </div>
      </div>
      <div>
        <div className="font-semibold text-lochcad-text mb-1">Lochraster</div>
        <div className="ml-2 text-lochcad-text-dim">
          <div>{perfboard.width}×{perfboard.height} ({perfboard.boardType})</div>
          <div>{perfboard.components.length} Bauteile</div>
          <div>{perfboard.connections.length} Verbindungen</div>
          {perfboard.boardType === 'stripboard' && (
            <div>{perfboard.trackCuts.length} Track-Cuts</div>
          )}
        </div>
      </div>
    </div>
  );
}
