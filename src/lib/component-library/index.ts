// ============================================================
// Built-in Component Library — Standard electronic components
// ============================================================

import type { ComponentDefinition, FootprintPad, GridPosition } from '@/types';

let _cache: ComponentDefinition[] | null = null;

export function getBuiltInComponents(): ComponentDefinition[] {
  if (_cache) return _cache;
  _cache = [
    ...createResistors(),
    ...createCapacitors(),
    ...createInductors(),
    ...createDiodes(),
    ...createLEDs(),
    ...createTransistors(),
    ...createVoltageRegulators(),
    ...createICs(),
    ...createConnectors(),
    ...createSwitches(),
    ...createCrystals(),
    ...createMiscComponents(),
    ...createPowerSymbols(),
  ];
  return _cache;
}

/**
 * Look up a component by its library ID.
 * Pass the project's custom component list as second arg so custom parts are found too.
 */
export function getComponentById(id: string, customComponents?: ComponentDefinition[]): ComponentDefinition | undefined {
  return getBuiltInComponents().find((c) => c.id === id)
    ?? (customComponents ? customComponents.find((c) => c.id === id) : undefined);
}

/**
 * Two-pin component IDs whose footprint span can be adjusted via holeSpan.
 * For these, pad[0] stays at col=0 and pad[1] moves to col=(holeSpan-1).
 */
const TWO_PIN_ADJUSTABLE = new Set([
  'resistor_axial', 'capacitor_ceramic', 'capacitor_electrolytic',
  'capacitor_electrolytic_large', 'capacitor_film', 'capacitor_film_large',
  'capacitor_tantalum', 'capacitor_mlcc',
  'inductor', 'diode', 'crystal', 'switch_spst',
  'zener_diode', 'schottky_diode', 'buzzer',
  'ldr_photoresistor', 'ntc_thermistor', 'varistor', 'fuse_holder',
]);

/**
 * Return adjusted footprint pads and spanHoles for a component,
 * honouring an optional holeSpan override (number of holes the component stretches).
 *
 * For 2-pin adjustable components, the second pad's column is moved to holeSpan-1.
 * For all others, the library-default footprint is returned unchanged.
 */
export function getAdjustedFootprint(
  def: ComponentDefinition,
  holeSpan?: number | string,
): { pads: FootprintPad[]; spanHoles: GridPosition } {
  const basePads = def.footprint.pads;
  const baseSpan = def.footprint.spanHoles;

  if (!holeSpan || !TWO_PIN_ADJUSTABLE.has(def.id)) {
    return { pads: basePads, spanHoles: baseSpan };
  }

  const span = typeof holeSpan === 'string' ? parseInt(holeSpan, 10) : holeSpan;
  if (isNaN(span) || span < 2) {
    return { pads: basePads, spanHoles: baseSpan };
  }

  // Default span from library
  const defaultLastCol = basePads.length === 2
    ? basePads[1].gridPosition.col
    : baseSpan.col - 1;

  if (span - 1 === defaultLastCol) {
    // No change needed
    return { pads: basePads, spanHoles: baseSpan };
  }

  // Clone pads, adjusting the second pad's column
  const newPads: FootprintPad[] = basePads.map((p, i) => {
    if (i === 1) {
      return {
        ...p,
        gridPosition: { col: span - 1, row: p.gridPosition.row },
      };
    }
    return p;
  });

  const newSpan: GridPosition = {
    col: span,
    row: baseSpan.row,
  };

  return { pads: newPads, spanHoles: newSpan };
}

// ---- Resistors ----

function createResistors(): ComponentDefinition[] {
  return [
    {
      id: 'resistor_axial',
      name: 'Widerstand (Axial)',
      category: 'Resistors',
      description: 'Axial-Widerstand, 1/4W Standard',
      keywords: ['resistor', 'widerstand', 'R'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -7 }, end: { x: 20, y: 7 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 4, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [
          { type: 'rectangle', start: { col: 1, row: 0 }, end: { col: 3, row: 0 } },
        ],
        spanHoles: { col: 5, row: 1 },
      },
      model3d: {
        type: 'parametric',
        shape: 'resistor_axial',
        params: { bodyLength: 6.3, bodyDiameter: 2.5, leadDiameter: 0.6, leadSpacing: 10.16 },
      },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'R{ref} {1} {2} {value}' },
      defaultProperties: { value: '10kΩ', tolerance: '5%', power: '0.25W' },
      isBuiltIn: true,
    },
    {
      id: 'potentiometer',
      name: 'Potentiometer',
      category: 'Resistors',
      description: 'Drehpotentiometer, 3 Pins',
      keywords: ['pot', 'potentiometer', 'variable resistor'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -7 }, end: { x: 20, y: 7 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'polyline', points: [{ x: -5, y: -15 }, { x: 0, y: -7 }, { x: 5, y: -15 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'W', position: { x: 0, y: -30 }, length: 15, direction: 270, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 2 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 3 },
      },
      model3d: { type: 'parametric', shape: 'potentiometer', params: { diameter: 9, height: 6 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: 'R{ref}_1 {1} {2} {value}\nR{ref}_2 {2} {3} {value}' },
      defaultProperties: { value: '10kΩ' },
      isBuiltIn: true,
    },
  ];
}

// ---- Capacitors ----

function createCapacitors(): ComponentDefinition[] {
  return [
    {
      id: 'capacitor_ceramic',
      name: 'Kondensator (Keramik)',
      category: 'Capacitors',
      description: 'Keramik-Scheibenkondensator',
      keywords: ['capacitor', 'kondensator', 'ceramic', 'C'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -4, y: -12 }, end: { x: -4, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 44, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'capacitor_ceramic', params: { diameter: 5, thickness: 3 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'C{ref} {1} {2} {value}' },
      defaultProperties: { value: '100nF', voltage: '50V' },
      isBuiltIn: true,
    },
    {
      id: 'capacitor_electrolytic',
      name: 'Elko',
      category: 'Capacitors',
      description: 'Elektrolytkondensator (polarisiert)',
      keywords: ['electrolytic', 'elko', 'polarized', 'capacitor'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'arc', center: { x: -1, y: 0 }, radius: 12, startAngle: -90, endAngle: 90, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: -16, y: -8 }, text: '+', fontSize: 10, stroke: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '+', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '-', position: { x: 40, y: 0 }, length: 41, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'capacitor_electrolytic', params: { diameter: 5, height: 11, leadSpacing: 5.08 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'C{ref} {1} {2} {value}' },
      defaultProperties: { value: '100µF', voltage: '25V' },
      isBuiltIn: true,
    },
    {
      id: 'capacitor_electrolytic_large',
      name: 'Elko (groß)',
      category: 'Capacitors',
      description: 'Großer Elektrolytkondensator (polarisiert)',
      keywords: ['electrolytic', 'elko', 'polarized', 'capacitor', 'large'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'arc', center: { x: -1, y: 0 }, radius: 12, startAngle: -90, endAngle: 90, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: -16, y: -8 }, text: '+', fontSize: 10, stroke: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '+', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '-', position: { x: 40, y: 0 }, length: 41, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 4, row: 4 },
      },
      model3d: { type: 'parametric', shape: 'capacitor_electrolytic', params: { diameter: 10, height: 16, leadSpacing: 7.62 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'C{ref} {1} {2} {value}' },
      defaultProperties: { value: '1000µF', voltage: '25V' },
      isBuiltIn: true,
    },
    // ---- Film / Box Capacitor ----
    {
      id: 'capacitor_film',
      name: 'Folienkondensator',
      category: 'Capacitors',
      description: 'Folienkondensator (MKT/MKP), Rastermaß 10mm',
      keywords: ['capacitor', 'film', 'folie', 'MKT', 'MKP', 'polyester', 'box'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -4, y: -12 }, end: { x: -4, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 44, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 4, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [
          { type: 'rectangle', start: { col: 1, row: 0 }, end: { col: 3, row: 0 } },
        ],
        spanHoles: { col: 5, row: 3 },
      },
      model3d: { type: 'parametric', shape: 'capacitor_film', params: { bodyWidth: 7, bodyHeight: 7.5, bodyDepth: 3.5 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'C{ref} {1} {2} {value}' },
      defaultProperties: { value: '100nF', voltage: '63V' },
      isBuiltIn: true,
    },
    {
      id: 'capacitor_film_large',
      name: 'Folienkondensator (groß)',
      category: 'Capacitors',
      description: 'Großer Folienkondensator (MKP), Rastermaß 15mm',
      keywords: ['capacitor', 'film', 'MKP', 'large', 'power', 'box', 'folie'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -4, y: -12 }, end: { x: -4, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 44, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 6, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [
          { type: 'rectangle', start: { col: 1, row: 0 }, end: { col: 5, row: 0 } },
        ],
        spanHoles: { col: 7, row: 4 },
      },
      model3d: { type: 'parametric', shape: 'capacitor_film', params: { bodyWidth: 11, bodyHeight: 11, bodyDepth: 5 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'C{ref} {1} {2} {value}' },
      defaultProperties: { value: '1µF', voltage: '400V' },
      isBuiltIn: true,
    },
    // ---- Tantalum Capacitor ----
    {
      id: 'capacitor_tantalum',
      name: 'Tantal-Kondensator',
      category: 'Capacitors',
      description: 'Tantal-Elektrolytkondensator (polarisiert)',
      keywords: ['tantalum', 'tantal', 'capacitor', 'polarized', 'kondensator'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'arc', center: { x: -1, y: 0 }, radius: 12, startAngle: -90, endAngle: 90, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: -16, y: -8 }, text: '+', fontSize: 10, stroke: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '+', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '-', position: { x: 40, y: 0 }, length: 41, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'capacitor_tantalum', params: { bodyWidth: 4, bodyHeight: 5, bodyDepth: 2.5 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'C{ref} {1} {2} {value}' },
      defaultProperties: { value: '10µF', voltage: '16V' },
      isBuiltIn: true,
    },
    // ---- MLCC Radial Capacitor ----
    {
      id: 'capacitor_mlcc',
      name: 'MLCC (radial)',
      category: 'Capacitors',
      description: 'Vielschicht-Keramikkondensator, radiale Bauform',
      keywords: ['mlcc', 'multilayer', 'ceramic', 'capacitor', 'vielschicht', 'SMD', 'radial'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -4, y: -12 }, end: { x: -4, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 44, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 2, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'capacitor_mlcc', params: { bodyWidth: 3.2, bodyHeight: 4, bodyDepth: 1.6 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'C{ref} {1} {2} {value}' },
      defaultProperties: { value: '100nF', voltage: '50V' },
      isBuiltIn: true,
    },
  ];
}

// ---- Inductors ----

function createInductors(): ComponentDefinition[] {
  return [
    {
      id: 'inductor',
      name: 'Spule',
      category: 'Inductors',
      description: 'Induktivität / Spule',
      keywords: ['inductor', 'spule', 'coil', 'L'],
      symbol: {
        graphics: [
          { type: 'arc', center: { x: -15, y: 0 }, radius: 5, startAngle: 0, endAngle: 180, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'arc', center: { x: -5, y: 0 }, radius: 5, startAngle: 0, endAngle: 180, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'arc', center: { x: 5, y: 0 }, radius: 5, startAngle: 0, endAngle: 180, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'arc', center: { x: 15, y: 0 }, radius: 5, startAngle: 0, endAngle: 180, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 4, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 5, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'inductor', params: { bodyLength: 8, bodyDiameter: 4 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'L{ref} {1} {2} {value}' },
      defaultProperties: { value: '10mH' },
      isBuiltIn: true,
    },
  ];
}

// ---- Diodes ----

function createDiodes(): ComponentDefinition[] {
  return [
    {
      id: 'diode',
      name: 'Diode',
      category: 'Diodes',
      description: 'Standard-Diode (z.B. 1N4148)',
      keywords: ['diode', 'D', 'rectifier'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 4, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'diode', params: { bodyLength: 4, bodyDiameter: 2 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_DEFAULT' },
      defaultProperties: { value: '1N4148' },
      isBuiltIn: true,
    },
    {
      id: 'zener_diode',
      name: 'Zener-Diode',
      category: 'Diodes',
      description: 'Zener-Diode (z.B. 1N4733, 5.1V)',
      keywords: ['zener', 'diode', 'voltage reference', 'regulator'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 6, y: -10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 10, y: 10 }, end: { x: 14, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 4, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'diode', params: { bodyLength: 4, bodyDiameter: 2.2 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_ZENER' },
      defaultProperties: { value: '1N4733 (5.1V)' },
      isBuiltIn: true,
    },
    {
      id: 'schottky_diode',
      name: 'Schottky-Diode',
      category: 'Diodes',
      description: 'Schottky-Diode (z.B. 1N5819)',
      keywords: ['schottky', 'diode', 'fast', 'low drop'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 7, y: -10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 7, y: -10 }, end: { x: 7, y: -7 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 10, y: 10 }, end: { x: 13, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 13, y: 10 }, end: { x: 13, y: 7 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 4, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'diode', params: { bodyLength: 5, bodyDiameter: 2.7 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_SCHOTTKY' },
      defaultProperties: { value: '1N5819' },
      isBuiltIn: true,
    },
    {
      id: 'diode_1n4007',
      name: 'Diode 1N4007',
      category: 'Diodes',
      description: 'Gleichrichterdiode 1N4007 (1000V, 1A)',
      keywords: ['diode', 'rectifier', '1N4007', 'power'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 4, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 5, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'diode', params: { bodyLength: 5.5, bodyDiameter: 2.7 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_DEFAULT' },
      defaultProperties: { value: '1N4007' },
      isBuiltIn: true,
    },
  ];
}

// ---- LEDs ----

function createLEDs(): ComponentDefinition[] {
  return [
    {
      id: 'led_standard',
      name: 'LED (5mm)',
      category: 'LEDs',
      description: 'Standard 5mm LED',
      keywords: ['led', 'light', 'LED'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 12, y: -14 }, end: { x: 20, y: -20 }, stroke: '#ffaa00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 18, y: -17 }, { x: 20, y: -20 }, { x: 17, y: -19 }], stroke: '#ffaa00', strokeWidth: 1, closed: true, fill: '#ffaa00' },
          { type: 'line', start: { x: 8, y: -18 }, end: { x: 16, y: -24 }, stroke: '#ffaa00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 14, y: -21 }, { x: 16, y: -24 }, { x: 13, y: -23 }], stroke: '#ffaa00', strokeWidth: 1, closed: true, fill: '#ffaa00' },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 2, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'led', params: { diameter: 5, height: 8, color: 'red' } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_LED' },
      defaultProperties: { value: 'Red', forwardVoltage: '2.0V', maxCurrent: '20mA' },
      isBuiltIn: true,
    },
    {
      id: 'led_green',
      name: 'LED (5mm, Grün)',
      category: 'LEDs',
      description: 'Grüne 5mm LED',
      keywords: ['led', 'light', 'green', 'grün'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 12, y: -14 }, end: { x: 20, y: -20 }, stroke: '#22ff22', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 18, y: -17 }, { x: 20, y: -20 }, { x: 17, y: -19 }], stroke: '#22ff22', strokeWidth: 1, closed: true, fill: '#22ff22' },
          { type: 'line', start: { x: 8, y: -18 }, end: { x: 16, y: -24 }, stroke: '#22ff22', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 14, y: -21 }, { x: 16, y: -24 }, { x: 13, y: -23 }], stroke: '#22ff22', strokeWidth: 1, closed: true, fill: '#22ff22' },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 2, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'led', params: { diameter: 5, height: 8, color: 'green' } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_LED' },
      defaultProperties: { value: 'Green', forwardVoltage: '2.2V', maxCurrent: '20mA' },
      isBuiltIn: true,
    },
    {
      id: 'led_blue',
      name: 'LED (5mm, Blau)',
      category: 'LEDs',
      description: 'Blaue 5mm LED',
      keywords: ['led', 'light', 'blue', 'blau'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 12, y: -14 }, end: { x: 20, y: -20 }, stroke: '#4488ff', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 18, y: -17 }, { x: 20, y: -20 }, { x: 17, y: -19 }], stroke: '#4488ff', strokeWidth: 1, closed: true, fill: '#4488ff' },
          { type: 'line', start: { x: 8, y: -18 }, end: { x: 16, y: -24 }, stroke: '#4488ff', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 14, y: -21 }, { x: 16, y: -24 }, { x: 13, y: -23 }], stroke: '#4488ff', strokeWidth: 1, closed: true, fill: '#4488ff' },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 2, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'led', params: { diameter: 5, height: 8, color: 'blue' } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_LED' },
      defaultProperties: { value: 'Blue', forwardVoltage: '3.2V', maxCurrent: '20mA' },
      isBuiltIn: true,
    },
    {
      id: 'led_yellow',
      name: 'LED (5mm, Gelb)',
      category: 'LEDs',
      description: 'Gelbe 5mm LED',
      keywords: ['led', 'light', 'yellow', 'gelb'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 12, y: -14 }, end: { x: 20, y: -20 }, stroke: '#ffdd00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 18, y: -17 }, { x: 20, y: -20 }, { x: 17, y: -19 }], stroke: '#ffdd00', strokeWidth: 1, closed: true, fill: '#ffdd00' },
          { type: 'line', start: { x: 8, y: -18 }, end: { x: 16, y: -24 }, stroke: '#ffdd00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 14, y: -21 }, { x: 16, y: -24 }, { x: 13, y: -23 }], stroke: '#ffdd00', strokeWidth: 1, closed: true, fill: '#ffdd00' },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 2, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'led', params: { diameter: 5, height: 8, color: 'yellow' } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_LED' },
      defaultProperties: { value: 'Yellow', forwardVoltage: '2.1V', maxCurrent: '20mA' },
      isBuiltIn: true,
    },
    {
      id: 'led_white',
      name: 'LED (5mm, Weiß)',
      category: 'LEDs',
      description: 'Weiße 5mm LED',
      keywords: ['led', 'light', 'white', 'weiß'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 12, y: -14 }, end: { x: 20, y: -20 }, stroke: '#ffffff', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 18, y: -17 }, { x: 20, y: -20 }, { x: 17, y: -19 }], stroke: '#ffffff', strokeWidth: 1, closed: true, fill: '#ffffff' },
          { type: 'line', start: { x: 8, y: -18 }, end: { x: 16, y: -24 }, stroke: '#ffffff', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 14, y: -21 }, { x: 16, y: -24 }, { x: 13, y: -23 }], stroke: '#ffffff', strokeWidth: 1, closed: true, fill: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 2, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'led', params: { diameter: 5, height: 8, color: 'white' } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_LED' },
      defaultProperties: { value: 'White', forwardVoltage: '3.3V', maxCurrent: '20mA' },
      isBuiltIn: true,
    },
    {
      id: 'led_3mm',
      name: 'LED (3mm)',
      category: 'LEDs',
      description: 'Kleine 3mm LED (Rot)',
      keywords: ['led', 'light', '3mm', 'small'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -10, y: -10 }, { x: 10, y: 0 }, { x: -10, y: 10 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 10, y: -10 }, end: { x: 10, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 12, y: -14 }, end: { x: 20, y: -20 }, stroke: '#ffaa00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 18, y: -17 }, { x: 20, y: -20 }, { x: 17, y: -19 }], stroke: '#ffaa00', strokeWidth: 1, closed: true, fill: '#ffaa00' },
          { type: 'line', start: { x: 8, y: -18 }, end: { x: 16, y: -24 }, stroke: '#ffaa00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 14, y: -21 }, { x: 16, y: -24 }, { x: 13, y: -23 }], stroke: '#ffaa00', strokeWidth: 1, closed: true, fill: '#ffaa00' },
        ],
        pins: [
          { number: '1', name: 'A', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'K', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 2, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'led', params: { diameter: 3, height: 5.5, color: 'red' } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'D{ref} {1} {2} D_LED' },
      defaultProperties: { value: 'Red 3mm', forwardVoltage: '2.0V', maxCurrent: '20mA' },
      isBuiltIn: true,
    },
  ];
}

// ---- Transistors ----

function createTransistors(): ComponentDefinition[] {
  return [
    {
      id: 'npn_transistor',
      name: 'NPN-Transistor',
      category: 'Transistors',
      description: 'NPN BJT (z.B. 2N2222, BC547)',
      keywords: ['transistor', 'npn', 'bjt', 'Q'],
      symbol: {
        graphics: [
          { type: 'circle', center: { x: 7, y: 0 }, radius: 20, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'line', start: { x: -10, y: 0 }, end: { x: 0, y: 0 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 0, y: -12 }, end: { x: 0, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 0, y: -6 }, end: { x: 20, y: -15 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 0, y: 6 }, end: { x: 20, y: 15 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'polyline', points: [{ x: 15, y: 14 }, { x: 20, y: 15 }, { x: 17, y: 11 }], stroke: '#2176B7', strokeWidth: 1, closed: true, fill: '#2176B7' },
        ],
        pins: [
          { number: '1', name: 'B', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'input' },
          { number: '2', name: 'C', position: { x: 20, y: -30 }, length: 15, direction: 90, electricalType: 'output' },
          { number: '3', name: 'E', position: { x: 20, y: 30 }, length: 15, direction: 270, electricalType: 'output' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'transistor_to92', params: { bodyWidth: 4.5, bodyHeight: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: 'Q{ref} {2} {1} {3} Q_NPN' },
      defaultProperties: { value: 'BC547' },
      isBuiltIn: true,
    },
    {
      id: 'pnp_transistor',
      name: 'PNP-Transistor',
      category: 'Transistors',
      description: 'PNP BJT (z.B. BC557)',
      keywords: ['transistor', 'pnp', 'bjt'],
      symbol: {
        graphics: [
          { type: 'circle', center: { x: 7, y: 0 }, radius: 20, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'line', start: { x: -10, y: 0 }, end: { x: 0, y: 0 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 0, y: -12 }, end: { x: 0, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 0, y: -6 }, end: { x: 20, y: -15 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'polyline', points: [{ x: 5, y: -11 }, { x: 2, y: -7 }, { x: 7, y: -8 }], stroke: '#2176B7', strokeWidth: 1, closed: true, fill: '#2176B7' },
          { type: 'line', start: { x: 0, y: 6 }, end: { x: 20, y: 15 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: 'B', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'input' },
          { number: '2', name: 'C', position: { x: 20, y: 30 }, length: 15, direction: 270, electricalType: 'output' },
          { number: '3', name: 'E', position: { x: 20, y: -30 }, length: 15, direction: 90, electricalType: 'output' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'transistor_to92', params: { bodyWidth: 4.5, bodyHeight: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: 'Q{ref} {2} {1} {3} Q_PNP' },
      defaultProperties: { value: 'BC557' },
      isBuiltIn: true,
    },
    {
      id: 'mosfet_n_channel',
      name: 'N-MOSFET',
      category: 'Transistors',
      description: 'N-Kanal MOSFET (z.B. 2N7000)',
      keywords: ['mosfet', 'n-channel', 'fet', 'transistor', '2N7000'],
      symbol: {
        graphics: [
          { type: 'circle', center: { x: 7, y: 0 }, radius: 20, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'line', start: { x: -10, y: 0 }, end: { x: 0, y: 0 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 0, y: -12 }, end: { x: 0, y: 12 }, stroke: '#2176B7', strokeWidth: 3 },
          { type: 'line', start: { x: 3, y: -10 }, end: { x: 3, y: -4 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 3, y: -1 }, end: { x: 3, y: 5 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 3, y: 6 }, end: { x: 3, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 3, y: -7 }, end: { x: 20, y: -7 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 3, y: 9 }, end: { x: 20, y: 9 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 20, y: -7 }, end: { x: 20, y: -15 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 20, y: 9 }, end: { x: 20, y: 15 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 3, y: 2 }, end: { x: 20, y: 2 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 20, y: 2 }, end: { x: 20, y: 9 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'polyline', points: [{ x: 7, y: -1 }, { x: 3, y: 2 }, { x: 7, y: 5 }], stroke: '#2176B7', strokeWidth: 1, closed: true, fill: '#2176B7' },
        ],
        pins: [
          { number: '1', name: 'G', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'input' },
          { number: '2', name: 'D', position: { x: 20, y: -30 }, length: 15, direction: 90, electricalType: 'passive' },
          { number: '3', name: 'S', position: { x: 20, y: 30 }, length: 15, direction: 270, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'transistor_to92', params: { bodyWidth: 4.5, bodyHeight: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: 'M{ref} {2} {1} {3} {3} NMOS' },
      defaultProperties: { value: '2N7000' },
      isBuiltIn: true,
    },
  ];
}

// ---- ICs ----

function createICs(): ComponentDefinition[] {
  return [
    {
      id: 'ic_555',
      name: 'NE555 Timer',
      category: 'ICs',
      description: 'NE555 Timer IC, DIP-8',
      keywords: ['555', 'timer', 'ne555', 'IC'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -30, y: -40 }, end: { x: 30, y: 40 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: '555', fontSize: 12, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'GND', position: { x: -60, y: 30 }, length: 30, direction: 0, electricalType: 'power_in' },
          { number: '2', name: 'TRIG', position: { x: -60, y: 10 }, length: 30, direction: 0, electricalType: 'input' },
          { number: '3', name: 'OUT', position: { x: 60, y: 10 }, length: 30, direction: 180, electricalType: 'output' },
          { number: '4', name: 'RESET', position: { x: -60, y: -10 }, length: 30, direction: 0, electricalType: 'input' },
          { number: '5', name: 'CTRL', position: { x: 60, y: -10 }, length: 30, direction: 180, electricalType: 'input' },
          { number: '6', name: 'THR', position: { x: -60, y: -30 }, length: 30, direction: 0, electricalType: 'input' },
          { number: '7', name: 'DISCH', position: { x: 60, y: -30 }, length: 30, direction: 180, electricalType: 'output' },
          { number: '8', name: 'VCC', position: { x: 60, y: 30 }, length: 30, direction: 180, electricalType: 'power_in' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 0, row: 1 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 0, row: 2 }, shape: 'circle' },
          { number: '4', gridPosition: { col: 0, row: 3 }, shape: 'circle' },
          { number: '5', gridPosition: { col: 3, row: 3 }, shape: 'circle' },
          { number: '6', gridPosition: { col: 3, row: 2 }, shape: 'circle' },
          { number: '7', gridPosition: { col: 3, row: 1 }, shape: 'circle' },
          { number: '8', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [
          { type: 'rectangle', start: { col: 0, row: 0 }, end: { col: 3, row: 3 } },
        ],
        spanHoles: { col: 4, row: 4 },
      },
      model3d: { type: 'parametric', shape: 'ic_dip', params: { pinCount: 8, bodyWidth: 6.35, bodyLength: 9.4, pinSpacing: 2.54, rowSpacing: 7.62 } },
      pinMapping: { '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8' },
      spice: { template: '* {ref} NE555\nX{ref} {1} {2} {3} {4} {5} {6} {7} {8} NE555' },
      defaultProperties: { value: 'NE555' },
      isBuiltIn: true,
    },
    {
      id: 'ic_opamp',
      name: 'Operationsverstärker',
      category: 'ICs',
      description: 'Standard OpAmp (z.B. LM741, LM358)',
      keywords: ['opamp', 'op-amp', 'operational amplifier', 'IC'],
      symbol: {
        graphics: [
          { type: 'polyline', points: [{ x: -20, y: -25 }, { x: 25, y: 0 }, { x: -20, y: 25 }], stroke: '#2176B7', strokeWidth: 2, closed: true },
          { type: 'text', position: { x: -15, y: -12 }, text: '+', fontSize: 10, stroke: '#2176B7' },
          { type: 'text', position: { x: -15, y: 8 }, text: '−', fontSize: 10, stroke: '#2176B7' },
        ],
        pins: [
          { number: '2', name: 'IN+', position: { x: -60, y: -12 }, length: 40, direction: 0, electricalType: 'input' },
          { number: '3', name: 'IN-', position: { x: -60, y: 12 }, length: 40, direction: 0, electricalType: 'input' },
          { number: '6', name: 'OUT', position: { x: 60, y: 0 }, length: 35, direction: 180, electricalType: 'output' },
          { number: '7', name: 'V+', position: { x: 2, y: -40 }, length: 27, direction: 90, electricalType: 'power_in' },
          { number: '4', name: 'V-', position: { x: 2, y: 40 }, length: 27, direction: 270, electricalType: 'power_in' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 0, row: 1 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 0, row: 2 }, shape: 'circle' },
          { number: '4', gridPosition: { col: 0, row: 3 }, shape: 'circle' },
          { number: '5', gridPosition: { col: 3, row: 3 }, shape: 'circle' },
          { number: '6', gridPosition: { col: 3, row: 2 }, shape: 'circle' },
          { number: '7', gridPosition: { col: 3, row: 1 }, shape: 'circle' },
          { number: '8', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [{ type: 'rectangle', start: { col: 0, row: 0 }, end: { col: 3, row: 3 } }],
        spanHoles: { col: 4, row: 4 },
      },
      model3d: { type: 'parametric', shape: 'ic_dip', params: { pinCount: 8, bodyWidth: 6.35, bodyLength: 9.4, pinSpacing: 2.54, rowSpacing: 7.62 } },
      pinMapping: { '2': '2', '3': '3', '4': '4', '6': '6', '7': '7' },
      spice: { template: '* {ref} OpAmp\nX{ref} {2} {3} {7} {4} {6} LM741' },
      defaultProperties: { value: 'LM741' },
      isBuiltIn: true,
    },
    {
      id: 'ic_atmega328',
      name: 'ATmega328P',
      category: 'ICs',
      description: 'ATmega328P Mikrocontroller, DIP-28',
      keywords: ['atmega', 'arduino', 'microcontroller', 'avr'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -50, y: -100 }, end: { x: 50, y: 140 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: 'ATmega328P', fontSize: 8, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'PC6/RST', position: { x: -80, y: -90 }, length: 30, direction: 0, electricalType: 'bidirectional' },
          { number: '2', name: 'PD0/RXD', position: { x: -80, y: -70 }, length: 30, direction: 0, electricalType: 'bidirectional' },
          { number: '3', name: 'PD1/TXD', position: { x: -80, y: -50 }, length: 30, direction: 0, electricalType: 'bidirectional' },
          { number: '7', name: 'VCC', position: { x: -80, y: -30 }, length: 30, direction: 0, electricalType: 'power_in' },
          { number: '8', name: 'GND', position: { x: -80, y: -10 }, length: 30, direction: 0, electricalType: 'power_in' },
          { number: '9', name: 'XTAL1', position: { x: -80, y: 10 }, length: 30, direction: 0, electricalType: 'input' },
          { number: '10', name: 'XTAL2', position: { x: -80, y: 30 }, length: 30, direction: 0, electricalType: 'output' },
          { number: '14', name: 'PB0', position: { x: 80, y: -90 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '15', name: 'PB1', position: { x: 80, y: -70 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '16', name: 'PB2', position: { x: 80, y: -50 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '17', name: 'PB3/MOSI', position: { x: 80, y: -30 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '18', name: 'PB4/MISO', position: { x: 80, y: -10 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '19', name: 'PB5/SCK', position: { x: 80, y: 10 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '23', name: 'PC0/ADC0', position: { x: 80, y: 30 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '24', name: 'PC1/ADC1', position: { x: 80, y: 50 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '25', name: 'PC2/ADC2', position: { x: 80, y: 70 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '26', name: 'PC3/ADC3', position: { x: 80, y: 90 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '27', name: 'PC4/SDA', position: { x: 80, y: 110 }, length: 30, direction: 180, electricalType: 'bidirectional' },
          { number: '28', name: 'PC5/SCL', position: { x: 80, y: 130 }, length: 30, direction: 180, electricalType: 'bidirectional' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: Array.from({ length: 14 }, (_, i) => ({
          number: String(i + 1),
          gridPosition: { col: 0, row: i },
          shape: (i === 0 ? 'square' : 'circle') as 'square' | 'circle',
        })).concat(
          Array.from({ length: 14 }, (_, i) => ({
            number: String(28 - i),
            gridPosition: { col: 3, row: i },
            shape: 'circle' as const,
          }))
        ),
        silkscreen: [{ type: 'rectangle', start: { col: 0, row: 0 }, end: { col: 3, row: 13 } }],
        spanHoles: { col: 4, row: 14 },
      },
      model3d: { type: 'parametric', shape: 'ic_dip', params: { pinCount: 28, bodyWidth: 6.35, bodyLength: 34.8, pinSpacing: 2.54, rowSpacing: 7.62 } },
      pinMapping: Object.fromEntries(Array.from({ length: 28 }, (_, i) => [String(i + 1), String(i + 1)])),
      defaultProperties: { value: 'ATmega328P' },
      isBuiltIn: true,
    },
  ];
}

// ---- Connectors ----

function createConnectors(): ComponentDefinition[] {
  return [
    {
      id: 'pin_header_1',
      name: 'Pin Header 1-polig',
      category: 'Connectors',
      description: '1-Pin Header / Testpunkt, 2.54mm',
      keywords: ['header', 'pin', 'connector', 'testpoint', '1-pin', 'J'],
      symbol: {
        graphics: [
          { type: 'circle', center: { x: 0, y: 0 }, radius: 6, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 34, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 1, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 1, rows: 1 } },
      pinMapping: { '1': '1' },
      defaultProperties: { value: 'Conn_1' },
      isBuiltIn: true,
    },
    {
      id: 'pin_header_2',
      name: 'Pin Header 2-polig',
      category: 'Connectors',
      description: '2-Pin Header, 2.54mm',
      keywords: ['header', 'pin', 'connector', 'J'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -10, y: -18 }, end: { x: 10, y: 18 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: -40, y: 10 }, length: 30, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 0, row: 1 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 1, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 2, rows: 1 } },
      pinMapping: { '1': '1', '2': '2' },
      defaultProperties: { value: 'Conn_2' },
      isBuiltIn: true,
    },
    {
      id: 'pin_header_4',
      name: 'Pin Header 4-polig',
      category: 'Connectors',
      description: '4-Pin Header, 2.54mm',
      keywords: ['header', 'pin', 'connector'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -10, y: -38 }, end: { x: 10, y: 38 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -30 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: -40, y: -10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: -40, y: 10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '4', name: '4', position: { x: -40, y: 30 }, length: 30, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 0, row: 1 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 0, row: 2 }, shape: 'circle' },
          { number: '4', gridPosition: { col: 0, row: 3 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 1, row: 4 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 4, rows: 1 } },
      pinMapping: { '1': '1', '2': '2', '3': '3', '4': '4' },
      defaultProperties: { value: 'Conn_4' },
      isBuiltIn: true,
    },
    {
      id: 'pin_header_3',
      name: 'Pin Header 3-polig',
      category: 'Connectors',
      description: '3-Pin Header, 2.54mm',
      keywords: ['header', 'pin', 'connector', '3-pin'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -10, y: -28 }, end: { x: 10, y: 28 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -20 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: -40, y: 20 }, length: 30, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 0, row: 1 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 0, row: 2 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 1, row: 3 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 3, rows: 1 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      defaultProperties: { value: 'Conn_3' },
      isBuiltIn: true,
    },
    {
      id: 'pin_header_6',
      name: 'Pin Header 6-polig',
      category: 'Connectors',
      description: '6-Pin Header, 2.54mm',
      keywords: ['header', 'pin', 'connector', '6-pin'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -10, y: -58 }, end: { x: 10, y: 58 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -50 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: -40, y: -30 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: -40, y: -10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '4', name: '4', position: { x: -40, y: 10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '5', name: '5', position: { x: -40, y: 30 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '6', name: '6', position: { x: -40, y: 50 }, length: 30, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: Array.from({ length: 6 }, (_, i) => ({
          number: String(i + 1),
          gridPosition: { col: 0, row: i },
          shape: (i === 0 ? 'square' : 'circle') as 'square' | 'circle',
        })),
        silkscreen: [],
        spanHoles: { col: 1, row: 6 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 6, rows: 1 } },
      pinMapping: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i + 1), String(i + 1)])),
      defaultProperties: { value: 'Conn_6' },
      isBuiltIn: true,
    },
    {
      id: 'pin_header_8',
      name: 'Pin Header 8-polig',
      category: 'Connectors',
      description: '8-Pin Header, 2.54mm',
      keywords: ['header', 'pin', 'connector', '8-pin'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -10, y: -78 }, end: { x: 10, y: 78 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -70 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: -40, y: -50 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: -40, y: -30 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '4', name: '4', position: { x: -40, y: -10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '5', name: '5', position: { x: -40, y: 10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '6', name: '6', position: { x: -40, y: 30 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '7', name: '7', position: { x: -40, y: 50 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '8', name: '8', position: { x: -40, y: 70 }, length: 30, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: Array.from({ length: 8 }, (_, i) => ({
          number: String(i + 1),
          gridPosition: { col: 0, row: i },
          shape: (i === 0 ? 'square' : 'circle') as 'square' | 'circle',
        })),
        silkscreen: [],
        spanHoles: { col: 1, row: 8 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 8, rows: 1 } },
      pinMapping: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i + 1), String(i + 1)])),
      defaultProperties: { value: 'Conn_8' },
      isBuiltIn: true,
    },
    {
      id: 'screw_terminal_2',
      name: 'Schraubklemme 2-polig',
      category: 'Connectors',
      description: '2-Pin Schraubklemme, 5.08mm',
      keywords: ['screw', 'terminal', 'klemme', 'connector', 'power'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -10, y: -18 }, end: { x: 10, y: 18 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'circle', center: { x: 0, y: -10 }, radius: 4, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'circle', center: { x: 0, y: 10 }, radius: 4, stroke: '#2176B7', strokeWidth: 1.5 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -10 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: -40, y: 10 }, length: 30, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'screw_terminal', params: { pins: 2 } },
      pinMapping: { '1': '1', '2': '2' },
      defaultProperties: { value: 'Term_2' },
      isBuiltIn: true,
    },
    {
      id: 'screw_terminal_3',
      name: 'Schraubklemme 3-polig',
      category: 'Connectors',
      description: '3-Pin Schraubklemme, 5.08mm',
      keywords: ['screw', 'terminal', 'klemme', 'connector', '3-pin'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -10, y: -28 }, end: { x: 10, y: 28 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'circle', center: { x: 0, y: -20 }, radius: 4, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'circle', center: { x: 0, y: 0 }, radius: 4, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'circle', center: { x: 0, y: 20 }, radius: 4, stroke: '#2176B7', strokeWidth: 1.5 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -20 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: -40, y: 20 }, length: 30, direction: 0, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 4, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 5, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'screw_terminal', params: { pins: 3 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      defaultProperties: { value: 'Term_3' },
      isBuiltIn: true,
    },
  ];
}

// ---- Switches ----

function createSwitches(): ComponentDefinition[] {
  return [
    {
      id: 'switch_spst',
      name: 'Taster (SPST)',
      category: 'Switches',
      description: 'Einpoliger Taster',
      keywords: ['switch', 'taster', 'button', 'SW'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -15, y: 0 }, end: { x: -5, y: 0 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 5, y: 0 }, end: { x: 15, y: 0 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -5, y: 0 }, end: { x: 10, y: -10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'circle', center: { x: -5, y: 0 }, radius: 2, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'circle', center: { x: 5, y: 0 }, radius: 2, stroke: '#2176B7', strokeWidth: 1.5 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 25, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 25, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'switch', params: { width: 6, height: 3.5 } },
      pinMapping: { '1': '1', '2': '2' },
      defaultProperties: { value: 'SW' },
      isBuiltIn: true,
    },
    {
      id: 'tactile_switch',
      name: 'Taster (4-Pin)',
      category: 'Switches',
      description: '6×6mm Taktiler Taster, 4 Pins',
      keywords: ['tactile', 'taster', 'push button', 'button', '4-pin'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -15, y: -15 }, end: { x: 15, y: 15 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'circle', center: { x: 0, y: 0 }, radius: 5, stroke: '#2176B7', strokeWidth: 1.5 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: -10 }, length: 25, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: -10 }, length: 25, direction: 180, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: -40, y: 10 }, length: 25, direction: 0, electricalType: 'passive' },
          { number: '4', name: '4', position: { x: 40, y: 10 }, length: 25, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 0, row: 2 }, shape: 'circle' },
          { number: '4', gridPosition: { col: 2, row: 2 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 3 },
      },
      model3d: { type: 'parametric', shape: 'tactile_switch', params: { size: 6, height: 3.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3', '4': '4' },
      defaultProperties: { value: 'SW_Tact' },
      isBuiltIn: true,
    },
    {
      id: 'slide_switch',
      name: 'Schiebeschalter',
      category: 'Switches',
      description: 'Schiebeschalter SPDT (3-Pin)',
      keywords: ['slide', 'switch', 'schiebeschalter', 'SPDT'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: -15, y: 0 }, end: { x: -5, y: 0 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 5, y: -10 }, end: { x: 15, y: -10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 5, y: 10 }, end: { x: 15, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -5, y: 0 }, end: { x: 5, y: -10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'circle', center: { x: -5, y: 0 }, radius: 2, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'circle', center: { x: 5, y: -10 }, radius: 2, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'circle', center: { x: 5, y: 10 }, radius: 2, stroke: '#2176B7', strokeWidth: 1.5 },
        ],
        pins: [
          { number: '1', name: 'C', position: { x: -40, y: 0 }, length: 25, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'A', position: { x: 40, y: -10 }, length: 25, direction: 180, electricalType: 'passive' },
          { number: '3', name: 'B', position: { x: 40, y: 10 }, length: 25, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'switch', params: { width: 8, height: 3 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      defaultProperties: { value: 'SW_Slide' },
      isBuiltIn: true,
    },
  ];
}

// ---- Crystals ----

function createCrystals(): ComponentDefinition[] {
  return [
    {
      id: 'crystal',
      name: 'Quarz',
      category: 'Crystals',
      description: 'Quarzoszillator',
      keywords: ['crystal', 'quarz', 'oscillator', 'Y'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -5, y: -10 }, end: { x: 5, y: 10 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -10, y: -12 }, end: { x: -10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: 10, y: -12 }, end: { x: 10, y: 12 }, stroke: '#2176B7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'crystal', params: { width: 11, height: 4.5 } },
      pinMapping: { '1': '1', '2': '2' },
      defaultProperties: { value: '16MHz' },
      isBuiltIn: true,
    },
  ];
}

// ---- Voltage Regulators ----

function createVoltageRegulators(): ComponentDefinition[] {
  return [
    {
      id: 'reg_7805',
      name: '7805 Spannungsregler',
      category: 'Voltage Regulators',
      description: '+5V Festspannungsregler, TO-220',
      keywords: ['7805', 'voltage regulator', 'spannungsregler', '5V', 'LM7805'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -30, y: -20 }, end: { x: 30, y: 20 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: '7805', fontSize: 10, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'IN', position: { x: -60, y: 0 }, length: 30, direction: 0, electricalType: 'power_in' },
          { number: '2', name: 'GND', position: { x: 0, y: 40 }, length: 20, direction: 270, electricalType: 'power_in' },
          { number: '3', name: 'OUT', position: { x: 60, y: 0 }, length: 30, direction: 180, electricalType: 'power_out' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 3 },
      },
      model3d: { type: 'parametric', shape: 'voltage_regulator_to220', params: { bodyWidth: 10, bodyHeight: 10, bodyDepth: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: '* {ref} 7805 Voltage Regulator\nX{ref} {1} {2} {3} LM7805' },
      defaultProperties: { value: '7805 (+5V)' },
      isBuiltIn: true,
    },
    {
      id: 'reg_7812',
      name: '7812 Spannungsregler',
      category: 'Voltage Regulators',
      description: '+12V Festspannungsregler, TO-220',
      keywords: ['7812', 'voltage regulator', 'spannungsregler', '12V'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -30, y: -20 }, end: { x: 30, y: 20 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: '7812', fontSize: 10, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'IN', position: { x: -60, y: 0 }, length: 30, direction: 0, electricalType: 'power_in' },
          { number: '2', name: 'GND', position: { x: 0, y: 40 }, length: 20, direction: 270, electricalType: 'power_in' },
          { number: '3', name: 'OUT', position: { x: 60, y: 0 }, length: 30, direction: 180, electricalType: 'power_out' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 3 },
      },
      model3d: { type: 'parametric', shape: 'voltage_regulator_to220', params: { bodyWidth: 10, bodyHeight: 10, bodyDepth: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: '* {ref} 7812 Voltage Regulator\nX{ref} {1} {2} {3} LM7812' },
      defaultProperties: { value: '7812 (+12V)' },
      isBuiltIn: true,
    },
    {
      id: 'reg_7833',
      name: '78L33 Spannungsregler',
      category: 'Voltage Regulators',
      description: '+3.3V Festspannungsregler, TO-92',
      keywords: ['78L33', 'voltage regulator', '3.3V', 'LDO'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -30, y: -20 }, end: { x: 30, y: 20 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: '3.3V', fontSize: 10, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'IN', position: { x: -60, y: 0 }, length: 30, direction: 0, electricalType: 'power_in' },
          { number: '2', name: 'GND', position: { x: 0, y: 40 }, length: 20, direction: 270, electricalType: 'power_in' },
          { number: '3', name: 'OUT', position: { x: 60, y: 0 }, length: 30, direction: 180, electricalType: 'power_out' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'transistor_to92', params: { bodyWidth: 4.5, bodyHeight: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: '* {ref} 3.3V Regulator\nX{ref} {1} {2} {3} LM78L33' },
      defaultProperties: { value: '78L33 (+3.3V)' },
      isBuiltIn: true,
    },
    {
      id: 'reg_lm317',
      name: 'LM317 Regler',
      category: 'Voltage Regulators',
      description: 'Einstellbarer Spannungsregler, TO-220',
      keywords: ['lm317', 'adjustable', 'voltage regulator', 'variable'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -30, y: -20 }, end: { x: 30, y: 20 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: 'LM317', fontSize: 9, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'ADJ', position: { x: 0, y: 40 }, length: 20, direction: 270, electricalType: 'passive' },
          { number: '2', name: 'OUT', position: { x: 60, y: 0 }, length: 30, direction: 180, electricalType: 'power_out' },
          { number: '3', name: 'IN', position: { x: -60, y: 0 }, length: 30, direction: 0, electricalType: 'power_in' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 3 },
      },
      model3d: { type: 'parametric', shape: 'voltage_regulator_to220', params: { bodyWidth: 10, bodyHeight: 10, bodyDepth: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: '* {ref} LM317 Adjustable Regulator\nX{ref} {1} {2} {3} LM317' },
      defaultProperties: { value: 'LM317' },
      isBuiltIn: true,
    },
  ];
}

// ---- Misc / Sensors ----

function createMiscComponents(): ComponentDefinition[] {
  return [
    {
      id: 'buzzer',
      name: 'Piezo-Summer',
      category: 'Misc',
      description: 'Piezo-Summer / Buzzer',
      keywords: ['buzzer', 'summer', 'piezo', 'beeper', 'speaker'],
      symbol: {
        graphics: [
          { type: 'circle', center: { x: 0, y: 0 }, radius: 12, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: 'BZ', fontSize: 10, anchor: 'middle', stroke: '#ffffff' },
          { type: 'text', position: { x: -8, y: -5 }, text: '+', fontSize: 8, stroke: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '+', position: { x: -40, y: 0 }, length: 28, direction: 0, electricalType: 'passive' },
          { number: '2', name: '-', position: { x: 40, y: 0 }, length: 28, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 5, row: 5 },
      },
      model3d: { type: 'parametric', shape: 'buzzer', params: { diameter: 12, height: 7 } },
      pinMapping: { '1': '1', '2': '2' },
      defaultProperties: { value: 'Buzzer' },
      isBuiltIn: true,
    },
    {
      id: 'ldr_photoresistor',
      name: 'Fotowiderstand (LDR)',
      category: 'Misc',
      description: 'Lichtabhängiger Widerstand',
      keywords: ['ldr', 'photoresistor', 'fotowiderstand', 'light', 'sensor'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -7 }, end: { x: 20, y: 7 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -8, y: -18 }, end: { x: -2, y: -10 }, stroke: '#ffaa00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: -4, y: -12 }, { x: -2, y: -10 }, { x: 0, y: -13 }], stroke: '#ffaa00', strokeWidth: 1, closed: true, fill: '#ffaa00' },
          { type: 'line', start: { x: -4, y: -18 }, end: { x: 2, y: -10 }, stroke: '#ffaa00', strokeWidth: 1.5 },
          { type: 'polyline', points: [{ x: 0, y: -12 }, { x: 2, y: -10 }, { x: 4, y: -13 }], stroke: '#ffaa00', strokeWidth: 1, closed: true, fill: '#ffaa00' },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'ldr', params: { diameter: 5 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'R{ref} {1} {2} {value}' },
      defaultProperties: { value: '10kΩ (hell)' },
      isBuiltIn: true,
    },
    {
      id: 'ntc_thermistor',
      name: 'NTC-Thermistor',
      category: 'Misc',
      description: 'NTC-Thermistor (Temperatursensor)',
      keywords: ['ntc', 'thermistor', 'temperature', 'sensor', 'temperatur'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -7 }, end: { x: 20, y: 7 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -25, y: 12 }, end: { x: 25, y: -12 }, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'text', position: { x: 22, y: -16 }, text: 'ϑ−', fontSize: 8, stroke: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'ntc_bead', params: { diameter: 4 } },
      pinMapping: { '1': '1', '2': '2' },
      spice: { template: 'R{ref} {1} {2} {value}' },
      defaultProperties: { value: '10kΩ @ 25°C' },
      isBuiltIn: true,
    },
    {
      id: 'fuse_holder',
      name: 'Sicherungshalter',
      category: 'Misc',
      description: 'Sicherungshalter für 5x20mm Sicherungen',
      keywords: ['fuse', 'sicherung', 'holder', 'halter', 'protection'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -15, y: -5 }, end: { x: 15, y: 5 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -10, y: 0 }, end: { x: 10, y: 0 }, stroke: '#2176B7', strokeWidth: 1.5 },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 25, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 25, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 4, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 5, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'fuse', params: { bodyLength: 8, bodyDiameter: 3 } },
      pinMapping: { '1': '1', '2': '2' },
      defaultProperties: { value: '1A' },
      isBuiltIn: true,
    },
    {
      id: 'ir_receiver',
      name: 'IR-Empfänger',
      category: 'Misc',
      description: 'Infrarot-Empfänger (z.B. TSOP1738)',
      keywords: ['ir', 'infrared', 'infrarot', 'receiver', 'empfänger', 'remote'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -18 }, end: { x: 20, y: 18 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -4, y: -22 }, end: { x: 2, y: -14 }, stroke: '#ff4444', strokeWidth: 1.5 },
          { type: 'line', start: { x: 0, y: -22 }, end: { x: 6, y: -14 }, stroke: '#ff4444', strokeWidth: 1.5 },
          { type: 'text', position: { x: 0, y: 3 }, text: 'IR', fontSize: 10, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'OUT', position: { x: -50, y: -10 }, length: 30, direction: 0, electricalType: 'output' },
          { number: '2', name: 'GND', position: { x: -50, y: 10 }, length: 30, direction: 0, electricalType: 'power_in' },
          { number: '3', name: 'VCC', position: { x: 50, y: 0 }, length: 30, direction: 180, electricalType: 'power_in' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'transistor_to92', params: { bodyWidth: 5, bodyHeight: 5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      defaultProperties: { value: 'TSOP1738' },
      isBuiltIn: true,
    },
    // ---- Varistor ----
    {
      id: 'varistor',
      name: 'Varistor (MOV)',
      category: 'Misc',
      description: 'Metalloxid-Varistor für Überspannungsschutz',
      keywords: ['varistor', 'MOV', 'surge', 'protection', 'überspannung'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -7 }, end: { x: 20, y: 7 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'line', start: { x: -25, y: 12 }, end: { x: 25, y: -12 }, stroke: '#2176B7', strokeWidth: 1.5 },
          { type: 'text', position: { x: 22, y: -16 }, text: 'U', fontSize: 8, stroke: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '2', name: '2', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 4, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'varistor', params: { diameter: 7, thickness: 4 } },
      pinMapping: { '1': '1', '2': '2' },
      defaultProperties: { value: '275V' },
      isBuiltIn: true,
    },
    // ---- Bridge Rectifier ----
    {
      id: 'bridge_rectifier',
      name: 'Brückengleichrichter',
      category: 'Misc',
      description: 'Brückengleichrichter 4-Pin (z.B. KBP206)',
      keywords: ['bridge', 'rectifier', 'gleichrichter', 'brücke', 'diode'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -20 }, end: { x: 20, y: 20 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: '~ +', fontSize: 8, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: '+', position: { x: 0, y: -40 }, length: 20, direction: 90, electricalType: 'passive' },
          { number: '2', name: 'AC1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '3', name: '-', position: { x: 0, y: 40 }, length: 20, direction: 270, electricalType: 'passive' },
          { number: '4', name: 'AC2', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 1, row: 0 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
          { number: '4', gridPosition: { col: 3, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 4, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'bridge_rectifier', params: { bodyWidth: 8, bodyHeight: 4, bodyDepth: 8 } },
      pinMapping: { '1': '1', '2': '2', '3': '3', '4': '4' },
      spice: { template: '* {ref} Bridge Rectifier\nD{ref}_1 {2} {1} D_DEFAULT\nD{ref}_2 {4} {1} D_DEFAULT\nD{ref}_3 {3} {2} D_DEFAULT\nD{ref}_4 {3} {4} D_DEFAULT' },
      defaultProperties: { value: 'KBP206' },
      isBuiltIn: true,
    },
    // ---- Relay ----
    {
      id: 'relay_spdt',
      name: 'Relais (SPDT)',
      category: 'Misc',
      description: 'Relais SPDT, 5-Pin (z.B. SRD-05VDC)',
      keywords: ['relay', 'relais', 'SPDT', 'coil', 'switch'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -30, y: -30 }, end: { x: 30, y: 30 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: 0 }, text: 'K', fontSize: 12, anchor: 'middle', stroke: '#ffffff' },
        ],
        pins: [
          { number: '1', name: 'COIL+', position: { x: -60, y: -15 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'COIL-', position: { x: -60, y: 15 }, length: 30, direction: 0, electricalType: 'passive' },
          { number: '3', name: 'COM', position: { x: 60, y: 0 }, length: 30, direction: 180, electricalType: 'passive' },
          { number: '4', name: 'NO', position: { x: 60, y: -20 }, length: 30, direction: 180, electricalType: 'passive' },
          { number: '5', name: 'NC', position: { x: 60, y: 20 }, length: 30, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'square' },
          { number: '2', gridPosition: { col: 0, row: 4 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 6, row: 2 }, shape: 'circle' },
          { number: '4', gridPosition: { col: 6, row: 0 }, shape: 'circle' },
          { number: '5', gridPosition: { col: 6, row: 4 }, shape: 'circle' },
        ],
        silkscreen: [
          { type: 'rectangle', start: { col: 0, row: 0 }, end: { col: 6, row: 4 } },
        ],
        spanHoles: { col: 7, row: 5 },
      },
      model3d: { type: 'parametric', shape: 'relay', params: { bodyWidth: 19, bodyHeight: 15, bodyDepth: 15 } },
      pinMapping: { '1': '1', '2': '2', '3': '3', '4': '4', '5': '5' },
      spice: { template: '* {ref} Relay SPDT\nR{ref}_coil {1} {2} 70\nS{ref} {4} {3} {1} {2} SWMOD' },
      defaultProperties: { value: 'SRD-05VDC' },
      isBuiltIn: true,
    },
    // ---- Trimmer Potentiometer ----
    {
      id: 'trimmer_pot',
      name: 'Trimmer',
      category: 'Resistors',
      description: 'Einstellbarer Trimmer-Potentiometer',
      keywords: ['trimmer', 'potentiometer', 'variable', 'einstellbar', 'trimpot'],
      symbol: {
        graphics: [
          { type: 'rectangle', start: { x: -20, y: -7 }, end: { x: 20, y: 7 }, stroke: '#2176B7', strokeWidth: 2 },
          { type: 'polyline', points: [{ x: -5, y: -15 }, { x: 0, y: -7 }, { x: 5, y: -15 }], stroke: '#2176B7', strokeWidth: 2, closed: true, fill: '#2176B7' },
        ],
        pins: [
          { number: '1', name: '1', position: { x: -40, y: 0 }, length: 20, direction: 0, electricalType: 'passive' },
          { number: '2', name: 'W', position: { x: 0, y: -30 }, length: 15, direction: 270, electricalType: 'passive' },
          { number: '3', name: '3', position: { x: 40, y: 0 }, length: 20, direction: 180, electricalType: 'passive' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [
          { number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' },
          { number: '2', gridPosition: { col: 1, row: 1 }, shape: 'circle' },
          { number: '3', gridPosition: { col: 2, row: 0 }, shape: 'circle' },
        ],
        silkscreen: [],
        spanHoles: { col: 3, row: 2 },
      },
      model3d: { type: 'parametric', shape: 'trimmer', params: { size: 6.5, height: 4.5 } },
      pinMapping: { '1': '1', '2': '2', '3': '3' },
      spice: { template: 'R{ref}_1 {1} {2} {value}\nR{ref}_2 {2} {3} {value}' },
      defaultProperties: { value: '10kΩ' },
      isBuiltIn: true,
    },
  ];
}

// ---- Power symbols ----

function createPowerSymbols(): ComponentDefinition[] {
  return [
    {
      id: 'power_vcc',
      name: 'VCC',
      category: 'Power',
      description: 'Positive Versorgungsspannung',
      keywords: ['vcc', 'power', 'supply', '+V'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: -10 }, stroke: '#ff4444', strokeWidth: 2 },
          { type: 'line', start: { x: -8, y: -10 }, end: { x: 8, y: -10 }, stroke: '#ff4444', strokeWidth: 2 },
          { type: 'text', position: { x: 0, y: -18 }, text: 'VCC', fontSize: 10, anchor: 'middle', stroke: '#ff4444' },
        ],
        pins: [
          { number: '1', name: 'VCC', position: { x: 0, y: 10 }, length: 10, direction: 90, electricalType: 'power_out' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [{ number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' }],
        silkscreen: [],
        spanHoles: { col: 1, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 1, rows: 1 } },
      pinMapping: { '1': '1' },
      defaultProperties: { value: 'VCC' },
      isBuiltIn: true,
    },
    {
      id: 'power_gnd',
      name: 'GND',
      category: 'Power',
      description: 'Masse',
      keywords: ['gnd', 'ground', 'masse'],
      symbol: {
        graphics: [
          { type: 'line', start: { x: 0, y: 0 }, end: { x: 0, y: 10 }, stroke: '#4fc3f7', strokeWidth: 2 },
          { type: 'line', start: { x: -10, y: 10 }, end: { x: 10, y: 10 }, stroke: '#4fc3f7', strokeWidth: 2 },
          { type: 'line', start: { x: -6, y: 14 }, end: { x: 6, y: 14 }, stroke: '#4fc3f7', strokeWidth: 2 },
          { type: 'line', start: { x: -2, y: 18 }, end: { x: 2, y: 18 }, stroke: '#4fc3f7', strokeWidth: 2 },
        ],
        pins: [
          { number: '1', name: 'GND', position: { x: 0, y: -10 }, length: 10, direction: 270, electricalType: 'power_out' },
        ],
      },
      footprint: {
        type: 'through_hole',
        pads: [{ number: '1', gridPosition: { col: 0, row: 0 }, shape: 'circle' }],
        silkscreen: [],
        spanHoles: { col: 1, row: 1 },
      },
      model3d: { type: 'parametric', shape: 'pin_header', params: { pins: 1, rows: 1 } },
      pinMapping: { '1': '1' },
      defaultProperties: { value: 'GND' },
      isBuiltIn: true,
    },
  ];
}
