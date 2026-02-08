// ============================================================
// Project Manager Store — Multi-project storage & management
// ============================================================

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { Project, ProjectListEntry } from '@/types';
import { useProjectStore, createEmptyProject, getLastActiveProjectId } from './projectStore';

// ---- Storage Keys ----
const INDEX_KEY = 'lochcad-projects-index';
const PROJECT_PREFIX = 'lochcad-project-';

// ---- Helpers ----

function loadIndex(): ProjectListEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ProjectListEntry[];
  } catch {
    return [];
  }
}

function saveIndex(entries: ProjectListEntry[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

function projectKey(id: string): string {
  return `${PROJECT_PREFIX}${id}`;
}

function saveProjectData(project: Project): void {
  try {
    localStorage.setItem(projectKey(project.id), JSON.stringify(project));
  } catch (e) {
    console.warn('Failed to save project data:', e);
  }
}

function loadProjectData(id: string): Project | null {
  try {
    const raw = localStorage.getItem(projectKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

function removeProjectData(id: string): void {
  localStorage.removeItem(projectKey(id));
}

function entryFromProject(project: Project): ProjectListEntry {
  return {
    id: project.id,
    name: project.name,
    description: project.description || '',
    author: project.author || '',
    tags: project.tags || [],
    createdAt: project.createdAt,
    updatedAt: project.updatedAt || new Date().toISOString(),
    noteCount: project.notes?.length || 0,
    componentCount: project.schematic?.components?.length || 0,
    sheetCount: project.schematic?.sheets?.length || 0,
  };
}

// ---- Migrate legacy autosave if needed ----
function migrateLegacy(): void {
  const index = loadIndex();
  if (index.length > 0) return; // already has projects

  // Check for legacy single-project saves
  for (const key of ['lochcad-autosave', 'lochcad-project']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const proj = JSON.parse(raw) as Project;
      if (proj && proj.schematic && proj.perfboard) {
        // Ensure new fields
        if (!proj.description) proj.description = '';
        if (!proj.author) proj.author = '';
        if (!proj.tags) proj.tags = [];
        if (!proj.notes) proj.notes = [];
        saveProjectData(proj);
        saveIndex([entryFromProject(proj)]);
        return; // migrated one project
      }
    } catch { /* ignore */ }
  }
}

migrateLegacy();

// ---- Store ----

interface ProjectManagerState {
  projects: ProjectListEntry[];
  isOpen: boolean;

  // UI
  open: () => void;
  close: () => void;

  // Actions
  refreshIndex: () => void;
  createProject: (name: string, description?: string, author?: string) => string;
  duplicateProject: (id: string) => string | null;
  deleteProject: (id: string) => void;
  openProject: (id: string) => boolean;
  saveCurrentProject: () => void;
  renameProject: (id: string, name: string) => void;
  updateProjectMeta: (id: string, updates: Partial<Pick<ProjectListEntry, 'name' | 'description' | 'author' | 'tags'>>) => void;

  // Import / Export
  exportProject: (id: string) => void;
  exportAllProjects: () => void;
  importProjectFromFile: (file: File) => Promise<string | null>;
  importAllFromFile: (file: File) => Promise<number>;
}

export const useProjectManagerStore = create<ProjectManagerState>()((set, get) => ({
  projects: loadIndex(),
  isOpen: false,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  refreshIndex: () => {
    set({ projects: loadIndex() });
  },

  createProject: (name, description = '', author = '') => {
    const proj = createEmptyProject(name);
    proj.description = description;
    proj.author = author;

    // Save current project first
    get().saveCurrentProject();

    // Store the new project
    saveProjectData(proj);
    const index = loadIndex();
    index.unshift(entryFromProject(proj));
    saveIndex(index);

    // Switch to it
    useProjectStore.getState().setProject(proj);

    set({ projects: index });
    return proj.id;
  },

  duplicateProject: (id) => {
    const source = loadProjectData(id);
    if (!source) return null;

    const newProj: Project = {
      ...JSON.parse(JSON.stringify(source)),
      id: uuid(),
      name: `${source.name} (Kopie)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveProjectData(newProj);
    const index = loadIndex();
    index.unshift(entryFromProject(newProj));
    saveIndex(index);
    set({ projects: index });
    return newProj.id;
  },

  deleteProject: (id) => {
    const currentId = useProjectStore.getState().project.id;
    removeProjectData(id);
    const index = loadIndex().filter(e => e.id !== id);
    saveIndex(index);
    set({ projects: index });

    // If we deleted the active project, switch to another or create new
    if (id === currentId) {
      if (index.length > 0) {
        const next = loadProjectData(index[0].id);
        if (next) {
          if (!next.description) next.description = '';
          if (!next.author) next.author = '';
          if (!next.tags) next.tags = [];
          if (!next.notes) next.notes = [];
          useProjectStore.getState().setProject(next);
          return;
        }
      }
      // No projects left — create a fresh one
      const fresh = createEmptyProject();
      saveProjectData(fresh);
      const newIndex = [entryFromProject(fresh)];
      saveIndex(newIndex);
      set({ projects: newIndex });
      useProjectStore.getState().setProject(fresh);
    }
  },

  openProject: (id) => {
    // Save current first
    get().saveCurrentProject();

    const proj = loadProjectData(id);
    if (!proj) return false;

    // Ensure new fields exist
    if (!proj.description) proj.description = '';
    if (!proj.author) proj.author = '';
    if (!proj.tags) proj.tags = [];
    if (!proj.notes) proj.notes = [];

    useProjectStore.getState().setProject(proj);
    return true;
  },

  saveCurrentProject: () => {
    const proj = { ...useProjectStore.getState().project };
    if (!proj?.id) return;

    proj.updatedAt = new Date().toISOString();
    saveProjectData(proj);

    // Update index
    const index = loadIndex();
    const idx = index.findIndex(e => e.id === proj.id);
    const entry = entryFromProject(proj);
    if (idx >= 0) {
      index[idx] = entry;
    } else {
      index.unshift(entry);
    }
    saveIndex(index);
    useProjectStore.getState().markClean();
    set({ projects: index });
  },

  renameProject: (id, name) => {
    const index = loadIndex();
    const entry = index.find(e => e.id === id);
    if (entry) {
      entry.name = name;
      entry.updatedAt = new Date().toISOString();
      saveIndex(index);
    }

    // If it's the current project, update the store too
    const current = useProjectStore.getState().project;
    if (current.id === id) {
      useProjectStore.getState().setProjectName(name);
    } else {
      // Update the stored project data
      const proj = loadProjectData(id);
      if (proj) {
        proj.name = name;
        proj.updatedAt = new Date().toISOString();
        saveProjectData(proj);
      }
    }

    set({ projects: loadIndex() });
  },

  updateProjectMeta: (id, updates) => {
    const index = loadIndex();
    const entry = index.find(e => e.id === id);
    if (entry) {
      if (updates.name !== undefined) entry.name = updates.name;
      if (updates.description !== undefined) entry.description = updates.description;
      if (updates.author !== undefined) entry.author = updates.author;
      if (updates.tags !== undefined) entry.tags = updates.tags;
      entry.updatedAt = new Date().toISOString();
      saveIndex(index);
    }

    const current = useProjectStore.getState().project;
    if (current.id === id) {
      if (updates.name !== undefined) useProjectStore.getState().setProjectName(updates.name);
      if (updates.description !== undefined) useProjectStore.getState().setProjectDescription(updates.description);
      if (updates.author !== undefined) useProjectStore.getState().setProjectAuthor(updates.author);
      if (updates.tags !== undefined) useProjectStore.getState().setProjectTags(updates.tags);
    } else {
      const proj = loadProjectData(id);
      if (proj) {
        if (updates.name !== undefined) proj.name = updates.name;
        if (updates.description !== undefined) proj.description = updates.description;
        if (updates.author !== undefined) proj.author = updates.author;
        if (updates.tags !== undefined) proj.tags = updates.tags;
        proj.updatedAt = new Date().toISOString();
        saveProjectData(proj);
      }
    }

    set({ projects: loadIndex() });
  },

  // ---- Export ----
  exportProject: (id) => {
    const current = useProjectStore.getState().project;
    let proj: Project | null;
    if (current.id === id) {
      proj = current;
    } else {
      proj = loadProjectData(id);
    }
    if (!proj) return;

    const data = JSON.stringify(proj, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${proj.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.lochcad`;
    a.click();
    URL.revokeObjectURL(url);
  },

  exportAllProjects: () => {
    // Save current first
    get().saveCurrentProject();

    const index = loadIndex();
    const allProjects: Project[] = [];
    for (const entry of index) {
      const proj = loadProjectData(entry.id);
      if (proj) allProjects.push(proj);
    }

    const exportData = {
      magic: 'LOCHCAD_ARCHIVE',
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      projectCount: allProjects.length,
      projects: allProjects,
    };

    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LochCAD_Alle_Projekte_${new Date().toISOString().slice(0, 10)}.lochcad-archive`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importProjectFromFile: async (file: File): Promise<string | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);

          // Handle archive files
          if (parsed.magic === 'LOCHCAD_ARCHIVE' && Array.isArray(parsed.projects)) {
            // Import all projects from archive
            const index = loadIndex();
            let count = 0;
            for (const proj of parsed.projects) {
              if (!proj.id || !proj.schematic) continue;
              // Ensure new fields
              if (!proj.description) proj.description = '';
              if (!proj.author) proj.author = '';
              if (!proj.tags) proj.tags = [];
              if (!proj.notes) proj.notes = [];
              // Assign new ID to avoid collisions
              const newId = uuid();
              proj.id = newId;
              saveProjectData(proj);
              index.unshift(entryFromProject(proj));
              count++;
            }
            saveIndex(index);
            set({ projects: index });
            resolve(count > 0 ? 'archive' : null);
            return;
          }

          // Handle single project files (including legacy LOCHCAD_PROJECT format)
          let proj: Project;
          if (parsed.magic === 'LOCHCAD_PROJECT' && parsed.project) {
            proj = parsed.project;
          } else if (parsed.schematic && parsed.perfboard) {
            proj = parsed as Project;
          } else {
            resolve(null);
            return;
          }

          // Ensure new fields
          if (!proj.id) proj.id = uuid();
          if (!proj.description) proj.description = '';
          if (!proj.author) proj.author = '';
          if (!proj.tags) proj.tags = [];
          if (!proj.notes) proj.notes = [];

          // Assign a fresh ID to avoid overwriting
          const newId = uuid();
          proj.id = newId;
          proj.updatedAt = new Date().toISOString();

          saveProjectData(proj);
          const index = loadIndex();
          index.unshift(entryFromProject(proj));
          saveIndex(index);
          set({ projects: index });

          resolve(newId);
        } catch (e) {
          console.error('Import failed:', e);
          resolve(null);
        }
      };
      reader.readAsText(file);
    });
  },

  importAllFromFile: async (file: File): Promise<number> => {
    const id = await get().importProjectFromFile(file);
    return id ? 1 : 0;
  },
}));
