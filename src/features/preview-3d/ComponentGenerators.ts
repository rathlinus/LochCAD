// ============================================================
// 3D Component Generators — Parametric THREE.js geometries
// with realistic bent leads through perfboard holes
// ============================================================

import * as THREE from 'three';
import type { Model3D } from '@/types';
import { COLORS } from '@/constants';

/** Pad position in component-local 3D space (y=0 = board top surface) */
export interface PadPos3D {
  x: number;
  z: number;
}

// ---- Constants ----

const POKE = 1.5;        // mm lead pokes below board bottom
const LEAD_R = 0.3;      // default lead wire radius mm

// ---- Shared Materials ----

const mat = {
  resistorBody: new THREE.MeshStandardMaterial({ color: COLORS.resistorBody, roughness: 0.7, metalness: 0.1 }),
  ceramicDisc:  new THREE.MeshStandardMaterial({ color: COLORS.capacitorBody, roughness: 0.6, metalness: 0.1 }),
  elcoSleeve:   new THREE.MeshStandardMaterial({ color: '#1a237e', roughness: 0.4, metalness: 0.15 }),
  elcoTop:      new THREE.MeshStandardMaterial({ color: '#444', roughness: 0.4 }),
  icBody:       new THREE.MeshStandardMaterial({ color: COLORS.icBody, roughness: 0.3, metalness: 0.1 }),
  lead:         new THREE.MeshStandardMaterial({ color: COLORS.pinMetal, roughness: 0.3, metalness: 0.8 }),
  plastic:      new THREE.MeshStandardMaterial({ color: COLORS.plastic, roughness: 0.5, metalness: 0.05 }),
  ledRed:       new THREE.MeshStandardMaterial({ color: '#ff2222', roughness: 0.1, transparent: true, opacity: 0.85 }),
  ledGreen:     new THREE.MeshStandardMaterial({ color: '#22ff22', roughness: 0.1, transparent: true, opacity: 0.85 }),
  solder:       new THREE.MeshStandardMaterial({ color: '#c8c8c8', roughness: 0.4, metalness: 0.6 }),
  copper:       new THREE.MeshStandardMaterial({ color: COLORS.copper3d, roughness: 0.3, metalness: 0.9 }),
  metalCan:     new THREE.MeshStandardMaterial({ color: '#c0c0c0', roughness: 0.2, metalness: 0.8 }),
  whiteStripe:  new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.6 }),
  diodeBody:    new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.4 }),
  cathodeBand:  new THREE.MeshStandardMaterial({ color: '#ccc', roughness: 0.3 }),
  darkGreen:    new THREE.MeshStandardMaterial({ color: '#2e7d32', roughness: 0.5 }),
  blueBody:     new THREE.MeshStandardMaterial({ color: '#1a5276', roughness: 0.5 }),
  buttonGrey:   new THREE.MeshStandardMaterial({ color: '#666', roughness: 0.3 }),
  ledBlue:      new THREE.MeshStandardMaterial({ color: '#2255ff', roughness: 0.1, transparent: true, opacity: 0.85 }),
  ledYellow:    new THREE.MeshStandardMaterial({ color: '#ffdd00', roughness: 0.1, transparent: true, opacity: 0.85 }),
  ledWhite:     new THREE.MeshStandardMaterial({ color: '#f0f0ff', roughness: 0.1, transparent: true, opacity: 0.9 }),
  ledOrange:    new THREE.MeshStandardMaterial({ color: '#ff6600', roughness: 0.1, transparent: true, opacity: 0.85 }),
  to220Body:    new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.3, metalness: 0.05 }),
  to220Tab:     new THREE.MeshStandardMaterial({ color: '#c0c0c0', roughness: 0.2, metalness: 0.8 }),
  ldrBody:      new THREE.MeshStandardMaterial({ color: '#8B0000', roughness: 0.5, metalness: 0.1 }),
  ldrWindow:    new THREE.MeshStandardMaterial({ color: '#cc4444', roughness: 0.3, transparent: true, opacity: 0.6 }),
  ntcBody:      new THREE.MeshStandardMaterial({ color: '#003366', roughness: 0.5 }),
  // Film / box capacitor
  filmCapBody:  new THREE.MeshStandardMaterial({ color: '#b22222', roughness: 0.5, metalness: 0.05 }),
  filmCapText:  new THREE.MeshStandardMaterial({ color: '#ffcc00', roughness: 0.5 }),
  // Tantalum capacitor
  tantalumBody: new THREE.MeshStandardMaterial({ color: '#d4a017', roughness: 0.6, metalness: 0.1 }),
  tantalumMark: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }),
  // MLCC
  mlccBody:     new THREE.MeshStandardMaterial({ color: '#1a5276', roughness: 0.5, metalness: 0.1 }),
  // Varistor
  varistorBody: new THREE.MeshStandardMaterial({ color: '#1565c0', roughness: 0.5 }),
  // Relay
  relayBody:    new THREE.MeshStandardMaterial({ color: '#1a1a2e', roughness: 0.4, metalness: 0.05 }),
  relayLabel:   new THREE.MeshStandardMaterial({ color: '#5555aa', roughness: 0.5 }),
  // Fuse
  fuseBody:     new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.2, transparent: true, opacity: 0.7 }),
  fuseCap:      new THREE.MeshStandardMaterial({ color: '#c0c0c0', roughness: 0.3, metalness: 0.7 }),
  fuseWire:     new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.4, metalness: 0.5 }),
  // Trimmer potentiometer
  trimmerBody:  new THREE.MeshStandardMaterial({ color: '#1565c0', roughness: 0.5 }),
  trimmerSlot:  new THREE.MeshStandardMaterial({ color: '#dddddd', roughness: 0.3, metalness: 0.5 }),
  // Bridge rectifier
  bridgeBody:   new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.4 }),
  // Resistor box
  resistorBoxBody: new THREE.MeshStandardMaterial({ color: '#1a3d5c', roughness: 0.5 }),
  resistorBoxText: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }),
};

/** Digit → color for resistor bands (0=black … 9=white) */
const BAND_COLORS: string[] = [
  '#000000', // 0 black
  '#8B4513', // 1 brown
  '#FF0000', // 2 red
  '#FF8C00', // 3 orange
  '#FFD700', // 4 yellow
  '#00FF00', // 5 green
  '#0000FF', // 6 blue
  '#8B008B', // 7 violet
  '#808080', // 8 grey
  '#FFFFFF', // 9 white
];

/** Multiplier exponent → color  (-2=silver, -1=gold, 0..9 = digit colors) */
const MULTIPLIER_COLORS: Record<number, string> = {
  [-2]: '#C0C0C0', // silver  (0.01)
  [-1]: '#FFD700', // gold    (0.1)
  0: '#000000', 1: '#8B4513', 2: '#FF0000', 3: '#FF8C00',
  4: '#FFD700', 5: '#00FF00', 6: '#0000FF', 7: '#8B008B',
  8: '#808080', 9: '#FFFFFF',
};

/** Tolerance string → color */
const TOLERANCE_COLORS: Record<string, string> = {
  '1%': '#8B4513',   // brown
  '2%': '#FF0000',   // red
  '0.5%': '#00FF00', // green
  '0.25%': '#0000FF',// blue
  '0.1%': '#8B008B', // violet
  '5%': '#FFD700',   // gold
  '10%': '#C0C0C0',  // silver
  '20%': '#e8d0aa',  // no band (body color)
};

/** Extra properties passed from the component (value, tolerance, etc.) */
export interface ComponentExtraProps {
  value?: string;
  tolerance?: string;
}

// ============================================================
// Resistor Value → Color Bands
// ============================================================

/**
 * Parse a resistance value string like "10kΩ", "4.7kΩ", "470Ω", "2.2MΩ", "0.1Ω"
 * into an ohm number.  Returns NaN on failure.
 */
function parseResistanceValue(raw: string): number {
  if (!raw) return NaN;
  // Strip Ω, spaces
  let s = raw.replace(/[Ωω\s]/gi, '').trim();
  let multiplier = 1;
  if (/[Mm]$/i.test(s)) { multiplier = 1e6; s = s.slice(0, -1); }
  else if (/[Kk]$/i.test(s)) { multiplier = 1e3; s = s.slice(0, -1); }
  else if (/[Rr]$/i.test(s)) { multiplier = 1; s = s.slice(0, -1); }
  const num = parseFloat(s);
  return isNaN(num) ? NaN : num * multiplier;
}

/**
 * Convert an ohm value + tolerance into 4 band colors.
 * Returns 4 hex strings: [digit1, digit2, multiplier, tolerance].
 * Falls back to generic brown bands on parse failure.
 */
function resistorColorBands(ohms: number, tolerance?: string): string[] {
  const tolColor = (tolerance && TOLERANCE_COLORS[tolerance]) || TOLERANCE_COLORS['5%'];

  if (isNaN(ohms) || ohms <= 0) {
    // Fallback: brown-black-black-gold  (10Ω 5%)
    return [BAND_COLORS[1], BAND_COLORS[0], MULTIPLIER_COLORS[0], tolColor];
  }

  // Normalise to 2 significant digits: e.g. 4700 → 47 × 10^2
  let exp = 0;
  let sig = ohms;
  if (sig >= 100) {
    while (sig >= 100) { sig /= 10; exp++; }
  } else if (sig < 10) {
    while (sig < 10 && exp > -2) { sig *= 10; exp--; }
  }
  sig = Math.round(sig);
  if (sig >= 100) { sig = Math.round(sig / 10); exp++; }

  const d1 = Math.floor(sig / 10) % 10;
  const d2 = sig % 10;

  const c1 = BAND_COLORS[d1] ?? BAND_COLORS[0];
  const c2 = BAND_COLORS[d2] ?? BAND_COLORS[0];
  const cm = MULTIPLIER_COLORS[exp] ?? MULTIPLIER_COLORS[0];

  return [c1, c2, cm, tolColor];
}

// ============================================================
// Main Entry
// ============================================================

export function generate3DComponent(
  model: Model3D,
  pads: PadPos3D[],
  boardThick: number,
  extra?: ComponentExtraProps,
): THREE.Group {
  if (model.type === 'custom' || pads.length === 0) return buildPlaceholder(pads, boardThick);

  const { shape, params } = model;
  switch (shape) {
    case 'resistor_axial':         return buildResistorAxial(params, pads, boardThick, extra);
    case 'resistor_box':           return buildResistorBox(params, pads, boardThick);
    case 'capacitor_ceramic':      return buildCeramicCap(params, pads, boardThick);
    case 'capacitor_electrolytic': return buildElcoCap(params, pads, boardThick);
    case 'capacitor_film':         return buildFilmCap(params, pads, boardThick);
    case 'capacitor_tantalum':     return buildTantalumCap(params, pads, boardThick);
    case 'capacitor_mlcc':         return buildMLCCCap(params, pads, boardThick);
    case 'led':                    return buildLED(params, pads, boardThick);
    case 'led_3mm':                return buildLED({ ...params, diameter: 3, height: 5.5 }, pads, boardThick);
    case 'diode':                  return buildDiode(params, pads, boardThick);
    case 'transistor_to92':        return buildTO92(params, pads, boardThick);
    case 'transistor_to220':       return buildTO220(params, pads, boardThick);
    case 'ic_dip':                 return buildDIP(params, pads, boardThick);
    case 'pin_header':             return buildPinHeader(params, pads, boardThick);
    case 'connector':              return buildPinHeader(params, pads, boardThick);
    case 'crystal':                return buildCrystal(params, pads, boardThick);
    case 'switch':                 return buildSwitch(params, pads, boardThick);
    case 'potentiometer':          return buildPotentiometer(params, pads, boardThick);
    case 'trimmer':                return buildTrimmer(params, pads, boardThick);
    case 'inductor':               return buildInductor(params, pads, boardThick);
    case 'voltage_regulator_to220': return buildTO220(params, pads, boardThick);
    case 'buzzer':                  return buildBuzzer(params, pads, boardThick);
    case 'screw_terminal':          return buildScrewTerminal(params, pads, boardThick);
    case 'tactile_switch':          return buildTactileSwitch(params, pads, boardThick);
    case 'relay':                   return buildRelay(params, pads, boardThick);
    case 'bridge_rectifier':        return buildBridgeRectifier(params, pads, boardThick);
    case 'varistor':                return buildVaristor(params, pads, boardThick);
    case 'fuse':                    return buildFuse(params, pads, boardThick);
    case 'ldr':                     return buildLDR(params, pads, boardThick);
    case 'ntc_bead':                return buildNTCBead(params, pads, boardThick);
    default:                        return buildPlaceholder(pads, boardThick);
  }
}

// ============================================================
// Lead Helpers
// ============================================================

/**
 * Create a bent lead using TubeGeometry.
 * The lead exits the body at `exitPt`, travels horizontally (if needed)
 * to above the hole, bends smoothly downward through the board, and
 * pokes out below.
 */
function bentLead(
  exitPt: THREE.Vector3,
  hx: number,
  hz: number,
  bt: number,
  r: number = LEAD_R,
): THREE.Mesh {
  const pts: THREE.Vector3[] = [exitPt.clone()];
  const ey = exitPt.y;

  // Horizontal travel to above hole (if needed)
  const dx = Math.abs(hx - exitPt.x);
  const dz = Math.abs(hz - exitPt.z);
  if (dx > 0.2 || dz > 0.2) {
    pts.push(new THREE.Vector3(hx, ey, hz));
  }

  // Intermediate point for smooth 90° bend
  if (ey > 0.8) {
    pts.push(new THREE.Vector3(hx, ey * 0.3, hz));
  }

  // Board surface
  pts.push(new THREE.Vector3(hx, 0, hz));
  // Below board
  pts.push(new THREE.Vector3(hx, -bt - POKE, hz));

  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.08);
  const segs = Math.max(pts.length * 8, 20);
  const geom = new THREE.TubeGeometry(curve, segs, r, 8, false);
  return new THREE.Mesh(geom, mat.lead);
}

/** Straight vertical lead from topY down through hole and board */
function straightLead(topY: number, hx: number, hz: number, bt: number, r: number = LEAD_R): THREE.Mesh {
  const total = topY + bt + POKE;
  const geom = new THREE.CylinderGeometry(r, r, total, 8);
  const m = new THREE.Mesh(geom, mat.lead);
  m.position.set(hx, topY / 2 - (bt + POKE) / 2, hz);
  return m;
}

/** Small solder blob at the bottom of a hole */
function solderBlob(hx: number, hz: number, bt: number): THREE.Mesh {
  const geom = new THREE.SphereGeometry(0.55, 8, 6);
  const m = new THREE.Mesh(geom, mat.solder);
  m.position.set(hx, -bt, hz);
  m.scale.set(1, 0.4, 1);
  return m;
}

/** Centre of a pad array */
function padCenter(pads: PadPos3D[]): { x: number; z: number } {
  if (pads.length === 0) return { x: 0, z: 0 };
  const sx = pads.reduce((s, p) => s + p.x, 0);
  const sz = pads.reduce((s, p) => s + p.z, 0);
  return { x: sx / pads.length, z: sz / pads.length };
}

/** Add leads + solder to group for an array of pads that exit body at given Y */
function addStraightLeads(g: THREE.Group, pads: PadPos3D[], exitY: number, bt: number, r: number = LEAD_R) {
  for (const p of pads) {
    g.add(straightLead(exitY, p.x, p.z, bt, r));
    g.add(solderBlob(p.x, p.z, bt));
  }
}

// ============================================================
// Resistor — Axial
// ============================================================

function buildResistorAxial(p: Record<string, number | string>, pads: PadPos3D[], bt: number, extra?: ComponentExtraProps): THREE.Group {
  const g = new THREE.Group();
  const bodyLen = (p.bodyLength as number) || 6.3;
  const bodyDia = (p.bodyDiameter as number) || 2.5;
  const lr = ((p.leadDiameter as number) || 0.6) / 2;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 10.16, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;

  // Body elevated above board so leads bend nicely
  const clearance = 1.0;
  const by = clearance + bodyDia / 2;

  // Body cylinder (along X)
  const bodyGeom = new THREE.CylinderGeometry(bodyDia / 2, bodyDia / 2, bodyLen, 16);
  bodyGeom.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, mat.resistorBody);
  body.position.set(cx, by, cz);
  g.add(body);

  // Compute correct color bands from component value
  const ohms = parseResistanceValue(extra?.value ?? '');
  const bands = resistorColorBands(ohms, extra?.tolerance);

  // Render 4 bands: digit1, digit2, multiplier spaced equally, tolerance band with gap
  const bandR = bodyDia / 2 + 0.05;
  const bandW = 0.65;

  for (let i = 0; i < 4; i++) {
    const bGeom = new THREE.CylinderGeometry(bandR, bandR, bandW, 16);
    bGeom.rotateZ(Math.PI / 2);
    const bMat = new THREE.MeshStandardMaterial({
      color: bands[i],
      roughness: 0.5,
    });
    const band = new THREE.Mesh(bGeom, bMat);
    // First 3 bands grouped on left, tolerance band offset to right
    const xPos = i < 3
      ? cx - bodyLen * 0.30 + i * bodyLen * 0.17
      : cx + bodyLen * 0.35;
    band.position.set(xPos, by, cz);
    g.add(band);
  }

  // Bent leads from body endcaps → horizontal → down through holes
  g.add(bentLead(new THREE.Vector3(cx - bodyLen / 2, by, cz), p0.x, p0.z, bt, lr));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + bodyLen / 2, by, cz), p1.x, p1.z, bt, lr));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Diode — Axial (similar to resistor but black body + cathode band)
// ============================================================

function buildDiode(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyLen = (p.bodyLength as number) || 4;
  const bodyDia = (p.bodyDiameter as number) || 2;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 10.16, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;

  const clearance = 1.0;
  const by = clearance + bodyDia / 2;

  // Body
  const bodyGeom = new THREE.CylinderGeometry(bodyDia / 2, bodyDia / 2, bodyLen, 12);
  bodyGeom.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, mat.diodeBody);
  body.position.set(cx, by, cz);
  g.add(body);

  // Cathode band
  const bandGeom = new THREE.CylinderGeometry(bodyDia / 2 + 0.1, bodyDia / 2 + 0.1, 0.8, 12);
  bandGeom.rotateZ(Math.PI / 2);
  const band = new THREE.Mesh(bandGeom, mat.cathodeBand);
  band.position.set(cx + bodyLen / 2 - 1, by, cz);
  g.add(band);

  // Bent leads
  g.add(bentLead(new THREE.Vector3(cx - bodyLen / 2, by, cz), p0.x, p0.z, bt, LEAD_R));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + bodyLen / 2, by, cz), p1.x, p1.z, bt, LEAD_R));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Ceramic Capacitor — Disc body, 2 leads
// ============================================================

function buildCeramicCap(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 5;
  const thickness = (p.thickness as number) || 3;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 5.08, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;

  // Disc standing vertical, face visible from front (axis along Z)
  const elev = 1.5;
  const by = elev + dia / 2;

  const bodyGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, thickness, 20);
  bodyGeom.rotateX(Math.PI / 2); // axis along Z → face visible from front
  const body = new THREE.Mesh(bodyGeom, mat.ceramicDisc);
  body.position.set(cx, by, cz);
  g.add(body);

  // Marking ring
  const markGeom = new THREE.TorusGeometry(dia / 2 - 0.3, 0.15, 8, 20);
  const markMat = new THREE.MeshStandardMaterial({ color: '#a0522d', roughness: 0.5 });
  const mark = new THREE.Mesh(markGeom, markMat);
  mark.position.set(cx, by, cz + thickness / 2 + 0.05);
  g.add(mark);

  // Leads exit from lower part of disc where it still has width,
  // then bend down and outward to the pad holes.
  // At 30° above bottom, the disc still has ~dia/2 * cos(60°) ≈ half-width.
  const exitY = by - dia / 2 * 0.85;  // ~30% up from disc bottom
  const exitXoff = dia / 2 * 0.35;    // within disc width at that height
  const exitLeft =  new THREE.Vector3(cx - exitXoff, exitY, cz);
  const exitRight = new THREE.Vector3(cx + exitXoff, exitY, cz);
  g.add(bentLead(exitLeft, p0.x, p0.z, bt));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(exitRight, p1.x, p1.z, bt));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Electrolytic Capacitor — Vertical cylinder
// ============================================================

function buildElcoCap(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 5;
  const height = (p.height as number) || 11;

  const c = padCenter(pads);
  const bodyGap = 0.5; // small gap above board

  // Main cylinder
  const bodyGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, height, 20);
  const body = new THREE.Mesh(bodyGeom, mat.elcoSleeve);
  body.position.set(c.x, bodyGap + height / 2, c.z);
  g.add(body);

  // Top cap
  const topGeom = new THREE.CylinderGeometry(dia / 2 - 0.3, dia / 2, 1, 20);
  const top = new THREE.Mesh(topGeom, mat.elcoTop);
  top.position.set(c.x, bodyGap + height + 0.5, c.z);
  g.add(top);

  // Polarity stripe
  const stripeGeom = new THREE.BoxGeometry(0.3, height * 0.8, dia * 0.3);
  const stripe = new THREE.Mesh(stripeGeom, mat.whiteStripe);
  stripe.position.set(c.x + dia / 2 - 0.1, bodyGap + height / 2, c.z);
  g.add(stripe);

  // Straight leads down through pads
  addStraightLeads(g, pads, bodyGap, bt);

  return g;
}

// ============================================================
// LED — Dome shape
// ============================================================

function buildLED(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 5;
  const h = (p.height as number) || 8;
  const color = (p.color as string) || 'red';

  const c = padCenter(pads);
  const ledMat = (() => {
    switch (color) {
      case 'green':  return mat.ledGreen;
      case 'blue':   return mat.ledBlue;
      case 'yellow': return mat.ledYellow;
      case 'white':  return mat.ledWhite;
      case 'orange': return mat.ledOrange;
      default:       return mat.ledRed;
    }
  })();

  const bodyGap = 1.0;

  // Bottom cylinder
  const cylGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, h * 0.6, 20);
  const cyl = new THREE.Mesh(cylGeom, ledMat);
  cyl.position.set(c.x, bodyGap + h * 0.3, c.z);
  g.add(cyl);

  // Dome top
  const domeGeom = new THREE.SphereGeometry(dia / 2, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeom, ledMat);
  dome.position.set(c.x, bodyGap + h * 0.6, c.z);
  g.add(dome);

  // Flat bottom
  const flatGeom = new THREE.CircleGeometry(dia / 2, 20);
  flatGeom.rotateX(Math.PI / 2);
  const flat = new THREE.Mesh(flatGeom, mat.plastic);
  flat.position.set(c.x, bodyGap, c.z);
  g.add(flat);

  // Straight leads down through pads
  addStraightLeads(g, pads, bodyGap, bt);

  return g;
}

// ============================================================
// Transistor TO-92
// ============================================================

function buildTO92(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const w = (p.bodyWidth as number) || 4.5;
  const h = (p.bodyHeight as number) || 4.5;

  const c = padCenter(pads);
  const bodyGap = 1.5;
  const r = w / 2;

  // D-shaped cross-section: flat face in front (-Z), curved back (+Z)
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);                            // bottom-left of flat face
  shape.lineTo(r, 0);                             // bottom-right of flat face
  // Semicircular back (from right to left at +Z side)
  const segments = 20;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI;  // 0 → PI
    shape.lineTo(r * Math.cos(angle), r * Math.sin(angle));
  }
  shape.lineTo(-r, 0); // close

  // Extrude upward (along Y via rotation)
  const extrudeSettings = { depth: h, bevelEnabled: false };
  const bodyGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // Shape is in XY, extrude along Z → rotate so extrude axis = Y
  bodyGeom.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, mat.plastic);
  body.position.set(c.x, bodyGap, c.z);
  g.add(body);

  // Marking dot on flat face for pin-1 indicator
  // Flat face is at Z = c.z (facing +Z); dot sits just in front of it.
  const dotGeom = new THREE.CircleGeometry(0.4, 8);
  const dotMat = new THREE.MeshStandardMaterial({ color: '#ccc', roughness: 0.5 });
  const dot = new THREE.Mesh(dotGeom, dotMat);
  dot.position.set(c.x - r * 0.5, bodyGap + h - 0.8, c.z + 0.06);
  g.add(dot);

  // Leads emerge from the bottom of the flat face and bend outward to pad holes.
  // The flat face bottom is at Y=bodyGap, Z=c.z (front face).
  // Space the exit points evenly within the body width.
  const padCount = pads.length;
  for (let i = 0; i < padCount; i++) {
    const pad = pads[i];
    // Exit X spread across body — clamped within body radius
    const exitSpread = Math.min(r * 0.8, (padCount > 1 ? (padCount - 1) * 0.8 : 0));
    const exitX = padCount > 1
      ? c.x - exitSpread + (i / (padCount - 1)) * exitSpread * 2
      : c.x;
    const exitPt = new THREE.Vector3(exitX, bodyGap, c.z);
    g.add(bentLead(exitPt, pad.x, pad.z, bt, LEAD_R));
    g.add(solderBlob(pad.x, pad.z, bt));
  }

  return g;
}

// ============================================================
// IC DIP — Body elevated on legs
// ============================================================

function buildDIP(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const pinCount = (p.pinCount as number) || 8;
  const bodyW = (p.bodyWidth as number) || 6.35;
  const bodyL = (p.bodyLength as number) || 9.4;
  const pinSpacing = (p.pinSpacing as number) || 2.54;
  const rowSpacing = (p.rowSpacing as number) || 7.62;
  const pinsPerSide = pinCount / 2;

  // Find bounds of pads to centre the body
  const c = padCenter(pads);
  const bodyH = 3;
  const legHeight = 2; // body elevated 2mm on legs

  // Body
  const bodyGeom = new THREE.BoxGeometry(rowSpacing, bodyH, bodyL);
  const body = new THREE.Mesh(bodyGeom, mat.icBody);
  body.position.set(c.x, legHeight + bodyH / 2, c.z);
  g.add(body);

  // Pin-1 notch
  const notchGeom = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI);
  const notchMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.5 });
  const notch = new THREE.Mesh(notchGeom, notchMat);
  notch.position.set(c.x, legHeight + bodyH + 0.1, c.z - bodyL / 2 + 1.5);
  notch.rotation.x = -Math.PI / 2;
  g.add(notch);

  // Label texture
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#333333';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#aaaaaa';
  ctx.font = '24px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`DIP-${pinCount}`, 64, 40);
  const labelTexture = new THREE.CanvasTexture(canvas);
  const labelMat = new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.5 });
  const labelGeom = new THREE.PlaneGeometry(rowSpacing * 0.8, bodyL * 0.4);
  const label = new THREE.Mesh(labelGeom, labelMat);
  label.position.set(c.x, legHeight + bodyH + 0.1, c.z);
  label.rotation.x = -Math.PI / 2;
  g.add(label);

  // IC legs: bent from body sides down to pad holes
  // Left row pads are those with smallest X, right row with largest X
  const leftX = Math.min(...pads.map(pp => pp.x));
  const rightX = Math.max(...pads.map(pp => pp.x));
  const bodyLeftEdge = c.x - rowSpacing / 2;
  const bodyRightEdge = c.x + rowSpacing / 2;

  for (const pad of pads) {
    const isLeft = Math.abs(pad.x - leftX) < 0.1;
    const exitX = isLeft ? bodyLeftEdge : bodyRightEdge;
    const exitPt = new THREE.Vector3(exitX, legHeight, pad.z);
    g.add(bentLead(exitPt, pad.x, pad.z, bt, 0.25));
    g.add(solderBlob(pad.x, pad.z, bt));
  }

  return g;
}

// ============================================================
// Pin Header
// ============================================================

function buildPinHeader(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const pins = (p.pins as number) || pads.length || 2;
  const spacing = 2.54;

  const c = padCenter(pads);

  // Plastic housing sits on board
  const housingLen = pins * spacing;
  const housingH = 2.5;
  const housingGeom = new THREE.BoxGeometry(spacing, housingH, housingLen);
  const housing = new THREE.Mesh(housingGeom, mat.plastic);
  housing.position.set(c.x, housingH / 2, c.z);
  g.add(housing);

  // Each pin: extends above housing and below through board
  for (const pad of pads) {
    // Upper pin stub (above housing)
    const upperH = 6;
    const pinGeom = new THREE.BoxGeometry(0.5, upperH + housingH, 0.5);
    const pin = new THREE.Mesh(pinGeom, mat.lead);
    pin.position.set(pad.x, (upperH + housingH) / 2 - 0.5, pad.z);
    g.add(pin);

    // Lower pin through board
    g.add(straightLead(0, pad.x, pad.z, bt, 0.25));
    g.add(solderBlob(pad.x, pad.z, bt));
  }

  return g;
}

// ============================================================
// Crystal
// ============================================================

function buildCrystal(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const w = (p.width as number) || 11;
  const h = (p.height as number) || 4.5;
  const depth = 3.5;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 5.08, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const bodyGap = 1.5;

  // HC-49S style: elongated metal can with rounded ends
  const mainLen = w - depth;
  const bodyGeom = new THREE.BoxGeometry(mainLen, h, depth);
  const body = new THREE.Mesh(bodyGeom, mat.metalCan);
  body.position.set(cx, bodyGap + h / 2, cz);
  g.add(body);

  // Rounded end caps
  const capR = depth / 2;
  for (const sign of [-1, 1]) {
    const capGeom = new THREE.CylinderGeometry(capR, capR, h, 12);
    const cap = new THREE.Mesh(capGeom, mat.metalCan);
    cap.position.set(cx + sign * mainLen / 2, bodyGap + h / 2, cz);
    g.add(cap);
  }

  // Embossed frequency marking line on top
  const lineGeom = new THREE.BoxGeometry(mainLen * 0.6, 0.1, 0.4);
  const lineMat = new THREE.MeshStandardMaterial({ color: '#aaa', roughness: 0.4, metalness: 0.6 });
  const line = new THREE.Mesh(lineGeom, lineMat);
  line.position.set(cx, bodyGap + h + 0.05, cz);
  g.add(line);

  // Bent leads from body bottom to pad holes
  g.add(bentLead(new THREE.Vector3(cx - w * 0.2, bodyGap, cz), p0.x, p0.z, bt));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + w * 0.2, bodyGap, cz), p1.x, p1.z, bt));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Switch
// ============================================================

function buildSwitch(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const w = (p.width as number) || 6;
  const h = (p.height as number) || 3.5;

  const c = padCenter(pads);

  // Body sits on board
  const bodyGeom = new THREE.BoxGeometry(w, h, w);
  const body = new THREE.Mesh(bodyGeom, mat.plastic);
  body.position.set(c.x, h / 2 + 0.3, c.z);
  g.add(body);

  // Button on top
  const btnGeom = new THREE.CylinderGeometry(1.5, 1.5, 1, 16);
  const btn = new THREE.Mesh(btnGeom, mat.buttonGrey);
  btn.position.set(c.x, h + 1, c.z);
  g.add(btn);

  // Straight leads
  addStraightLeads(g, pads, 0.3, bt);

  return g;
}

// ============================================================
// Potentiometer
// ============================================================

function buildPotentiometer(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 9;
  const h = (p.height as number) || 6;

  const c = padCenter(pads);
  const bodyGap = 0.5;

  // Body cylinder
  const bodyGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, h, 20);
  const body = new THREE.Mesh(bodyGeom, mat.blueBody);
  body.position.set(c.x, bodyGap + h / 2, c.z);
  g.add(body);

  // Shaft
  const shaftGeom = new THREE.CylinderGeometry(1, 1, 8, 12);
  const shaft = new THREE.Mesh(shaftGeom, mat.lead);
  shaft.position.set(c.x, bodyGap + h + 4, c.z);
  g.add(shaft);

  // Leads — some potentiometers have 3 pads in a triangle
  // Use bent leads from body bottom for pads not directly under body
  const exitY = bodyGap;
  for (const pad of pads) {
    const dx = Math.abs(pad.x - c.x);
    const dz = Math.abs(pad.z - c.z);
    if (dx < 0.5 && dz < 0.5) {
      // Pad directly under body centre — straight lead
      g.add(straightLead(exitY, pad.x, pad.z, bt));
    } else {
      // Pad offset from body — bent lead
      g.add(bentLead(new THREE.Vector3(pad.x, exitY + 0.5, pad.z), pad.x, pad.z, bt));
    }
    g.add(solderBlob(pad.x, pad.z, bt));
  }

  return g;
}

// ============================================================
// Inductor
// ============================================================

function buildInductor(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyLen = (p.bodyLength as number) || 8;
  const bodyDia = (p.bodyDiameter as number) || 4;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 10.16, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;

  const clearance = 1.0;
  const by = clearance + bodyDia / 2;

  // Main body cylinder (along X axis)
  const bodyGeom = new THREE.CylinderGeometry(bodyDia / 2, bodyDia / 2, bodyLen, 16);
  bodyGeom.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, mat.darkGreen);
  body.position.set(cx, by, cz);
  g.add(body);

  // Coil windings — thin torus rings wrapped around the body
  const coilMat = new THREE.MeshStandardMaterial({ color: '#b87333', roughness: 0.3, metalness: 0.7 });
  const windingCount = 10;
  const windingSpan = bodyLen * 0.8;
  const startX = cx - windingSpan / 2;
  for (let i = 0; i < windingCount; i++) {
    const wx = startX + (i / (windingCount - 1)) * windingSpan;
    const coilGeom = new THREE.TorusGeometry(bodyDia / 2 + 0.15, 0.2, 6, 16);
    coilGeom.rotateY(Math.PI / 2); // ring around X axis
    const coil = new THREE.Mesh(coilGeom, coilMat);
    coil.position.set(wx, by, cz);
    g.add(coil);
  }

  // End caps — slightly wider discs at body ends
  const capMat = new THREE.MeshStandardMaterial({ color: '#1a3d1a', roughness: 0.5 });
  for (const sign of [-1, 1]) {
    const capGeom = new THREE.CylinderGeometry(bodyDia / 2 + 0.3, bodyDia / 2 + 0.3, 0.5, 16);
    capGeom.rotateZ(Math.PI / 2);
    const cap = new THREE.Mesh(capGeom, capMat);
    cap.position.set(cx + sign * bodyLen / 2, by, cz);
    g.add(cap);
  }

  // Bent leads from body ends to pad holes
  g.add(bentLead(new THREE.Vector3(cx - bodyLen / 2, by, cz), p0.x, p0.z, bt, LEAD_R));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + bodyLen / 2, by, cz), p1.x, p1.z, bt, LEAD_R));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// TO-220 Voltage Regulator
// ============================================================

function buildTO220(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyW = (p.bodyWidth as number) || 10;
  const bodyH = (p.bodyHeight as number) || 10;
  const bodyD = (p.bodyDepth as number) || 4.5;

  const c = padCenter(pads);
  const bodyGap = 1.0;

  // Main plastic body
  const mainGeom = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const main = new THREE.Mesh(mainGeom, mat.to220Body);
  main.position.set(c.x, bodyGap + bodyH / 2, c.z);
  g.add(main);

  // Metal tab extending above body
  const tabH = 5;
  const tabGeom = new THREE.BoxGeometry(bodyW, tabH, 0.8);
  const tab = new THREE.Mesh(tabGeom, mat.to220Tab);
  tab.position.set(c.x, bodyGap + bodyH + tabH / 2 - 0.5, c.z - bodyD / 2 + 0.4);
  g.add(tab);

  // Mounting hole in tab
  const ringGeom = new THREE.TorusGeometry(1.5, 0.3, 8, 16);
  const ring = new THREE.Mesh(ringGeom, mat.to220Tab);
  ring.position.set(c.x, bodyGap + bodyH + tabH / 2 - 0.5, c.z - bodyD / 2 + 0.5);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  // Straight leads from bottom through pads
  addStraightLeads(g, pads, bodyGap, bt);

  return g;
}

// ============================================================
// Buzzer
// ============================================================

function buildBuzzer(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 12;
  const h = (p.height as number) || 7;

  const c = padCenter(pads);
  const bodyGap = 0.5;

  // Cylindrical body
  const bodyGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, h, 24);
  const body = new THREE.Mesh(bodyGeom, mat.plastic);
  body.position.set(c.x, bodyGap + h / 2, c.z);
  g.add(body);

  // Top disc
  const topGeom = new THREE.CylinderGeometry(dia / 2 - 0.2, dia / 2, 0.5, 24);
  const top = new THREE.Mesh(topGeom, mat.buttonGrey);
  top.position.set(c.x, bodyGap + h + 0.25, c.z);
  g.add(top);

  // Sound hole
  const holeGeom = new THREE.CylinderGeometry(1.5, 1.5, 0.6, 12);
  const holeMesh = new THREE.Mesh(holeGeom, mat.plastic);
  holeMesh.position.set(c.x, bodyGap + h + 0.35, c.z);
  g.add(holeMesh);

  // Polarity marker (small white dot for + pin)
  const dotGeom = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 8);
  const dot = new THREE.Mesh(dotGeom, mat.whiteStripe);
  dot.position.set(c.x + dia / 3, bodyGap + h + 0.4, c.z);
  g.add(dot);

  // Straight leads
  addStraightLeads(g, pads, bodyGap, bt);

  return g;
}

// ============================================================
// Screw Terminal
// ============================================================

function buildScrewTerminal(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const pinCount = (p.pins as number) || pads.length || 2;
  const c = padCenter(pads);
  const h = 8;
  const termW = pinCount * 5;

  // Main housing
  const housingGeom = new THREE.BoxGeometry(termW, h, 7);
  const housing = new THREE.Mesh(housingGeom, mat.blueBody);
  housing.position.set(c.x, h / 2 + 0.3, c.z);
  g.add(housing);

  // Screw heads and wire entry for each pin
  for (const pad of pads) {
    // Screw head
    const screwGeom = new THREE.CylinderGeometry(1.8, 1.8, 1, 12);
    const screw = new THREE.Mesh(screwGeom, mat.lead);
    screw.position.set(pad.x, h + 0.8, pad.z);
    g.add(screw);

    // Screw slot
    const slotGeom = new THREE.BoxGeometry(2.5, 0.15, 0.4);
    const slot = new THREE.Mesh(slotGeom, mat.plastic);
    slot.position.set(pad.x, h + 1.3, pad.z);
    g.add(slot);

    // Wire entry (front face)
    const entryGeom = new THREE.BoxGeometry(2.5, 2.5, 0.3);
    const entryMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.3 });
    const entry = new THREE.Mesh(entryGeom, entryMat);
    entry.position.set(pad.x, h * 0.45, c.z + 3.6);
    g.add(entry);
  }

  addStraightLeads(g, pads, 0.3, bt);

  return g;
}

// ============================================================
// Tactile Push Button (4-pin)
// ============================================================

function buildTactileSwitch(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const size = (p.size as number) || 6;
  const h = (p.height as number) || 3.5;

  const c = padCenter(pads);

  // Main body
  const bodyGeom = new THREE.BoxGeometry(size, h, size);
  const body = new THREE.Mesh(bodyGeom, mat.plastic);
  body.position.set(c.x, h / 2 + 0.3, c.z);
  g.add(body);

  // Button circle on top
  const btnGeom = new THREE.CylinderGeometry(1.7, 1.7, 1.2, 16);
  const btn = new THREE.Mesh(btnGeom, mat.buttonGrey);
  btn.position.set(c.x, h + 0.9, c.z);
  g.add(btn);

  // Bent legs from body edges to pad holes
  for (const pad of pads) {
    const exitX = pad.x < c.x ? c.x - size / 2 : c.x + size / 2;
    const exitZ = pad.z < c.z ? c.z - size / 2 : c.z + size / 2;
    const exitPt = new THREE.Vector3(exitX, 0.3, exitZ);
    g.add(bentLead(exitPt, pad.x, pad.z, bt, 0.25));
    g.add(solderBlob(pad.x, pad.z, bt));
  }

  return g;
}

// ============================================================
// Resistor Box — SMD-style or SIP box resistor package
// ============================================================

function buildResistorBox(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyW = (p.bodyWidth as number) || 5;
  const bodyH = (p.bodyHeight as number) || 3;
  const bodyD = (p.bodyDepth as number) || 2.5;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 10.16, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const bodyGap = 0.5;

  // Rectangular body
  const bodyGeom = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const body = new THREE.Mesh(bodyGeom, mat.resistorBoxBody);
  body.position.set(cx, bodyGap + bodyH / 2, cz);
  g.add(body);

  // Value text on top
  const textGeom = new THREE.PlaneGeometry(bodyW * 0.6, bodyD * 0.3);
  const text = new THREE.Mesh(textGeom, mat.resistorBoxText);
  text.position.set(cx, bodyGap + bodyH + 0.05, cz);
  text.rotation.x = -Math.PI / 2;
  g.add(text);

  // Straight leads
  addStraightLeads(g, pads, bodyGap, bt);

  return g;
}

// ============================================================
// Film / Box Capacitor — Rectangular box body with leads
// ============================================================

function buildFilmCap(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyW = (p.bodyWidth as number) || 7;
  const bodyH = (p.bodyHeight as number) || 7.5;
  const bodyD = (p.bodyDepth as number) || 3.5;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 10.16, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const bodyGap = 0.5;

  // Rectangular body
  const bodyGeom = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const body = new THREE.Mesh(bodyGeom, mat.filmCapBody);
  body.position.set(cx, bodyGap + bodyH / 2, cz);
  g.add(body);

  // Text stripe on front face
  const stripeGeom = new THREE.PlaneGeometry(bodyW * 0.8, bodyH * 0.15);
  const stripe = new THREE.Mesh(stripeGeom, mat.filmCapText);
  stripe.position.set(cx, bodyGap + bodyH * 0.65, cz + bodyD / 2 + 0.05);
  g.add(stripe);

  // Second stripe
  const stripe2Geom = new THREE.PlaneGeometry(bodyW * 0.6, bodyH * 0.1);
  const stripe2 = new THREE.Mesh(stripe2Geom, mat.filmCapText);
  stripe2.position.set(cx, bodyGap + bodyH * 0.4, cz + bodyD / 2 + 0.05);
  g.add(stripe2);

  // Leads from body bottom to pads
  g.add(bentLead(new THREE.Vector3(cx - bodyW * 0.3, bodyGap, cz), p0.x, p0.z, bt));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + bodyW * 0.3, bodyGap, cz), p1.x, p1.z, bt));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Tantalum Capacitor — Drop / teardrop shaped body
// ============================================================

function buildTantalumCap(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyW = (p.bodyWidth as number) || 4;
  const bodyH = (p.bodyHeight as number) || 5;
  const bodyD = (p.bodyDepth as number) || 2.5;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 5.08, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const bodyGap = 0.5;

  // Teardrop / rounded box body
  const shape = new THREE.Shape();
  const hw = bodyW / 2;
  const hd = bodyD / 2;
  const r = Math.min(hw, hd) * 0.4;
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);

  const extrudeSettings = { depth: bodyH, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 3 };
  const bodyGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  bodyGeom.rotateX(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, mat.tantalumBody);
  body.position.set(cx, bodyGap, cz);
  g.add(body);

  // Polarity mark (+ side) - white stripe
  const markGeom = new THREE.BoxGeometry(0.3, bodyH * 0.7, bodyD * 0.8);
  const mark = new THREE.Mesh(markGeom, mat.tantalumMark);
  mark.position.set(cx - hw + 0.3, bodyGap + bodyH / 2, cz);
  g.add(mark);

  // Straight leads
  addStraightLeads(g, pads, bodyGap, bt);

  return g;
}

// ============================================================
// MLCC Radial Capacitor — Multilayer ceramic, small rectangular
// ============================================================

function buildMLCCCap(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyW = (p.bodyWidth as number) || 3.2;
  const bodyH = (p.bodyHeight as number) || 4;
  const bodyD = (p.bodyDepth as number) || 1.6;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 2.54, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const bodyGap = 0.8;

  // Small rectangular body standing vertical
  const bodyGeom = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const body = new THREE.Mesh(bodyGeom, mat.mlccBody);
  body.position.set(cx, bodyGap + bodyH / 2, cz);
  g.add(body);

  // Metal end caps (left and right)
  for (const sign of [-1, 1]) {
    const capGeom = new THREE.BoxGeometry(0.4, bodyH * 0.9, bodyD + 0.1);
    const cap = new THREE.Mesh(capGeom, mat.lead);
    cap.position.set(cx + sign * (bodyW / 2 - 0.1), bodyGap + bodyH / 2, cz);
    g.add(cap);
  }

  // Bent leads from bottom
  const exitLeft = new THREE.Vector3(cx - bodyW / 2 + 0.2, bodyGap, cz);
  const exitRight = new THREE.Vector3(cx + bodyW / 2 - 0.2, bodyGap, cz);
  g.add(bentLead(exitLeft, p0.x, p0.z, bt));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(exitRight, p1.x, p1.z, bt));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// LDR — Disc with transparent photosensitive window
// ============================================================

function buildLDR(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 5;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 5.08, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const bodyGap = 1.2;

  // Body disc (dark red ceramic)
  const bodyGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, 2.5, 20);
  const body = new THREE.Mesh(bodyGeom, mat.ldrBody);
  body.position.set(cx, bodyGap + 1.25, cz);
  g.add(body);

  // Photosensitive window (transparent reddish disc on top)
  const windowGeom = new THREE.CylinderGeometry(dia / 2 - 0.5, dia / 2 - 0.5, 0.5, 20);
  const window = new THREE.Mesh(windowGeom, mat.ldrWindow);
  window.position.set(cx, bodyGap + 2.75, cz);
  g.add(window);

  // Serpentine pattern on window (simplified as a cross)
  const patternMat = new THREE.MeshStandardMaterial({ color: '#660000', roughness: 0.5 });
  for (const rot of [0, Math.PI / 2]) {
    const lineGeom = new THREE.BoxGeometry(dia * 0.6, 0.08, 0.3);
    const line = new THREE.Mesh(lineGeom, patternMat);
    line.position.set(cx, bodyGap + 3.0, cz);
    line.rotation.y = rot;
    g.add(line);
  }

  // Bent leads from body bottom
  const exitY = bodyGap;
  g.add(bentLead(new THREE.Vector3(cx - dia * 0.25, exitY, cz), p0.x, p0.z, bt));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + dia * 0.25, exitY, cz), p1.x, p1.z, bt));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// NTC Bead — Small disc/bead thermistor
// ============================================================

function buildNTCBead(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 4;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 5.08, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const bodyGap = 1.0;

  // Small bead body (sphere-like disc)
  const bodyGeom = new THREE.SphereGeometry(dia / 2, 16, 12);
  const body = new THREE.Mesh(bodyGeom, mat.ntcBody);
  body.position.set(cx, bodyGap + dia / 2, cz);
  body.scale.set(1, 0.7, 1);
  g.add(body);

  // Bent leads
  const exitY = bodyGap;
  g.add(bentLead(new THREE.Vector3(cx - dia * 0.3, exitY, cz), p0.x, p0.z, bt));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + dia * 0.3, exitY, cz), p1.x, p1.z, bt));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Trimmer Potentiometer — Small top-adjust trimmer
// ============================================================

function buildTrimmer(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const size = (p.size as number) || 6.5;
  const h = (p.height as number) || 4.5;

  const c = padCenter(pads);
  const bodyGap = 0.5;

  // Square body
  const bodyGeom = new THREE.BoxGeometry(size, h, size);
  const body = new THREE.Mesh(bodyGeom, mat.trimmerBody);
  body.position.set(c.x, bodyGap + h / 2, c.z);
  g.add(body);

  // Adjustment screw on top (circular with slot)
  const screwGeom = new THREE.CylinderGeometry(size * 0.3, size * 0.3, 0.8, 16);
  const screw = new THREE.Mesh(screwGeom, mat.trimmerSlot);
  screw.position.set(c.x, bodyGap + h + 0.4, c.z);
  g.add(screw);

  // Screw slot
  const slotGeom = new THREE.BoxGeometry(size * 0.4, 0.15, 0.6);
  const slot = new THREE.Mesh(slotGeom, mat.plastic);
  slot.position.set(c.x, bodyGap + h + 0.8, c.z);
  g.add(slot);

  // Leads
  for (const pad of pads) {
    const dx = Math.abs(pad.x - c.x);
    const dz = Math.abs(pad.z - c.z);
    if (dx < 0.5 && dz < 0.5) {
      g.add(straightLead(bodyGap, pad.x, pad.z, bt));
    } else {
      g.add(bentLead(new THREE.Vector3(pad.x, bodyGap + 0.5, pad.z), pad.x, pad.z, bt));
    }
    g.add(solderBlob(pad.x, pad.z, bt));
  }

  return g;
}

// ============================================================
// Varistor — Disc with leads (like ceramic cap but with marking)
// ============================================================

function buildVaristor(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const dia = (p.diameter as number) || 7;
  const thickness = (p.thickness as number) || 4;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 5.08, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const elev = 1.5;
  const by = elev + dia / 2;

  // Disc body
  const bodyGeom = new THREE.CylinderGeometry(dia / 2, dia / 2, thickness, 20);
  bodyGeom.rotateX(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, mat.varistorBody);
  body.position.set(cx, by, cz);
  g.add(body);

  // Marking dot on face
  const dotGeom = new THREE.CircleGeometry(dia / 2 - 1, 16);
  const dotMat = new THREE.MeshStandardMaterial({ color: '#102040', roughness: 0.5 });
  const dot = new THREE.Mesh(dotGeom, dotMat);
  dot.position.set(cx, by, cz + thickness / 2 + 0.05);
  g.add(dot);

  // Leads
  const exitY = by - dia / 2 * 0.85;
  g.add(bentLead(new THREE.Vector3(cx - dia * 0.3, exitY, cz), p0.x, p0.z, bt));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + dia * 0.3, exitY, cz), p1.x, p1.z, bt));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Relay — Simple rectangular box
// ============================================================

function buildRelay(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();

  const bodyW = (p.bodyWidth as number) || 19;
  const bodyH = (p.bodyHeight as number) || 15;
  const bodyD = (p.bodyDepth as number) || 15;

  // Centre over footprint bounds
  const xs = pads.map(pp => pp.x);
  const zs = pads.map(pp => pp.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const bodyGap = 0.3;

  // Main body
  const bodyGeom = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const body = new THREE.Mesh(bodyGeom, mat.relayBody);
  body.position.set(cx, bodyGap + bodyH / 2, cz);
  g.add(body);

  // Label strip on top
  const labelGeom = new THREE.BoxGeometry(bodyW * 0.7, 0.15, bodyD * 0.35);
  const label = new THREE.Mesh(labelGeom, mat.relayLabel);
  label.position.set(cx, bodyGap + bodyH + 0.08, cz);
  g.add(label);

  // Pin-1 dot
  const dotGeom = new THREE.CircleGeometry(0.6, 8);
  const dot = new THREE.Mesh(dotGeom, mat.whiteStripe);
  dot.position.set(cx - bodyW / 2 + 1.5, bodyGap + bodyH + 0.1, cz - bodyD / 2 + 1.5);
  dot.rotation.x = -Math.PI / 2;
  g.add(dot);

  // Leads
  for (const pad of pads) {
    g.add(bentLead(new THREE.Vector3(pad.x, bodyGap, pad.z), pad.x, pad.z, bt, LEAD_R * 1.2));
    g.add(solderBlob(pad.x, pad.z, bt));
  }

  return g;
}

// ============================================================
// Bridge Rectifier — 4-pin inline or square package
// ============================================================

function buildBridgeRectifier(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyW = (p.bodyWidth as number) || 8;
  const bodyH = (p.bodyHeight as number) || 4;
  const bodyD = (p.bodyDepth as number) || 8;

  const c = padCenter(pads);
  const bodyGap = 0.5;

  // Body with rounded edges
  const bodyGeom = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
  const body = new THREE.Mesh(bodyGeom, mat.bridgeBody);
  body.position.set(c.x, bodyGap + bodyH / 2, c.z);
  g.add(body);

  // Plus mark on top
  const plusH = new THREE.BoxGeometry(bodyW * 0.3, 0.15, 0.4);
  const plusV = new THREE.BoxGeometry(0.4, 0.15, bodyW * 0.3);
  const plusMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
  const pH = new THREE.Mesh(plusH, plusMat);
  const pV = new THREE.Mesh(plusV, plusMat);
  pH.position.set(c.x - bodyW * 0.25, bodyGap + bodyH + 0.08, c.z);
  pV.position.set(c.x - bodyW * 0.25, bodyGap + bodyH + 0.08, c.z);
  g.add(pH);
  g.add(pV);

  // Wave symbol (~) simplified as small arc mark on top
  const waveMat = new THREE.MeshStandardMaterial({ color: '#cccccc', roughness: 0.5 });
  const waveGeom = new THREE.BoxGeometry(0.5, 0.15, bodyW * 0.25);
  const wave = new THREE.Mesh(waveGeom, waveMat);
  wave.position.set(c.x + bodyW * 0.25, bodyGap + bodyH + 0.08, c.z);
  g.add(wave);

  // Leads
  addStraightLeads(g, pads, bodyGap, bt);

  return g;
}

// ============================================================
// Fuse — Cylindrical glass body with metal end caps
// ============================================================

function buildFuse(p: Record<string, number | string>, pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const bodyLen = (p.bodyLength as number) || 8;
  const bodyDia = (p.bodyDiameter as number) || 3;

  const p0 = pads[0] ?? { x: 0, z: 0 };
  const p1 = pads[1] ?? { x: 10.16, z: 0 };
  const cx = (p0.x + p1.x) / 2;
  const cz = (p0.z + p1.z) / 2;
  const clearance = 1.5;
  const by = clearance + bodyDia / 2;

  // Glass body (transparent cylinder)
  const bodyGeom = new THREE.CylinderGeometry(bodyDia / 2, bodyDia / 2, bodyLen - 3, 16);
  bodyGeom.rotateZ(Math.PI / 2);
  const body = new THREE.Mesh(bodyGeom, mat.fuseBody);
  body.position.set(cx, by, cz);
  g.add(body);

  // Metal end caps
  for (const sign of [-1, 1]) {
    const capGeom = new THREE.CylinderGeometry(bodyDia / 2 + 0.2, bodyDia / 2 + 0.2, 1.5, 12);
    capGeom.rotateZ(Math.PI / 2);
    const cap = new THREE.Mesh(capGeom, mat.fuseCap);
    cap.position.set(cx + sign * (bodyLen / 2 - 0.75), by, cz);
    g.add(cap);
  }

  // Internal wire (thin line through center)
  const wireGeom = new THREE.CylinderGeometry(0.1, 0.1, bodyLen - 4, 6);
  wireGeom.rotateZ(Math.PI / 2);
  const wire = new THREE.Mesh(wireGeom, mat.fuseWire);
  wire.position.set(cx, by, cz);
  g.add(wire);

  // Bent leads
  g.add(bentLead(new THREE.Vector3(cx - bodyLen / 2, by, cz), p0.x, p0.z, bt, LEAD_R));
  g.add(solderBlob(p0.x, p0.z, bt));
  g.add(bentLead(new THREE.Vector3(cx + bodyLen / 2, by, cz), p1.x, p1.z, bt, LEAD_R));
  g.add(solderBlob(p1.x, p1.z, bt));

  return g;
}

// ============================================================
// Placeholder
// ============================================================

function buildPlaceholder(pads: PadPos3D[], bt: number): THREE.Group {
  const g = new THREE.Group();
  const c = padCenter(pads);

  const geom = new THREE.BoxGeometry(4, 4, 4);
  const m = new THREE.MeshStandardMaterial({ color: '#ff00ff', wireframe: true });
  const box = new THREE.Mesh(geom, m);
  box.position.set(c.x, 3, c.z);
  g.add(box);

  // Still add leads for any pads
  addStraightLeads(g, pads, 1, bt);

  return g;
}
