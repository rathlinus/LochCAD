// ============================================================
// Collaboration Protocol — Shared message types
// ============================================================

export interface CollabUser {
  id: string;
  name: string;
  color: string;
}

export interface AwarenessState {
  cursor?: { x: number; y: number };
  view?: string;
  tool?: string;
  selection?: string[];
  activeSheetId?: string;
  drawing?: boolean;
}

export type EntityPath =
  | 'schematic.components'
  | 'schematic.wires'
  | 'schematic.junctions'
  | 'schematic.labels'
  | 'schematic.sheets'
  | 'perfboard.components'
  | 'perfboard.connections'
  | 'perfboard.trackCuts';

export interface EntityOp {
  path: EntityPath;
  action: 'set' | 'delete';
  id: string;
  data?: string;
}

export interface MetaOp {
  path: 'meta';
  key: string;
  value: string;
}

export interface ConfigOp {
  path: 'config';
  key: string;
  value: any;
}

export type Operation = EntityOp | MetaOp | ConfigOp;

// ---- Client → Server ----
export type ClientMessage =
  | { type: 'join'; roomId: string; user: CollabUser }
  | { type: 'ops'; ops: Operation[] }
  | { type: 'awareness'; state: AwarenessState }
  | { type: 'state-full'; state: string };

// ---- Server → Client ----
export type ServerMessage =
  | { type: 'joined'; roomId: string; userId: string; users: CollabUser[] }
  | { type: 'state-full'; state: string }
  | { type: 'user-joined'; user: CollabUser }
  | { type: 'user-left'; userId: string }
  | { type: 'ops'; ops: Operation[]; userId: string }
  | { type: 'awareness'; userId: string; state: AwarenessState }
  | { type: 'error'; message: string };
