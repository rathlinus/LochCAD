// ============================================================
// Collaboration Store — Connection, peers, awareness state
// ============================================================

import { create } from 'zustand';
import { collabClient } from '@/lib/collab/client';
import { startSync, stopSync } from '@/lib/collab/sync';
import type { CollabUser, AwarenessState, ServerMessage } from '@/lib/collab/protocol';
import { useAuthStore } from './authStore';
import { useProjectManagerStore } from './projectManagerStore';
import { useProjectStore } from './projectStore';
import { v4 as uuid } from 'uuid';

export interface RemotePeer {
  user: CollabUser;
  awareness: AwarenessState;
  lastSeen: number;
}

interface CollabState {
  // Connection
  connected: boolean;
  connecting: boolean;
  roomId: string | null;

  // Peers
  peers: Map<string, RemotePeer>;

  // UI
  isShareDialogOpen: boolean;
  shareDialogTab: 'create' | 'join';

  // Actions
  createRoom: () => string;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  openShareDialog: (tab?: 'create' | 'join') => void;
  closeShareDialog: () => void;

  // Awareness
  localAwareness: AwarenessState;
  updateLocalAwareness: (partial: Partial<AwarenessState>) => void;
}

let _messageUnsub: (() => void) | null = null;
let _awarenessInterval: ReturnType<typeof setInterval> | null = null;
let _connectTimeout: ReturnType<typeof setTimeout> | null = null;
let _lastSentAwareness: AwarenessState | null = null;
/** Project ID the user had open before joining a room */
let _preJoinProjectId: string | null = null;

export const useCollabStore = create<CollabState>((set, get) => ({
  connected: false,
  connecting: false,
  roomId: null,
  peers: new Map(),
  isShareDialogOpen: false,
  shareDialogTab: 'create',
  localAwareness: {},

  createRoom: () => {
    const roomId = uuid().slice(0, 8);
    get().joinRoom(roomId);
    return roomId;
  },

  joinRoom: (roomId: string) => {
    const profile = useAuthStore.getState().profile;
    if (!profile) {
      useAuthStore.getState().openAuthModal();
      return;
    }

    const current = get();
    if (current.roomId === roomId && (current.connected || current.connecting)) return;

    if (current.roomId) {
      // Switching rooms: tear down the old session, but keep the original
      // pre-collab project reference — the project currently open belongs
      // to the old room, not to the user.
      collabClient.disconnect();
      stopSync();
      if (_messageUnsub) { _messageUnsub(); _messageUnsub = null; }
      if (_awarenessInterval) { clearInterval(_awarenessInterval); _awarenessInterval = null; }
      set({ connected: false, peers: new Map(), localAwareness: {} });
    } else {
      // Save current local project before switching to collab state
      const pmStore = useProjectManagerStore.getState();
      pmStore.saveCurrentProject();
      _preJoinProjectId = useProjectStore.getState().project.id;
    }

    set({ connecting: true, roomId });

    // Unblock the share dialog if the server never answers. The client keeps
    // retrying in the background; a late 'joined' still flips to connected.
    if (_connectTimeout) clearTimeout(_connectTimeout);
    _connectTimeout = setTimeout(() => {
      _connectTimeout = null;
      if (get().connecting) set({ connecting: false });
    }, 15_000);

    // Listen for server messages
    if (_messageUnsub) _messageUnsub();
    _messageUnsub = collabClient.onMessage((msg: ServerMessage) => {
      const state = get();
      switch (msg.type) {
        case 'joined': {
          if (_connectTimeout) { clearTimeout(_connectTimeout); _connectTimeout = null; }
          // Rebuild from the server's authoritative list — merging would keep
          // ghost peers who left while we were disconnected
          const newPeers = new Map<string, RemotePeer>();
          for (const u of msg.users) {
            newPeers.set(u.id, { user: u, awareness: {}, lastSeen: Date.now() });
          }
          set({ connected: true, connecting: false, peers: newPeers });
          break;
        }
        case 'user-joined': {
          const newPeers = new Map(state.peers);
          newPeers.set(msg.user.id, { user: msg.user, awareness: {}, lastSeen: Date.now() });
          set({ peers: newPeers });
          break;
        }
        case 'user-left': {
          const newPeers = new Map(state.peers);
          newPeers.delete(msg.userId);
          set({ peers: newPeers });
          break;
        }
        case 'awareness': {
          const newPeers = new Map(state.peers);
          const peer = newPeers.get(msg.userId);
          if (peer) {
            newPeers.set(msg.userId, { ...peer, awareness: msg.state, lastSeen: Date.now() });
          }
          set({ peers: newPeers });
          break;
        }
      }
    });

    // Connect WebSocket
    collabClient.connect(roomId, {
      id: profile.id,
      name: profile.displayName,
      color: profile.color,
    });

    // Start state sync
    startSync();

    // Start awareness broadcasting (up to 20fps, only when it changed —
    // updateLocalAwareness creates a new object, so identity is enough)
    if (_awarenessInterval) clearInterval(_awarenessInterval);
    _lastSentAwareness = null;
    _awarenessInterval = setInterval(() => {
      const awareness = get().localAwareness;
      if (awareness === _lastSentAwareness) return;
      _lastSentAwareness = awareness;
      collabClient.sendAwareness(awareness);
    }, 50);

    // Update URL
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    window.history.replaceState({}, '', url.toString());
  },

  leaveRoom: () => {
    collabClient.disconnect();
    stopSync();
    if (_messageUnsub) { _messageUnsub(); _messageUnsub = null; }
    if (_awarenessInterval) { clearInterval(_awarenessInterval); _awarenessInterval = null; }
    if (_connectTimeout) { clearTimeout(_connectTimeout); _connectTimeout = null; }
    _lastSentAwareness = null;

    set({
      connected: false,
      connecting: false,
      roomId: null,
      peers: new Map(),
      localAwareness: {},
    });

    // Restore the user's own project. If the open project is the room's (we
    // joined someone else's session), discard it instead of saving a copy of
    // the host's project into the local project list.
    if (_preJoinProjectId) {
      const pmStore = useProjectManagerStore.getState();
      const currentId = useProjectStore.getState().project.id;
      pmStore.openProject(_preJoinProjectId, { skipSaveCurrent: currentId !== _preJoinProjectId });
      _preJoinProjectId = null;
    }

    // Clean URL
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  },

  openShareDialog: (tab = 'create') => set({ isShareDialogOpen: true, shareDialogTab: tab }),
  closeShareDialog: () => set({ isShareDialogOpen: false }),

  updateLocalAwareness: (partial) => {
    set((state) => ({
      localAwareness: { ...state.localAwareness, ...partial },
    }));
  },
}));
