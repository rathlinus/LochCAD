// ============================================================
// CollabProvider — React integration for collaboration system
// ============================================================
//
// Handles:
// 1. URL-based room auto-joining (?room=XYZ)
// 2. Broadcasting local cursor position & view/tool awareness
// 3. Cleanup on unmount

import { useEffect, useRef } from 'react';
import { useCollabStore } from '@/stores/collabStore';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';

export function CollabProvider() {
  const joinRoom = useCollabStore((s) => s.joinRoom);
  const connected = useCollabStore((s) => s.connected);
  const updateLocalAwareness = useCollabStore((s) => s.updateLocalAwareness);
  const profile = useAuthStore((s) => s.profile);
  const currentView = useProjectStore((s) => s.currentView);
  const schematicTool = useSchematicStore((s) => s.activeTool);
  const perfboardTool = usePerfboardStore((s) => s.activeTool);
  const schematicDrawing = useSchematicStore((s) => s.isDrawing);
  const perfboardDrawing = usePerfboardStore((s) => s.isDrawing);
  const activeSheetId = useProjectStore((s) => s.activeSheetId);

  const joinedRef = useRef(false);

  // Auto-join room from URL on first mount
  useEffect(() => {
    if (joinedRef.current) return;
    const url = new URL(window.location.href);
    const roomId = url.searchParams.get('room');
    if (roomId && profile) {
      joinedRef.current = true;
      joinRoom(roomId);
    } else if (roomId && !profile) {
      // Need account first — open auth modal, then join on profile creation
      joinedRef.current = true;
      useAuthStore.getState().openAuthModal();
      // Watch for profile creation
      const unsub = useAuthStore.subscribe((state) => {
        if (state.profile) {
          unsub();
          joinRoom(roomId);
        }
      });
    }
  }, [profile]);

  // Broadcast local view/tool/drawing awareness
  useEffect(() => {
    if (!connected) return;
    const tool = currentView === 'schematic' ? schematicTool
      : currentView === 'perfboard' ? perfboardTool
      : 'select';
    const drawing = currentView === 'schematic' ? schematicDrawing
      : currentView === 'perfboard' ? perfboardDrawing
      : false;

    updateLocalAwareness({
      view: currentView,
      tool,
      drawing,
      activeSheetId,
    });
  }, [connected, currentView, schematicTool, perfboardTool, schematicDrawing, perfboardDrawing, activeSheetId]);

  return null; // This is a headless provider
}
