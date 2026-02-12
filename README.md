<p align="center">
  <img src="public/lochcad-logo.svg" alt="LochCAD Logo" width="96" />
</p>

<h1 align="center">LochCAD</h1>

<p align="center">
  <strong>Open-Source Schaltplan- &amp; Lochraster-CAD — direkt im Browser.</strong>
</p>

<p align="center">
  <a href="https://lochcad.de">Live-Demo</a> ·
  <a href="docs/BENUTZERHANDBUCH.md">Dokumentation</a> ·
  <a href="CONTRIBUTING.md">Mitwirken</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.3.8-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/Lizenz-MIT-green?style=flat-square" alt="MIT Lizenz" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
</p>

---

## Über das Projekt

**LochCAD** ist ein webbasiertes EDA-Tool (Electronic Design Automation), das speziell für die Arbeit mit Lochrasterplatinen entwickelt wurde. Schaltpläne zeichnen, auf Lochraster übertragen, in 3D prüfen und als Netzliste oder Stückliste exportieren — alles kostenlos im Browser, ohne Installation.

### Features

| Feature | Beschreibung |
|---|---|
| **Schaltplan-Editor** | Symbole platzieren, Drähte ziehen, Net-Labels vergeben — mit Multi-Sheet-Support |
| **Lochraster-Editor** | Bauteile auf Perfboard/Stripboard platzieren, Drähte routen, Lötbrücken setzen |
| **3D-Vorschau** | Interaktive 3D-Ansicht der bestückten Platine (Three.js) |
| **Bauteil-Editor** | Eigene Schaltplansymbole und Footprints definieren |
| **Autorouter** | Automatisches Routen von Verbindungen auf dem Lochraster |
| **Auto-Layout** | Automatische Bauteilplatzierung auf dem Lochraster |
| **ERC / DRC** | Electrical & Design Rules Check für Schaltplan und Layout |
| **Echtzeit-Zusammenarbeit** | WebSocket-basiert: Räume erstellen/beitreten, Live-Cursor, Presence-Avatare, State-Sync |
| **Benutzerprofile** | Profil mit Name und Farbe für die Zusammenarbeit |
| **Export** | `.lochcad`-Projekt, SPICE-Netzliste, Stückliste (CSV/HTML), Netzlisten-JSON, Bestückungsplan-PDF |
| **Projektmanager** | Mehrere Projekte verwalten, importieren, exportieren, archivieren |
| **Projekt-Notizen** | Markdown-Notizen pro Projekt, exportierbar als `.md` |
| **Offline-fähig** | Läuft komplett im Browser — keine Daten verlassen den Rechner (außer bei Zusammenarbeit) |

## Schnellstart

### Voraussetzungen

- [Node.js](https://nodejs.org/) ≥ 18
- [npm](https://www.npmjs.com/) oder [pnpm](https://pnpm.io/)

### Installation

```bash
# Repository klonen
git clone https://github.com/rathlinus/LochCAD.git
cd LochCAD

# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten
npm run dev
```

Die App ist dann erreichbar unter **http://localhost:3000**.

### Build für Produktion

```bash
npm run build
npm run preview
```

---

## Projektstruktur

```
LochCAD/
├── public/                  # Statische Assets (Logo, Icons)
├── server/
│   └── collab-server.cjs    # WebSocket Collaboration-Server (Node.js)
├── src/
│   ├── components/          # React UI-Komponenten
│   │   ├── collab/          #   Zusammenarbeit (ShareDialog, AuthModal, Presence, Cursors)
│   │   ├── layout/          #   App-Layout, TopBar, Toolbar, StatusBar
│   │   ├── properties/      #   Eigenschaften-Panel
│   │   └── sidebar/         #   Bauteil-Bibliothek Sidebar
│   ├── constants/           # Globale Konstanten (Grid, Farben, Shortcuts)
│   ├── features/            # Feature-Module
│   │   ├── schematic-editor/   # Schaltplan-Editor (Konva)
│   │   ├── perfboard-editor/   # Lochraster-Editor (Konva)
│   │   ├── preview-3d/         # 3D-Vorschau (Three.js / R3F)
│   │   └── component-editor/   # Bauteil-Editor
│   ├── lib/                 # Kernlogik
│   │   ├── collab/          #   Collaboration-Protokoll, Client, Sync-Engine
│   │   ├── engine/          #   Netlist, Router, Auto-Layout, ERC, DRC
│   │   ├── export/          #   SPICE, BOM, PDF, Projektdatei
│   │   ├── component-library/  # Eingebaute Bauteilbibliothek
│   │   ├── clipboard.ts     #   Copy/Paste-Logik
│   │   └── units.ts         #   SI-Einheiten-Konvertierung
│   ├── stores/              # Zustand State-Management (inkl. collabStore, authStore)
│   └── types/               # TypeScript-Typdefinitionen
├── docs/                    # Dokumentation
├── nginx/                   # Nginx-Konfiguration (Deployment)
├── vite.config.ts           # Vite-Konfiguration
├── tailwind.config.js       # Tailwind CSS-Konfiguration
└── tsconfig.json            # TypeScript-Konfiguration
```

---

## Technologie-Stack

| Technologie | Einsatz |
|---|---|
| [React 18](https://react.dev/) | UI-Framework |
| [TypeScript 5.6](https://www.typescriptlang.org/) | Typisierung |
| [Vite 6](https://vitejs.dev/) | Build-Tool & Dev-Server |
| [Zustand](https://zustand-demo.pmnd.rs/) | State-Management (mit Immer) |
| [Konva / react-konva](https://konvajs.org/) | 2D-Canvas (Schaltplan & Lochraster) |
| [Three.js / @react-three/fiber](https://docs.pmnd.rs/react-three-fiber/) | 3D-Vorschau |
| [Tailwind CSS](https://tailwindcss.com/) | Styling |
| [Lucide Icons](https://lucide.dev/) | Icon-Set |
| [jsPDF](https://github.com/parallax/jsPDF) | PDF-Generierung |
| [JSZip](https://stuk.github.io/jszip/) | Projektdatei-Archiv (.lochcad) |
| [ws](https://github.com/websockets/ws) | WebSocket (Collaboration-Server) |

---

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| `Ctrl+S` | Projekt speichern |
| `Ctrl+Shift+P` | Projektmanager öffnen |
| `Ctrl+N` | Neues Projekt |
| `Ctrl+O` | Projekt öffnen / importieren |
| `Ctrl+E` | Projekt exportieren |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+A` | Alles auswählen |
| `Ctrl+=` / `Ctrl+-` | Zoom rein / raus |
| `Ctrl+0` | Zoom zurücksetzen |
| `W` | Draht-Werkzeug |
| `R` | Bauteil drehen |
| `X` | Bauteil spiegeln |
| `L` | Net-Label platzieren |
| `Del` / `Backspace` | Auswahl löschen |
| `Esc` | Werkzeug abbrechen |

---

## Mitwirken

Beiträge sind herzlich willkommen! Lies bitte zuerst die [CONTRIBUTING.md](CONTRIBUTING.md), bevor du einen Pull Request erstellst.

## Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE). Du darfst es frei verwenden, verändern und weitergeben.


---

<p align="center">
  <sub>Entwickelt von <a href="https://rathblume.de">Linus Rath</a></sub>
</p>
