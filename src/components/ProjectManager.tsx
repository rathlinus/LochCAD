// ============================================================
// ProjectManager — Full-featured modal for managing projects
// ============================================================

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useProjectManagerStore } from '@/stores/projectManagerStore';
import { useProjectStore } from '@/stores/projectStore';
import { useToastStore } from '@/stores/toastStore';
import type { ProjectListEntry } from '@/types';
import {
  FolderOpen,
  Plus,
  Trash2,
  Download,
  Upload,
  Copy,
  Edit3,
  X,
  Search,
  Tag,
  User,
  FileText,
  Clock,
  StickyNote,
  Layers,
  Cpu,
  Archive,
  Check,
  MoreVertical,
  ArrowUpDown,
  ExternalLink,
  HardDrive,
  FolderPlus,
  AlertTriangle,
} from 'lucide-react';

// ---- Relative time helper ----
function timeAgo(isoDate: string): string {
  if (!isoDate) return '—';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return '—';
  const diff = now - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return 'gerade eben';
  if (sec < 60) return `vor ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} Min.`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `vor ${hrs} Std.`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
  if (days < 30) return `vor ${Math.floor(days / 7)} Woche${Math.floor(days / 7) > 1 ? 'n' : ''}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `vor ${months} Monat${months > 1 ? 'en' : ''}`;
  const years = Math.floor(months / 12);
  return `vor ${years} Jahr${years > 1 ? 'en' : ''}`;
}

function formatDate(isoDate: string): string {
  if (!isoDate) return '—';
  try {
    return new Date(isoDate).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

type SortMode = 'updated' | 'created' | 'name' | 'components';

// ---- Storage usage helper ----
function estimateStorageUsage(): string {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('lochcad')) {
        total += (localStorage.getItem(key) || '').length * 2;
      }
    }
    if (total < 1024) return `${total} B`;
    if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} KB`;
    return `${(total / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return '—';
  }
}

// ============================================================
// New Project Form
// ============================================================
function NewProjectForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const current = useProjectStore.getState().project;
    if (current.author) setAuthor(current.author);
    inputRef.current?.focus();
  }, []);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    useProjectManagerStore.getState().createProject(trimmed, description.trim(), author.trim());
    useToastStore.getState().showToast(`Projekt "${trimmed}" erstellt`, 'success');
    onCreated();
  };

  return (
    <div className="border-b border-lochcad-panel/30 bg-lochcad-bg/30">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-lochcad-text flex items-center gap-2">
            <FolderPlus size={16} className="text-lochcad-accent" />
            Neues Projekt erstellen
          </h3>
          <button className="btn-icon" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div className="flex gap-3">
          <div className="flex-1 space-y-2">
            <div>
              <label className="input-label">Projektname *</label>
              <input
                ref={inputRef}
                className="input w-full"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') onCancel();
                }}
                placeholder="Mein neues Projekt"
              />
            </div>
            <div>
              <label className="input-label">Autor</label>
              <input
                className="input w-full"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Dein Name"
              />
            </div>
          </div>
          <div className="flex-1">
            <label className="input-label">Beschreibung</label>
            <textarea
              className="input w-full resize-none h-[calc(100%-20px)]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optionale Beschreibung..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-secondary text-xs" onClick={onCancel}>
            Abbrechen
          </button>
          <button className="btn btn-primary text-xs" onClick={handleCreate} disabled={!name.trim()}>
            <Plus size={13} />
            Erstellen & Öffnen
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Edit Metadata Form (inline)
// ============================================================
function EditMetaForm({ entry, onDone }: { entry: ProjectListEntry; onDone: () => void }) {
  const [name, setName] = useState(entry.name);
  const [description, setDescription] = useState(entry.description);
  const [author, setAuthor] = useState(entry.author);
  const [tagInput, setTagInput] = useState(entry.tags.join(', '));

  const handleSave = () => {
    const tags = tagInput.split(',').map((t) => t.trim()).filter(Boolean);
    useProjectManagerStore.getState().updateProjectMeta(entry.id, {
      name: name.trim() || entry.name,
      description: description.trim(),
      author: author.trim(),
      tags,
    });
    useToastStore.getState().showToast('Projektdetails aktualisiert', 'success');
    onDone();
  };

  return (
    <div className="p-3 space-y-2 bg-lochcad-bg/50 rounded-lg border border-lochcad-accent/20 mx-1">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="input-label">Projektname</label>
          <input
            className="input w-full text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') onDone();
            }}
            autoFocus
          />
        </div>
        <div className="flex-1">
          <label className="input-label">Autor</label>
          <input
            className="input w-full text-xs"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="input-label">Beschreibung</label>
        <textarea
          className="input w-full resize-none text-xs"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div>
        <label className="input-label">Tags (kommagetrennt)</label>
        <input
          className="input w-full text-xs"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="z.B. audio, verstärker, v2"
        />
      </div>
      <div className="flex justify-end gap-1.5 pt-1">
        <button className="btn btn-secondary text-xs py-0.5" onClick={onDone}>
          Abbrechen
        </button>
        <button className="btn btn-primary text-xs py-0.5" onClick={handleSave}>
          <Check size={12} />
          Speichern
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Delete Confirmation
// ============================================================
function DeleteConfirm({
  entry,
  isCurrent,
  onConfirm,
  onCancel,
}: {
  entry: ProjectListEntry;
  isCurrent: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-3 bg-lochcad-error/5 rounded-lg border border-lochcad-error/30 mx-1 animate-fade-in">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-lochcad-error shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs font-medium text-lochcad-text">
            Projekt „{entry.name}" unwiderruflich löschen?
          </p>
          {isCurrent && (
            <p className="text-[10px] text-lochcad-warning mt-1">
              Dies ist das aktuell aktive Projekt. Ein leeres Projekt wird stattdessen erstellt.
            </p>
          )}
          <p className="text-[10px] text-lochcad-text-dim mt-1">
            {entry.componentCount} Bauteile, {entry.sheetCount} Blätter
            {entry.noteCount > 0 && `, ${entry.noteCount} Notizen`} gehen verloren.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-1.5 mt-2">
        <button className="btn btn-secondary text-xs py-0.5" onClick={onCancel}>
          Abbrechen
        </button>
        <button
          className="btn text-xs py-0.5 bg-lochcad-error hover:bg-lochcad-error/80 text-white"
          onClick={onConfirm}
        >
          <Trash2 size={12} />
          Endgültig löschen
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Project Card
// ============================================================
function ProjectCard({
  entry,
  isCurrent,
  onOpen,
  onEdit,
  onDelete,
  onDuplicate,
  onExport,
}: {
  entry: ProjectListEntry;
  isCurrent: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onExport: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <div
      className={`group rounded-lg border transition-all duration-150 ${
        isCurrent
          ? 'border-lochcad-accent/50 bg-lochcad-accent/8 ring-1 ring-lochcad-accent/20'
          : 'border-lochcad-panel/30 bg-lochcad-surface hover:border-lochcad-panel/50 hover:bg-lochcad-bg/60'
      }`}
    >
      <div className="p-3">
        {/* Row 1: Name + Actions */}
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
            <div className="flex items-center gap-2">
              <FileText
                size={14}
                className={isCurrent ? 'text-lochcad-accent shrink-0' : 'text-lochcad-text-dim shrink-0'}
              />
              <span className="text-sm font-semibold text-lochcad-text truncate">{entry.name}</span>
              {isCurrent && (
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-lochcad-accent/20 text-lochcad-accent font-bold shrink-0">
                  aktiv
                </span>
              )}
            </div>
          </div>

          {/* Quick action buttons */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isCurrent && (
              <button className="btn-icon p-1" onClick={onOpen} data-tooltip="Projekt öffnen">
                <ExternalLink size={13} />
              </button>
            )}
            <button className="btn-icon p-1" onClick={onEdit} data-tooltip="Bearbeiten">
              <Edit3 size={13} />
            </button>
            <button className="btn-icon p-1" onClick={onExport} data-tooltip="Exportieren">
              <Download size={13} />
            </button>

            {/* More menu */}
            <div className="relative" ref={menuRef}>
              <button
                className="btn-icon p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
              >
                <MoreVertical size={13} />
              </button>
              {showMenu && (
                <div className="context-menu right-0 top-full mt-1 min-w-[150px] animate-fade-in z-[400]">
                  <div
                    className="context-menu-item"
                    onClick={() => {
                      onOpen();
                      setShowMenu(false);
                    }}
                  >
                    <FolderOpen size={12} />
                    {isCurrent ? 'Schließen' : 'Öffnen'}
                  </div>
                  <div
                    className="context-menu-item"
                    onClick={() => {
                      onEdit();
                      setShowMenu(false);
                    }}
                  >
                    <Edit3 size={12} />
                    Bearbeiten
                  </div>
                  <div
                    className="context-menu-item"
                    onClick={() => {
                      onDuplicate();
                      setShowMenu(false);
                    }}
                  >
                    <Copy size={12} />
                    Duplizieren
                  </div>
                  <div
                    className="context-menu-item"
                    onClick={() => {
                      onExport();
                      setShowMenu(false);
                    }}
                  >
                    <Download size={12} />
                    Exportieren
                  </div>
                  <div className="context-menu-separator" />
                  <div
                    className="context-menu-item text-lochcad-error"
                    onClick={() => {
                      onDelete();
                      setShowMenu(false);
                    }}
                  >
                    <Trash2 size={12} />
                    Löschen
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Description */}
        {entry.description && (
          <p className="text-[11px] text-lochcad-text-dim mt-1 ml-[22px] line-clamp-2">{entry.description}</p>
        )}

        {/* Row 3: Meta stats */}
        <div className="flex items-center gap-3 mt-2 ml-[22px] text-[10px] text-lochcad-text-dim">
          {entry.author && (
            <span className="flex items-center gap-1">
              <User size={9} />
              {entry.author}
            </span>
          )}
          <span className="flex items-center gap-1" title="Blätter">
            <Layers size={9} />
            {entry.sheetCount}
          </span>
          <span className="flex items-center gap-1" title="Bauteile">
            <Cpu size={9} />
            {entry.componentCount}
          </span>
          {entry.noteCount > 0 && (
            <span className="flex items-center gap-1" title="Notizen">
              <StickyNote size={9} />
              {entry.noteCount}
            </span>
          )}
          <span className="flex items-center gap-1 ml-auto" title={formatDate(entry.updatedAt)}>
            <Clock size={9} />
            {timeAgo(entry.updatedAt)}
          </span>
        </div>

        {/* Row 4: Tags */}
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 ml-[22px]">
            {entry.tags.map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                className="text-[9px] px-1.5 py-0.5 rounded bg-lochcad-panel/40 text-lochcad-text-dim"
              >
                <Tag size={8} className="inline mr-0.5" />
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Empty State
// ============================================================
function EmptyState({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-lochcad-text-dim">
      <div className="w-16 h-16 rounded-full bg-lochcad-panel/20 flex items-center justify-center mb-4">
        <FolderOpen size={28} className="opacity-40" />
      </div>
      <p className="text-sm font-medium text-lochcad-text mb-1">Noch keine gespeicherten Projekte</p>
      <p className="text-xs text-center max-w-[300px] mb-4">
        Projekte werden automatisch im Browser gespeichert. Erstelle ein neues Projekt oder importiere
        eine bestehende Datei.
      </p>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary text-xs" onClick={onNew}>
          <Plus size={14} />
          Neues Projekt
        </button>
        <button className="btn btn-secondary text-xs" onClick={onImport}>
          <Upload size={14} />
          Datei importieren
        </button>
      </div>
    </div>
  );
}

// ============================================================
// No Results State
// ============================================================
function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-lochcad-text-dim">
      <Search size={24} className="mb-2 opacity-40" />
      <p className="text-sm">Keine Ergebnisse für „{query}"</p>
      <button className="text-xs text-lochcad-accent hover:underline mt-2" onClick={onClear}>
        Suche zurücksetzen
      </button>
    </div>
  );
}

// ============================================================
// Main Modal
// ============================================================
export function ProjectManager() {
  const { projects, isOpen, close, refreshIndex, saveCurrentProject, importProjectFromFile, exportAllProjects } =
    useProjectManagerStore();
  const currentProject = useProjectStore((s) => s.project);

  const [showNewForm, setShowNewForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('updated');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showSort, setShowSort] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  // Refresh on open
  useEffect(() => {
    if (isOpen) {
      saveCurrentProject();
      refreshIndex();
      setShowNewForm(false);
      setSearchQuery('');
      setEditingId(null);
      setDeletingId(null);
      setShowSort(false);
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on Escape — layered (closes deepest open thing first)
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showSort) {
          setShowSort(false);
        } else if (showNewForm) {
          setShowNewForm(false);
        } else if (editingId) {
          setEditingId(null);
        } else if (deletingId) {
          setDeletingId(null);
        } else {
          close();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close, showNewForm, editingId, deletingId, showSort]);

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!showSort) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setShowSort(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSort]);

  // Import
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lochcad,.lochcad-archive,.json';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      let importedCount = 0;
      for (const file of Array.from(files)) {
        const result = await importProjectFromFile(file);
        if (result === 'archive') {
          importedCount += 2; // approximation
        } else if (result) {
          importedCount++;
        }
      }
      if (importedCount > 0) {
        useToastStore.getState().showToast(
          importedCount === 1 ? 'Projekt importiert' : `${importedCount} Projekte importiert`,
          'success'
        );
      } else {
        useToastStore.getState().showToast('Import fehlgeschlagen – ungültiges Dateiformat', 'error');
      }
      refreshIndex();
    };
    input.click();
  }, [importProjectFromFile, refreshIndex]);

  // Open project
  const handleOpenProject = useCallback(
    (id: string) => {
      if (id === currentProject.id) {
        close();
        return;
      }
      const success = useProjectManagerStore.getState().openProject(id);
      if (success) {
        useToastStore.getState().showToast('Projekt geöffnet', 'success');
        close();
      } else {
        useToastStore.getState().showToast('Projekt konnte nicht geladen werden', 'error');
      }
    },
    [currentProject.id, close]
  );

  // Delete
  const handleDeleteProject = useCallback(
    (id: string) => {
      useProjectManagerStore.getState().deleteProject(id);
      useToastStore.getState().showToast('Projekt gelöscht', 'info');
      setDeletingId(null);
      refreshIndex();
    },
    [refreshIndex]
  );

  // Duplicate
  const handleDuplicate = useCallback(
    (id: string) => {
      const newId = useProjectManagerStore.getState().duplicateProject(id);
      if (newId) {
        useToastStore.getState().showToast('Projekt dupliziert', 'success');
        refreshIndex();
      }
    },
    [refreshIndex]
  );

  // Export
  const handleExport = useCallback((id: string) => {
    useProjectManagerStore.getState().exportProject(id);
    useToastStore.getState().showToast('Export gestartet', 'success');
  }, []);

  // Sort + filter
  const sortedAndFiltered = useMemo(() => {
    let list = [...projects];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    switch (sortMode) {
      case 'updated':
        list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case 'created':
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        break;
      case 'components':
        list.sort((a, b) => b.componentCount - a.componentCount);
        break;
    }

    return list;
  }, [projects, searchQuery, sortMode]);

  const storageUsage = useMemo(() => (isOpen ? estimateStorageUsage() : ''), [isOpen, projects]);

  if (!isOpen) return null;

  const sortLabels: Record<SortMode, string> = {
    updated: 'Zuletzt bearbeitet',
    created: 'Erstelldatum',
    name: 'Name A-Z',
    components: 'Bauteilanzahl',
  };
  const sortOptions: SortMode[] = ['updated', 'created', 'name', 'components'];

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) close();
      }}
    >
      <div className="bg-lochcad-surface rounded-xl border border-lochcad-panel/40 shadow-2xl w-[720px] max-h-[85vh] flex flex-col animate-fade-in">
        {/* ---- Header ---- */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-lochcad-panel/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-lochcad-accent/15 flex items-center justify-center">
              <FolderOpen size={16} className="text-lochcad-accent" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-lochcad-text leading-tight">Projekte verwalten</h2>
              <p className="text-[10px] text-lochcad-text-dim">
                {projects.length} Projekt{projects.length !== 1 ? 'e' : ''} · {storageUsage} Speicher
              </p>
            </div>
          </div>
          <button className="btn-icon hover:bg-lochcad-panel/40" onClick={close}>
            <X size={16} />
          </button>
        </div>

        {/* ---- Toolbar ---- */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-lochcad-panel/20 shrink-0">
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-lochcad-text-dim" />
            <input
              ref={searchRef}
              className="input w-full pl-8 pr-8 py-1.5 text-xs"
              placeholder="Name, Beschreibung, Autor oder Tag suchen..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-lochcad-text-dim hover:text-lochcad-text p-0.5"
                onClick={() => {
                  setSearchQuery('');
                  searchRef.current?.focus();
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Sort dropdown */}
          <div className="relative" ref={sortRef}>
            <button
              className="btn btn-secondary text-xs py-1.5 gap-1.5"
              onClick={() => setShowSort(!showSort)}
            >
              <ArrowUpDown size={12} />
              <span className="max-w-[120px] truncate">{sortLabels[sortMode]}</span>
            </button>
            {showSort && (
              <div className="context-menu right-0 top-full mt-1 min-w-[170px] animate-fade-in z-[400]">
                {sortOptions.map((opt) => (
                  <div
                    key={opt}
                    className={`context-menu-item ${sortMode === opt ? 'text-lochcad-accent' : ''}`}
                    onClick={() => {
                      setSortMode(opt);
                      setShowSort(false);
                    }}
                  >
                    {sortMode === opt ? <Check size={11} /> : <span className="w-[11px]" />}
                    {sortLabels[opt]}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <button
            className={`btn text-xs py-1.5 ${showNewForm ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setShowNewForm(!showNewForm);
              setEditingId(null);
              setDeletingId(null);
            }}
          >
            <Plus size={13} />
            Neu
          </button>
          <button className="btn btn-secondary text-xs py-1.5" onClick={handleImport}>
            <Upload size={13} />
            Import
          </button>
          {projects.length > 0 && (
            <button
              className="btn btn-secondary text-xs py-1.5"
              onClick={exportAllProjects}
              data-tooltip="Alle Projekte als Archiv exportieren"
            >
              <Archive size={13} />
            </button>
          )}
        </div>

        {/* ---- New Project Form ---- */}
        {showNewForm && (
          <NewProjectForm
            onCreated={() => {
              setShowNewForm(false);
              refreshIndex();
              close();
            }}
            onCancel={() => setShowNewForm(false)}
          />
        )}

        {/* ---- Project List ---- */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px]">
          {projects.length === 0 ? (
            <EmptyState onNew={() => setShowNewForm(true)} onImport={handleImport} />
          ) : sortedAndFiltered.length === 0 ? (
            <NoResults query={searchQuery} onClear={() => setSearchQuery('')} />
          ) : (
            sortedAndFiltered.map((entry) => (
              <React.Fragment key={entry.id}>
                <ProjectCard
                  entry={entry}
                  isCurrent={entry.id === currentProject.id}
                  onOpen={() => handleOpenProject(entry.id)}
                  onEdit={() => {
                    setEditingId(editingId === entry.id ? null : entry.id);
                    setDeletingId(null);
                  }}
                  onDelete={() => {
                    setDeletingId(deletingId === entry.id ? null : entry.id);
                    setEditingId(null);
                  }}
                  onDuplicate={() => handleDuplicate(entry.id)}
                  onExport={() => handleExport(entry.id)}
                />
                {editingId === entry.id && (
                  <EditMetaForm
                    entry={entry}
                    onDone={() => {
                      setEditingId(null);
                      refreshIndex();
                    }}
                  />
                )}
                {deletingId === entry.id && (
                  <DeleteConfirm
                    entry={entry}
                    isCurrent={entry.id === currentProject.id}
                    onConfirm={() => handleDeleteProject(entry.id)}
                    onCancel={() => setDeletingId(null)}
                  />
                )}
              </React.Fragment>
            ))
          )}
        </div>

        {/* ---- Footer ---- */}
        <div className="px-4 py-2 border-t border-lochcad-panel/20 text-[10px] text-lochcad-text-dim flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <HardDrive size={9} />
              Lokal im Browser gespeichert
            </span>
            <span>Klick zum Öffnen · Strg+Shift+P</span>
          </div>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-lochcad-success animate-pulse" />
            Autosave aktiv
          </span>
        </div>
      </div>
    </div>
  );
}
