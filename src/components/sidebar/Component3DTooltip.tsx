// ============================================================
// Component3DTooltip — Spinning 3D model preview on hover
// ============================================================

import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import type { ComponentDefinition } from '@/types';
import { generate3DComponent, type PadPos3D } from '@/features/preview-3d/ComponentGenerators';

const CANVAS_SIZE = 160;
const BOARD_THICK = 1.6;
const HOLE_SPACING = 2.54;
const BG_COLOR = 0x1a1a2e;
const ROTATION_SPEED = 0.008;

/**
 * Lightweight THREE.js canvas that renders a slowly rotating 3D component.
 * Uses raw THREE (no R3F) to keep it fast and avoid context nesting issues.
 */
export const Component3DTooltip = React.memo(function Component3DTooltip({
  definition,
}: {
  definition: ComponentDefinition;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    model: THREE.Group;
    raf: number;
  } | null>(null);

  const animate = useCallback(() => {
    const s = stateRef.current;
    if (!s) return;
    s.model.rotation.y += ROTATION_SPEED;
    s.renderer.render(s.scene, s.camera);
    s.raf = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    renderer.setSize(CANVAS_SIZE, CANVAS_SIZE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(BG_COLOR);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    // --- Scene ---
    const scene = new THREE.Scene();

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-4, 3, -5);
    scene.add(fillLight);

    // --- Generate 3D model ---
    const padPositions: PadPos3D[] = definition.footprint.pads.map((pad) => ({
      x: pad.gridPosition.col * HOLE_SPACING,
      z: pad.gridPosition.row * HOLE_SPACING,
    }));

    const model = definition.model3d
      ? generate3DComponent(definition.model3d, padPositions, BOARD_THICK)
      : new THREE.Group();

    // Centre the model on its bounding box
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);

    // Wrap in pivot so rotation is around visual centre
    const pivot = new THREE.Group();
    pivot.add(model);
    scene.add(pivot);

    // --- Camera (bounding-sphere fit for correct zoom during rotation) ---
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const radius = Math.max(sphere.radius, 3);
    const FOV = 36;
    const halfFovRad = (FOV / 2) * (Math.PI / 180);
    // Distance so the full sphere fits inside the frustum, plus 15% margin
    const fitDist = (radius / Math.sin(halfFovRad)) * 1.15;

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 500);
    const dir = new THREE.Vector3(0.8, 0.7, 1.2).normalize();
    camera.position.copy(dir.multiplyScalar(fitDist));
    camera.lookAt(0, 0, 0);

    stateRef.current = { renderer, scene, camera, model: pivot, raf: 0 };
    stateRef.current.raf = requestAnimationFrame(animate);

    return () => {
      if (stateRef.current) {
        cancelAnimationFrame(stateRef.current.raf);
      }
      renderer.dispose();
      stateRef.current = null;
    };
  }, [definition, animate]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      className="rounded-md"
      style={{ width: CANVAS_SIZE, height: CANVAS_SIZE, display: 'block' }}
    />
  );
});
