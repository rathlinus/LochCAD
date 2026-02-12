// ============================================================
// Schematic Editor — Main Konva Canvas
// ============================================================

import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import { Stage, Layer, Line, Circle, Text, Rect, Group } from 'react-konva';
import { RemoteCursorsLayer } from '@/components/collab/RemoteCursorsLayer';
import type Konva from 'konva';
import { useProjectStore, useSchematicStore, useCheckStore } from '@/stores';
import { useCollabStore } from '@/stores/collabStore';
import { getBuiltInComponents, getComponentById } from '@/lib/component-library';
import { SymbolRenderer } from './SymbolRenderer';
import { COLORS, SCHEMATIC_GRID, SCHEMATIC_WIDTH, SCHEMATIC_HEIGHT, CATEGORY_PREFIX, nextUniqueReference } from '@/constants';
import type { Point, SchematicComponent, Wire, Junction, NetLabel } from '@/types';
import { v4 as uuid } from 'uuid';
import { useHotkeys } from 'react-hotkeys-hook';
import { routeSchematicWire, getComponentBBox, bboxOverlap, hasComponentCollision, getComponentPinSegments, buildOccupiedEdges, findSameNetWireIds, buildRoutingContext, buildOtherNetPinCells } from '@/lib/engine/schematic-router';
import { buildNetlist } from '@/lib/engine/netlist';
import type { BBox } from '@/lib/engine/schematic-router';


/** Distance from a point to a line segment (for wire reshape hit detection) */
function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

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
  const boxSelectStartRef = useRef<Point | null>(null);
  const dragGroupRef = useRef<{ startPos: Point; ids: string[] } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);

  // Label placement / edit state (inline input instead of prompt)
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [labelInputValue, setLabelInputValue] = useState('');
  const [labelInputPos, setLabelInputPos] = useState<Point>({ x: 0, y: 0 });
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);

  const viewport = useSchematicStore((s) => s.viewport);
  const setViewport = useSchematicStore((s) => s.setViewport);
  const activeTool = useSchematicStore((s) => s.activeTool);
  const selection = useSchematicStore((s) => s.selection);
  const isDrawing = useSchematicStore((s) => s.isDrawing);
  const drawingPoints = useSchematicStore((s) => s.drawingPoints);
  const placingComponentId = useSchematicStore((s) => s.placingComponentId);
  const highlightedNetPoints = useSchematicStore((s) => s.highlightedNetPoints);
  const activeSheetId = useProjectStore((s) => s.activeSheetId);
  const schematic = useProjectStore((s) => s.project.schematic);
  const customComponents = useProjectStore((s) => s.project.componentLibrary);
  const netColors = useProjectStore((s) => s.project.netColors);

  // Wire reshaping state
  const [reshapingWireId, setReshapingWireId] = useState<string | null>(null);
  const [reshapeSegIdx, setReshapeSegIdx] = useState<number>(-1);
  const reshapeDragRef = useRef(false);

  const allComponents = useMemo(
    () => [...getBuiltInComponents(), ...customComponents],
    [customComponents]
  );

  // Resize handler — use ResizeObserver so canvas updates when panels collapse/expand
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

  // Hierarchical sheet instances on the current sheet
  const sheetInstances = useMemo(
    () => schematic.hierarchicalSheetInstances.filter((h) => h.sheetId === activeSheetId),
    [schematic.hierarchicalSheetInstances, activeSheetId]
  );

  // Compute the netlist from the schematic for net-name resolution
  const computedNetlist = useMemo(() => buildNetlist(schematic), [schematic]);

  // Build wire-id → color map using netlist + labels + transitive wire matching
  const wireNetColorMap = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    if (!netColors || Object.keys(netColors).length === 0) return map;

    for (const [netName, color] of Object.entries(netColors)) {
      const seedPoints: Point[] = [];

      // Seed from labels with this net name on the active sheet
      for (const label of sheetLabels) {
        if (label.text === netName) seedPoints.push(label.position);
      }

      // Seed from netlist — find component pins belonging to this net
      const net = computedNetlist.nets.find((n) => n.name === netName);
      if (net) {
        for (const conn of net.connections) {
          const comp = sheetComponents.find((c) => c.id === conn.componentId);
          if (!comp) continue;
          const def = allComponents.find((d) => d.id === comp.libraryId);
          if (!def) continue;
          const pinIdx = def.symbol.pins.findIndex((p) => p.number === conn.pinNumber);
          if (pinIdx < 0) continue;
          const segs = getComponentPinSegments(comp, def.symbol);
          if (segs[pinIdx]) seedPoints.push(segs[pinIdx].base);
        }
      }

      if (seedPoints.length === 0) continue;

      // Find all wires transitively connected to these seed points
      const wireIds = findSameNetWireIds(seedPoints, sheetWires);
      for (const id of wireIds) {
        if (!map.has(id)) map.set(id, color);
      }
    }

    return map;
  }, [netColors, computedNetlist, sheetLabels, sheetWires, sheetComponents, allComponents]);

  // Remote selection map: elementId → { color, name } for collab highlights
  const collabPeers = useCollabStore((s) => s.peers);
  const collabConnected = useCollabStore((s) => s.connected);
  const remoteSelectionMap = useMemo(() => {
    const map = new Map<string, { color: string; name: string }>();
    if (!collabConnected) return map;
    for (const [, peer] of collabPeers) {
      const { awareness, user } = peer;
      if (!awareness.selection || awareness.view !== 'schematic') continue;
      for (const id of awareness.selection) {
        if (!map.has(id)) {
          map.set(id, { color: user.color, name: user.name });
        }
      }
    }
    return map;
  }, [collabPeers, collabConnected]);

  // Routing obstacles (full bboxes) + pin corridor allowed cells
  const { sheetObstacles, sheetAllowedCells } = useMemo(() => {
    const { obstacles, allowedCells } = buildRoutingContext(sheetComponents, allComponents);
    return { sheetObstacles: obstacles, sheetAllowedCells: allowedCells };
  }, [sheetComponents, allComponents]);

  // Occupied grid-edges from existing wires (so new wires avoid overlap)
  const sheetOccupiedEdges = useMemo<Set<string>>(() => {
    return buildOccupiedEdges(sheetWires, SCHEMATIC_GRID);
  }, [sheetWires]);

  // All pin connection-point positions (world-space) for snap-to-pin
  const PIN_SNAP_RADIUS = 15;
  const sheetPinPositions = useMemo<Point[]>(() => {
    const pins: Point[] = [];
    for (const comp of sheetComponents) {
      const def = allComponents.find((d) => d.id === comp.libraryId);
      if (!def) continue;
      const segs = getComponentPinSegments(comp, def.symbol);
      for (const seg of segs) pins.push(seg.base);
    }
    return pins;
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

    // Same-net edges: wires sharing endpoints with drawing start should not be penalised
    const sameNetIds = findSameNetWireIds(drawingPoints, sheetWires);
    const sameNetEdges = buildOccupiedEdges(
      sheetWires.filter((w) => sameNetIds.has(w.id)),
      SCHEMATIC_GRID,
    );

    return routeSchematicWire({
      from: lastPoint,
      to: mousePos,
      obstacles: sheetObstacles,
      occupiedEdges: sheetOccupiedEdges,
      sameNetEdges,
      allowedCells: sheetAllowedCells,
      blockedCells: buildOtherNetPinCells(sheetComponents, allComponents, drawingPoints, sheetWires),
    });
  }, [isDrawing, drawingPoints, mousePos, sheetObstacles, sheetAllowedCells, sheetOccupiedEdges, sheetWires]);

  // Snap to grid
  const snap = useCallback((p: Point): Point => ({
    x: Math.round(p.x / SCHEMATIC_GRID) * SCHEMATIC_GRID,
    y: Math.round(p.y / SCHEMATIC_GRID) * SCHEMATIC_GRID,
  }), []);

  // Snap with pin priority — snaps to nearby pin connection points before falling back to grid
  const snapWithPins = useCallback((p: Point): Point => {
    let closestPin: Point | null = null;
    let closestDist = PIN_SNAP_RADIUS;
    for (const pin of sheetPinPositions) {
      const dx = p.x - pin.x;
      const dy = p.y - pin.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closestPin = pin;
      }
    }
    if (closestPin) return { x: closestPin.x, y: closestPin.y };
    return snap(p);
  }, [sheetPinPositions, snap]);

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
      // Use pin-snap during wire/bus drawing for precise pin connections
      const snapped = (isDrawing && activeTool === 'draw_wire')
        ? snapWithPins(pos)
        : snap(pos);
      setMousePos(snapped);

      // Broadcast cursor position for collaboration
      const collabState = useCollabStore.getState();
      if (collabState.connected) {
        collabState.updateLocalAwareness({ cursor: { x: snapped.x, y: snapped.y } });
      }

      // Box selection tracking
      if (boxSelectStartRef.current) {
        const rawPos = getPointerPos();
        if (rawPos) {
          const start = boxSelectStartRef.current;
          setSelectionBox({
            x: Math.min(start.x, rawPos.x),
            y: Math.min(start.y, rawPos.y),
            width: Math.abs(rawPos.x - start.x),
            height: Math.abs(rawPos.y - start.y),
          });
        }
      }

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
  }, [getPointerPos, snap, snapWithPins, isDrawing, activeTool, stageSize]);

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

    if (activeTool === 'draw_wire') {
      const pinSnapped = snapWithPins(pos);
      if (!isDrawing) {
        useSchematicStore.getState().startDrawing(pinSnapped);
      } else {
        useSchematicStore.getState().addDrawingPoint(pinSnapped);
      }
      return;
    }

    if (activeTool === 'place_label') {
      setLabelInputPos(snapped);
      setLabelInputValue('');
      setShowLabelInput(true);
      setTimeout(() => labelInputRef.current?.focus(), 50);
      return;
    }

    if (activeTool === 'select') {
      // Nothing clicked on canvas background → deselect (only without shift)
      if (!e.evt.shiftKey && (e.target === stageRef.current || e.target.getParent() === stageRef.current?.findOne('.grid-layer'))) {
        useSchematicStore.getState().clearSelection();
        useSchematicStore.getState().clearNetHighlight();
      }
    }
  }, [activeTool, placingComponentId, allComponents, snap, snapWithPins, getPointerPos, isDrawing, activeSheetId, schematic.components, placementCollision, placementRotation, placementMirror]);

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
    if (activeTool === 'select') {
      e.cancelBubble = true;
      // Clear net highlight when clicking a component directly
      useSchematicStore.getState().clearNetHighlight();
      if (e.evt.shiftKey) {
        useSchematicStore.getState().toggleSelection('componentIds', compId);
      } else {
        useSchematicStore.getState().select({ componentIds: [compId] });
      }
    } else if (activeTool === 'delete') {
      e.cancelBubble = true;
      useSchematicStore.getState().deleteComponent(compId);
    }
    // For draw_wire: let click bubble to stage so drawing starts/adds points
  }, [activeTool]);

  const handleComponentDragEnd = useCallback((compId: string, x: number, y: number): boolean => {
    isDraggingComponentRef.current = false;
    if (autoScrollRafRef.current) { cancelAnimationFrame(autoScrollRafRef.current); autoScrollRafRef.current = null; }

    const groupInfo = dragGroupRef.current;
    dragGroupRef.current = null;

    if (groupInfo && groupInfo.ids.length > 1) {
      // Group drag: compute snapped delta and move all selected
      const snappedX = Math.round(x / SCHEMATIC_GRID) * SCHEMATIC_GRID;
      const snappedY = Math.round(y / SCHEMATIC_GRID) * SCHEMATIC_GRID;
      const delta: Point = {
        x: snappedX - groupInfo.startPos.x,
        y: snappedY - groupInfo.startPos.y,
      };
      if (delta.x !== 0 || delta.y !== 0) {
        useSchematicStore.getState().moveComponentGroup(groupInfo.ids, delta);
      }
      return true;
    }

    return useSchematicStore.getState().moveComponent(compId, { x, y });
  }, []);

  const handleComponentDragStart = useCallback((compId: string) => {
    isDraggingComponentRef.current = true;
    // Clear net highlight so it doesn't interfere with drag
    useSchematicStore.getState().clearNetHighlight();
    const sel = useSchematicStore.getState().selection.componentIds;
    if (sel.length > 1 && sel.includes(compId)) {
      const comp = useProjectStore.getState().project.schematic.components.find((c) => c.id === compId);
      if (comp) {
        dragGroupRef.current = { startPos: { ...comp.position }, ids: [...sel] };
      }
    } else {
      dragGroupRef.current = null;
    }
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

  // Box selection: start on shift+mouseDown on background
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    if (activeTool !== 'select' || !e.evt.shiftKey) return;
    const isBackground = e.target === stageRef.current || e.target.getParent()?.name() === 'grid-layer';
    if (!isBackground) return;
    const pos = getPointerPos();
    if (pos) {
      boxSelectStartRef.current = pos;
      setSelectionBox({ x: pos.x, y: pos.y, width: 0, height: 0 });
      stageRef.current?.stopDrag();
    }
  }, [activeTool, getPointerPos]);

  // Box selection: finalize on mouseUp
  const handleMouseUp = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!boxSelectStartRef.current) return;
    const box = selectionBox;
    boxSelectStartRef.current = null;
    setSelectionBox(null);
    if (!box || (box.width < 5 && box.height < 5)) return;
    const insideIds = sheetComponents
      .filter((c) =>
        c.position.x >= box.x && c.position.x <= box.x + box.width &&
        c.position.y >= box.y && c.position.y <= box.y + box.height
      )
      .map((c) => c.id);
    if (insideIds.length > 0) {
      const currentSel = useSchematicStore.getState().selection.componentIds;
      const merged = Array.from(new Set([...currentSel, ...insideIds]));
      useSchematicStore.getState().select({ componentIds: merged });
    }
  }, [selectionBox, sheetComponents]);

  // Net highlight helper: given a wire, find all wires on the same net
  const highlightNetFromWire = useCallback((wireId: string) => {
    const wire = sheetWires.find((w) => w.id === wireId);
    if (!wire || wire.points.length < 2) {
      useSchematicStore.getState().clearNetHighlight();
      return;
    }
    // Find which net contains any point of this wire
    const EPS = 2;
    const wireStart = wire.points[0];
    const wireEnd = wire.points[wire.points.length - 1];

    // Collect all wire IDs that share endpoints via transitive connection
    const sameNetIds = findSameNetWireIds([wireStart, wireEnd], sheetWires);

    // Collect all highlighted wire IDs and select them
    const highlightIds = Array.from(sameNetIds);
    useSchematicStore.getState().select({ wireIds: highlightIds });

    // Collect all wire endpoints for visual net highlight
    const allPts: Point[] = [];
    for (const wId of highlightIds) {
      const w = sheetWires.find((sw) => sw.id === wId);
      if (w) {
        allPts.push(w.points[0]);
        allPts.push(w.points[w.points.length - 1]);
      }
    }

    // Store full highlight — keep components out of selection
    // so dragging one component doesn't move the whole net
    useSchematicStore.getState().highlightNet(allPts);
    useSchematicStore.getState().select({ wireIds: highlightIds });
  }, [sheetWires, sheetComponents, allComponents, schematic]);

  const handleWireClick = useCallback((wireId: string, e: any) => {
    if (activeTool === 'select') {
      e.cancelBubble = true;
      // Always highlight the full net when clicking a wire
      highlightNetFromWire(wireId);
    } else if (activeTool === 'delete') {
      e.cancelBubble = true;
      useSchematicStore.getState().deleteWire(wireId);
    }
    // For draw_wire: let click bubble to stage so drawing starts/adds points
  }, [activeTool, highlightNetFromWire]);

  // Wire reshape: double-click on wire to add a waypoint
  const handleWireDblClick = useCallback((wireId: string, e: any) => {
    if (activeTool !== 'select') return;
    e.cancelBubble = true;
    const pos = getPointerPos();
    if (!pos) return;
    const snapped = snap(pos);

    const wire = sheetWires.find((w) => w.id === wireId);
    if (!wire || wire.points.length < 2) return;

    // Find which segment the click is closest to and insert the waypoint
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < wire.points.length - 1; i++) {
      const a = wire.points[i];
      const b = wire.points[i + 1];
      const dist = pointToSegmentDist(snapped, a, b);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }

    if (bestDist < 20) {
      useSchematicStore.getState().pushSnapshot();
      // Insert waypoint into wire
      useProjectStore.setState((state) => {
        const w = state.project.schematic.wires.find((w) => w.id === wireId);
        if (w) {
          w.points.splice(bestIdx, 0, snapped);
        }
        state.project.updatedAt = new Date().toISOString();
        state.isDirty = true;
      });
    }
  }, [activeTool, sheetWires, getPointerPos, snap]);

  // Keyboard shortcuts
  useHotkeys('escape', () => {
    if (showLabelInput) {
      setShowLabelInput(false);
    } else if (isDrawing) {
      useSchematicStore.getState().cancelDrawing();
    } else {
      useSchematicStore.getState().setActiveTool('select');
      useSchematicStore.getState().clearSelection();
      setPlacementRotation(0);
      setPlacementMirror(false);
    }
  }, { preventDefault: true });
  useHotkeys('w', () => useSchematicStore.getState().setActiveTool('draw_wire'), { preventDefault: true });
  useHotkeys('l', () => useSchematicStore.getState().setActiveTool('place_label'), { preventDefault: true });
  useHotkeys('delete, backspace', () => useSchematicStore.getState().deleteSelected(), { preventDefault: true });
  useHotkeys('r', () => {
    if (activeTool === 'place_component') {
      setPlacementRotation((r) => ((r + 90) % 360));
    } else {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().rotateComponent(id));
    }
  }, { preventDefault: true });
  useHotkeys('x', () => {
    if (activeTool === 'place_component') {
      setPlacementMirror((m) => !m);
    } else {
      const sel = useSchematicStore.getState().selection;
      sel.componentIds.forEach((id) => useSchematicStore.getState().mirrorComponent(id));
    }
  }, { preventDefault: true });
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

  // Clipboard shortcuts
  useHotkeys('ctrl+c', () => useSchematicStore.getState().copySelection(), { preventDefault: true });
  useHotkeys('ctrl+x', () => useSchematicStore.getState().cutSelection(), { preventDefault: true });
  useHotkeys('ctrl+v', () => useSchematicStore.getState().pasteSelection(), { preventDefault: true });
  // Duplicate: Ctrl+D copies + immediately pastes
  useHotkeys('ctrl+d', () => {
    useSchematicStore.getState().copySelection();
    useSchematicStore.getState().pasteSelection();
  }, { preventDefault: true });
  // Zoom to fit: Ctrl+0
  useHotkeys('ctrl+0', () => useSchematicStore.getState().zoomToFit(), { preventDefault: true });

  // --- Commit label placement or edit ---
  const commitLabel = useCallback(() => {
    const text = labelInputValue.trim();
    if (editingLabelId) {
      // Editing existing label
      if (text) {
        useSchematicStore.getState().updateLabel(editingLabelId, { text });
      }
    } else {
      // Placing new label
      if (text) {
        useSchematicStore.getState().addLabel({
          text,
          position: labelInputPos,
          type: 'net',
          netId: uuid(),
          rotation: 0,
          sheetId: activeSheetId,
        });
      }
    }
    setShowLabelInput(false);
    setLabelInputValue('');
    setEditingLabelId(null);
  }, [labelInputValue, labelInputPos, activeSheetId, editingLabelId]);

  // Calculate screen position of the label input
  const labelScreenPos = useMemo(() => {
    if (!showLabelInput) return { left: 0, top: 0 };
    return {
      left: labelInputPos.x * viewport.scale + viewport.x,
      top: labelInputPos.y * viewport.scale + viewport.y - 32,
    };
  }, [showLabelInput, labelInputPos, viewport]);

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
        onDblClick={handleDblClick}
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
        {/* Grid Layer */}
        <Layer name="grid-layer" listening={false}>
          <GridRenderer width={SCHEMATIC_WIDTH} height={SCHEMATIC_HEIGHT} gridSize={SCHEMATIC_GRID} />
        </Layer>

        {/* Wires Layer */}
        <Layer>
          {sheetWires.map((wire) => (
            <React.Fragment key={wire.id}>
              <WireRenderer
                wire={wire}
                isSelected={selection.wireIds.includes(wire.id)}
                isNetHighlighted={highlightedNetPoints.length > 0 && selection.wireIds.includes(wire.id)}
                netColor={wireNetColorMap.get(wire.id)}
                remoteSelectedBy={remoteSelectionMap.get(wire.id) || null}
                onClick={(e) => handleWireClick(wire.id, e)}
                onDblClick={(e) => handleWireDblClick(wire.id, e)}
              />
              {/* Wire waypoint drag handles for reshaping (route-aware) */}
              {activeTool === 'select' && selection.wireIds.includes(wire.id) && wire.points.length > 2 &&
                wire.points.slice(1, -1).map((pt, idx) => (
                  <Circle
                    key={`wp-${wire.id}-${idx}`}
                    x={pt.x}
                    y={pt.y}
                    radius={4}
                    fill={COLORS.selected}
                    stroke="#fff"
                    strokeWidth={1}
                    draggable
                    cursor="move"
                    onDragStart={() => {
                      reshapeDragRef.current = true;
                      useSchematicStore.getState().pushSnapshot();
                    }}
                    onDragEnd={(e) => {
                      reshapeDragRef.current = false;
                      const targetPos = snap({ x: e.target.x(), y: e.target.y() });
                      e.target.x(targetPos.x);
                      e.target.y(targetPos.y);

                      useProjectStore.setState((state) => {
                        const w = state.project.schematic.wires.find((w) => w.id === wire.id);
                        if (!w) return;

                        const waypointIdx = idx + 1; // index in the full points array
                        const prevPt = w.points[waypointIdx - 1];
                        const nextPt = w.points[waypointIdx + 1];
                        if (!prevPt || !nextPt) return;

                        // Build replacement: prevPt → targetPos → nextPt with Manhattan L-route corners
                        const replacement: Point[] = [prevPt];

                        // Connect prevPt → targetPos
                        if (Math.abs(prevPt.x - targetPos.x) > 0.5 && Math.abs(prevPt.y - targetPos.y) > 0.5) {
                          // Not axis-aligned — insert L-route corner
                          // Pick direction based on incoming segment orientation
                          const prevPrev = w.points[waypointIdx - 2];
                          if (prevPrev && Math.abs(prevPrev.y - prevPt.y) < 1) {
                            // Incoming segment is horizontal → continue horizontal, then vertical
                            replacement.push({ x: targetPos.x, y: prevPt.y });
                          } else {
                            // Incoming segment is vertical (or start point) → continue vertical, then horizontal
                            replacement.push({ x: prevPt.x, y: targetPos.y });
                          }
                        }

                        replacement.push(targetPos);

                        // Connect targetPos → nextPt
                        if (Math.abs(targetPos.x - nextPt.x) > 0.5 && Math.abs(targetPos.y - nextPt.y) > 0.5) {
                          // Not axis-aligned — insert L-route corner
                          const nextNext = w.points[waypointIdx + 2];
                          if (nextNext && Math.abs(nextNext.x - nextPt.x) < 1) {
                            // Outgoing segment is vertical → approach with horizontal-to-vertical corner
                            replacement.push({ x: nextPt.x, y: targetPos.y });
                          } else {
                            // Outgoing segment is horizontal (or end point) → approach with vertical-to-horizontal corner
                            replacement.push({ x: targetPos.x, y: nextPt.y });
                          }
                        }

                        replacement.push(nextPt);

                        // Splice into wire, replacing [prevPt, oldWaypoint, nextPt]
                        const before = w.points.slice(0, waypointIdx - 1);
                        const after = w.points.slice(waypointIdx + 2);
                        let pts = [...before, ...replacement, ...after];

                        // Clean up: remove consecutive duplicates
                        const deduped: Point[] = [pts[0]];
                        for (let i = 1; i < pts.length; i++) {
                          if (Math.abs(pts[i].x - deduped[deduped.length - 1].x) > 0.5 ||
                              Math.abs(pts[i].y - deduped[deduped.length - 1].y) > 0.5) {
                            deduped.push(pts[i]);
                          }
                        }

                        // Clean up: remove collinear middle points (3 points on same axis → drop middle)
                        if (deduped.length >= 3) {
                          const final: Point[] = [deduped[0]];
                          for (let i = 1; i < deduped.length - 1; i++) {
                            const a = final[final.length - 1];
                            const b = deduped[i];
                            const c = deduped[i + 1];
                            const collinearX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
                            const collinearY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
                            if (!collinearX && !collinearY) {
                              final.push(b);
                            }
                          }
                          final.push(deduped[deduped.length - 1]);
                          w.points = final;
                        } else {
                          w.points = deduped;
                        }

                        state.project.updatedAt = new Date().toISOString();
                        state.isDirty = true;
                      });
                    }}
                  />
                ))
              }
            </React.Fragment>
          ))}

          {/* Drawing preview — Manhattan routed */}
          {isDrawing && drawingPoints.length > 0 && (() => {
            // Committed segments
            const committedPts = drawingPoints.flatMap((p) => [p.x, p.y]);
            // Preview extension from last committed point to mouse
            const previewPts = drawingPreviewPoints
              ? drawingPreviewPoints.flatMap((p) => [p.x, p.y])
              : [drawingPoints[drawingPoints.length - 1].x, drawingPoints[drawingPoints.length - 1].y, mousePos.x, mousePos.y];
            const wireColor = COLORS.wire;
            const wireWidth = 2;
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
                remoteSelectedBy={remoteSelectionMap.get(comp.id) || null}
                draggable={activeTool === 'select'}
                onClick={(e: any) => handleComponentClick(comp.id, e)}
                onDblClick={() => {
                  // Select exclusively on double-click, ensuring properties panel shows
                  useSchematicStore.getState().select({ componentIds: [comp.id] });
                }}
                onDragStart={() => handleComponentDragStart(comp.id)}
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
            <Group
              key={label.id}
              x={label.position.x}
              y={label.position.y}
              rotation={label.rotation}
              draggable={activeTool === 'select'}
              onClick={(e: any) => {
                e.cancelBubble = true;
                if (activeTool === 'delete') {
                  useSchematicStore.getState().deleteLabel(label.id);
                }
              }}
              onDragEnd={(e: any) => {
                const snapped = snap({ x: e.target.x(), y: e.target.y() });
                e.target.x(snapped.x);
                e.target.y(snapped.y);
                useSchematicStore.getState().updateLabel(label.id, { position: snapped });
              }}
              onDblClick={(e: any) => {
                e.cancelBubble = true;
                setEditingLabelId(label.id);
                setLabelInputValue(label.text);
                setLabelInputPos(label.position);
                setShowLabelInput(true);
                setTimeout(() => {
                  labelInputRef.current?.focus();
                  labelInputRef.current?.select();
                }, 50);
              }}
              cursor={activeTool === 'delete' ? 'pointer' : activeTool === 'select' ? 'move' : 'default'}
            >
              <Rect
                x={-2}
                y={-12}
                width={label.text.length * 7 + 8}
                height={16}
                fill={COLORS.background}
                stroke={label.type === 'power' ? '#ff4444' : (netColors?.[label.text] || COLORS.wire)}
                strokeWidth={1}
                cornerRadius={2}
              />
              <Text
                x={2}
                y={-10}
                text={label.text}
                fontSize={10}
                fontFamily="JetBrains Mono, monospace"
                fill={label.type === 'power' ? '#ff4444' : (netColors?.[label.text] || '#ffffff')}
              />
            </Group>
          ))}

          {/* Hierarchical Sheet Instances */}
          {sheetInstances.map((inst) => {
            const targetSheet = schematic.sheets.find((s) => s.id === inst.targetSheetId);
            const sheetName = targetSheet?.name ?? 'Sheet';
            // Collect sheet pins that belong to the target sheet
            const pins = schematic.sheetPins.filter((p) => p.sheetId === inst.targetSheetId);

            return (
              <Group
                key={inst.id}
                x={inst.position.x}
                y={inst.position.y}
                draggable={activeTool === 'select'}
                onDragEnd={(e: any) => {
                  const snapped = snap({ x: e.target.x(), y: e.target.y() });
                  e.target.x(snapped.x);
                  e.target.y(snapped.y);
                  useProjectStore.setState((state) => {
                    const h = state.project.schematic.hierarchicalSheetInstances.find(
                      (hi) => hi.id === inst.id
                    );
                    if (h) {
                      h.position = snapped;
                    }
                    state.isDirty = true;
                  });
                }}
                onDblClick={(e: any) => {
                  e.cancelBubble = true;
                  useProjectStore.getState().navigateIntoSheet(inst.targetSheetId);
                }}
                onClick={(e: any) => {
                  e.cancelBubble = true;
                  if (activeTool === 'delete') {
                    useProjectStore.getState().removeHierarchicalSheetInstance(inst.id);
                  }
                }}
                cursor={activeTool === 'delete' ? 'pointer' : activeTool === 'select' ? 'pointer' : 'default'}
              >
                {/* Sheet instance box */}
                <Rect
                  width={inst.size.width}
                  height={inst.size.height}
                  fill="rgba(100, 140, 200, 0.08)"
                  stroke="#6488c8"
                  strokeWidth={2}
                  cornerRadius={4}
                />
                {/* Sheet name header */}
                <Rect
                  width={inst.size.width}
                  height={22}
                  fill="rgba(100, 140, 200, 0.25)"
                  cornerRadius={[4, 4, 0, 0]}
                />
                <Text
                  x={6}
                  y={4}
                  text={sheetName}
                  fontSize={12}
                  fontFamily="Inter, sans-serif"
                  fontStyle="bold"
                  fill="#a0c0ff"
                  width={inst.size.width - 12}
                  ellipsis
                  wrap="none"
                />
                {/* Navigation hint */}
                <Text
                  x={6}
                  y={inst.size.height - 16}
                  text="⏎ Doppelklick: Öffnen"
                  fontSize={8}
                  fontFamily="JetBrains Mono, monospace"
                  fill="#6488c8"
                  opacity={0.6}
                />
                {/* Sheet pins on the sides */}
                {pins.map((pin, idx) => {
                  const pinY = 30 + idx * 20;
                  const isInput = pin.direction === 'input';
                  const pinX = isInput ? 0 : inst.size.width;
                  const textX = isInput ? 8 : inst.size.width - 8;
                  const anchor = isInput ? 'start' : 'end';
                  return (
                    <React.Fragment key={pin.id}>
                      <Circle
                        x={pinX}
                        y={pinY}
                        radius={3}
                        fill="#a0c0ff"
                        stroke="#6488c8"
                        strokeWidth={1}
                      />
                      <Text
                        x={isInput ? textX : textX - pin.name.length * 6}
                        y={pinY - 5}
                        text={pin.name}
                        fontSize={9}
                        fontFamily="JetBrains Mono, monospace"
                        fill="#a0c0ff"
                      />
                    </React.Fragment>
                  );
                })}
              </Group>
            );
          })}
        </Layer>

        {/* Overlay Layer — cursor crosshair, placement preview */}
        <Layer listening={false}>
          {/* Selection box */}
          {selectionBox && (
            <Rect
              x={selectionBox.x}
              y={selectionBox.y}
              width={selectionBox.width}
              height={selectionBox.height}
              fill="rgba(0, 140, 255, 0.08)"
              stroke="rgba(0, 140, 255, 0.5)"
              strokeWidth={1}
              dash={[6, 3]}
            />
          )}
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

        {/* Net Highlight Overlay */}
        {highlightedNetPoints.length > 0 && (
          <Layer name="net-highlight" listening={false}>
            {highlightedNetPoints.map((pt, i) => (
              <Circle
                key={`nh-${i}`}
                x={pt.x}
                y={pt.y}
                radius={8}
                fill="#ffaa00"
                opacity={0.25}
              />
            ))}
          </Layer>
        )}

        {/* ERC Error Highlighting Overlay */}
        <ERCOverlayLayer />

        {/* Remote collaboration cursors */}
        <RemoteCursorsLayer viewFilter="schematic" viewportScale={viewport.scale} />
      </Stage>

      {/* Tool hint overlay */}
      <div className="absolute bottom-2 left-2 text-[10px] text-lochcad-text-dim bg-lochcad-bg/80 px-2 py-1 rounded">
        {activeTool === 'select' && 'Klick Draht: Netz markieren | Doppelklick Draht: Wegpunkt einfügen | Wegpunkt ziehen: Umverlegen | Strg+C/V/X: Kopieren/Einfügen'}
        {activeTool === 'draw_wire' && 'Klick: Punkt setzen (Manhattan) | Doppelklick: Beenden | Esc: Abbrechen'}
        {activeTool === 'place_component' && 'Klick: Platzieren | Rechtsklick/R/Strg+R: Drehen | X: Spiegeln | Esc: Abbrechen'}
        {activeTool === 'place_label' && 'Klick: Label platzieren — Name eingeben & Enter drücken'}
        {activeTool === 'delete' && 'Klick auf Element: Löschen'}
      </div>

      {/* Floating label input */}
      {showLabelInput && (
        <div
          className="absolute z-50 flex items-center gap-1.5"
          style={{ left: labelScreenPos.left, top: labelScreenPos.top }}
        >
          <input
            ref={labelInputRef}
            className="bg-lochcad-surface border border-lochcad-accent rounded px-2 py-1 text-xs text-lochcad-text outline-none focus:ring-1 focus:ring-lochcad-accent shadow-lg w-36"
            placeholder="Label-Name…"
            value={labelInputValue}
            onChange={(e) => setLabelInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitLabel(); }
              if (e.key === 'Escape') { e.preventDefault(); setShowLabelInput(false); }
              e.stopPropagation();
            }}
            onBlur={() => commitLabel()}
          />
          <span className="text-[9px] text-lochcad-text-dim bg-lochcad-bg/80 px-1.5 py-0.5 rounded">
            Enter ↵
          </span>
        </div>
      )}
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

const WireRenderer: React.FC<{
  wire: Wire;
  isSelected: boolean;
  isNetHighlighted?: boolean;
  netColor?: string;
  remoteSelectedBy?: { color: string; name: string } | null;
  onClick: (e: any) => void;
  onDblClick?: (e: any) => void;
}> = React.memo(
  ({ wire, isSelected, isNetHighlighted, netColor, remoteSelectedBy, onClick, onDblClick }) => {
    const remoteColor = !isSelected && remoteSelectedBy ? remoteSelectedBy.color : null;
    return (
      <>
        {/* Remote selection glow */}
        {remoteColor && (
          <Line
            points={wire.points.flatMap((p) => [p.x, p.y])}
            stroke={remoteColor}
            strokeWidth={7}
            lineCap="round"
            lineJoin="round"
            opacity={0.35}
            listening={false}
          />
        )}
        <Line
          points={wire.points.flatMap((p) => [p.x, p.y])}
          stroke={isNetHighlighted ? '#ffaa00' : isSelected ? COLORS.selected : remoteColor || netColor || COLORS.wire}
          strokeWidth={isSelected || isNetHighlighted ? 3 : 2}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={10}
          onClick={onClick}
          onDblClick={onDblClick}
        />
      </>
    );
  }
);

WireRenderer.displayName = 'WireRenderer';

// ---- ERC Error Overlay ----

const ERCOverlayLayer: React.FC = React.memo(() => {
  const activeCheck = useCheckStore((s) => s.activeCheck);
  const ercResult = useCheckStore((s) => s.ercResult);
  const highlightedId = useCheckStore((s) => s.highlightedViolationId);
  const ercErrorComponentIds = useCheckStore((s) => s.ercErrorComponentIds);
  const ercWarningComponentIds = useCheckStore((s) => s.ercWarningComponentIds);

  if (activeCheck !== 'erc' || !ercResult) return null;

  const violations = ercResult.violations;

  return (
    <Layer name="erc-overlay" listening={false}>
      {violations.map((v) => {
        if (!v.position || !('x' in v.position)) return null;
        const isActive = highlightedId === v.id;
        const color = v.severity === 'error' ? COLORS.errorMarker
          : v.severity === 'warning' ? COLORS.warningMarker
          : '#4fc3f7';
        const size = isActive ? 18 : 12;
        const opacity = isActive ? 1 : 0.7;

        return (
          <Group key={v.id}>
            {/* Pulsing circle marker */}
            <Circle
              x={v.position.x}
              y={v.position.y}
              radius={size}
              fill={color}
              opacity={opacity * 0.15}
            />
            <Circle
              x={v.position.x}
              y={v.position.y}
              radius={size * 0.6}
              fill={color}
              opacity={opacity * 0.3}
            />
            {/* Cross or dot at center */}
            <Line
              points={[
                v.position.x - 4, v.position.y - 4,
                v.position.x + 4, v.position.y + 4,
              ]}
              stroke={color}
              strokeWidth={isActive ? 2.5 : 1.5}
              opacity={opacity}
            />
            <Line
              points={[
                v.position.x + 4, v.position.y - 4,
                v.position.x - 4, v.position.y + 4,
              ]}
              stroke={color}
              strokeWidth={isActive ? 2.5 : 1.5}
              opacity={opacity}
            />
            {/* Label for highlighted */}
            {isActive && (
              <>
                <Rect
                  x={v.position.x + 14}
                  y={v.position.y - 10}
                  width={Math.min(v.message.length * 5.5, 250)}
                  height={16}
                  fill="rgba(0,0,0,0.85)"
                  cornerRadius={3}
                />
                <Text
                  x={v.position.x + 17}
                  y={v.position.y - 7}
                  text={v.message}
                  fontSize={9}
                  fontFamily="JetBrains Mono, monospace"
                  fill={color}
                  width={250}
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

ERCOverlayLayer.displayName = 'ERCOverlayLayer';
