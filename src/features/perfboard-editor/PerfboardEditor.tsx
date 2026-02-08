// ============================================================
// Perfboard Editor — Lochraster / Stripboard layout canvas
// ============================================================

import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { Stage, Layer, Circle, Rect, Line, Text, Group } from 'react-konva';
import type Konva from 'konva';
import { useProjectStore, usePerfboardStore } from '@/stores';
import { getBuiltInComponents, getAdjustedFootprint } from '@/lib/component-library';
import { COLORS, PERFBOARD_GRID, CATEGORY_PREFIX, nextUniqueReference } from '@/constants';
import type { GridPosition, PerfboardComponent, PerfboardConnection, ComponentDefinition, FootprintPad } from '@/types';
import { useHotkeys } from 'react-hotkeys-hook';
import { findManhattanRoute, getOccupiedHoles, getConnectionOccupiedHoles, solderBridgeCrossesExisting, hasCollision, gridKey, hasFootprintCollision, isAdjacent, insertSupportPoints } from '@/lib/engine/router';

export default function PerfboardEditor() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [mouseGridPos, setMouseGridPos] = useState<GridPosition>({ col: 0, row: 0 });
  const isDraggingComponentRef = useRef(false);

  const [placementRotation, setPlacementRotation] = useState(0);

  const viewport = usePerfboardStore((s) => s.viewport);
  const setViewport = usePerfboardStore((s) => s.setViewport);
  const activeTool = usePerfboardStore((s) => s.activeTool);
  const selectedIds = usePerfboardStore((s) => s.selectedIds);
  const isDrawing = usePerfboardStore((s) => s.isDrawing);
  const drawingFrom = usePerfboardStore((s) => s.drawingFrom);
  const drawingTo = usePerfboardStore((s) => s.drawingTo);
  const drawingType = usePerfboardStore((s) => s.drawingType);
  const drawingSide = usePerfboardStore((s) => s.drawingSide);
  const placingComponentId = usePerfboardStore((s) => s.placingComponentId);

  const perfboard = useProjectStore((s) => s.project.perfboard);
  const schematic = useProjectStore((s) => s.project.schematic);
  const customComponents = useProjectStore((s) => s.project.componentLibrary);

  const allLib = useMemo(
    () => [...getBuiltInComponents(), ...customComponents],
    [customComponents]
  );

  // Build component data for collision checks
  const compData = useMemo(() => {
    return perfboard.components.map((c) => {
      const def = allLib.find((d) => d.id === c.libraryId);
      if (!def) return { gridPosition: c.gridPosition, rotation: c.rotation, pads: [] as GridPosition[], spanHoles: undefined as GridPosition | undefined };
      const { pads, spanHoles } = getAdjustedFootprint(def, c.properties?.holeSpan);
      return {
        gridPosition: c.gridPosition,
        rotation: c.rotation,
        pads: pads.map((p) => p.gridPosition),
        spanHoles,
      };
    });
  }, [perfboard.components, allLib]);

  // Build occupied holes set for wire routing
  const occupiedHoles = useMemo(() => {
    return getOccupiedHoles(compData);
  }, [compData]);

  // Build occupied holes including same-side connections for preview
  const previewOccupied = useMemo(() => {
    const base = new Set(occupiedHoles);
    if (!isDrawing || !drawingFrom || !drawingTo) return base;
    const fromKey = gridKey(drawingFrom.col, drawingFrom.row);
    const toKey = gridKey(drawingTo.col, drawingTo.row);
    const endpointKeys = new Set([fromKey, toKey]);
    const connOcc = getConnectionOccupiedHoles(perfboard.connections, drawingSide, endpointKeys);
    for (const k of connOcc) base.add(k);
    base.delete(fromKey);
    base.delete(toKey);
    return base;
  }, [occupiedHoles, isDrawing, drawingFrom, drawingTo, drawingSide, perfboard.connections]);

  // Compute Manhattan drawing preview path
  // Check if drawing endpoints are adjacent (→ solder bridge)
  const drawingIsAdjacent = useMemo(() => {
    if (!isDrawing || !drawingFrom || !drawingTo) return false;
    return isAdjacent(drawingFrom, drawingTo);
  }, [isDrawing, drawingFrom, drawingTo]);

  // Check if the preview route is blocked
  const drawingBlocked = useMemo(() => {
    if (!isDrawing || !drawingFrom || !drawingTo) return false;
    if (drawingFrom.col === drawingTo.col && drawingFrom.row === drawingTo.row) return false;
    if (isAdjacent(drawingFrom, drawingTo)) {
      return solderBridgeCrossesExisting(drawingFrom, drawingTo, perfboard.connections, 'bottom');
    }
    const route = findManhattanRoute({
      from: drawingFrom,
      to: drawingTo,
      boardWidth: perfboard.width,
      boardHeight: perfboard.height,
      occupied: previewOccupied,
    });
    return !route;
  }, [isDrawing, drawingFrom, drawingTo, perfboard.width, perfboard.height, previewOccupied, perfboard.connections]);

  const drawingPreviewPath = useMemo(() => {
    if (!isDrawing || !drawingFrom || !drawingTo) return null;
    if (drawingFrom.col === drawingTo.col && drawingFrom.row === drawingTo.row) return null;
    // Adjacent → just a direct segment (will become solder bridge)
    if (isAdjacent(drawingFrom, drawingTo)) return [drawingFrom, drawingTo];
    const route = findManhattanRoute({
      from: drawingFrom,
      to: drawingTo,
      boardWidth: perfboard.width,
      boardHeight: perfboard.height,
      occupied: previewOccupied,
    });
    if (!route) return [drawingFrom, drawingTo]; // fallback direct line for blocked preview
    // Add support points for preview
    return insertSupportPoints(route);
  }, [isDrawing, drawingFrom, drawingTo, perfboard.width, perfboard.height, previewOccupied]);

  // Check collision for placement preview — full footprint bbox overlap (no overlap allowed on Lochraster)
  const placementCollision = useMemo(() => {
    if (activeTool !== 'place_component' || !placingComponentId) return false;
    const libComp = allLib.find((c) => c.id === placingComponentId);
    if (!libComp) return false;
    const pads = libComp.footprint.pads.map((p) => p.gridPosition);
    return hasFootprintCollision(pads, mouseGridPos, placementRotation, compData, libComp.footprint.spanHoles);
  }, [activeTool, placingComponentId, allLib, mouseGridPos, placementRotation, compData]);

  // Auto-scroll edge margin / speed
  const EDGE_MARGIN = 40;
  const SCROLL_SPEED = 8;

  const handleCompDragStart = useCallback(() => {
    isDraggingComponentRef.current = true;
  }, []);

  const handleCompDragMove = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !isDraggingComponentRef.current) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    let dx = 0, dy = 0;
    if (pointer.x < EDGE_MARGIN) dx = SCROLL_SPEED;
    else if (pointer.x > stageSize.width - EDGE_MARGIN) dx = -SCROLL_SPEED;
    if (pointer.y < EDGE_MARGIN) dy = SCROLL_SPEED;
    else if (pointer.y > stageSize.height - EDGE_MARGIN) dy = -SCROLL_SPEED;

    if (dx !== 0 || dy !== 0) {
      const vp = usePerfboardStore.getState().viewport;
      usePerfboardStore.getState().setViewport({ x: vp.x + dx, y: vp.y + dy });
    }
  }, [stageSize]);

  const handleCompDragEnd = useCallback((compId: string, gridPos: GridPosition): boolean => {
    isDraggingComponentRef.current = false;
    return usePerfboardStore.getState().moveComponent(compId, gridPos);
  }, []);

  // Resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setStageSize({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const gridToPixel = useCallback(
    (pos: GridPosition) => ({
      x: (pos.col + 1) * PERFBOARD_GRID,
      y: (pos.row + 1) * PERFBOARD_GRID,
    }),
    []
  );

  const pixelToGrid = useCallback(
    (px: number, py: number): GridPosition => ({
      col: Math.round(px / PERFBOARD_GRID) - 1,
      row: Math.round(py / PERFBOARD_GRID) - 1,
    }),
    []
  );

  const getPointerCanvasPos = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - viewport.x) / viewport.scale,
      y: (pointer.y - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  // ---- Events ----

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.08;
    const oldScale = viewport.scale;
    const newScale = e.evt.deltaY > 0
      ? Math.max(oldScale / scaleBy, 0.2)
      : Math.min(oldScale * scaleBy, 5);

    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    };

    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, [viewport, setViewport]);

  const handleMouseMove = useCallback(() => {
    const pos = getPointerCanvasPos();
    if (!pos) return;
    const gridPos = pixelToGrid(pos.x, pos.y);
    setMouseGridPos(gridPos);

    if (isDrawing) {
      usePerfboardStore.getState().updateDrawingConnection(gridPos);

      // Auto-scroll when drawing near stage edges
      const stage = stageRef.current;
      if (stage) {
        const pointer = stage.getPointerPosition();
        if (pointer) {
          let dx = 0, dy = 0;
          if (pointer.x < EDGE_MARGIN) dx = SCROLL_SPEED;
          else if (pointer.x > stageSize.width - EDGE_MARGIN) dx = -SCROLL_SPEED;
          if (pointer.y < EDGE_MARGIN) dy = SCROLL_SPEED;
          else if (pointer.y > stageSize.height - EDGE_MARGIN) dy = -SCROLL_SPEED;
          if (dx !== 0 || dy !== 0) {
            const vp = usePerfboardStore.getState().viewport;
            usePerfboardStore.getState().setViewport({ x: vp.x + dx, y: vp.y + dy });
          }
        }
      }
    }
  }, [getPointerCanvasPos, pixelToGrid, isDrawing, stageSize]);

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Ignore right-click (used for rotation)
    if (e.evt.button !== 0) return;
    const pos = getPointerCanvasPos();
    if (!pos) return;
    const gridPos = pixelToGrid(pos.x, pos.y);

    // Bounds check
    if (gridPos.col < 0 || gridPos.col >= perfboard.width || gridPos.row < 0 || gridPos.row >= perfboard.height) return;

    if (activeTool === 'place_component' && placingComponentId) {
      const libComp = allLib.find((c) => c.id === placingComponentId);
      if (!libComp) return;

      // Find matching schematic component (unplaced ones first)
      const placedSchIds = new Set(perfboard.components.map(c => c.schematicComponentId));
      const schematicComp = schematic.components.find(
        (c) => c.libraryId === placingComponentId && !placedSchIds.has(c.id)
      ) ?? schematic.components.find((c) => c.libraryId === placingComponentId);

      // Generate unique reference if no schematic match
      let ref = schematicComp?.reference;
      if (!ref) {
        const prefix = libComp.prefix ?? CATEGORY_PREFIX[libComp.category] ?? 'X';
        const existingRefs = [
          ...schematic.components.map(c => c.reference),
          ...perfboard.components.map(c => c.reference),
        ];
        ref = nextUniqueReference(prefix, existingRefs);
      }

      usePerfboardStore.getState().placeComponent({
        schematicComponentId: schematicComp?.id ?? '',
        libraryId: placingComponentId,
        reference: ref,
        gridPosition: gridPos,
        rotation: placementRotation,
        side: 'top',
        properties: schematicComp?.properties.holeSpan
          ? { holeSpan: schematicComp.properties.holeSpan }
          : undefined,
      });
      return;
    }

    if (activeTool === 'draw_wire' || activeTool === 'draw_wire_bridge' || activeTool === 'draw_solder_bridge') {
      if (!isDrawing) {
        usePerfboardStore.getState().startDrawingConnection(gridPos);
      } else {
        usePerfboardStore.getState().finishDrawingConnection();
      }
      return;
    }

    if (activeTool === 'cut_track') {
      usePerfboardStore.getState().toggleTrackCut(gridPos);
      return;
    }

    if (activeTool === 'select') {
      // Deselect on background click
      if (e.target === stageRef.current) {
        usePerfboardStore.getState().clearSelection();
      }
    }
  }, [activeTool, placingComponentId, allLib, getPointerCanvasPos, pixelToGrid, isDrawing, perfboard, schematic, placementRotation, placementCollision]);

  // Right-click handler for rotation
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    // Rotate placement preview
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
      return;
    }
    // Rotate selected component
    if (activeTool === 'select') {
      selectedIds.forEach((id) => usePerfboardStore.getState().rotateComponent(id));
    }
  }, [activeTool, selectedIds]);

  // Keyboard shortcuts
  useHotkeys('escape', () => {
    if (isDrawing) {
      usePerfboardStore.getState().cancelDrawing();
    } else {
      usePerfboardStore.getState().setActiveTool('select');
      usePerfboardStore.getState().clearSelection();
      setPlacementRotation(0);
    }
  });
  useHotkeys('w', () => usePerfboardStore.getState().setActiveTool('draw_wire'));
  useHotkeys('delete', () => usePerfboardStore.getState().deleteSelected());
  useHotkeys('r', () => {
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
    } else {
      selectedIds.forEach((id) => usePerfboardStore.getState().rotateComponent(id));
    }
  });
  // Ctrl+R: rotate instead of browser refresh
  useHotkeys('ctrl+r', (e) => {
    e.preventDefault();
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
    } else {
      selectedIds.forEach((id) => usePerfboardStore.getState().rotateComponent(id));
    }
  }, { preventDefault: true, enableOnFormTags: true });

  // ---- Derived rendering data ----

  const boardPixelW = (perfboard.width + 1) * PERFBOARD_GRID;
  const boardPixelH = (perfboard.height + 1) * PERFBOARD_GRID;
  const isStripboard = perfboard.boardType === 'stripboard';

  return (
    <div ref={containerRef} className="w-full h-full bg-lochcad-bg relative">
      <Stage
        ref={stageRef}
        width={stageSize.width}
        height={stageSize.height}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={activeTool === 'select' && !isDrawing && !isDraggingComponentRef.current}
        onDragEnd={(e) => {
          if (e.target !== stageRef.current) return;
          setViewport({ x: e.target.x(), y: e.target.y() });
        }}
      >
        {/* Board background */}
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={boardPixelW}
            height={boardPixelH}
            fill={isStripboard ? COLORS.boardPerf : COLORS.boardGreen}
            cornerRadius={4}
            shadowBlur={10}
            shadowColor="black"
            shadowOpacity={0.3}
          />

          {/* Stripboard copper strips */}
          {isStripboard &&
            Array.from({ length: perfboard.height }, (_, row) => {
              const py = (row + 1) * PERFBOARD_GRID;
              return (
                <Rect
                  key={`strip-${row}`}
                  x={PERFBOARD_GRID * 0.5}
                  y={py - 3}
                  width={boardPixelW - PERFBOARD_GRID}
                  height={6}
                  fill={COLORS.copperStrip}
                  opacity={0.6}
                  cornerRadius={1}
                />
              );
            })}

          {/* Holes grid */}
          {Array.from({ length: perfboard.width }, (_, col) =>
            Array.from({ length: perfboard.height }, (_, row) => {
              const px = (col + 1) * PERFBOARD_GRID;
              const py = (row + 1) * PERFBOARD_GRID;
              const isCut = perfboard.trackCuts.some(
                (t) => t.position.col === col && t.position.row === row
              );
              return (
                <React.Fragment key={`h-${col}-${row}`}>
                  {/* Copper pad ring */}
                  <Circle
                    x={px}
                    y={py}
                    radius={5}
                    fill={isCut ? COLORS.boardGreen : COLORS.copperPad}
                    opacity={isCut ? 0.3 : 0.7}
                  />
                  {/* Hole */}
                  <Circle x={px} y={py} radius={2.5} fill={COLORS.boardHole} />
                  {/* Track cut X */}
                  {isCut && (
                    <>
                      <Line points={[px - 4, py - 4, px + 4, py + 4]} stroke={COLORS.trackCut} strokeWidth={2} />
                      <Line points={[px - 4, py + 4, px + 4, py - 4]} stroke={COLORS.trackCut} strokeWidth={2} />
                    </>
                  )}
                </React.Fragment>
              );
            })
          )}
        </Layer>

        {/* Connections Layer */}
        <Layer>
          {perfboard.connections.map((conn) => (
            <ConnectionRenderer
              key={conn.id}
              connection={conn}
              gridToPixel={gridToPixel}
              isSelected={selectedIds.includes(conn.id)}
              onClick={() => {
                if (activeTool === 'select') usePerfboardStore.getState().select([conn.id]);
                else if (activeTool === 'delete') usePerfboardStore.getState().removeConnection(conn.id);
              }}
            />
          ))}

          {/* Drawing preview — Manhattan routed path with Lötpunkte */}
          {isDrawing && drawingPreviewPath && drawingPreviewPath.length >= 2 && (() => {
            const blockedColor = COLORS.errorMarker;
            const previewColor = drawingBlocked ? blockedColor
              : drawingIsAdjacent ? SOLDER_BRIDGE_COLOR
              : drawingType === 'wire' ? COLORS.copper
              : drawingType === 'wire_bridge' ? COLORS.wireBridge
              : COLORS.solderBridge;
            const previewStroke = drawingIsAdjacent ? 4 : drawingType === 'wire_bridge' ? 3 : 2;
            const previewDash: number[] | undefined = drawingBlocked ? [4, 4]
              : drawingIsAdjacent ? undefined : [6, 4];
            const previewPoints = drawingPreviewPath.flatMap((p) => {
              const px = gridToPixel(p);
              return [px.x, px.y];
            });
            // Waypoints for Lötpunkte preview (exclude endpoints)
            const waypointDots = drawingPreviewPath.slice(1, -1);

            return (
              <Group>
                <Line
                  points={previewPoints}
                  stroke={previewColor}
                  strokeWidth={previewStroke}
                  dash={previewDash}
                  lineCap="round"
                  lineJoin="round"
                  opacity={drawingBlocked ? 0.7 : 0.6}
                />
                {/* Blocked indicator */}
                {drawingBlocked && drawingTo && (() => {
                  const endPx = gridToPixel(drawingTo);
                  return (
                    <>
                      <Line
                        points={[endPx.x - 6, endPx.y - 6, endPx.x + 6, endPx.y + 6]}
                        stroke={blockedColor}
                        strokeWidth={2}
                      />
                      <Line
                        points={[endPx.x + 6, endPx.y - 6, endPx.x - 6, endPx.y + 6]}
                        stroke={blockedColor}
                        strokeWidth={2}
                      />
                      <Text
                        x={endPx.x + 10}
                        y={endPx.y - 6}
                        text="Blockiert"
                        fontSize={9}
                        fontFamily="JetBrains Mono, monospace"
                        fill={blockedColor}
                        opacity={0.9}
                      />
                    </>
                  );
                })()}
                {/* Lötpunkte dots at corners and support points */}
                {!drawingIsAdjacent && !drawingBlocked && waypointDots.map((wp, i) => {
                  const p = gridToPixel(wp);
                  return (
                    <Circle
                      key={`dwp-${i}`}
                      x={p.x}
                      y={p.y}
                      radius={3.5}
                      fill={SOLDER_POINT_COLOR}
                      opacity={0.5}
                    />
                  );
                })}
                {/* Solder bridge hint */}
                {drawingIsAdjacent && !drawingBlocked && (
                  <Text
                    x={gridToPixel(drawingPreviewPath[0]).x}
                    y={gridToPixel(drawingPreviewPath[0]).y + 12}
                    text="Lötbrücke"
                    fontSize={8}
                    fontFamily="JetBrains Mono, monospace"
                    fill={SOLDER_BRIDGE_COLOR}
                    opacity={0.7}
                  />
                )}
              </Group>
            );
          })()}
        </Layer>

        {/* Components Layer */}
        <Layer>
          {perfboard.components.map((comp) => {
            const libComp = allLib.find((c) => c.id === comp.libraryId);
            if (!libComp) return null;
            return (
              <PerfboardComponentRenderer
                key={comp.id}
                component={comp}
                definition={libComp}
                gridToPixel={gridToPixel}
                pixelToGrid={pixelToGrid}
                isSelected={selectedIds.includes(comp.id)}
                draggable={activeTool === 'select'}
                onClick={() => {
                  if (activeTool === 'select') usePerfboardStore.getState().select([comp.id]);
                  else if (activeTool === 'delete') usePerfboardStore.getState().removeComponent(comp.id);
                }}
                onDragStart={handleCompDragStart}
                onDragMove={handleCompDragMove}
                onDragEnd={(gridPos) => handleCompDragEnd(comp.id, gridPos)}
              />
            );
          })}
        </Layer>

        {/* Overlay */}
        <Layer listening={false}>
          {/* Cursor highlight */}
          {mouseGridPos.col >= 0 && mouseGridPos.col < perfboard.width &&
            mouseGridPos.row >= 0 && mouseGridPos.row < perfboard.height && (
            <Circle
              x={(mouseGridPos.col + 1) * PERFBOARD_GRID}
              y={(mouseGridPos.row + 1) * PERFBOARD_GRID}
              radius={7}
              stroke={COLORS.selected}
              strokeWidth={1.5}
              opacity={0.6}
            />
          )}

          {/* Component placement preview */}
          {activeTool === 'place_component' && placingComponentId && (() => {
            const libComp = allLib.find((c) => c.id === placingComponentId);
            if (!libComp) return null;
            const previewColor = placementCollision ? '#ff4444' : COLORS.selected;

            // Compute rotated pad positions for bounding box
            const rotatedPads = libComp.footprint.pads.map((pad) => {
              const r = ((placementRotation % 360) + 360) % 360;
              let pc = pad.gridPosition.col, pr = pad.gridPosition.row;
              if (r === 90) { const t = pc; pc = -pr; pr = t; }
              else if (r === 180) { pc = -pc; pr = -pr; }
              else if (r === 270) { const t = pc; pc = pr; pr = -t; }
              return { col: mouseGridPos.col + pc, row: mouseGridPos.row + pr };
            });
            let minCol = Math.min(...rotatedPads.map((p) => p.col));
            let maxCol = Math.max(...rotatedPads.map((p) => p.col));
            let minRow = Math.min(...rotatedPads.map((p) => p.row));
            let maxRow = Math.max(...rotatedPads.map((p) => p.row));

            // Expand bbox to match spanHoles body area
            const sh = libComp.footprint.spanHoles;
            const rAngle = ((placementRotation % 360) + 360) % 360;
            let spanC = sh.col, spanR = sh.row;
            if (rAngle === 90 || rAngle === 270) { const t = spanC; spanC = spanR; spanR = t; }
            const padCols = maxCol - minCol + 1;
            const padRows = maxRow - minRow + 1;
            const extraC = spanC - padCols;
            const extraR = spanR - padRows;
            if (extraC > 0) { minCol -= Math.floor(extraC / 2); maxCol += Math.ceil(extraC / 2); }
            if (extraR > 0) { minRow -= Math.floor(extraR / 2); maxRow += Math.ceil(extraR / 2); }

            return (
              <Group>
                {/* Collision bounding box */}
                {placementCollision && (
                  <>
                    <Rect
                      x={(minCol + 1) * PERFBOARD_GRID - 10}
                      y={(minRow + 1) * PERFBOARD_GRID - 10}
                      width={(maxCol - minCol) * PERFBOARD_GRID + 20}
                      height={(maxRow - minRow) * PERFBOARD_GRID + 20}
                      fill="rgba(255, 40, 40, 0.12)"
                      stroke="#ff4444"
                      strokeWidth={1.5}
                      dash={[6, 3]}
                      cornerRadius={3}
                      listening={false}
                    />
                    <Text
                      x={(minCol + 1) * PERFBOARD_GRID - 10}
                      y={(maxRow + 1) * PERFBOARD_GRID + 14}
                      text="Kollision!"
                      fontSize={10}
                      fontFamily="JetBrains Mono, monospace"
                      fill="#ff4444"
                    />
                  </>
                )}
                {/* Pad circles */}
                <Group opacity={placementCollision ? 0.7 : 0.5}>
                  {rotatedPads.map((rp, i) => {
                    const px = (rp.col + 1) * PERFBOARD_GRID;
                    const py = (rp.row + 1) * PERFBOARD_GRID;
                    return (
                      <Circle key={i} x={px} y={py} radius={5} fill={previewColor} />
                    );
                  })}
                </Group>
              </Group>
            );
          })()}

          {/* Coordinate info */}
          <Text
            x={(mouseGridPos.col + 1) * PERFBOARD_GRID + 12}
            y={(mouseGridPos.row + 1) * PERFBOARD_GRID + 12}
            text={`${mouseGridPos.col},${mouseGridPos.row}`}
            fontSize={9}
            fontFamily="JetBrains Mono, monospace"
            fill={COLORS.selected}
            opacity={0.5}
          />
        </Layer>
      </Stage>

      {/* Tool hint */}
      <div className="absolute bottom-2 left-2 text-[10px] text-lochcad-text-dim bg-lochcad-bg/80 px-2 py-1 rounded">
        {activeTool === 'select' && 'Klick: Auswählen | Rechtsklick/Strg+R: Drehen | Scroll: Zoom'}
        {activeTool === 'place_component' && 'Klick: Platzieren | Rechtsklick/R/Strg+R: Drehen | Esc: Abbrechen'}
        {(activeTool === 'draw_wire' || activeTool === 'draw_wire_bridge' || activeTool === 'draw_solder_bridge') &&
          'Klick: Start/Ende setzen (Manhattan-Routing) | Esc: Abbrechen'}
        {activeTool === 'cut_track' && 'Klick: Track unterbrechen/wiederherstellen'}
        {activeTool === 'delete' && 'Klick: Element löschen'}
      </div>
    </div>
  );
}

// ---- Connection Renderer ----

const SOLDER_POINT_RADIUS = 4;
const SOLDER_POINT_COLOR = '#c0c0c0'; // silver solder
const SOLDER_BRIDGE_COLOR = '#b87333'; // copper

const ConnectionRenderer: React.FC<{
  connection: PerfboardConnection;
  gridToPixel: (pos: GridPosition) => { x: number; y: number };
  isSelected: boolean;
  onClick: () => void;
}> = React.memo(({ connection, gridToPixel, isSelected, onClick }) => {
  const from = gridToPixel(connection.from);
  const to = gridToPixel(connection.to);

  const isSolderBridge = connection.type === 'solder_bridge';

  const color = isSelected ? COLORS.selected
    : connection.type === 'wire' ? COLORS.copper
    : connection.type === 'wire_bridge' ? COLORS.wireBridge
    : isSolderBridge ? SOLDER_BRIDGE_COLOR
    : COLORS.copper;

  const strokeWidth = isSolderBridge ? 4
    : connection.type === 'wire_bridge' ? 3 : 2;
  const dash = connection.type === 'wire_bridge' ? [6, 3] : undefined;

  // Build points array including waypoints
  const allPoints: GridPosition[] = [connection.from];
  if (connection.waypoints && connection.waypoints.length > 0) {
    allPoints.push(...connection.waypoints);
  }
  allPoints.push(connection.to);

  const pixelPoints: number[] = [];
  for (const gp of allPoints) {
    const p = gridToPixel(gp);
    pixelPoints.push(p.x, p.y);
  }

  // Compute Lötpunkte: every waypoint (= corner or support point)
  // Exclude first and last (those are connection endpoints, already shown as pads)
  const lötpunkte = allPoints.slice(1, -1);

  return (
    <Group>
      {/* Wire/bridge line */}
      <Line
        points={pixelPoints}
        stroke={color}
        strokeWidth={strokeWidth}
        dash={dash}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={10}
        onClick={onClick}
      />

      {/* Solder bridge: thicker rounded blob between adjacent holes */}
      {isSolderBridge && (
        <>
          <Circle x={from.x} y={from.y} radius={SOLDER_POINT_RADIUS + 1}
            fill={isSelected ? COLORS.selected : SOLDER_BRIDGE_COLOR} opacity={0.9} />
          <Circle x={to.x} y={to.y} radius={SOLDER_POINT_RADIUS + 1}
            fill={isSelected ? COLORS.selected : SOLDER_BRIDGE_COLOR} opacity={0.9} />
        </>
      )}

      {/* Lötpunkte at corners and support points */}
      {!isSolderBridge && lötpunkte.map((wp, i) => {
        const p = gridToPixel(wp);
        return (
          <Circle
            key={`sp-${i}`}
            x={p.x}
            y={p.y}
            radius={SOLDER_POINT_RADIUS}
            fill={isSelected ? COLORS.selected : SOLDER_POINT_COLOR}
            stroke={isSelected ? COLORS.selected : '#999'}
            strokeWidth={0.5}
            opacity={0.85}
          />
        );
      })}
    </Group>
  );
});

ConnectionRenderer.displayName = 'ConnectionRenderer';

// ---- Perfboard Component Renderer ----

const PerfboardComponentRenderer: React.FC<{
  component: PerfboardComponent;
  definition: ComponentDefinition;
  gridToPixel: (pos: GridPosition) => { x: number; y: number };
  pixelToGrid: (x: number, y: number) => GridPosition;
  isSelected: boolean;
  draggable?: boolean;
  onClick: () => void;
  onDragStart?: () => void;
  onDragMove?: () => void;
  onDragEnd?: (gridPos: GridPosition) => boolean | void;
}> = React.memo(({ component, definition, gridToPixel, pixelToGrid, isSelected, draggable = false, onClick, onDragStart, onDragMove, onDragEnd }) => {
  // Use adjusted footprint pads if holeSpan is set
  const { pads: adjustedPads } = getAdjustedFootprint(definition, component.properties?.holeSpan);
  const basePos = gridToPixel(component.gridPosition);

  // Helper to rotate pad offsets by component rotation
  const rotatePadOffset = (pad: { col: number; row: number }) => {
    const r = ((component.rotation % 360) + 360) % 360;
    let c = pad.col, ro = pad.row;
    if (r === 90) { const t = c; c = -ro; ro = t; }
    else if (r === 180) { c = -c; ro = -ro; }
    else if (r === 270) { const t = c; c = ro; ro = -t; }
    return { col: c, row: ro };
  };

  const handleDragEnd = (e: any) => {
    e.cancelBubble = true;
    const gx = e.target.x();
    const gy = e.target.y();
    const gp = pixelToGrid(gx, gy);
    const accepted = onDragEnd?.(gp);
    if (accepted === false) {
      // Collision — snap back to original position
      e.target.x(basePos.x);
      e.target.y(basePos.y);
    } else {
      const snapped = gridToPixel(gp);
      e.target.x(snapped.x);
      e.target.y(snapped.y);
    }
  };

  return (
    <Group
      x={basePos.x}
      y={basePos.y}
      draggable={draggable}
      onClick={onClick}
      onDragStart={(e: any) => { e.cancelBubble = true; onDragStart?.(); }}
      onDragMove={(e: any) => { e.cancelBubble = true; onDragMove?.(); }}
      onDragEnd={handleDragEnd}
    >
      {/* Pads */}
      {adjustedPads.map((pad, i) => {
        const rotated = rotatePadOffset(pad.gridPosition);
        const padPos = gridToPixel({
          col: component.gridPosition.col + rotated.col,
          row: component.gridPosition.row + rotated.row,
        });
        const relX = padPos.x - basePos.x;
        const relY = padPos.y - basePos.y;
        return (
          <React.Fragment key={i}>
            {/* Pad highlight */}
            <Circle
              x={relX}
              y={relY}
              radius={6}
              fill={isSelected ? COLORS.selected : COLORS.copper}
              opacity={0.8}
            />
            {/* Pad number */}
            {pad.shape === 'square' && (
              <Rect
                x={relX - 5}
                y={relY - 5}
                width={10}
                height={10}
                fill={isSelected ? COLORS.selected : COLORS.copper}
                opacity={0.8}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Component body outline */}
      {adjustedPads.length > 1 && (() => {
        const cols = adjustedPads.map((p) => {
          const rp = rotatePadOffset(p.gridPosition);
          return component.gridPosition.col + rp.col;
        });
        const rows = adjustedPads.map((p) => {
          const rp = rotatePadOffset(p.gridPosition);
          return component.gridPosition.row + rp.row;
        });
        let cMin = Math.min(...cols), cMax = Math.max(...cols);
        let rMin = Math.min(...rows), rMax = Math.max(...rows);

        // Expand to match the component body (spanHoles) if larger than pads
        const sh = definition.footprint.spanHoles;
        const rAngle = ((component.rotation % 360) + 360) % 360;
        let spanC = sh.col, spanR = sh.row;
        if (rAngle === 90 || rAngle === 270) { const t = spanC; spanC = spanR; spanR = t; }
        const padC = cMax - cMin + 1;
        const padR = rMax - rMin + 1;
        const eC = spanC - padC;
        const eR = spanR - padR;
        if (eC > 0) { cMin -= Math.floor(eC / 2); cMax += Math.ceil(eC / 2); }
        if (eR > 0) { rMin -= Math.floor(eR / 2); rMax += Math.ceil(eR / 2); }

        const minPos = gridToPixel({ col: cMin, row: rMin });
        const maxPos = gridToPixel({ col: cMax, row: rMax });

        return (
          <Rect
            x={minPos.x - basePos.x - 8}
            y={minPos.y - basePos.y - 8}
            width={maxPos.x - minPos.x + 16}
            height={maxPos.y - minPos.y + 16}
            stroke={isSelected ? COLORS.selected : COLORS.componentBody}
            strokeWidth={1.5}
            fill="rgba(233, 69, 96, 0.08)"
            cornerRadius={3}
            dash={[4, 2]}
          />
        );
      })()}

      {/* Reference text */}
      <Text
        x={0}
        y={-14}
        text={component.reference}
        fontSize={9}
        fontFamily="JetBrains Mono, monospace"
        fill={isSelected ? COLORS.selected : COLORS.componentRef}
        align="center"
      />
    </Group>
  );
});

PerfboardComponentRenderer.displayName = 'PerfboardComponentRenderer';
