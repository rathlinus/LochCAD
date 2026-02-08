import React, { useState } from 'react';
import { useProjectStore } from '@/stores';
import { Plus, X, Edit2 } from 'lucide-react';

export function SheetTabs() {
  const sheets = useProjectStore((s) => s.project.schematic.sheets);
  const activeSheetId = useProjectStore((s) => s.activeSheetId);
  const { setActiveSheet, addSheet, removeSheet, renameSheet } = useProjectStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

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

  return (
    <div className="h-8 bg-lochcad-surface border-t border-lochcad-panel/30 flex items-center px-1 gap-0.5 shrink-0 overflow-x-auto">
      {sheets.map((sheet) => (
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
      <button
        className="btn-icon ml-1"
        onClick={() => addSheet(`Sheet ${sheets.length + 1}`)}
        data-tooltip="Neues Sheet"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
