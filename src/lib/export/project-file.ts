// ============================================================
// Export: Project File (.lochcad) — ZIP archive with JSON
// ============================================================

import type { Project } from '@/types';
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
    version: PROJECT_VERSION,
    sheets: project.sheets.length,
    exportDate: new Date().toISOString(),
  }, null, 2));

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

  return parsed.project;
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
    return JSON.parse(json) as Project;
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
