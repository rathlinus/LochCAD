# LochCAD

A web-based schematic capture and perfboard layout CAD tool for through-hole electronics prototyping. LochCAD provides an integrated workflow: draw schematics, lay out components on a virtual perfboard, and preview the result in 3D — all from the browser.

## Features

### Schematic Editor
- Place and wire standard electronic components (resistors, capacitors, ICs, transistors, connectors, etc.)
- Multi-sheet hierarchical schematics with sheet pins and bus support
- Net labels, power symbols, junctions, and bus entries
- Electrical Rules Check (ERC) for detecting unconnected pins, conflicting types, and missing drivers
- Automatic netlist generation

### Perfboard / Stripboard Layout
- Visual placement of through-hole components on a perfboard or stripboard grid
- Wiring, solder bridges, wire bridges, and track cuts
- Auto-routing with Manhattan-path algorithm and collision detection
- Design Rules Check (DRC) for overlapping components, out-of-bounds placement, and unconnected nets
- Configurable board sizes (standard presets from 24x18 up to Eurocard 64x39)

### 3D Preview
- Real-time 3D visualization of the assembled board
- Parametric 3D models for common packages (axial resistors, ceramic/electrolytic capacitors, DIP ICs, TO-92/TO-220 transistors, LEDs, connectors, etc.)

### Component Library
- Built-in library with resistors, capacitors, inductors, diodes, LEDs, transistors, voltage regulators, ICs, connectors, switches, crystals, and more
- Custom component editor for creating new symbols and footprints
- Pin mapping between schematic symbols and physical footprints

### Export
- Save/load projects in `.lochcad` format (JSON-based)
- SPICE netlist generation
- Bill of Materials (BOM) export in CSV and HTML
- Autosave to browser local storage

## Tech Stack

- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **State Management:** Zustand with Immer
- **2D Canvas:** Konva / react-konva
- **3D Rendering:** Three.js via @react-three/fiber and @react-three/drei
- **Styling:** Tailwind CSS
- **Fonts:** Inter (UI), JetBrains Mono (values/references)

## Getting Started

### Prerequisites

- Node.js (v18 or later recommended)
- npm

### Installation

```bash
git clone https://github.com/rathlinus/LochCAD.git
cd LochCAD
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:3000`.

### Production Build

```bash
npm run build
npm run preview
```

## Keyboard Shortcuts

| Action       | Shortcut   |
|--------------|------------|
| Save         | Ctrl+S     |
| Open         | Ctrl+O     |
| New Project  | Ctrl+N     |
| Export       | Ctrl+E     |
| Undo         | Ctrl+Z     |
| Redo         | Ctrl+Y     |
| Select All   | Ctrl+A     |
| Delete       | Delete     |
| Rotate       | R          |
| Mirror       | X          |
| Wire Tool    | W          |
| Bus Tool     | B          |
| Label Tool   | L          |
| Move         | M          |
| Zoom In      | Ctrl+=     |
| Zoom Out     | Ctrl+-     |
| Zoom Fit     | Ctrl+0     |

## Project Structure

```
src/
  components/        UI layout, toolbar, sidebar, properties panel
  constants/         Grid settings, colors, board presets, shortcuts
  features/
    schematic-editor/   Schematic canvas and symbol rendering
    perfboard-editor/   Perfboard canvas and layout tools
    preview-3d/         Three.js 3D board preview
    component-editor/   Custom component creation
  lib/
    component-library/  Built-in component definitions
    engine/             Netlist builder, ERC, DRC, auto-router
    export/             Project file I/O, SPICE/BOM export
  stores/              Zustand stores (project, schematic, perfboard)
  types/               TypeScript type definitions
```

## License

This project is not yet published under a specific license. All rights reserved.
