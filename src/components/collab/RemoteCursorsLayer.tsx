// ============================================================
// RemoteCursorsLayer — Konva-based remote cursor rendering
// ============================================================
//
// Renders remote user cursors directly on the Konva canvas.
// Because cursors live inside the Stage, they pan & zoom
// together with the rest of the drawing — no HTML/canvas
// coordinate mismatch.

import React, { useMemo } from 'react';
import { Layer, Group, Line, Text, Rect } from 'react-konva';
import { useCollabStore } from '@/stores/collabStore';

interface CursorEntry {
  id: string;
  name: string;
  color: string;
  worldX: number;
  worldY: number;
  drawing: boolean;
}

interface RemoteCursorsLayerProps {
  /** Which view to filter peers by (e.g. 'schematic', 'perfboard') */
  viewFilter: string;
  /** Current viewport scale — used to keep cursors a fixed visual size */
  viewportScale: number;
  /**
   * Optional transform from awareness cursor coords to canvas world coords.
   * E.g. for perfboard: grid → pixel conversion.
   * If omitted, cursor x/y are used directly as world coords.
   */
  transformCursor?: (cursor: { x: number; y: number }) => { x: number; y: number };
}

// Cursor arrow polygon (matches the SVG arrow from the old HTML overlay)
const ARROW_POINTS = [0, 0, 16, 10, 8, 11, 5, 20];

export const RemoteCursorsLayer: React.FC<RemoteCursorsLayerProps> = React.memo(
  ({ viewFilter, viewportScale, transformCursor }) => {
    const peers = useCollabStore((s) => s.peers);
    const connected = useCollabStore((s) => s.connected);

    const cursors = useMemo<CursorEntry[]>(() => {
      if (!connected) return [];
      const result: CursorEntry[] = [];
      for (const [id, peer] of peers) {
        const { awareness, user } = peer;
        if (!awareness.cursor || awareness.view !== viewFilter) continue;

        let worldX = awareness.cursor.x;
        let worldY = awareness.cursor.y;
        if (transformCursor) {
          const t = transformCursor(awareness.cursor);
          worldX = t.x;
          worldY = t.y;
        }

        result.push({
          id,
          name: user.name,
          color: user.color,
          worldX,
          worldY,
          drawing: !!awareness.drawing,
        });
      }
      return result;
    }, [peers, connected, viewFilter, transformCursor]);

    if (cursors.length === 0) return null;

    // Inverse scale so cursors stay constant visual size regardless of zoom
    const inv = 1 / viewportScale;

    return (
      <Layer listening={false} name="remote-cursors">
        {cursors.map((c) => {
          const label = c.drawing ? `${c.name} ●` : c.name;
          const badgeW = label.length * 6.5 + 10;

          return (
            <Group key={c.id} x={c.worldX} y={c.worldY} scaleX={inv} scaleY={inv}>
              {/* Cursor arrow */}
              <Line
                points={ARROW_POINTS}
                closed
                fill={c.color}
                stroke="white"
                strokeWidth={1.5}
                lineJoin="round"
                shadowBlur={3}
                shadowColor="rgba(0,0,0,0.4)"
                shadowOffsetX={1}
                shadowOffsetY={1}
              />

              {/* Name badge background */}
              <Rect
                x={18}
                y={12}
                width={badgeW}
                height={16}
                fill={c.color}
                cornerRadius={3}
                shadowBlur={2}
                shadowColor="rgba(0,0,0,0.3)"
              />
              {/* Name badge text */}
              <Text
                x={23}
                y={15}
                text={label}
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                fill="white"
              />
            </Group>
          );
        })}
      </Layer>
    );
  }
);

RemoteCursorsLayer.displayName = 'RemoteCursorsLayer';
