// ============================================================
// Schematic Editor — Main Konva Canvas
// ============================================================

import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { Stage, Layer, Line, Circle, Text, Rect, Group } from 'react-konva';
import type Konva from 'konva';
import { useProjectStore, useSchematicStore } from '@/stores';
import { getBuiltInComponents, getComponentById } from '@/lib/component-library';
import { SymbolRenderer } from './SymbolRenderer';
import { COLORS, SCHEMATIC_GRID, SCHEMATIC_WIDTH, SCHEMATIC_HEIGHT, CATEGORY_PREFIX, nextUniqueReference } from '@/constants';
import type { Point, SchematicComponent, Wire, Junction, NetLabel } from '@/types';
import { v4 as uuid } from 'uuid';
import { useHotkeys } from 'react-hotkeys-hook';
import { routeSchematicWire, getComponentBBox, bboxOverlap, hasComponentCollision } from '@/lib/engine/schematic-router';
import type { BBox } from '@/lib/engine/schematic-router';

export default function SchematicEditor() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [mousePos, setMousePos] = useState<Point>({ x: 0, y: 0 });
  const [hoveredComponentId, setHoveredComponentId] = useState<string | null>(null);
  const [placementRotation, setPlacementRotation] = useState(0);
  const [placementMirror, setPlacementMirror] = useState(false);
  const isDraggingComponentRef = useRef(false);
  const autoScrollRafRef = useRef<number | null>(null);

  const viewport = useSchematicStore((s) => s.viewport);
  const setViewport = useSchematicStore((s) => s.setViewport);
  const activeTool = useSchematicStore((s) => s.activeTool);
  const selection = useSchematicStore((s) => s.selection);
  const isDrawing = useSchematicStore((s) => s.isDrawing);
  const drawingPoints = useSchematicStore((s) => s.drawingPoints);
  const placingComponentId = useSchematicStore((s) => s.placingComponentId);
  const activeSheetId = useProjectStore((s) => s.activeSheetId);
  const schematic = useProjectStore((s) => s.project.schematic);
  const customComponents = useProjectStore((s) => s.project.componentLibrary);

  const allComponents = useMemo(
    () => [...getBuiltInComponents(), ...customComponents],
    [customComponents]
  );

  // Resize handler
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

  // Filter elements for active sheet
  const sheetComponents = useMemo(
    () => schematic.components.filter((c) => c.sheetId === activeSheetId),
    [schematic.components, activeSheetId]
  );
  const sheetWires = useMemo(
    () => schematic.wires.filter((w) => w.sheetId === activeSheetId),
    [schematic.wires, activeSheetId]
  );
  const sheetJunctions = useMemo(
    () => schematic.junctions.filter((j) => j.sheetId === activeSheetId),
    [schematic.junctions, activeSheetId]
  );
  const sheetLabels = useMemo(
    () => schematic.labels.filter((l) => l.sheetId === activeSheetId),
    [schematic.labels, activeSheetId]
  );
  const sheetBusses = useMemo(
    () => schematic.busses.filter((b) => b.sheetId === activeSheetId),
    [schematic.busses, activeSheetId]
  );

  // Obstacle bboxes for all components on this sheet (for wire routing preview)
  const sheetObstacles = useMemo<BBox[]>(() => {
    return sheetComponents.map((c) => {
      const def = allComponents.find((d) => d.id === c.libraryId);
      return def ? getComponentBBox(c, def.symbol) : null;
    }).filter((b): b is NonNullable<typeof b> => b !== null);
  }, [sheetComponents, allComponents]);

  // Check collision for component placement preview — only exact pin-on-pin allowed
  const placementCollision = useMemo(() => {
    if (activeTool !== 'place_component' || !placingComponentId) return false;
    const libComp = allComponents.find((c) => c.id === placingComponentId);
    if (!libComp) return false;
    const previewComp = { id: '_preview', libraryId: placingComponentId, reference: '', value: '', position: mousePos, rotation: placementRotation, mirror: placementMirror, properties: {}, sheetId: activeSheetId } as any;
    for (const sc of sheetComponents) {
      const sDef = allComponents.find((d) => d.id === sc.libraryId);
      if (!sDef) continue;
      if (hasComponentCollision(previewComp, libComp.symbol, sc, sDef.symbol)) return true;
    }
    return false;
  }, [activeTool, placingComponentId, allComponents, mousePos, placementRotation, placementMirror, sheetComponents, activeSheetId]);

  // Manhattan drawing preview
  const drawingPreviewPoints = useMemo<Point[] | null>(() => {
    if (!isDrawing || drawingPoints.length === 0) return null;
    const lastPoint = drawingPoints[drawingPoints.length - 1];
    if (lastPoint.x === mousePos.x && lastPoint.y === mousePos.y) return null;
    return routeSchematicWire({
      from: lastPoint,
      to: mousePos,
      obstacles: sheetObstacles,
    });
  }, [isDrawing, drawingPoints, mousePos, sheetObstacles]);

  // Snap to grid
  const snap = useCallback((p: Point): Point => ({
    x: Math.round(p.x / SCHEMATIC_GRID) * SCHEMATIC_GRID,
    y: Math.round(p.y / SCHEMATIC_GRID) * SCHEMATIC_GRID,
  }), []);

  // Get pointer position in canvas coordinates
  const getPointerPos = useCallback((): Point | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    return {
      x: (pointer.x - viewport.x) / viewport.scale,
      y: (pointer.y - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  // ---- Event Handlers ----

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.08;
    const oldScale = viewport.scale;
    const newScale = e.evt.deltaY > 0
      ? Math.max(oldScale / scaleBy, 0.1)
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

  // Auto-scroll edge margin / speed
  const EDGE_MARGIN = 40;
  const SCROLL_SPEED = 8;

  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getPointerPos();
    if (pos) {
      setMousePos(snap(pos));

      if (isDrawing) {
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
              const vp = useSchematicStore.getState().viewport;
              useSchematicStore.getState().setViewport({ x: vp.x + dx, y: vp.y + dy });
            }
          }
        }
      }
    }
  }, [getPointerPos, snap, isDrawing, stageSize]);

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // Ignore right-click (used for rotation)
    if (e.evt.button !== 0) return;
    const pos = getPointerPos();
    if (!pos) return;
    const snapped = snap(pos);

    if (activeTool === 'place_component' && placingComponentId) {
      const libComp = allComponents.find((c) => c.id === placingComponentId);
      if (!libComp) return;

      // Block placement on direct overlap
      if (placementCollision) return;

      // Auto-reference: unique per prefix across schematic + perfboard
      const prefix = libComp.prefix ?? CATEGORY_PREFIX[libComp.category] ?? 'X';
      const existingRefs = [
        ...schematic.components.map(c => c.reference),
        ...useProjectStore.getState().project.perfboard.components.map(c => c.reference),
      ];

      useSchematicStore.getState().addComponent({
        libraryId: placingComponentId,
        reference: nextUniqueReference(prefix, existingRefs),
        value: libComp.defaultProperties?.value ?? libComp.name,
        position: snapped,
        rotation: placementRotation,
        mirror: placementMirror,
        properties: { ...libComp.defaultProperties },
        sheetId: activeSheetId,
      });
      return;
    }

    if (activeTool === 'draw_wire' || activeTool === 'draw_bus') {
      if (!isDrawing) {
        useSchematicStore.getState().startDrawing(snapped);
      } else {
        useSchematicStore.getState().addDrawingPoint(snapped);
      }
      return;
    }

    if (activeTool === 'place_junction') {
      useSchematicStore.getState().addJunction(snapped, uuid(), activeSheetId);
      return;
    }

    if (activeTool === 'place_label') {
      const name = prompt('Label-Name:');
      if (name) {
        useSchematicStore.getState().addLabel({
          text: name,
          position: snapped,
          type: 'net',
          netId: uuid(),
          rotation: 0,
          sheetId: activeSheetId,
        });
      }
      return;
    }

    if (activeTool === 'place_power') {
      // Place VCC or GND
      const choice = prompt('Power-Symbol (VCC / GND):');
      if (choice) {
        const pwrId = choice.toUpperCase() === 'GND' ? 'power_gnd' : 'power_vcc';
        useSchematicStore.getState().addComponent({
          libraryId: pwrId,
          reference: '#PWR',
          value: choice.toUpperCase(),
          position: snapped,
          rotation: 0,
          mirror: false,
          properties: {},
          sheetId: activeSheetId,
        });
      }
      return;
    }

    if (activeTool === 'select') {
      // Nothing clicked on canvas background → deselect
      if (e.target === stageRef.current || e.target.getParent() === stageRef.current?.findOne('.grid-layer')) {
        useSchematicStore.getState().clearSelection();
      }
    }
  }, [activeTool, placingComponentId, allComponents, snap, getPointerPos, isDrawing, activeSheetId, schematic.components, placementCollision, placementRotation, placementMirror]);

  // Right-click handler for rotation
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
      return;
    }
    if (activeTool === 'select') {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().rotateComponent(id));
    }
  }, [activeTool]);

  const handleDblClick = useCallback(() => {
    if (isDrawing) {
      useSchematicStore.getState().finishDrawing();
    }
  }, [isDrawing]);

  // Component interaction handlers
  const handleComponentClick = useCallback((compId: string, e: any) => {
    e.cancelBubble = true;
    if (activeTool === 'select') {
      if (e.evt.shiftKey) {
        useSchematicStore.getState().toggleSelection('componentIds', compId);
      } else {
        useSchematicStore.getState().select({ componentIds: [compId] });
      }
    } else if (activeTool === 'delete') {
      useSchematicStore.getState().deleteComponent(compId);
    }
  }, [activeTool]);

  const handleComponentDragEnd = useCallback((compId: string, x: number, y: number): boolean => {
    isDraggingComponentRef.current = false;
    if (autoScrollRafRef.current) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = null; }
    return useSchematicStore.getState().moveComponent(compId, { x, y });
  }, []);

  const handleComponentDragStart = useCallback(() => {
    isDraggingComponentRef.current = true;
  }, []);

  const handleComponentDragMove = useCallback(() => {
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
      const vp = useSchematicStore.getState().viewport;
      useSchematicStore.getState().setViewport({ x: vp.x + dx, y: vp.y + dy });
    }
  }, [stageSize]);

  const handleWireClick = useCallback((wireId: string, e: any) => {
    e.cancelBubble = true;
    if (activeTool === 'select') {
      useSchematicStore.getState().select({ wireIds: [wireId] });
    } else if (activeTool === 'delete') {
      useSchematicStore.getState().deleteWire(wireId);
    }
  }, [activeTool]);

  // Keyboard shortcuts
  useHotkeys('escape', () => {
    if (isDrawing) {
      useSchematicStore.getState().cancelDrawing();
    } else {
      useSchematicStore.getState().setActiveTool('select');
      useSchematicStore.getState().clearSelection();
      setPlacementRotation(0);
      setPlacementMirror(false);
    }
  });
  useHotkeys('w', () => useSchematicStore.getState().setActiveTool('draw_wire'));
  useHotkeys('b', () => useSchematicStore.getState().setActiveTool('draw_bus'));
  useHotkeys('l', () => useSchematicStore.getState().setActiveTool('place_label'));
  useHotkeys('delete', () => useSchematicStore.getState().deleteSelected());
  useHotkeys('r', () => {
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
    } else {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().rotateComponent(id));
    }
  });
  useHotkeys('x', () => {
    if (activeTool === 'place_component') {
      setPlacementMirror((m) => !m);
    } else {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().mirrorComponent(id));
    }
  });
  // Ctrl+R: rotate instead of browser refresh
  useHotkeys('ctrl+r', (e) => {
    e.preventDefault();
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
    } else {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().rotateComponent(id));
    }
  }, { preventDefault: true, enableOnFormTags: true });

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
        onDblClick={handleDblClick}
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
        {/* Grid Layer */}
        <Layer name="grid-layer" listening={false}>
          <GridRenderer width={SCHEMATIC_WIDTH} height={SCHEMATIC_HEIGHT} gridSize={SCHEMATIC_GRID} />
        </Layer>

        {/* Wires Layer */}
        <Layer>
          {sheetWires.map((wire) => (
            <WireRenderer
              key={wire.id}
              wire={wire}
              isSelected={selection.wireIds.includes(wire.id)}
              onClick={(e) => handleWireClick(wire.id, e)}
            />
          ))}

          {/* Busses */}
          {sheetBusses.map((bus) => (
            <Line
              key={bus.id}
              points={bus.points.flatMap((p) => [p.x, p.y])}
              stroke={COLORS.bus}
              strokeWidth={4}
              lineCap="round"
              lineJoin="round"
            />
          ))}

          {/* Drawing preview — Manhattan routed */}
          {isDrawing && drawingPoints.length > 0 && (() => {
            // Committed segments
            const committedPts = drawingPoints.flatMap((p) => [p.x, p.y]);
            // Preview extension from last committed point to mouse
            const previewPts = drawingPreviewPoints
              ? drawingPreviewPoints.flatMap((p) => [p.x, p.y])
              : [drawingPoints[drawingPoints.length - 1].x, drawingPoints[drawingPoints.length - 1].y, mousePos.x, mousePos.y];
            const wireColor = activeTool === 'draw_bus' ? COLORS.bus : COLORS.wire;
            const wireWidth = activeTool === 'draw_bus' ? 4 : 2;
            return (
              <>
                {/* Already committed points */}
                {drawingPoints.length >= 2 && (
                  <Line
                    points={committedPts}
                    stroke={wireColor}
                    strokeWidth={wireWidth}
                    lineCap="round"
                    lineJoin="round"
                  />
                )}
                {/* Live preview segment */}
                <Line
                  points={previewPts}
                  stroke={wireColor}
                  strokeWidth={wireWidth}
                  lineCap="round"
                  lineJoin="round"
                  dash={[6, 4]}
                  opacity={0.7}
                />
              </>
            );
          })()}
        </Layer>

        {/* Components Layer */}
        <Layer>
          {sheetComponents.map((comp) => {
            const libComp = allComponents.find((c) => c.id === comp.libraryId);
            if (!libComp) return null;

            return (
              <SymbolRenderer
                key={comp.id}
                symbol={libComp.symbol}
                x={comp.position.x}
                y={comp.position.y}
                rotation={comp.rotation}
                mirror={comp.mirror}
                reference={comp.reference}
                value={comp.value}
                isSelected={selection.componentIds.includes(comp.id)}
                isHovered={hoveredComponentId === comp.id}
                draggable={activeTool === 'select'}
                onClick={() => handleComponentClick(comp.id, { cancelBubble: true, evt: { shiftKey: false } })}
                onDblClick={() => {
                  // Select exclusively on double-click, ensuring properties panel shows
                  useSchematicStore.getState().select({ componentIds: [comp.id] });
                }}
                onDragStart={handleComponentDragStart}
                onDragMove={handleComponentDragMove}
                onDragEnd={(x, y) => handleComponentDragEnd(comp.id, x, y)}
              />
            );
          })}

          {/* Junctions */}
          {sheetJunctions.map((jct) => (
            <Circle
              key={jct.id}
              x={jct.position.x}
              y={jct.position.y}
              radius={4}
              fill={COLORS.junction}
              stroke={COLORS.junction}
              strokeWidth={1}
            />
          ))}

          {/* Labels */}
          {sheetLabels.map((label) => (
            <Group key={label.id} x={label.position.x} y={label.position.y} rotation={label.rotation}>
              <Rect
                x={-2}
                y={-12}
                width={label.text.length * 7 + 8}
                height={16}
                fill={COLORS.background}
                stroke={label.type === 'power' ? '#ff4444' : COLORS.wire}
                strokeWidth={1}
                cornerRadius={2}
              />
              <Text
                x={2}
                y={-10}
                text={label.text}
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                fill={label.type === 'power' ? '#ff4444' : '#ffffff'}
              />
            </Group>
          ))}
        </Layer>

        {/* Overlay Layer — cursor crosshair, placement preview */}
        <Layer listening={false}>
          {/* Cursor crosshair */}
          {(activeTool !== 'select') && (
            <>
              <Line
                points={[mousePos.x - 10, mousePos.y, mousePos.x + 10, mousePos.y]}
                stroke={COLORS.selected}
                strokeWidth={0.5}
                opacity={0.6}
              />
              <Line
                points={[mousePos.x, mousePos.y - 10, mousePos.x, mousePos.y + 10]}
                stroke={COLORS.selected}
                strokeWidth={0.5}
                opacity={0.6}
              />
            </>
          )}

          {/* Component placement preview */}
          {activeTool === 'place_component' && placingComponentId && (() => {
            const libComp = allComponents.find((c) => c.id === placingComponentId);
            if (!libComp) return null;
            return (
              <Group>
                {/* Collision indicator */}
                {placementCollision && (
                  <Rect
                    x={mousePos.x - 50}
                    y={mousePos.y - 50}
                    width={100}
                    height={100}
                    fill="rgba(255, 40, 40, 0.15)"
                    stroke="#ff4444"
                    strokeWidth={1.5}
                    dash={[6, 3]}
                    cornerRadius={4}
                    listening={false}
                  />
                )}
                <SymbolRenderer
                  symbol={libComp.symbol}
                  x={mousePos.x}
                  y={mousePos.y}
                  rotation={placementRotation}
                  mirror={placementMirror}
                  isDimmed={!placementCollision}
                  reference=""
                  value=""
                />
                {placementCollision && (
                  <Text
                    x={mousePos.x - 30}
                    y={mousePos.y + 40}
                    text="Kollision!"
                    fontSize={10}
                    fontFamily="JetBrains Mono, monospace"
                    fill="#ff4444"
                  />
                )}
              </Group>
            );
          })()}

          {/* Coordinates display */}
          <Text
            x={mousePos.x + 15}
            y={mousePos.y + 15}
            text={`${mousePos.x}, ${mousePos.y}`}
            fontSize={9}
            fontFamily="JetBrains Mono, monospace"
            fill={COLORS.selected}
            opacity={0.5}
          />
        </Layer>
      </Stage>

      {/* Tool hint overlay */}
      <div className="absolute bottom-2 left-2 text-[10px] text-lochcad-text-dim bg-lochcad-bg/80 px-2 py-1 rounded">
        {activeTool === 'select' && 'Klick: Auswählen | Rechtsklick/Strg+R: Drehen | Scroll: Zoom'}
        {activeTool === 'draw_wire' && 'Klick: Punkt setzen (Manhattan) | Doppelklick: Beenden | Esc: Abbrechen'}
        {activeTool === 'draw_bus' && 'Klick: Punkt setzen | Doppelklick: Beenden | Esc: Abbrechen'}
        {activeTool === 'place_component' && 'Klick: Platzieren | Rechtsklick/R/Strg+R: Drehen | X: Spiegeln | Esc: Abbrechen'}
        {activeTool === 'place_label' && 'Klick: Label platzieren'}
        {activeTool === 'place_junction' && 'Klick: Knotenpunkt setzen'}
        {activeTool === 'delete' && 'Klick auf Element: Löschen'}
      </div>
    </div>
  );
}

// ---- Grid Renderer ----

const GridRenderer: React.FC<{ width: number; height: number; gridSize: number }> = React.memo(
  ({ width, height, gridSize }) => {
    const lines: React.ReactNode[] = [];
    const majorGrid = gridSize * 5;

    // Minor grid
    for (let x = 0; x <= width; x += gridSize) {
      const isMajor = x % majorGrid === 0;
      lines.push(
        <Line
          key={`gv-${x}`}
          points={[x, 0, x, height]}
          stroke={isMajor ? COLORS.grid : COLORS.gridMinor}
          strokeWidth={isMajor ? 0.5 : 0.25}
        />
      );
    }
    for (let y = 0; y <= height; y += gridSize) {
      const isMajor = y % majorGrid === 0;
      lines.push(
        <Line
          key={`gh-${y}`}
          points={[0, y, width, y]}
          stroke={isMajor ? COLORS.grid : COLORS.gridMinor}
          strokeWidth={isMajor ? 0.5 : 0.25}
        />
      );
    }

    return <>{lines}</>;
  }
);

GridRenderer.displayName = 'GridRenderer';

// ---- Wire Renderer ----

const WireRenderer: React.FC<{ wire: Wire; isSelected: boolean; onClick: (e: any) => void }> = React.memo(
  ({ wire, isSelected, onClick }) => (
    <Line
      points={wire.points.flatMap((p) => [p.x, p.y])}
      stroke={isSelected ? COLORS.selected : COLORS.wire}
      strokeWidth={isSelected ? 3 : 2}
      lineCap="round"
      lineJoin="round"
      hitStrokeWidth={10}
      onClick={onClick}
    />
  )
);

WireRenderer.displayName = 'WireRenderer';
