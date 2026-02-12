// ============================================================
// CursorOverlay — Render remote user cursors on the canvas
// ============================================================

import React, { useMemo } from 'react';
import { useCollabStore } from '@/stores/collabStore';
import { useProjectStore, useSchematicStore, usePerfboardStore } from '@/stores';
import { PERFBOARD_GRID } from '@/constants';

/** SVG cursor arrow in the user's color */
function CursorArrow({ color }: { color: string }) {
  return (
    <svg
      width="20"
      height="24"
      viewBox="0 0 20 24"
      fill="none"
      className="drop-shadow-md"
      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
    >
      <path
        d="M2 2L18 12L10 13L7 22L2 2Z"
        fill={color}
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface CursorData {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  drawing: boolean;
  tool: string;
}

export function CursorOverlay() {
  const peers = useCollabStore((s) => s.peers);
  const connected = useCollabStore((s) => s.connected);
  const currentView = useProjectStore((s) => s.currentView);

  // Get the active viewport for coordinate transform
  const schematicViewport = useSchematicStore((s) => s.viewport);
  const perfboardViewport = usePerfboardStore((s) => s.viewport);

  const viewport = currentView === 'schematic' ? schematicViewport
    : currentView === 'perfboard' ? perfboardViewport
    : null;

  const cursors = useMemo(() => {
    if (!connected || !viewport) return [];

    const result: CursorData[] = [];
    for (const [id, peer] of peers) {
      const { awareness, user } = peer;
      if (!awareness.cursor || awareness.view !== currentView) continue;

      let worldX = awareness.cursor.x;
      let worldY = awareness.cursor.y;

      // For perfboard, cursor is in grid coords — convert to pixel
      if (currentView === 'perfboard') {
        worldX = worldX * PERFBOARD_GRID;
        worldY = worldY * PERFBOARD_GRID;
      }

      // World → screen transform
      const screenX = worldX * viewport.scale + viewport.x;
      const screenY = worldY * viewport.scale + viewport.y;

      result.push({
        id,
        name: user.name,
        color: user.color,
        x: screenX,
        y: screenY,
        drawing: !!awareness.drawing,
        tool: awareness.tool || '',
      });
    }
    return result;
  }, [peers, connected, viewport, currentView]);

  if (cursors.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
      {cursors.map((c) => (
        <div
          key={c.id}
          className="absolute"
          style={{
            left: c.x,
            top: c.y,
            transition: 'left 80ms linear, top 80ms linear',
            willChange: 'left, top',
          }}
        >
          {/* Cursor arrow */}
          <CursorArrow color={c.color} />

          {/* Name label */}
          <div
            className="absolute left-4 top-4 px-1.5 py-0.5 rounded text-[10px] font-medium text-white whitespace-nowrap shadow-md"
            style={{ backgroundColor: c.color }}
          >
            {c.name}
            {c.drawing && (
              <span className="ml-1 animate-pulse">●</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
