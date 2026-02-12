// ============================================================
// ShareDialog — Create / Join / Manage collaboration room
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { useCollabStore } from '@/stores/collabStore';
import { useAuthStore } from '@/stores/authStore';
import {
  X,
  Link2,
  Copy,
  Check,
  Users,
  LogOut,
  Wifi,
  WifiOff,
  Plus,
  ArrowRight,
  Globe,
} from 'lucide-react';

const viewLabels: Record<string, string> = {
  schematic: 'Schaltplan',
  perfboard: 'Lochraster',
  preview3d: '3D Ansicht',
  'component-editor': 'Bauteil-Editor',
};

const toolLabels: Record<string, string> = {
  select: 'Auswahl',
  place_component: 'Platzieren',
  draw_wire: 'Draht',
  place_label: 'Label',
  delete: 'Löschen',
  draw_wire_bridge: 'Brücke',
  draw_solder_bridge: 'Lötbrücke',
  cut_track: 'Track-Cut',
};

export function ShareDialog() {
  const {
    isShareDialogOpen,
    closeShareDialog,
    shareDialogTab,
    connected,
    connecting,
    roomId,
    peers,
    createRoom,
    joinRoom,
    leaveRoom,
  } = useCollabStore();
  const profile = useAuthStore((s) => s.profile);

  const [joinId, setJoinId] = useState('');
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'create' | 'join'>(shareDialogTab);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isShareDialogOpen) {
      setTab(shareDialogTab);
      setJoinId('');
      setCopied(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isShareDialogOpen, shareDialogTab]);

  if (!isShareDialogOpen) return null;

  const shareLink = roomId
    ? `${window.location.origin}${window.location.pathname}?room=${roomId}`
    : '';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCreate = () => {
    if (!profile) {
      useAuthStore.getState().openAuthModal();
      return;
    }
    createRoom();
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const id = joinId.trim();
    if (!id) return;
    if (!profile) {
      useAuthStore.getState().openAuthModal();
      return;
    }
    // Extract room ID from URL or plain ID
    const match = id.match(/[?&]room=([a-zA-Z0-9-]+)/);
    joinRoom(match ? match[1] : id);
  };

  const peerList = Array.from(peers.values());

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeShareDialog}>
      <div
        className="bg-lochcad-surface border border-lochcad-panel/40 rounded-xl shadow-2xl w-[460px] max-w-[95vw] animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-lochcad-panel/30">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-lochcad-accent" />
            <h2 className="text-sm font-semibold text-lochcad-text">
              Zusammenarbeit
            </h2>
          </div>
          <button onClick={closeShareDialog} className="btn-icon">
            <X size={16} />
          </button>
        </div>

        {/* Connected state */}
        {connected && roomId ? (
          <div className="p-5 space-y-4">
            {/* Status */}
            <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
              <Wifi size={14} className="text-green-400" />
              <span className="text-xs text-green-400 font-medium">Verbunden</span>
              <span className="text-xs text-lochcad-text-dim ml-auto">Raum: {roomId}</span>
            </div>

            {/* Share Link */}
            <div>
              <label className="block text-xs text-lochcad-text-dim mb-1.5">Einladungslink</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareLink}
                  className="flex-1 px-3 py-2 bg-lochcad-bg border border-lochcad-panel/40 rounded-lg text-xs text-lochcad-text font-mono select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={handleCopyLink}
                  className="px-3 py-2 bg-lochcad-accent/20 hover:bg-lochcad-accent/30 text-lochcad-accent rounded-lg transition-colors flex items-center gap-1.5"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span className="text-xs">{copied ? 'Kopiert!' : 'Kopieren'}</span>
                </button>
              </div>
            </div>

            {/* Online Users */}
            <div>
              <label className="block text-xs text-lochcad-text-dim mb-2">
                Online ({peerList.length + 1})
              </label>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {/* Self */}
                {profile && (
                  <div className="flex items-center gap-2.5 px-3 py-2 bg-lochcad-bg/40 rounded-lg">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ backgroundColor: profile.color }}
                    >
                      {profile.displayName[0].toUpperCase()}
                    </div>
                    <span className="text-xs text-lochcad-text font-medium flex-1">
                      {profile.displayName}
                    </span>
                    <span className="text-[10px] text-lochcad-text-dim">Du</span>
                  </div>
                )}

                {/* Remote peers */}
                {peerList.map((peer) => (
                  <div key={peer.user.id} className="flex items-center gap-2.5 px-3 py-2 bg-lochcad-bg/40 rounded-lg">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ backgroundColor: peer.user.color }}
                    >
                      {peer.user.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-lochcad-text font-medium block truncate">
                        {peer.user.name}
                      </span>
                      {peer.awareness.view && (
                        <span className="text-[10px] text-lochcad-text-dim">
                          {viewLabels[peer.awareness.view] || peer.awareness.view}
                          {peer.awareness.tool && ` · ${toolLabels[peer.awareness.tool] || peer.awareness.tool}`}
                        </span>
                      )}
                    </div>
                    {peer.awareness.drawing && (
                      <span className="text-[10px] text-lochcad-accent animate-pulse">zeichnet...</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Leave */}
            <button
              onClick={leaveRoom}
              className="w-full py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <LogOut size={14} />
              Raum verlassen
            </button>
          </div>
        ) : (
          /* Not connected — Create or Join */
          <div className="p-5">
            {/* Tabs */}
            <div className="flex gap-1 p-0.5 bg-lochcad-bg/50 rounded-lg mb-4">
              <button
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'create'
                    ? 'bg-lochcad-accent/20 text-lochcad-accent'
                    : 'text-lochcad-text-dim hover:text-lochcad-text'
                }`}
                onClick={() => setTab('create')}
              >
                <Plus size={12} className="inline mr-1" />
                Raum erstellen
              </button>
              <button
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'join'
                    ? 'bg-lochcad-accent/20 text-lochcad-accent'
                    : 'text-lochcad-text-dim hover:text-lochcad-text'
                }`}
                onClick={() => setTab('join')}
              >
                <ArrowRight size={12} className="inline mr-1" />
                Raum beitreten
              </button>
            </div>

            {tab === 'create' ? (
              <div className="space-y-3">
                <p className="text-xs text-lochcad-text-dim">
                  Erstelle einen Raum und teile den Link, damit andere deinem Projekt beitreten können.
                  Alle Änderungen werden in Echtzeit synchronisiert.
                </p>
                <button
                  onClick={handleCreate}
                  disabled={connecting}
                  className="w-full py-2.5 bg-lochcad-accent hover:bg-lochcad-accent/90 disabled:bg-lochcad-panel/40 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {connecting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verbinden...
                    </>
                  ) : (
                    <>
                      <Globe size={16} />
                      Raum erstellen
                    </>
                  )}
                </button>
              </div>
            ) : (
              <form onSubmit={handleJoin} className="space-y-3">
                <p className="text-xs text-lochcad-text-dim">
                  Gib die Raum-ID oder den Einladungslink ein, um einem bestehenden Raum beizutreten.
                </p>
                <input
                  ref={inputRef}
                  type="text"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="Raum-ID oder Link eingeben..."
                  className="w-full px-3 py-2 bg-lochcad-bg border border-lochcad-panel/40 rounded-lg text-sm text-lochcad-text focus:border-lochcad-accent focus:outline-none font-mono"
                />
                <button
                  type="submit"
                  disabled={!joinId.trim() || connecting}
                  className="w-full py-2.5 bg-lochcad-accent hover:bg-lochcad-accent/90 disabled:bg-lochcad-panel/40 disabled:text-lochcad-text-dim text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {connecting ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verbinden...
                    </>
                  ) : (
                    <>
                      <ArrowRight size={16} />
                      Beitreten
                    </>
                  )}
                </button>
              </form>
            )}

            {!profile && (
              <p className="text-[10px] text-lochcad-accent-warm text-center mt-3">
                Du benötigst einen Account um zusammenzuarbeiten.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
