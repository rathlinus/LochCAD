// ============================================================
// Perfboard Editor — Lochraster / Stripboard layout canvas
// ============================================================

import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { Stage, Layer, Circle, Rect, Line, Text, Group } from 'react-konva';
import type Konva from 'konva';
import { useProjectStore, usePerfboardStore, useCheckStore } from '@/stores';
import { getBuiltInComponents, getAdjustedFootprint } from '@/lib/component-library';
import { COLORS, PERFBOARD_GRID, CATEGORY_PREFIX, nextUniqueReference } from '@/constants';
import type { GridPosition, PerfboardComponent, PerfboardConnection, ComponentDefinition, FootprintPad } from '@/types';
import { useHotkeys } from 'react-hotkeys-hook';
import { findManhattanRoute, findStraightBridgeRoute, getOccupiedHoles, getConnectionOccupiedHoles, getWireBridgeOccupiedHoles, solderBridgeCrossesExisting, hasCollision, gridKey, hasFootprintCollision, isAdjacent, insertSupportPoints } from '@/lib/engine/router';
import { buildNetlist } from '@/lib/engine/netlist';

export default function PerfboardEditor() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [mouseGridPos, setMouseGridPos] = useState<GridPosition>({ col: 0, row: 0 });
  const isDraggingComponentRef = useRef(false);
  const boxSelectStartRef = useRef<GridPosition | null>(null);
  const dragGroupRef = useRef<{ startPos: GridPosition; ids: string[] } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ col: number; row: number; cols: number; rows: number } | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

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
  const netColors = useProjectStore((s) => s.project.netColors);

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
    // Wire bridges occupy through-holes — block for ALL sides
    const bridgeOcc = getWireBridgeOccupiedHoles(perfboard.connections, endpointKeys);
    for (const k of bridgeOcc) base.add(k);
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
    // Wire bridge: must be straight line (same row or column)
    if (drawingType === 'wire_bridge') {
      if (drawingFrom.col !== drawingTo.col && drawingFrom.row !== drawingTo.row) return true;
      const route = findStraightBridgeRoute(drawingFrom, drawingTo, previewOccupied);
      return !route;
    }
    const route = findManhattanRoute({
      from: drawingFrom,
      to: drawingTo,
      boardWidth: perfboard.width,
      boardHeight: perfboard.height,
      occupied: previewOccupied,
    });
    return !route;
  }, [isDrawing, drawingFrom, drawingTo, drawingType, perfboard.width, perfboard.height, previewOccupied, perfboard.connections]);

  const drawingPreviewPath = useMemo(() => {
    if (!isDrawing || !drawingFrom || !drawingTo) return null;
    if (drawingFrom.col === drawingTo.col && drawingFrom.row === drawingTo.row) return null;
    // Adjacent → just a direct segment (will become solder bridge)
    if (isAdjacent(drawingFrom, drawingTo)) return [drawingFrom, drawingTo];
    // Wire bridge: straight line only
    if (drawingType === 'wire_bridge') {
      if (drawingFrom.col !== drawingTo.col && drawingFrom.row !== drawingTo.row) {
        return [drawingFrom, drawingTo]; // fallback for blocked preview
      }
      const route = findStraightBridgeRoute(drawingFrom, drawingTo, previewOccupied);
      if (!route) return [drawingFrom, drawingTo];
      return route;
    }
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
  }, [isDrawing, drawingFrom, drawingTo, drawingType, perfboard.width, perfboard.height, previewOccupied]);

  // Check collision for placement preview — full footprint bbox overlap (no overlap allowed on Lochraster)
  const placementCollision = useMemo(() => {
    if (activeTool !== 'place_component' || !placingComponentId) return false;
    const libComp = allLib.find((c) => c.id === placingComponentId);
    if (!libComp) return false;
    const pads = libComp.footprint.pads.map((p) => p.gridPosition);
    return hasFootprintCollision(pads, mouseGridPos, placementRotation, compData, libComp.footprint.spanHoles);
  }, [activeTool, placingComponentId, allLib, mouseGridPos, placementRotation, compData]);

  // Compute the netlist from the schematic for net-name resolution
  const computedNetlist = useMemo(() => buildNetlist(schematic), [schematic]);

  // Build connection-id → color map for net coloring
  const connectionNetColorMap = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (!netColors || Object.keys(netColors).length === 0) return map;
    if (!computedNetlist.nets.length) return map;

    // Build netId → net name map
    const netNameById = new Map<string, string>();
    for (const net of computedNetlist.nets) {
      if (net.name && netColors[net.name]) {
        netNameById.set(net.id, net.name);
      }
    }

    // Build hole → net name map by mapping schematic component pins to perfboard pads
    const holeToNetName = new Map<string, string>();
    for (const net of computedNetlist.nets) {
      if (!net.name || !netColors[net.name]) continue;
      for (const conn of net.connections) {
        // Find the perfboard component matching this schematic component
        const pbComp = perfboard.components.find((c) => c.schematicComponentId === conn.componentId);
        if (!pbComp) continue;
        const libComp = allLib.find((l) => l.id === pbComp.libraryId);
        if (!libComp) continue;
        // Find the pad for this pin
        const pad = libComp.footprint.pads.find((p) => p.pinNumber === conn.pinNumber);
        if (!pad) continue;
        // Rotate pad position
        const r = ((pbComp.rotation % 360) + 360) % 360;
        let pc = pad.gridPosition.col, pr = pad.gridPosition.row;
        if (r === 90) { const t = pc; pc = -pr; pr = t; }
        else if (r === 180) { pc = -pc; pr = -pr; }
        else if (r === 270) { const t = pc; pc = pr; pr = -t; }
        const holeKey = `${pbComp.gridPosition.col + pc},${pbComp.gridPosition.row + pr}`;
        holeToNetName.set(holeKey, net.name);
      }
    }

    // Map connections to colors
    for (const conn of perfboard.connections) {
      // Try explicit netId first
      if (conn.netId) {
        const netName = netNameById.get(conn.netId);
        if (netName && netColors[netName]) {
          map.set(conn.id, netColors[netName]);
          continue;
        }
      }
      // Fall back to hole-based matching
      const fromKey = `${conn.from.col},${conn.from.row}`;
      const toKey = `${conn.to.col},${conn.to.row}`;
      const netName = holeToNetName.get(fromKey) || holeToNetName.get(toKey);
      if (netName && netColors[netName]) {
        map.set(conn.id, netColors[netName]);
      }
    }
    return map;
  }, [netColors, computedNetlist, perfboard.connections, perfboard.components, allLib]);

  // ---------- Ratsnest (dotted lines for unconnected schematic nets) ----------
  const ratsnestLines = useMemo(() => {
    if (!schematic || perfboard.components.length === 0) return [];

    // Build netlist from schematic
    const netlist = buildNetlist(schematic);

    // Helper: rotate a pad offset given a component rotation
    const rotatePad = (pad: GridPosition, rotation: number): GridPosition => {
      const r = ((rotation % 360) + 360) % 360;
      let c = pad.col, ro = pad.row;
      if (r === 90) { const t = c; c = -ro; ro = t; }
      else if (r === 180) { c = -c; ro = -ro; }
      else if (r === 270) { const t = c; c = ro; ro = -t; }
      return { col: c, row: ro };
    };

    // For each perfboard component, build a map: schematicComponentId + pinNumber → grid position
    const pinGridMap = new Map<string, GridPosition>(); // key: "schCompId:pinNum"
    for (const pbComp of perfboard.components) {
      const def = allLib.find((d) => d.id === pbComp.libraryId);
      if (!def) continue;
      const { pads } = getAdjustedFootprint(def, pbComp.properties?.holeSpan);
      for (const pad of pads) {
        const rotated = rotatePad(pad.gridPosition, pbComp.rotation);
        const gridPos: GridPosition = {
          col: pbComp.gridPosition.col + rotated.col,
          row: pbComp.gridPosition.row + rotated.row,
        };
        pinGridMap.set(`${pbComp.schematicComponentId}:${pad.number}`, gridPos);
      }
    }

    // Build a union-find of connected grid positions from existing perfboard connections
    const gk = (pos: GridPosition) => `${pos.col},${pos.row}`;
    const connParent = new Map<string, string>();
    const connFind = (k: string): string => {
      if (!connParent.has(k)) connParent.set(k, k);
      if (connParent.get(k) !== k) connParent.set(k, connFind(connParent.get(k)!));
      return connParent.get(k)!;
    };
    const connUnion = (a: string, b: string) => {
      const ra = connFind(a), rb = connFind(b);
      if (ra !== rb) connParent.set(ra, rb);
    };

    for (const conn of perfboard.connections) {
      const fk = gk(conn.from);
      const tk = gk(conn.to);
      connUnion(fk, tk);
      if (conn.waypoints) {
        for (const wp of conn.waypoints) {
          connUnion(fk, gk(wp));
          connUnion(tk, gk(wp));
        }
      }
    }

    // For each net, collect the grid positions of its pins that are placed on the perfboard
    const lines: { from: GridPosition; to: GridPosition; netName: string }[] = [];
    for (const net of netlist.nets) {
      if (net.connections.length < 2) continue;

      // Collect grid positions for pins in this net
      const pinPositions: GridPosition[] = [];
      for (const conn of net.connections) {
        const key = `${conn.componentId}:${conn.pinNumber}`;
        const gp = pinGridMap.get(key);
        if (gp) pinPositions.push(gp);
      }
      if (pinPositions.length < 2) continue;

      // Group by existing perfboard connectivity
      const groups = new Map<string, GridPosition[]>();
      for (const pos of pinPositions) {
        const root = connFind(gk(pos));
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root)!.push(pos);
      }

      // If all pins are in the same group, net is fully connected
      if (groups.size <= 1) continue;

      // Connect groups with ratsnest lines (simple chain between group representatives)
      const groupReps = Array.from(groups.values()).map((g) => g[0]);
      for (let i = 1; i < groupReps.length; i++) {
        lines.push({ from: groupReps[i - 1], to: groupReps[i], netName: net.name });
      }
    }

    return lines;
  }, [schematic, perfboard, allLib]);

  // ---------- Net target pin map (grid pos → same-net pin grid positions) ----------
  // Used to highlight which pins should be connected when drawing from a pin.
  const netTargetMap = useMemo(() => {
    const map = new Map<string, GridPosition[]>(); // "col,row" → other pin positions on same net
    if (!schematic || perfboard.components.length === 0) return map;

    const netlist = buildNetlist(schematic);

    const rotatePadNT = (pad: GridPosition, rotation: number): GridPosition => {
      const r = ((rotation % 360) + 360) % 360;
      let c = pad.col, ro = pad.row;
      if (r === 90) { const t = c; c = -ro; ro = t; }
      else if (r === 180) { c = -c; ro = -ro; }
      else if (r === 270) { const t = c; c = ro; ro = -t; }
      return { col: c, row: ro };
    };

    const pinGridMapNT = new Map<string, GridPosition>();
    for (const pbComp of perfboard.components) {
      const def = allLib.find((d) => d.id === pbComp.libraryId);
      if (!def) continue;
      const { pads } = getAdjustedFootprint(def, pbComp.properties?.holeSpan);
      for (const pad of pads) {
        const rotated = rotatePadNT(pad.gridPosition, pbComp.rotation);
        const gridPos: GridPosition = {
          col: pbComp.gridPosition.col + rotated.col,
          row: pbComp.gridPosition.row + rotated.row,
        };
        pinGridMapNT.set(`${pbComp.schematicComponentId}:${pad.number}`, gridPos);
      }
    }

    // For each net, collect placed pin grid positions and cross-reference
    for (const net of netlist.nets) {
      if (net.connections.length < 2) continue;
      const positions: GridPosition[] = [];
      for (const conn of net.connections) {
        const gp = pinGridMapNT.get(`${conn.componentId}:${conn.pinNumber}`);
        if (gp) positions.push(gp);
      }
      if (positions.length < 2) continue;
      // For each pin in this net, store all OTHER pins as targets
      for (let i = 0; i < positions.length; i++) {
        const key = `${positions[i].col},${positions[i].row}`;
        const others = positions.filter((_, j) => j !== i);
        const existing = map.get(key);
        if (existing) {
          existing.push(...others);
        } else {
          map.set(key, [...others]);
        }
      }
    }

    return map;
  }, [schematic, perfboard, allLib]);

  // Highlighted target pins when drawing from a pin
  const drawingTargetPins = useMemo<GridPosition[]>(() => {
    if (!isDrawing || !drawingFrom) return [];
    const key = `${drawingFrom.col},${drawingFrom.row}`;
    return netTargetMap.get(key) ?? [];
  }, [isDrawing, drawingFrom, netTargetMap]);

  // Auto-scroll edge margin / speed
  const EDGE_MARGIN = 40;
  const SCROLL_SPEED = 8;

  const handleCompDragStart = useCallback((compId: string) => {
    isDraggingComponentRef.current = true;
    const sel = usePerfboardStore.getState().selectedIds;
    if (sel.length > 1 && sel.includes(compId)) {
      const comp = useProjectStore.getState().project.perfboard.components.find((c) => c.id === compId);
      if (comp) {
        dragGroupRef.current = { startPos: { ...comp.gridPosition }, ids: [...sel] };
      }
    } else {
      dragGroupRef.current = null;
    }
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

    const groupInfo = dragGroupRef.current;
    dragGroupRef.current = null;

    if (groupInfo && groupInfo.ids.length > 1) {
      const colDelta = gridPos.col - groupInfo.startPos.col;
      const rowDelta = gridPos.row - groupInfo.startPos.row;
      if (colDelta !== 0 || rowDelta !== 0) {
        usePerfboardStore.getState().moveComponentGroup(groupInfo.ids, colDelta, rowDelta);
      }
      return true;
    }

    return usePerfboardStore.getState().moveComponent(compId, gridPos);
  }, []);

  // Resize — use ResizeObserver so canvas updates when panels collapse/expand
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setStageSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track shift key for box selection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
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

    // Box selection tracking
    if (boxSelectStartRef.current) {
      const start = boxSelectStartRef.current;
      setSelectionBox({
        col: Math.min(start.col, gridPos.col),
        row: Math.min(start.row, gridPos.row),
        cols: Math.abs(gridPos.col - start.col) + 1,
        rows: Math.abs(gridPos.row - start.row) + 1,
      });
    }

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

  // Box selection: start on shift+mouseDown on background
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    if (activeTool !== 'select' || !e.evt.shiftKey) return;
    const isBackground = e.target === stageRef.current;
    if (!isBackground) return;
    const pos = getPointerCanvasPos();
    if (pos) {
      const gridPos = pixelToGrid(pos.x, pos.y);
      boxSelectStartRef.current = gridPos;
      setSelectionBox({ col: gridPos.col, row: gridPos.row, cols: 1, rows: 1 });
      stageRef.current?.stopDrag();
    }
  }, [activeTool, getPointerCanvasPos, pixelToGrid]);

  // Box selection: finalize on mouseUp
  const handleMouseUp = useCallback(() => {
    if (!boxSelectStartRef.current) return;
    const box = selectionBox;
    boxSelectStartRef.current = null;
    setSelectionBox(null);
    if (!box || (box.cols <= 1 && box.rows <= 1)) return;
    const insideIds = perfboard.components
      .filter((c) =>
        c.gridPosition.col >= box.col && c.gridPosition.col < box.col + box.cols &&
        c.gridPosition.row >= box.row && c.gridPosition.row < box.row + box.rows
      )
      .map((c) => c.id);
    if (insideIds.length > 0) {
      const currentSel = usePerfboardStore.getState().selectedIds;
      const merged = Array.from(new Set([...currentSel, ...insideIds]));
      usePerfboardStore.getState().select(merged);
    }
  }, [selectionBox, perfboard.components]);

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
      // Deselect on background click (only without shift)
      if (!e.evt.shiftKey && e.target === stageRef.current) {
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
  }, { preventDefault: true });
  useHotkeys('w', () => usePerfboardStore.getState().setActiveTool('draw_wire'), { preventDefault: true });
  useHotkeys('delete, backspace', () => usePerfboardStore.getState().deleteSelected(), { preventDefault: true });
  useHotkeys('r', () => {
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
    } else {
      selectedIds.forEach((id) => usePerfboardStore.getState().rotateComponent(id));
    }
  }, { preventDefault: true });
  // Ctrl+R: rotate instead of browser refresh
  useHotkeys('ctrl+r', (e) => {
    e.preventDefault();
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
    } else {
      selectedIds.forEach((id) => usePerfboardStore.getState().rotateComponent(id));
    }
  }, { preventDefault: true, enableOnFormTags: true });

  // Clipboard shortcuts
  useHotkeys('ctrl+c', () => usePerfboardStore.getState().copySelection(), { preventDefault: true });
  useHotkeys('ctrl+x', () => usePerfboardStore.getState().cutSelection(), { preventDefault: true });
  useHotkeys('ctrl+v', () => usePerfboardStore.getState().pasteSelection(), { preventDefault: true });
  useHotkeys('ctrl+d', () => {
    usePerfboardStore.getState().copySelection();
    usePerfboardStore.getState().pasteSelection();
  }, { preventDefault: true });
  useHotkeys('ctrl+0', () => usePerfboardStore.getState().zoomToFit(stageSize.width, stageSize.height), { preventDefault: true });

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
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={activeTool === 'select' && !isDrawing && !isDraggingComponentRef.current && !shiftHeld}
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
              netColor={connectionNetColorMap.get(conn.id)}
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

        {/* Net target pin highlights — shown when drawing from a pin */}
        {drawingTargetPins.length > 0 && (
          <Layer listening={false}>
            {drawingTargetPins.map((tp, i) => {
              const px = gridToPixel(tp);
              return (
                <React.Fragment key={`ntp-${i}`}>
                  {/* Outer pulsing ring */}
                  <Circle
                    x={px.x}
                    y={px.y}
                    radius={10}
                    stroke="#00ff88"
                    strokeWidth={2}
                    dash={[4, 2]}
                    opacity={0.6}
                  />
                  {/* Inner filled dot */}
                  <Circle
                    x={px.x}
                    y={px.y}
                    radius={5}
                    fill="#00ff88"
                    opacity={0.45}
                  />
                </React.Fragment>
              );
            })}
          </Layer>
        )}

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
                onClick={(e: any) => {
                  // Only consume event for select / delete — let drawing
                  // tools propagate so wire drawing works from component pins
                  if (activeTool === 'select') {
                    e.cancelBubble = true;
                    if (e.evt?.shiftKey) {
                      usePerfboardStore.getState().toggleSelection(comp.id);
                    } else {
                      usePerfboardStore.getState().select([comp.id]);
                    }
                  } else if (activeTool === 'delete') {
                    e.cancelBubble = true;
                    usePerfboardStore.getState().removeComponent(comp.id);
                  }
                  // draw_wire / draw_solder_bridge etc. — don't cancel bubble
                }}
                onDragStart={() => handleCompDragStart(comp.id)}
                onDragMove={handleCompDragMove}
                onDragEnd={(gridPos) => handleCompDragEnd(comp.id, gridPos)}
              />
            );
          })}
        </Layer>

        {/* Ratsnest — dotted lines for unconnected nets */}
        {ratsnestLines.length > 0 && (
          <Layer listening={false}>
            {ratsnestLines.map((rl, i) => {
              const fromPx = gridToPixel(rl.from);
              const toPx = gridToPixel(rl.to);
              return (
                <React.Fragment key={`ratsnest-${i}`}>
                  <Line
                    points={[fromPx.x, fromPx.y, toPx.x, toPx.y]}
                    stroke="#ffcc00"
                    strokeWidth={1.2}
                    dash={[6, 4]}
                    opacity={0.7}
                    lineCap="round"
                  />
                  {/* Small dot at each end */}
                  <Circle x={fromPx.x} y={fromPx.y} radius={2.5} fill="#ffcc00" opacity={0.8} />
                  <Circle x={toPx.x} y={toPx.y} radius={2.5} fill="#ffcc00" opacity={0.8} />
                </React.Fragment>
              );
            })}
          </Layer>
        )}

        {/* Overlay */}
        <Layer listening={false}>
          {/* Selection box */}
          {selectionBox && (() => {
            const topLeft = gridToPixel({ col: selectionBox.col, row: selectionBox.row });
            const botRight = gridToPixel({ col: selectionBox.col + selectionBox.cols - 1, row: selectionBox.row + selectionBox.rows - 1 });
            return (
              <Rect
                x={topLeft.x - PERFBOARD_GRID / 2}
                y={topLeft.y - PERFBOARD_GRID / 2}
                width={botRight.x - topLeft.x + PERFBOARD_GRID}
                height={botRight.y - topLeft.y + PERFBOARD_GRID}
                fill="rgba(0, 140, 255, 0.08)"
                stroke="rgba(0, 140, 255, 0.5)"
                strokeWidth={1}
                dash={[6, 3]}
              />
            );
          })()}
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

        {/* DRC Error Highlighting Overlay */}
        <DRCOverlayLayer />
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
  netColor?: string;
  onClick: () => void;
}> = React.memo(({ connection, gridToPixel, isSelected, netColor, onClick }) => {
  const from = gridToPixel(connection.from);
  const to = gridToPixel(connection.to);

  const isSolderBridge = connection.type === 'solder_bridge';

  const color = isSelected ? COLORS.selected
    : netColor ? netColor
    : connection.type === 'wire' ? COLORS.copper
    : connection.type === 'wire_bridge' ? COLORS.wireBridge
    : isSolderBridge ? SOLDER_BRIDGE_COLOR
    : COLORS.copper;

  const strokeWidth = isSolderBridge ? 4
    : connection.type === 'wire_bridge' ? 3 : 2;
  const dash = undefined; // All connection types render as solid lines

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
  onClick: (e: any) => void;
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

// ---- DRC Error Overlay ----

const DRCOverlayLayer: React.FC = React.memo(() => {
  const activeCheck = useCheckStore((s) => s.activeCheck);
  const drcResult = useCheckStore((s) => s.drcResult);
  const highlightedId = useCheckStore((s) => s.highlightedViolationId);

  if (activeCheck !== 'drc' || !drcResult) return null;

  const violations = drcResult.violations;

  return (
    <Layer name="drc-overlay" listening={false}>
      {violations.map((v) => {
        if (!v.position || !('col' in v.position)) return null;
        const isActive = highlightedId === v.id;
        const color = v.severity === 'error' ? COLORS.errorMarker
          : v.severity === 'warning' ? COLORS.warningMarker
          : '#4fc3f7';
        const px = (v.position.col + 1) * PERFBOARD_GRID;
        const py = (v.position.row + 1) * PERFBOARD_GRID;
        const size = isActive ? 16 : 10;
        const opacity = isActive ? 1 : 0.7;

        return (
          <Group key={v.id}>
            {/* Outer ring */}
            <Circle
              x={px}
              y={py}
              radius={size}
              fill={color}
              opacity={opacity * 0.15}
            />
            <Circle
              x={px}
              y={py}
              radius={size * 0.6}
              fill={color}
              opacity={opacity * 0.3}
            />
            {/* Cross */}
            <Line
              points={[px - 4, py - 4, px + 4, py + 4]}
              stroke={color}
              strokeWidth={isActive ? 2.5 : 1.5}
              opacity={opacity}
            />
            <Line
              points={[px + 4, py - 4, px - 4, py + 4]}
              stroke={color}
              strokeWidth={isActive ? 2.5 : 1.5}
              opacity={opacity}
            />
            {/* Tooltip for highlighted */}
            {isActive && (
              <>
                <Rect
                  x={px + 14}
                  y={py - 10}
                  width={Math.min(v.message.length * 5.2, 220)}
                  height={16}
                  fill="rgba(0,0,0,0.85)"
                  cornerRadius={3}
                />
                <Text
                  x={px + 17}
                  y={py - 7}
                  text={v.message}
                  fontSize={9}
                  fontFamily="JetBrains Mono, monospace"
                  fill={color}
                  width={220}
                  ellipsis
                  wrap="none"
                />
              </>
            )}
          </Group>
        );
      })}
    </Layer>
  );
});

DRCOverlayLayer.displayName = 'DRCOverlayLayer';
