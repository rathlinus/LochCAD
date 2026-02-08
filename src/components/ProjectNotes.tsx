// ============================================================
// ProjectNotes — Panel for managing project notes
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectStore } from '@/stores/projectStore';
import { useToastStore } from '@/stores/toastStore';
import { exportNotesAsMarkdown } from '@/lib/export/project-file';
import type { ProjectNote } from '@/types';
import {
  StickyNote,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Download,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
} from 'lucide-react';

// ---- Note Editor ----
function NoteEditor({
  note,
  onSave,
  onCancel,
  isNew,
}: {
  note: { title: string; content: string };
  onSave: (title: string, content: string) => void;
  onCancel: () => void;
  isNew?: boolean;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSave = () => {
    if (!title.trim()) return;
    onSave(title.trim(), content);
  };

  return (
    <div className="p-2 space-y-2 border border-lochcad-accent/30 rounded-lg bg-lochcad-bg/50">
      <input
        ref={titleRef}
        className="input w-full text-sm font-medium"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Titel der Notiz..."
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) handleSave();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <textarea
        className="input w-full resize-none text-xs"
        rows={6}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Notiz schreiben... (Strg+Enter zum Speichern)"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.ctrlKey) handleSave();
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex justify-end gap-1.5">
        <button className="btn btn-secondary text-xs py-0.5" onClick={onCancel}>
          <X size={12} />
          Abbrechen
        </button>
        <button className="btn btn-primary text-xs py-0.5" onClick={handleSave} disabled={!title.trim()}>
          <Check size={12} />
          {isNew ? 'Erstellen' : 'Speichern'}
        </button>
      </div>
    </div>
  );
}

// ---- Single Note Card ----
function NoteCard({ note }: { note: ProjectNote }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleSave = (title: string, content: string) => {
    useProjectStore.getState().updateNote(note.id, { title, content });
    setEditing(false);
  };

  const handleDelete = () => {
    if (!confirm(`Notiz "${note.title}" löschen?`)) return;
    useProjectStore.getState().removeNote(note.id);
    useToastStore.getState().showToast('Notiz gelöscht', 'info');
  };

  if (editing) {
    return <NoteEditor note={note} onSave={handleSave} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="group rounded-lg border border-lochcad-panel/30 bg-lochcad-bg/30 hover:border-lochcad-panel/50 transition-colors">
      <div
        className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown size={12} className="text-lochcad-text-dim shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-lochcad-text-dim shrink-0" />
        )}
        <StickyNote size={12} className="text-lochcad-accent-warm shrink-0" />
        <span className="text-xs font-medium text-lochcad-text truncate flex-1">{note.title}</span>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="btn-icon p-0.5" onClick={(e) => { e.stopPropagation(); setEditing(true); }}>
            <Edit3 size={11} />
          </button>
          <button className="btn-icon p-0.5 hover:text-lochcad-error" onClick={(e) => { e.stopPropagation(); handleDelete(); }}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2 border-t border-lochcad-panel/20">
          <div className="text-[10px] text-lochcad-text-dim flex items-center gap-2 py-1">
            <Clock size={9} />
            Aktualisiert: {new Date(note.updatedAt).toLocaleString()}
          </div>
          <div className="text-xs text-lochcad-text whitespace-pre-wrap leading-relaxed">
            {note.content || <span className="italic text-lochcad-text-dim">Kein Inhalt</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main Panel ----
export function ProjectNotes() {
  const project = useProjectStore((s) => s.project);
  const notes = project.notes || [];
  const [adding, setAdding] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const handleAddNote = (title: string, content: string) => {
    useProjectStore.getState().addNote(title, content);
    setAdding(false);
    useToastStore.getState().showToast('Notiz hinzugefügt', 'success');
  };

  const handleExportNotes = useCallback(() => {
    const md = exportNotesAsMarkdown(project);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}_notizen.md`;
    a.click();
    URL.revokeObjectURL(url);
    useToastStore.getState().showToast('Notizen exportiert', 'success');
  }, [project]);

  return (
    <div className="border-t border-lochcad-panel/30">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-lochcad-panel/10 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <StickyNote size={14} className="text-lochcad-accent-warm" />
        <span className="text-xs font-semibold text-lochcad-text flex-1">
          Notizen
          {notes.length > 0 && (
            <span className="text-lochcad-text-dim font-normal ml-1">({notes.length})</span>
          )}
        </span>

        {!isCollapsed && (
          <div className="flex items-center gap-0.5">
            <button
              className="btn-icon p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                setAdding(true);
                setIsCollapsed(false);
              }}
              data-tooltip="Notiz hinzufügen"
            >
              <Plus size={13} />
            </button>
            {notes.length > 0 && (
              <button
                className="btn-icon p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExportNotes();
                }}
                data-tooltip="Notizen exportieren"
              >
                <Download size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div className="px-2 pb-2 space-y-1.5">
          {/* Add Note Form */}
          {adding && (
            <NoteEditor
              note={{ title: '', content: '' }}
              onSave={handleAddNote}
              onCancel={() => setAdding(false)}
              isNew
            />
          )}

          {/* Note List */}
          {notes.length === 0 && !adding ? (
            <div className="flex flex-col items-center py-4 text-lochcad-text-dim">
              <FileText size={20} className="mb-1 opacity-40" />
              <p className="text-[11px]">Keine Notizen</p>
              <button
                className="text-[11px] text-lochcad-accent hover:underline mt-1"
                onClick={() => setAdding(true)}
              >
                + Erste Notiz erstellen
              </button>
            </div>
          ) : (
            notes.map((note) => <NoteCard key={note.id} note={note} />)
          )}
        </div>
      )}
    </div>
  );
}
