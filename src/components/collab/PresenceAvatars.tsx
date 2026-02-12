// ============================================================
// PresenceAvatars — Show online users in the TopBar
// ============================================================

import React from 'react';
import { useCollabStore } from '@/stores/collabStore';
import { useAuthStore } from '@/stores/authStore';

const viewLabels: Record<string, string> = {
  schematic: 'Schaltplan',
  perfboard: 'Lochraster',
  preview3d: '3D',
  'component-editor': 'Editor',
};

export function PresenceAvatars() {
  const connected = useCollabStore((s) => s.connected);
  const peers = useCollabStore((s) => s.peers);
  const profile = useAuthStore((s) => s.profile);

  if (!connected) return null;

  const peerList = Array.from(peers.values());
  const totalUsers = peerList.length + 1; // +1 for self
  const maxShow = 5;
  const overflow = totalUsers - maxShow;

  return (
    <div className="flex items-center gap-0.5">
      {/* Self avatar */}
      {profile && (
        <div
          className="relative w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-lochcad-surface cursor-default"
          style={{ backgroundColor: profile.color }}
          title={`${profile.displayName} (Du)`}
        >
          {profile.displayName[0].toUpperCase()}
        </div>
      )}

      {/* Peer avatars */}
      {peerList.slice(0, maxShow - 1).map((peer) => {
        const viewKey = peer.awareness.view || '';
        return (
          <div
            key={peer.user.id}
            className="relative -ml-1.5 w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-lochcad-surface cursor-default transition-transform hover:scale-110 hover:z-10"
            style={{ backgroundColor: peer.user.color }}
            title={`${peer.user.name}${viewKey ? ` — ${viewLabels[viewKey] || viewKey}` : ''}`}
          >
            {peer.user.name[0].toUpperCase()}
            {/* Activity indicator */}
            {peer.awareness.drawing && (
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full ring-1 ring-lochcad-surface animate-pulse" />
            )}
          </div>
        );
      })}

      {/* Overflow badge */}
      {overflow > 0 && (
        <div className="relative -ml-1.5 w-6 h-6 rounded-full flex items-center justify-center text-lochcad-text-dim text-[10px] font-bold bg-lochcad-panel/60 ring-2 ring-lochcad-surface">
          +{overflow}
        </div>
      )}
    </div>
  );
}
