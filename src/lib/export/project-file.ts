// ============================================================
// Export: Project File (.lochcad) — ZIP archive with JSON
// ============================================================

import type { Project, ProjectNote } from '@/types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const PROJECT_VERSION = '1.0.0';
const MAGIC = 'LOCHCAD_PROJECT';

export interface ProjectFile {
  magic: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  project: Project;
}

export async function saveProjectFile(project: Project): Promise<void> {
  const projectFile: ProjectFile = {
    magic: MAGIC,
    version: PROJECT_VERSION,
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    project,
  };

  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(projectFile, null, 2));

  // Add metadata
  zip.file('meta.json', JSON.stringify({
    name: project.name,
    description: project.description || '',
    author: project.author || '',
    tags: project.tags || [],
    version: PROJECT_VERSION,
    sheets: project.schematic?.sheets?.length || 0,
    components: project.schematic?.components?.length || 0,
    noteCount: project.notes?.length || 0,
    exportDate: new Date().toISOString(),
  }, null, 2));

  // Add notes as individual text files
  if (project.notes?.length) {
    const notesFolder = zip.folder('notes');
    if (notesFolder) {
      for (const note of project.notes) {
        const safeName = note.title.replace(/[^a-zA-Z0-9_-]/g, '_');
        notesFolder.file(`${safeName}.md`, `# ${note.title}\n\n${note.content}\n`);
      }
      notesFolder.file('_index.json', JSON.stringify(project.notes, null, 2));
    }
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const filename = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.lochcad`;
  saveAs(blob, filename);
}

export async function loadProjectFile(file: File): Promise<Project> {
  const zip = await JSZip.loadAsync(file);

  const projectJson = zip.file('project.json');
  if (!projectJson) {
    throw new Error('Ungültige Projektdatei: project.json nicht gefunden');
  }

  const content = await projectJson.async('string');
  const parsed = JSON.parse(content) as ProjectFile;

  if (parsed.magic !== MAGIC) {
    throw new Error('Ungültige Projektdatei: Falsches Format');
  }

  const project = parsed.project;

  // Ensure new fields
  if (!project.description) project.description = '';
  if (!project.author) project.author = '';
  if (!project.tags) project.tags = [];
  if (!project.notes) project.notes = [];
  if (!project.componentLibrary) project.componentLibrary = [];

  return project;
}

/** Export notes only as a standalone file */
export function exportNotesAsMarkdown(project: Project): string {
  if (!project.notes?.length) return `# ${project.name} — Notes\n\n_No notes._\n`;

  const lines: string[] = [`# ${project.name} — Notes\n`];
  for (const note of project.notes) {
    lines.push(`## ${note.title}`);
    lines.push(`_Created: ${new Date(note.createdAt).toLocaleString()} | Updated: ${new Date(note.updatedAt).toLocaleString()}_\n`);
    lines.push(note.content);
    lines.push('\n---\n');
  }
  return lines.join('\n');
}

/** Import notes from a JSON notes array */
export function importNotes(json: string): ProjectNote[] {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((n: any) => n.id && n.title && n.content !== undefined) as ProjectNote[];
  } catch {
    return [];
  }
}

// ============================================================
// LocalStorage save/load (for auto-save)
// ============================================================

const LS_KEY = 'lochcad_autosave';

export function autoSaveProject(project: Project): void {
  try {
    const json = JSON.stringify(project);
    localStorage.setItem(LS_KEY, json);
    localStorage.setItem(`${LS_KEY}_timestamp`, new Date().toISOString());
  } catch (e) {
    console.warn('Auto-save failed:', e);
  }
}

export function loadAutoSavedProject(): Project | null {
  try {
    const json = localStorage.getItem(LS_KEY);
    if (!json) return null;
    const project = JSON.parse(json) as Project;
    if (!project.componentLibrary) project.componentLibrary = [];
    return project;
  } catch {
    return null;
  }
}

export function hasAutoSavedProject(): boolean {
  return localStorage.getItem(LS_KEY) !== null;
}

export function clearAutoSave(): void {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(`${LS_KEY}_timestamp`);
}

export function getAutoSaveTimestamp(): string | null {
  return localStorage.getItem(`${LS_KEY}_timestamp`);
}
