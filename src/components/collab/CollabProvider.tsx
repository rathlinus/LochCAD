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
  const schematicSelection = useSchematicStore((s) => s.selection);
  const perfboardSelection = usePerfboardStore((s) => s.selectedIds);

  const joinedRef = useRef(false);

  // Auto-join room from URL on first mount
  useEffect(() => {
    if (joinedRef.current) return;
    const url = new URL(window.location.href);
    const roomId = url.searchParams.get('room');
    if (!roomId) return;
    joinedRef.current = true;
    if (profile) {
      joinRoom(roomId);
      return;
    }
    // Need account first — open auth modal, then join on profile creation
    useAuthStore.getState().openAuthModal();
    const unsub = useAuthStore.subscribe((state) => {
      if (state.profile) {
        unsub();
        joinRoom(roomId);
      } else if (!state.isAuthModalOpen) {
        // Modal dismissed without creating a profile — abandon the auto-join
        // so a profile created later doesn't yank the user into this room
        unsub();
      }
    });
    return unsub;
  }, [profile]);

  // A view switch changes the cursor's coordinate space (schematic: world px,
  // perfboard: grid cells) — drop the last cursor so peers don't render it
  // transformed into the wrong space until the next mouse move.
  useEffect(() => {
    updateLocalAwareness({ cursor: undefined });
  }, [currentView]);

  // Broadcast local view/tool/drawing/selection awareness
  useEffect(() => {
    if (!connected) return;
    const tool = currentView === 'schematic' ? schematicTool
      : currentView === 'perfboard' ? perfboardTool
      : 'select';
    const drawing = currentView === 'schematic' ? schematicDrawing
      : currentView === 'perfboard' ? perfboardDrawing
      : false;

    // Gather currently selected element IDs
    const selection: string[] = currentView === 'schematic'
      ? [
          ...schematicSelection.componentIds,
          ...schematicSelection.wireIds,
          ...schematicSelection.labelIds,
          ...schematicSelection.junctionIds,
        ]
      : currentView === 'perfboard'
        ? perfboardSelection
        : [];

    updateLocalAwareness({
      view: currentView,
      tool,
      drawing,
      activeSheetId,
      selection,
    });
  }, [connected, currentView, schematicTool, perfboardTool, schematicDrawing, perfboardDrawing, activeSheetId, schematicSelection, perfboardSelection]);

  return null; // This is a headless provider
}
