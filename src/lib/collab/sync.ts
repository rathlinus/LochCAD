// ============================================================
// Collaboration Sync — Bidirectional state sync (Zustand ↔ WS)
// ============================================================

import { collabClient } from './client';
import type { Operation, EntityOp, MetaOp, ConfigOp, EntityPath, ServerMessage } from './protocol';
import { useProjectStore } from '@/stores/projectStore';
import type { Project, SchematicDocument, PerfboardDocument } from '@/types';

let _syncing = false;
let _unsubStore: (() => void) | null = null;
let _unsubWs: (() => void) | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _initialStateTimer: ReturnType<typeof setTimeout> | null = null;

// ---- Snapshot for diffing ----

interface Snapshot {
  entities: Map<string, Map<string, string>>; // path → (id → json)
  meta: Record<string, string>;
  config: Record<string, any>;
}

const ENTITY_PATHS: { path: EntityPath; get: (p: Project) => any[] }[] = [
  { path: 'schematic.components', get: (p) => p.schematic.components },
  { path: 'schematic.wires', get: (p) => p.schematic.wires },
  { path: 'schematic.junctions', get: (p) => p.schematic.junctions },
  { path: 'schematic.labels', get: (p) => p.schematic.labels },
  { path: 'schematic.sheets', get: (p) => p.schematic.sheets },
  { path: 'perfboard.components', get: (p) => p.perfboard.components },
  { path: 'perfboard.connections', get: (p) => p.perfboard.connections },
  { path: 'perfboard.trackCuts', get: (p) => p.perfboard.trackCuts },
];

function captureSnapshot(project: Project): Snapshot {
  const entities = new Map<string, Map<string, string>>();
  for (const { path, get } of ENTITY_PATHS) {
    const map = new Map<string, string>();
    for (const item of get(project)) {
      map.set(item.id, JSON.stringify(item));
    }
    entities.set(path, map);
  }
  return {
    entities,
    meta: {
      name: project.name,
      description: project.description,
      author: project.author,
      version: project.version,
    },
    config: {
      boardType: project.perfboard.boardType,
      boardWidth: project.perfboard.width,
      boardHeight: project.perfboard.height,
    },
  };
}

let _prevSnapshot: Snapshot | null = null;

// ---- Diffing ----

function computeDiff(prev: Snapshot, curr: Snapshot): Operation[] {
  const ops: Operation[] = [];

  // Diff entities
  for (const { path } of ENTITY_PATHS) {
    const prevMap = prev.entities.get(path) || new Map<string, string>();
    const currMap = curr.entities.get(path) || new Map<string, string>();

    for (const [id, json] of currMap) {
      if (!prevMap.has(id) || prevMap.get(id) !== json) {
        ops.push({ path, action: 'set', id, data: json });
      }
    }
    for (const [id] of prevMap) {
      if (!currMap.has(id)) {
        ops.push({ path, action: 'delete', id });
      }
    }
  }

  // Diff meta
  for (const key of Object.keys(curr.meta)) {
    if (curr.meta[key] !== prev.meta[key]) {
      ops.push({ path: 'meta', key, value: curr.meta[key] });
    }
  }

  // Diff config
  for (const key of Object.keys(curr.config)) {
    if (JSON.stringify(curr.config[key]) !== JSON.stringify(prev.config[key])) {
      ops.push({ path: 'config', key, value: curr.config[key] });
    }
  }

  return ops;
}

// ---- Apply remote operations ----

function applyRemoteOps(ops: Operation[]) {
  _syncing = true;
  try {
    useProjectStore.setState((state) => {
      for (const op of ops) {
        // A single malformed op must not abort the batch or leave sync stuck
        try {
          if (op.path === 'meta') {
            const metaOp = op as MetaOp;
            (state.project as any)[metaOp.key] = metaOp.value;
          } else if (op.path === 'config') {
            const cfgOp = op as ConfigOp;
            if (cfgOp.key === 'boardType') state.project.perfboard.boardType = cfgOp.value;
            else if (cfgOp.key === 'boardWidth') state.project.perfboard.width = cfgOp.value;
            else if (cfgOp.key === 'boardHeight') state.project.perfboard.height = cfgOp.value;
          } else {
            const entityOp = op as EntityOp;
            const [section, collection] = entityOp.path.split('.') as [string, string];
            const arr: any[] =
              section === 'schematic'
                ? (state.project.schematic as any)[collection]
                : (state.project.perfboard as any)[collection];
            if (!Array.isArray(arr)) continue;

            if (entityOp.action === 'set' && entityOp.data) {
              const data = JSON.parse(entityOp.data);
              const idx = arr.findIndex((e: any) => e.id === entityOp.id);
              if (idx >= 0) {
                arr[idx] = data;
              } else {
                arr.push(data);
              }
            } else if (entityOp.action === 'delete') {
              const idx = arr.findIndex((e: any) => e.id === entityOp.id);
              if (idx >= 0) arr.splice(idx, 1);
            }
          }
        } catch (err) {
          console.error('[Collab] Skipping malformed op', op, err);
        }
      }
      state.project.updatedAt = new Date().toISOString();
    });

    // Advance the diff baseline only for the remotely-changed entries.
    // Recapturing the whole snapshot here would also absorb local edits
    // still waiting in the debounce window, so they'd never be broadcast.
    if (_prevSnapshot) {
      for (const op of ops) {
        try {
          if (op.path === 'meta') {
            _prevSnapshot.meta[(op as MetaOp).key] = (op as MetaOp).value;
          } else if (op.path === 'config') {
            _prevSnapshot.config[(op as ConfigOp).key] = (op as ConfigOp).value;
          } else {
            const entityOp = op as EntityOp;
            const map = _prevSnapshot.entities.get(entityOp.path);
            if (!map) continue;
            if (entityOp.action === 'set' && entityOp.data) {
              map.set(entityOp.id, JSON.stringify(JSON.parse(entityOp.data)));
            } else if (entityOp.action === 'delete') {
              map.delete(entityOp.id);
            }
          }
        } catch {
          // op was already skipped during apply
        }
      }
    }
  } finally {
    _syncing = false;
  }
}

// ---- Message handler ----

function handleServerMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'ops':
      applyRemoteOps(msg.ops);
      break;

    case 'state-full': {
      // The room has canonical state — never overwrite it with our local
      // project via a still-pending initial send.
      if (_initialStateTimer) {
        clearTimeout(_initialStateTimer);
        _initialStateTimer = null;
      }
      _syncing = true;
      try {
        const project = JSON.parse(msg.state) as Project;
        useProjectStore.getState().setProject(project);
        _prevSnapshot = captureSnapshot(useProjectStore.getState().project);
      } catch {
        console.error('[Collab] Failed to parse full state');
      } finally {
        _syncing = false;
      }
      break;
    }

    case 'joined': {
      if (_initialStateTimer) clearTimeout(_initialStateTimer);
      _initialStateTimer = null;
      // Seed the room only when the server has no state yet. The project is
      // read inside the timeout — reading it here would capture the pre-join
      // project and upload it over any room state applied in the meantime.
      if (!msg.hasState) {
        _initialStateTimer = setTimeout(() => {
          _initialStateTimer = null;
          const project = useProjectStore.getState().project;
          collabClient.sendFullState(JSON.stringify(project));
        }, 500);
      }
      break;
    }
  }
}

// ---- Public API ----

/** Start syncing the project state with the collaboration server. */
export function startSync() {
  // Never stack subscriptions — a leaked store subscriber would keep
  // pushing diffs after stopSync and replay them into the next room.
  stopSync();
  const project = useProjectStore.getState().project;
  _prevSnapshot = captureSnapshot(project);

  // Listen for remote messages
  _unsubWs = collabClient.onMessage(handleServerMessage);

  // Watch local store changes → send ops
  _unsubStore = useProjectStore.subscribe(() => {
    if (_syncing) return;
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      if (_syncing || !_prevSnapshot) return;
      const project = useProjectStore.getState().project;
      const curr = captureSnapshot(project);
      const ops = computeDiff(_prevSnapshot, curr);
      if (ops.length > 0) {
        collabClient.sendOps(ops);
        // Also periodically send full state for new joiners
        collabClient.sendFullState(JSON.stringify(project));
      }
      _prevSnapshot = curr;
    }, 50); // 50ms debounce — fast enough to feel instant
  });
}

/** Stop syncing. */
export function stopSync() {
  if (_unsubStore) { _unsubStore(); _unsubStore = null; }
  if (_unsubWs) { _unsubWs(); _unsubWs = null; }
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  if (_initialStateTimer) { clearTimeout(_initialStateTimer); _initialStateTimer = null; }
  _prevSnapshot = null;
  _syncing = false;
}

/** Check if a sync operation is currently in progress (to prevent loops). */
export function isSyncing() { return _syncing; }
