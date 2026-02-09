import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { getBuiltInComponents } from '@/lib/component-library';
import type { ComponentDefinition, ComponentCategory } from '@/types';
import { COMPONENT_CATEGORIES } from '@/constants';
import { ProjectNotes } from '../ProjectNotes';
import {
  ChevronRight,
  ChevronDown,
  Search,
  Package,
  Layers,
  X,
  Pencil,
  Trash2,
} from 'lucide-react';

// Match helper: every search token must appear in at least one searchable field
function matchesSearch(comp: ComponentDefinition, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = [
    comp.name,
    comp.id,
    comp.category,
    comp.prefix ?? '',
    comp.description ?? '',
    ...(comp.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

// Highlight matching text
function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  // Build regex from tokens
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} className="text-lochcad-accent font-semibold">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function Sidebar() {
  const currentView = useProjectStore((s) => s.currentView);
  const customComponents = useProjectStore((s) => s.project.componentLibrary ?? []);
  const setCurrentView = useProjectStore((s) => s.setCurrentView);
  const setEditingComponent = useProjectStore((s) => s.setEditingComponent);
  const removeCustomComponent = useProjectStore((s) => s.removeCustomComponent);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Resistors', 'Capacitors']));
  const [activeTab, setActiveTab] = useState<'library' | 'project'>('library');
  const searchRef = useRef<HTMLInputElement>(null);

  const builtIn = useMemo(() => getBuiltInComponents(), []);
  const allComponents = useMemo(() => [...builtIn, ...customComponents], [builtIn, customComponents]);

  const searchTokens = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? q.split(/\s+/) : [];
  }, [searchQuery]);

  const isSearching = searchTokens.length > 0;

  const filteredComponents = useMemo(() => {
    if (!isSearching) return allComponents;
    return allComponents.filter((c) => matchesSearch(c, searchTokens));
  }, [allComponents, searchTokens, isSearching]);

  const grouped = useMemo(() => {
    const map = new Map<string, ComponentDefinition[]>();
    // Use the known order first, then append any extra categories found in components
    const knownCats: string[] = [...COMPONENT_CATEGORIES];
    const allCats = new Set(filteredComponents.map((c) => c.category));
    const orderedCats = [...knownCats, ...Array.from(allCats).filter((c) => !knownCats.includes(c))];
    for (const cat of orderedCats) {
      const items = filteredComponents.filter((c) => c.category === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [filteredComponents]);

  // Auto-expand all categories when searching
  const effectiveExpanded = useMemo(() => {
    if (isSearching) return new Set(Array.from(grouped.keys()));
    return expandedCategories;
  }, [isSearching, grouped, expandedCategories]);

  const toggleCategory = (cat: string) => {
    if (isSearching) return; // don't toggle while searching
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Keyboard shortcut: focus search with Ctrl+F when sidebar is visible
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'f' && activeTab === 'library') {
        // Only if not in an input already
        if (document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab]);

  const handlePlaceComponent = (comp: ComponentDefinition) => {
    if (currentView === 'schematic') {
      useSchematicStore.getState().setPlacingComponent(comp.id);
      useSchematicStore.getState().setActiveTool('place_component');
    } else if (currentView === 'perfboard') {
      usePerfboardStore.getState().setPlacingComponent(comp.id);
      usePerfboardStore.getState().setActiveTool('place_component');
    }
  };

  const handleEditComponent = (comp: ComponentDefinition) => {
    setEditingComponent(comp.id);
    setCurrentView('component-editor');
  };

  const handleDeleteComponent = (comp: ComponentDefinition, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`"${comp.name}" wirklich löschen?`)) {
      removeCustomComponent(comp.id);
    }
  };

  const isCustom = (comp: ComponentDefinition) => comp.id.startsWith('custom_');

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
                ref={searchRef}
                className="input w-full pl-7 pr-7 text-xs"
                placeholder="Suche: Name, Kategorie, Wert..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-lochcad-text-dim hover:text-lochcad-text p-0.5 rounded transition-colors"
                  onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {isSearching && (
              <div className="text-[10px] text-lochcad-text-dim mt-1 px-0.5">
                {filteredComponents.length} Treffer
              </div>
            )}
          </div>

          {/* Component Tree / Flat Results */}
          <div className="flex-1 overflow-y-auto pb-2">
            {isSearching ? (
              /* Flat result list when searching — faster to scan */
              filteredComponents.length > 0 ? (
                filteredComponents.map((comp) => (
                  <button
                    key={comp.id}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-lochcad-accent/10 rounded-sm transition-colors cursor-grab active:cursor-grabbing group"
                    onClick={() => handlePlaceComponent(comp)}
                    title={comp.description}
                  >
                    <div className="text-lochcad-text">
                      <Highlight text={comp.name} tokens={searchTokens} />
                    </div>
                    <div className="text-[10px] text-lochcad-text-dim/70 leading-tight">
                      <Highlight text={comp.category} tokens={searchTokens} />
                      {comp.description && (
                        <> · <Highlight text={comp.description} tokens={searchTokens} /></>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-4 text-xs text-lochcad-text-dim text-center">
                  Keine Bauteile gefunden
                </div>
              )
            ) : (
              /* Category tree when not searching */
              <>
                {Array.from(grouped.entries()).map(([category, components]) => (
                  <div key={category}>
                    <button
                      className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/10 transition-colors"
                      onClick={() => toggleCategory(category)}
                    >
                      {effectiveExpanded.has(category) ? (
                        <ChevronDown size={12} />
                      ) : (
                        <ChevronRight size={12} />
                      )}
                      {category}
                      <span className="ml-auto text-[10px] text-lochcad-text-dim/60">{components.length}</span>
                    </button>
                    {effectiveExpanded.has(category) && (
                      <div className="ml-2">
                        {components.map((comp) => (
                          <div
                            key={comp.id}
                            className="group/item flex items-center gap-0.5 hover:bg-lochcad-accent/10 rounded-sm transition-colors"
                          >
                            <button
                              className="flex-1 text-left px-3 py-1 text-xs text-lochcad-text-dim hover:text-lochcad-text cursor-grab active:cursor-grabbing truncate"
                              onClick={() => handlePlaceComponent(comp)}
                              title={comp.description ?? comp.name}
                            >
                              {comp.name || comp.id || '(Unbenannt)'}
                            </button>
                            {isCustom(comp) && (
                              <div className="hidden group-hover/item:flex items-center shrink-0 mr-1">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleEditComponent(comp); }}
                                  className="p-0.5 rounded text-lochcad-text-dim/50 hover:text-lochcad-accent transition-colors"
                                  title="Bearbeiten"
                                >
                                  <Pencil size={10} />
                                </button>
                                <button
                                  onClick={(e) => handleDeleteComponent(comp, e)}
                                  className="p-0.5 rounded text-lochcad-text-dim/50 hover:text-red-400 transition-colors"
                                  title="Löschen"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            )}
                          </div>
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
              </>
            )}
          </div>
        </>
      )}

      {activeTab === 'project' && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <ProjectTreeView />
          </div>
          <ProjectNotes />
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
