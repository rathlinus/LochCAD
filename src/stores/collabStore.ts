// ============================================================
// Collaboration Store — Connection, peers, awareness state
// ============================================================

import { create } from 'zustand';
import { collabClient } from '@/lib/collab/client';
import { startSync, stopSync } from '@/lib/collab/sync';
import type { CollabUser, AwarenessState, ServerMessage } from '@/lib/collab/protocol';
import { useAuthStore } from './authStore';
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

    set({ connecting: true, roomId });

    // Listen for server messages
    if (_messageUnsub) _messageUnsub();
    _messageUnsub = collabClient.onMessage((msg: ServerMessage) => {
      const state = get();
      switch (msg.type) {
        case 'joined': {
          const newPeers = new Map(state.peers);
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

    // Start awareness broadcasting (20fps)
    if (_awarenessInterval) clearInterval(_awarenessInterval);
    _awarenessInterval = setInterval(() => {
      const awareness = get().localAwareness;
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

    set({
      connected: false,
      connecting: false,
      roomId: null,
      peers: new Map(),
      localAwareness: {},
    });

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
