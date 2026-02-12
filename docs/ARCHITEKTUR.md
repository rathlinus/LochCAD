# LochCAD Architektur

> Technische Übersicht der LochCAD-Architektur für Entwickler und Contributors.

---

## Übersicht

LochCAD ist eine Single-Page Application (SPA), die vollständig im Browser läuft. Projektdaten werden im LocalStorage des Browsers gespeichert. Für Echtzeit-Zusammenarbeit kann optional ein WebSocket-Server genutzt werden.

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                            │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐   │
│  │  React UI    │  │ Zustand      │  │ LocalStorage│   │
│  │  Components  │←→│ Stores       │←→│ Persistenz  │   │
│  └──────┬───────┘  └──────┬───────┘  └─────────────┘   │
│         │                 │                               │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌─────────────┐   │
│  │  Konva       │  │  Engine      │  │ Collab      │   │
│  │  (2D Canvas) │  │  (Netlist,   │  │ Client      │   │
│  │              │  │   Router,    │  │ (WS Sync)   │   │
│  │  Three.js    │  │   ERC, DRC)  │  └─────┬───────┘   │
│  │  (3D WebGL)  │  │              │        │             │
│  └──────────────┘  └──────────────┘        │             │
└────────────────────────────────────────┴────────────────┘
                                            │
                                   ┌───────┴────────┐
                                   │ Collab Server  │
                                   │ (Node.js + ws) │
                                   └────────────────┘
```

---

## Schichten

### 1. UI-Schicht (`src/components/`)

React-Komponenten, die die Benutzeroberfläche bilden:

| Modul | Beschreibung |
|---|---|
| `layout/TopBar` | Hauptmenüleiste mit Datei-, Bearbeiten-, Werkzeuge-, Prüfung- und Hilfe-Menü |
| `layout/Toolbar` | Werkzeugleiste (Auswahl, Draht, Löschen, Zoom, Sync, Auto-Layout) |
| `layout/SheetTabs` | Tab-Leiste für Multi-Sheet im Schaltplan |
| `layout/StatusBar` | Statusleiste mit Cursor-Position, Zoom, Netz-Info |
| `sidebar/Sidebar` | Bauteil-Bibliothek und Suche |
| `properties/PropertiesPanel` | Eigenschaften-Editor für ausgewählte Elemente |
| `collab/ShareDialog` | Dialog zum Erstellen/Beitreten von Collaboration-Räumen |
| `collab/AuthModal` | Profil-Erstellung und -Bearbeitung |
| `collab/PresenceAvatars` | Farbige Avatar-Kreise der verbundenen Teilnehmer |
| `collab/RemoteCursorsLayer` | Remote-Cursor-Darstellung auf dem Konva-Canvas |
| `collab/CollabProvider` | Lifecycle-Wrapper für das Collaboration-System |
| `CheckPanel` | Anzeige von ERC/DRC-Ergebnissen |
| `ProjectManager` | Multi-Projekt-Verwaltung (Modal) mit Perfboard-Vorschau |
| `ProjectNotes` | Markdown-Notizen pro Projekt |
| `PDFPreviewModal` | PDF-Vorschau vor dem Download |
| `IntroScreen` | Willkommensbildschirm mit Tutorial |
| `Toast` | Benachrichtigungssystem |

### 2. Feature-Module (`src/features/`)

Eigenständige Editor-Module:

| Modul | Technologie | Beschreibung |
|---|---|---|
| `schematic-editor` | Konva / react-konva | Schaltplan-Zeichenfläche |
| `perfboard-editor` | Konva / react-konva | Lochraster-Zeichenfläche |
| `preview-3d` | Three.js / R3F | 3D-Vorschau der Platine |
| `component-editor` | Konva / react-konva | Editor für eigene Bauteile |

### 3. Engine (`src/lib/engine/`)

Kernlogik ohne UI-Abhängigkeiten:

| Modul | Beschreibung |
|---|---|
| `netlist.ts` | Baut Netzliste aus Schaltplan-Daten |
| `router.ts` | Lochraster-Router (Pfadfindung) |
| `autorouter.ts` | Automatisches Routen aller offenen Netze |
| `auto-layout.ts` | Automatische Bauteil-Platzierung |
| `schematic-router.ts` | Schaltplan-Wire-Routing |
| `erc.ts` | Electrical Rules Check |
| `drc.ts` | Design Rules Check |

### 4. Export (`src/lib/export/`)

| Modul | Beschreibung |
|---|---|
| `project-file.ts` | `.lochcad`-Projektformat (ZIP mit project.json + meta.json + Notizen) |
| `spice-bom.ts` | SPICE-Netzliste und Stückliste (BOM) |
| `pdf-perfboard.ts` | Bestückungsplan-PDF (Bauteilseite + Lötseite gespiegelt, via jsPDF) |

### 5. State Management (`src/stores/`)

Zustand-Stores mit Immer für immutable Updates:

| Store | Verantwortung |
|---|---|
| `projectStore` | Projektdaten (Schaltplan, Perfboard, Sheets), aktive Ansicht |
| `schematicStore` | Schaltplan-Editor-State (Viewport, Tool, Auswahl, Undo/Redo) |
| `perfboardStore` | Lochraster-Editor-State (Viewport, Tool, Auswahl, Undo/Redo) |
| `projectManagerStore` | Projektverwaltung (Liste, Öffnen, Speichern, Import/Export) |
| `collabStore` | Collaboration-State (Raum, Peers, Awareness, WebSocket-Verbindung) |
| `authStore` | Benutzerprofil (Name, Farbe), persistent im LocalStorage |
| `checkStore` | ERC/DRC-Ergebnisse |
| `toastStore` | Benachrichtigungen |

### 6. Typen (`src/types/index.ts`)

Zentrale TypeScript-Typdefinitionen für:

- Geometrie-Primitive (`Point`, `GridPosition`, `BoundingBox`)
- Schaltplan-Elemente (`SchematicComponent`, `Wire`, `NetLabel`)
- Lochraster-Elemente (`PerfboardComponent`, `Connection`, `TrackCut`)
- Bauteil-Definitionen (`ComponentDefinition`, `SymbolGraphic`, `FootprintPad`)
- Board-Typen (`BoardType`, `ConnectionType`, `ConnectionSide`)
- Editor-Enums (`ToolType`, `EditorView`)

### 7. Collaboration (`src/lib/collab/`)

Echtzeit-Zusammenarbeit über WebSocket:

| Modul | Beschreibung |
|---|---|
| `protocol.ts` | Nachrichtentypen und Awareness-State (Cursor, View, Tool, Auswahl) |
| `client.ts` | `CollabClient` — WebSocket-Verbindung mit Auto-Reconnect und Message-Queue |
| `sync.ts` | Diff-basierte Synchronisation: Zustand-Snapshots vergleichen, Operationen senden |

### 8. Collaboration-Server (`server/collab-server.cjs`)

Standalone Node.js WebSocket-Server mit dem `ws`-Paket:

- Raum-basiertes Relay: Nachrichten werden an alle Peers im Raum weitergeleitet
- Unterstützt: `ops` (Entitäts-Operationen), `awareness` (Cursor/Presence), `state-full` (Full-State-Sync)
- Kein persistenter State — der Server speichert keine Projektdaten

---

## Datenfluss

```
Bauteil platzieren:
  User klickt → SchematicEditor → schematicStore.dispatch()
    → projectStore.project.schematic wird aktualisiert (Immer)
    → React re-rendert den Canvas (Konva)
    → Collab-Sync erkennt Diff → sendet Operation an Server → Peers

Schaltplan → Lochraster synchronisieren:
  User klickt "Sync" → Engine baut Netlist aus Schaltplan
    → Perfboard-Bauteile werden erzeugt/aktualisiert
    → projectStore.project.perfboard wird aktualisiert

Echtzeit-Zusammenarbeit:
  User A ändert State → collabSync erkennt Zustand-Diff
    → Operationen werden über CollabClient (WebSocket) gesendet
    → Collab-Server leitet an User B weiter
    → User B empfängt Operationen → wendet sie auf lokalen Store an
    → Awareness (Cursor, Tool, Auswahl) wird separat bei 20 fps gebroadcastet

Export:
  User klickt "Export" → project-file.ts oder spice-bom.ts
    → JSON/SPICE/CSV/PDF generiert → Browser-Download
```

---

## Bauteil-Bibliothek (`src/lib/component-library/`)

Die eingebaute Bibliothek enthält ~100 vordefinierte Bauteile:

- **Widerstände** (axial, SIL-Netzwerke)
- **Kondensatoren** (Keramik, Elektrolyt)
- **Induktivitäten**
- **Dioden** (Standard, Zener, Schottky, LED)
- **Transistoren** (NPN, PNP, N-MOSFET, P-MOSFET)
- **ICs** (Operationsverstärker, Timer, Logic Gates, Flip-Flops, Mikrocontroller)
- **Stecker** (Header, Schraubklemmen)
- **Schalter**
- **Kristalle / Oszillatoren**
- **Power-Symbole** (VCC, GND, +5V, +3.3V, etc.)

Eigene Bauteile können im Bauteil-Editor erstellt und als Teil des Projekts gespeichert werden.

---

## Persistenz

- **Autosave**: Jedes Speichern (`Ctrl+S`) schreibt ins LocalStorage.
- **Auto-Save mit Wiederherstellung**: Automatische Sicherung im LocalStorage, um Datenverlust zu vermeiden.
- **Projektmanager**: Verwaltet mehrere Projekte im LocalStorage.
- **Export**: `.lochcad`-Dateien sind ZIP-Archive (project.json + meta.json + Notizen) — können geteilt und versioniert werden.
- **Archiv**: `.lochcad-archive` enthält alle Projekte (ZIP-Format via JSZip).
- **Benutzerprofil**: Name und Farbe werden im LocalStorage unter `lochcad-user-profile` gespeichert.

---

## Build & Deployment

```bash
npm run build      # TypeScript compilieren + Vite Build
npm run preview    # Produktions-Preview starten
npm run start      # Build + Preview auf Port 3800
```

Deployment erfolgt als statische Dateien (z.B. via Nginx, siehe `nginx/lochcad.conf`).

---

*Letzte Aktualisierung: Februar 2026*
