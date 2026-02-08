// ============================================================
// Preview3D — React-Three-Fiber 3D board preview
// ============================================================

import React, { useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, Grid, Html, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useProjectStore } from '@/stores/projectStore';
import { generate3DComponent, type PadPos3D, type ComponentExtraProps } from './ComponentGenerators';
import { getComponentById, getAdjustedFootprint } from '@/lib/component-library';
import type { PerfboardComponent, PerfboardConnection, TrackCut, BoardType } from '@/types';
import { BOARD, COLORS } from '@/constants';

// ---- Board Mesh ----

interface BoardMeshProps {
  cols: number;
  rows: number;
  boardType: BoardType;
  trackCuts: TrackCut[];
}

function BoardMesh({ cols, rows, boardType, trackCuts }: BoardMeshProps) {
  const spacing = BOARD.HOLE_SPACING_MM;
  const boardW = cols * spacing;
  const boardD = rows * spacing;
  const boardH = 1.6; // standard 1.6mm PCB

  const boardMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#2d5a1b',
    roughness: 0.7,
    metalness: 0.1,
  }), []);

  // Create instanced holes
  const holeCount = cols * rows;
  const holeMatrixRef = useRef<THREE.InstancedMesh>(null);
  const padMatrixRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    if (!holeMatrixRef.current || !padMatrixRef.current) return;

    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * spacing + spacing / 2;
        const z = r * spacing + spacing / 2;

        // Hole
        dummy.position.set(x, boardH + 0.01, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        holeMatrixRef.current.setMatrixAt(idx, dummy.matrix);

        // Pad (copper ring on bottom)
        dummy.position.set(x, -0.01, z);
        dummy.updateMatrix();
        padMatrixRef.current.setMatrixAt(idx, dummy.matrix);

        idx++;
      }
    }
    holeMatrixRef.current.instanceMatrix.needsUpdate = true;
    padMatrixRef.current.instanceMatrix.needsUpdate = true;
  }, [cols, rows, spacing, boardH]);

  // Copper strips for stripboard
  const stripGeometries = useMemo(() => {
    if (boardType !== 'stripboard') return [];

    const strips: { x: number; z: number; width: number }[] = [];
    for (let r = 0; r < rows; r++) {
      let startCol = 0;
      for (let c = 0; c <= cols; c++) {
        const isCut = trackCuts.some(tc => tc.position.col === c && tc.position.row === r);
        if (isCut || c === cols) {
          if (c > startCol) {
            const stripW = (c - startCol) * spacing;
            const x = startCol * spacing + stripW / 2;
            const z = r * spacing + spacing / 2;
            strips.push({ x, z, width: stripW });
          }
          startCol = c + 1;
        }
      }
    }
    return strips;
  }, [boardType, cols, rows, spacing, trackCuts]);

  const copperMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#b87333',
    roughness: 0.3,
    metalness: 0.8,
  }), []);

  return (
    <group position={[-boardW / 2, 0, -boardD / 2]}>
      {/* Board body */}
      <mesh position={[boardW / 2, boardH / 2, boardD / 2]}>
        <boxGeometry args={[boardW, boardH, boardD]} />
        <primitive object={boardMat} attach="material" />
      </mesh>

      {/* Holes (instanced) */}
      <instancedMesh ref={holeMatrixRef} args={[undefined, undefined, holeCount]}>
        <cylinderGeometry args={[0.4, 0.4, 0.1, 8]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </instancedMesh>

      {/* Pads (instanced) */}
      <instancedMesh ref={padMatrixRef} args={[undefined, undefined, holeCount]}>
        <cylinderGeometry args={[0.6, 0.6, 0.05, 12]} />
        <primitive object={copperMat} attach="material" />
      </instancedMesh>

      {/* Copper strips (stripboard) */}
      {stripGeometries.map((strip, i) => (
        <mesh key={i} position={[strip.x, -0.05, strip.z]}>
          <boxGeometry args={[strip.width - 0.2, 0.1, spacing * 0.7]} />
          <primitive object={copperMat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

// ---- Single 3D Component ----

interface Component3DProps {
  component: PerfboardComponent;
  boardCols: number;
  boardRows: number;
}

const BOARD_THICK = 1.6; // standard PCB thickness mm

function Component3DView({ component, boardCols, boardRows }: Component3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const def = getComponentById(component.libraryId);
  // Look up value & tolerance from the linked schematic component
  const schematic = useProjectStore((s) => s.project.schematic);
  const sComp = schematic.components.find(c => c.id === component.schematicComponentId);

  const spacing = BOARD.HOLE_SPACING_MM;

  useEffect(() => {
    if (!groupRef.current || !def?.model3d) return;

    // Clear previous children
    while (groupRef.current.children.length) {
      groupRef.current.remove(groupRef.current.children[0]);
    }

    // Compute pad positions in component-local 3D space (with holeSpan adjustment)
    const { pads: adjustedPads } = getAdjustedFootprint(def, component.properties?.holeSpan);
    const padPositions: PadPos3D[] = adjustedPads.map((pad) => ({
      x: pad.gridPosition.col * spacing,
      z: pad.gridPosition.row * spacing,
    }));

    const extra: ComponentExtraProps = {
      value: sComp?.value,
      tolerance: sComp?.properties?.tolerance,
    };

    const model = generate3DComponent(def.model3d, padPositions, BOARD_THICK, extra);
    groupRef.current.add(model);
  }, [def, spacing, component.properties?.holeSpan, sComp?.value, sComp?.properties?.tolerance]);

  if (!def) return null;

  const pos = component.gridPosition;
  const x = pos.col * spacing + spacing / 2;
  const z = pos.row * spacing + spacing / 2;

  return (
    <group
      ref={groupRef}
      position={[x - (boardCols * spacing) / 2, BOARD_THICK, z - (boardRows * spacing) / 2]}
      rotation={[0, -component.rotation * (Math.PI / 180), 0]}
    />
  );
}

// ---- Wire / Connection 3D ----

interface Connection3DProps {
  connection: PerfboardConnection;
  boardCols: number;
  boardRows: number;
}

// Shared materials for connections
const wireMaterials = {
  wire:         new THREE.MeshStandardMaterial({ color: '#e74c3c', roughness: 0.4, metalness: 0.6 }),
  wireBridge:   new THREE.MeshStandardMaterial({ color: '#3498db', roughness: 0.5, metalness: 0.2 }),
  solderBridge: new THREE.MeshStandardMaterial({ color: '#b87333', roughness: 0.35, metalness: 0.7 }),
  solder:       new THREE.MeshStandardMaterial({ color: '#c8c8c8', roughness: 0.4, metalness: 0.6 }),
  insulation:   new THREE.MeshStandardMaterial({ color: '#2980b9', roughness: 0.6, metalness: 0.05 }),
};

function Connection3DView({ connection, boardCols, boardRows }: Connection3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const spacing = BOARD.HOLE_SPACING_MM;
  const offsetX = (boardCols * spacing) / 2;
  const offsetZ = (boardRows * spacing) / 2;

  /** Convert grid position to 3D world XZ (board-centred) */
  const g2w = (pos: { col: number; row: number }) => ({
    x: pos.col * spacing + spacing / 2 - offsetX,
    z: pos.row * spacing + spacing / 2 - offsetZ,
  });

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    // Clear previous
    while (g.children.length) g.remove(g.children[0]);

    // Collect all positions along the connection
    const allPos = [connection.from];
    if (connection.waypoints?.length) allPos.push(...connection.waypoints);
    allPos.push(connection.to);

    const isSolderBridge = connection.type === 'solder_bridge'
      || (connection.type === 'wire' && (!connection.waypoints || connection.waypoints.length === 0)
          && (connection.from.col === connection.to.col || connection.from.row === connection.to.row)
          && (Math.abs(connection.from.col - connection.to.col) + Math.abs(connection.from.row - connection.to.row)) === 1);
    const isWireBridge = connection.type === 'wire_bridge';

    if (isSolderBridge) {
      // ---- Solder bridge: molten solder blob on the bottom side of the board ----
      const from3 = g2w(connection.from);
      const to3 = g2w(connection.to);
      const dist = Math.sqrt((to3.x - from3.x) ** 2 + (to3.z - from3.z) ** 2);
      const angle = Math.atan2(to3.z - from3.z, to3.x - from3.x);

      // Build a smooth solder blob shape: elongated ellipsoid
      const bridgeGeom = new THREE.SphereGeometry(1, 12, 8);
      const bridge = new THREE.Mesh(bridgeGeom, wireMaterials.solder);
      const midX = (from3.x + to3.x) / 2;
      const midZ = (from3.z + to3.z) / 2;
      bridge.position.set(midX, -0.1, midZ);
      // Scale: flat vertically, stretched along the bridge direction
      const halfDist = (dist + 0.6) / 2;
      bridge.scale.set(halfDist, 0.25, 0.65);
      bridge.rotation.set(0, angle, 0);
      g.add(bridge);

      // Solder bumps at both pads
      for (const pos of [from3, to3]) {
        const dotGeom = new THREE.SphereGeometry(0.65, 8, 6);
        const dot = new THREE.Mesh(dotGeom, wireMaterials.solder);
        dot.position.set(pos.x, -0.05, pos.z);
        dot.scale.set(1, 0.35, 1);
        g.add(dot);
      }
      return;
    }

    if (isWireBridge) {
      // ---- Wire bridge: insulated wire arching over the board ----
      const pts3d: THREE.Vector3[] = [];
      for (let i = 0; i < allPos.length; i++) {
        const w = g2w(allPos[i]);
        const isEndpoint = i === 0 || i === allPos.length - 1;
        // Endpoints go through the board; midpoints arch above
        if (isEndpoint) {
          pts3d.push(new THREE.Vector3(w.x, BOARD_THICK + 0.5, w.z));
        } else {
          pts3d.push(new THREE.Vector3(w.x, BOARD_THICK + 4, w.z));
        }
      }

      // If only 2 points, add a mid-point for a nice arch
      if (pts3d.length === 2) {
        const mid = new THREE.Vector3().lerpVectors(pts3d[0], pts3d[1], 0.5);
        mid.y = BOARD_THICK + 5;
        const curve = new THREE.QuadraticBezierCurve3(pts3d[0], mid, pts3d[1]);
        const tubeGeom = new THREE.TubeGeometry(curve, 24, 0.35, 8, false);
        g.add(new THREE.Mesh(tubeGeom, wireMaterials.insulation));
      } else {
        const curve = new THREE.CatmullRomCurve3(pts3d, false, 'catmullrom', 0.3);
        const tubeGeom = new THREE.TubeGeometry(curve, pts3d.length * 10, 0.35, 8, false);
        g.add(new THREE.Mesh(tubeGeom, wireMaterials.insulation));
      }

      // Solder blobs at endpoints
      for (const endPos of [connection.from, connection.to]) {
        const w = g2w(endPos);
        const blobGeom = new THREE.SphereGeometry(0.55, 8, 6);
        const blob = new THREE.Mesh(blobGeom, wireMaterials.solder);
        blob.position.set(w.x, -0.05, w.z);
        blob.scale.set(1, 0.4, 1);
        g.add(blob);
      }
      return;
    }

    // ---- Regular wire: per-segment rendering ----
    // Each segment between consecutive grid positions is either a Lötbrücke
    // (if it spans exactly 1 hole horizontally or vertically) or a wire segment.
    const wireY = -0.15; // slightly below board bottom

    // Track which endpoints actually need wire leads (not used by solder bridges)
    const wireEndpoints = new Set<string>();

    for (let i = 0; i < allPos.length - 1; i++) {
      const a = allPos[i];
      const b = allPos[i + 1];
      const manhattanDist = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
      const isSegmentBridge = manhattanDist === 1
        && (a.col === b.col || a.row === b.row);

      const wa = g2w(a);
      const wb = g2w(b);

      if (isSegmentBridge) {
        // ---- Render this segment as a Lötbrücke ----
        const dist = Math.sqrt((wb.x - wa.x) ** 2 + (wb.z - wa.z) ** 2);
        const angle = Math.atan2(wb.z - wa.z, wb.x - wa.x);
        const bridgeGeom = new THREE.SphereGeometry(1, 12, 8);
        const bridge = new THREE.Mesh(bridgeGeom, wireMaterials.solder);
        bridge.position.set((wa.x + wb.x) / 2, -0.1, (wa.z + wb.z) / 2);
        const halfDist = (dist + 0.6) / 2;
        bridge.scale.set(halfDist, 0.25, 0.65);
        bridge.rotation.set(0, angle, 0);
        g.add(bridge);
      } else {
        // ---- Render as wire tube ----
        const from3 = new THREE.Vector3(wa.x, wireY, wa.z);
        const to3 = new THREE.Vector3(wb.x, wireY, wb.z);
        const dir = new THREE.Vector3().subVectors(to3, from3);
        const len = dir.length();
        const mid = new THREE.Vector3().lerpVectors(from3, to3, 0.5);
        const tubeGeom = new THREE.CylinderGeometry(0.25, 0.25, len, 8);
        const tube = new THREE.Mesh(tubeGeom, wireMaterials.wire);
        tube.position.copy(mid);
        tube.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.normalize()
        );
        g.add(tube);

        // Mark these endpoints as needing wire leads
        const keyA = `${a.col},${a.row}`;
        const keyB = `${b.col},${b.row}`;
        if (i === 0) wireEndpoints.add(keyA);
        if (i === allPos.length - 2) wireEndpoints.add(keyB);
      }
    }

    // Solder Lötpunkte: blobs at every waypoint + endpoints (on bottom side)
    for (const pos of allPos) {
      const w = g2w(pos);
      const blobGeom = new THREE.SphereGeometry(0.55, 8, 6);
      const blob = new THREE.Mesh(blobGeom, wireMaterials.solder);
      blob.position.set(w.x, -0.05, w.z);
      blob.scale.set(1, 0.35, 1);
      g.add(blob);
    }
  }, [connection, spacing, offsetX, offsetZ]);

  return <group ref={groupRef} />;
}

// ---- Track Cut 3D ----

interface TrackCut3DProps {
  trackCut: TrackCut;
  boardCols: number;
  boardRows: number;
}

function TrackCut3DView({ trackCut, boardCols, boardRows }: TrackCut3DProps) {
  const spacing = BOARD.HOLE_SPACING_MM;
  const x = trackCut.position.col * spacing + spacing / 2 - (boardCols * spacing) / 2;
  const z = trackCut.position.row * spacing + spacing / 2 - (boardRows * spacing) / 2;

  return (
    <mesh position={[x, -0.15, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.5, 1, 16]} />
      <meshStandardMaterial color="#1a1a1a" roughness={0.8} />
    </mesh>
  );
}

// ---- Camera Controller ----

function CameraSetup() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(30, 40, 50);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return null;
}

// ---- Loading Fallback ----

function LoadingFallback() {
  return (
    <Html center>
      <div className="text-white bg-lochcad-surface px-4 py-2 rounded-lg shadow-lg">
        Lade 3D-Vorschau...
      </div>
    </Html>
  );
}

// ---- Main Preview3D Component ----

const Preview3D: React.FC = () => {
  const project = useProjectStore(s => s.project);

  // Use perfboard directly from the project
  const perfboard = useMemo(() => {
    if (!project) return null;
    return project.perfboard ?? null;
  }, [project]);

  if (!perfboard) {
    return (
      <div className="flex-1 flex items-center justify-center bg-lochcad-bg text-gray-400">
        <div className="text-center">
          <p className="text-lg mb-2">Kein Perfboard-Layout vorhanden</p>
          <p className="text-sm">Wechseln Sie zum Lochraster-Editor und platzieren Sie Bauteile.</p>
        </div>
      </div>
    );
  }

  const cols = perfboard.width;
  const rows = perfboard.height;
  const { boardType, components, connections, trackCuts } = perfboard;

  return (
    <div className="w-full h-full absolute inset-0 bg-gradient-to-b from-gray-900 to-gray-800">
      {/* Overlaid info panel */}
      <div className="absolute top-3 left-3 z-10 bg-lochcad-surface/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-gray-300">
        <div className="font-bold text-white mb-1">3D-Vorschau</div>
        <div>{cols}×{rows} | {boardType === 'perfboard' ? 'Lochraster' : 'Streifenraster'}</div>
        <div>{components.length} Bauteile | {connections.length} Verbindungen</div>
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-3 right-3 z-10 bg-lochcad-surface/80 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-gray-400">
        <div>🖱️ Links: Drehen | Rechts: Schwenken | Scroll: Zoom</div>
      </div>

      <Canvas
        shadows
        gl={{ antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%' }}
      >
        <Suspense fallback={<LoadingFallback />}>
          {/* Camera */}
          <PerspectiveCamera makeDefault fov={50} near={0.1} far={1000} />
          <CameraSetup />

          {/* Lighting */}
          <ambientLight intensity={0.4} />
          <directionalLight
            position={[30, 50, 20]}
            intensity={0.8}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <directionalLight position={[-20, 30, -10]} intensity={0.3} />
          <pointLight position={[0, 20, 0]} intensity={0.2} />

          {/* Environment */}
          <Environment preset="warehouse" />

          {/* Board */}
          <BoardMesh
            cols={cols}
            rows={rows}
            boardType={boardType}
            trackCuts={trackCuts}
          />

          {/* Components */}
          {components.map(comp => (
            <Component3DView key={comp.id} component={comp} boardCols={cols} boardRows={rows} />
          ))}

          {/* Connections */}
          {connections.map(conn => (
            <Connection3DView
              key={conn.id}
              connection={conn}
              boardCols={cols}
              boardRows={rows}
            />
          ))}

          {/* Track Cuts */}
          {trackCuts.map(tc => (
            <TrackCut3DView
              key={tc.id}
              trackCut={tc}
              boardCols={cols}
              boardRows={rows}
            />
          ))}

          {/* Reference grid */}
          <Grid
            position={[0, -0.5, 0]}
            args={[200, 200]}
            cellSize={2.54}
            cellThickness={0.5}
            cellColor="#333333"
            sectionSize={25.4}
            sectionThickness={1}
            sectionColor="#555555"
            fadeDistance={150}
            fadeStrength={1}
            infiniteGrid
          />

          {/* Controls */}
          <OrbitControls
            enableDamping
            dampingFactor={0.1}
            minDistance={2}
            maxDistance={500}
            zoomSpeed={2}
            maxPolarAngle={Math.PI * 0.95}
          />
        </Suspense>
      </Canvas>
    </div>
  );
};

export default Preview3D;
