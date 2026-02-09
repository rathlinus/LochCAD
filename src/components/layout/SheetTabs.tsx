import React, { useState } from 'react';
import { useProjectStore } from '@/stores';
import { getSheetBreadcrumbs } from '@/stores/projectStore';
import { Plus, X, Edit2, ChevronRight, ArrowUp, FileBox } from 'lucide-react';

export function SheetTabs() {
  const sheets = useProjectStore((s) => s.project.schematic.sheets);
  const activeSheetId = useProjectStore((s) => s.activeSheetId);
  const { setActiveSheet, addSheet, removeSheet, renameSheet, navigateUp } = useProjectStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showHierarchyMenu, setShowHierarchyMenu] = useState(false);

  const breadcrumbs = getSheetBreadcrumbs();
  const currentSheet = sheets.find((s) => s.id === activeSheetId);
  const hasParent = currentSheet?.parentSheetId !== null && currentSheet?.parentSheetId !== undefined;

  // Get children of the active sheet (for "add child" context)
  const childSheets = sheets.filter((s) => s.parentSheetId === activeSheetId);

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const finishRename = () => {
    if (editingId && editName.trim()) {
      renameSheet(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const addChildSheet = () => {
    const childName = `Sub-Sheet ${sheets.length + 1}`;
    const newId = addSheet(childName, activeSheetId);
    // Also create a hierarchical sheet instance on the parent sheet
    useProjectStore.getState().addHierarchicalSheetInstance(
      newId,
      { x: 200, y: 200 },
      { width: 160, height: 120 },
      activeSheetId,
    );
    setShowHierarchyMenu(false);
  };

  return (
    <div className="h-8 bg-lochcad-surface border-t border-lochcad-panel/30 flex items-center px-1 gap-0.5 shrink-0 overflow-x-auto overflow-y-visible relative">
      {/* Breadcrumb navigation */}
      {breadcrumbs.length > 1 && (
        <div className="flex items-center gap-0.5 mr-1 pr-2 border-r border-lochcad-panel/30">
          {hasParent && (
            <button
              className="btn-icon text-lochcad-accent"
              onClick={() => navigateUp()}
              data-tooltip="Übergeordnetes Sheet"
            >
              <ArrowUp size={12} />
            </button>
          )}
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              {idx > 0 && <ChevronRight size={10} className="text-lochcad-text-dim" />}
              <button
                className={`text-[10px] px-1 py-0.5 rounded transition-colors ${
                  crumb.id === activeSheetId
                    ? 'text-lochcad-accent font-semibold'
                    : 'text-lochcad-text-dim hover:text-lochcad-text'
                }`}
                onClick={() => setActiveSheet(crumb.id)}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Sheet tabs — show siblings of current level */}
      {sheets.filter((s) => s.parentSheetId === (currentSheet?.parentSheetId ?? null)).map((sheet) => (
        <div
          key={sheet.id}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer group transition-colors ${
            activeSheetId === sheet.id
              ? 'bg-lochcad-accent/20 text-lochcad-accent'
              : 'text-lochcad-text-dim hover:text-lochcad-text hover:bg-lochcad-panel/20'
          }`}
          onClick={() => setActiveSheet(sheet.id)}
        >
          {editingId === sheet.id ? (
            <input
              className="input w-20 text-xs py-0"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={finishRename}
              onKeyDown={(e) => e.key === 'Enter' && finishRename()}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span>{sheet.name}</span>
              {/* Show child sheet count indicator */}
              {sheets.some((s) => s.parentSheetId === sheet.id) && (
                <span className="text-[9px] text-lochcad-accent/60 ml-0.5" title="Hat Unter-Sheets">
                  ▾
                </span>
              )}
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(sheet.id, sheet.name);
                }}
              >
                <Edit2 size={10} />
              </button>
              {sheets.length > 1 && (
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-lochcad-error"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSheet(sheet.id);
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {/* Add sheet buttons */}
      <button
        className="btn-icon ml-1"
        onClick={() => addSheet(`Sheet ${sheets.length + 1}`, currentSheet?.parentSheetId ?? null)}
        data-tooltip="Neues Sheet (gleiche Ebene)"
      >
        <Plus size={14} />
      </button>

      <div className="relative" style={{ overflow: 'visible' }}>
        <button
          className="btn-icon ml-0.5"
          onClick={() => setShowHierarchyMenu(!showHierarchyMenu)}
          title="Unter-Sheet hinzufügen"
        >
          <FileBox size={14} />
        </button>

        {showHierarchyMenu && (
          <div className="fixed bg-lochcad-surface border border-lochcad-panel/30 rounded shadow-lg p-1 min-w-[180px]" style={{ zIndex: 9999, bottom: '2.5rem', left: 'auto' }} ref={(el) => { if (el) { const btn = el.parentElement?.querySelector('button'); if (btn) { const r = btn.getBoundingClientRect(); el.style.left = r.left + 'px'; el.style.bottom = (window.innerHeight - r.top + 4) + 'px'; } } }}>
            <button
              className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-lochcad-panel/20 text-lochcad-text flex items-center gap-1.5"
              onClick={addChildSheet}
            >
              <FileBox size={12} className="text-lochcad-accent" />
              Unter-Sheet erstellen
            </button>
            {childSheets.length > 0 && (
              <>
                <div className="border-t border-lochcad-panel/30 my-1" />
                <div className="text-[10px] text-lochcad-text-dim px-2 py-0.5">Unter-Sheets:</div>
                {childSheets.map((child) => (
                  <button
                    key={child.id}
                    className="w-full text-left text-xs px-2 py-1 rounded hover:bg-lochcad-panel/20 text-lochcad-text-dim hover:text-lochcad-text"
                    onClick={() => {
                      setActiveSheet(child.id);
                      setShowHierarchyMenu(false);
                    }}
                  >
                    → {child.name}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
