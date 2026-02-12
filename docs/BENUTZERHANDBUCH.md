# LochCAD Benutzerhandbuch

> Vollständige Anleitung für LochCAD — vom ersten Schaltplan bis zum fertigen Lochraster-Layout.

---

## Inhaltsverzeichnis

1. [Einführung](#einführung)
2. [Erste Schritte](#erste-schritte)
3. [Schaltplan-Editor](#schaltplan-editor)
4. [Lochraster-Editor](#lochraster-editor)
5. [3D-Vorschau](#3d-vorschau)
6. [Bauteil-Editor](#bauteil-editor)
7. [Prüfungen (ERC / DRC)](#prüfungen-erc--drc)
8. [Export-Funktionen](#export-funktionen)
9. [Projektmanager](#projektmanager)
10. [Zusammenarbeit (Collaboration)](#zusammenarbeit-collaboration)
11. [Projekt-Notizen](#projekt-notizen)
12. [Tastenkürzel-Referenz](#tastenkürzel-referenz)

---

## Einführung

LochCAD ist ein webbasiertes EDA-Tool (Electronic Design Automation) für Lochrasterplatinen. Der typische Workflow:

```
Schaltplan zeichnen → Auf Lochraster übertragen → Routen → Prüfen → Exportieren
```

### Systemvoraussetzungen

- Moderner Browser (Chrome, Firefox, Edge, Safari)
- Bildschirmauflösung ≥ 1280×720 empfohlen
- Keine Installation nötig — läuft vollständig im Browser
- Alle Daten bleiben lokal (LocalStorage) — außer bei Echtzeit-Zusammenarbeit

---

## Erste Schritte

### Neues Projekt

1. Öffne LochCAD unter [lochcad.de](https://lochcad.de) (oder lokal via `npm run dev`).
2. Beim ersten Start erscheint der **Willkommensbildschirm** mit einer Kurzanleitung.
3. Du bist sofort im **Schaltplan-Editor** — ein leeres Projekt ist bereits angelegt.

### Projekt speichern & laden

| Aktion | Vorgehensweise |
|---|---|
| **Speichern** | `Ctrl+S` — speichert automatisch im Browser (LocalStorage) |
| **Projektmanager** | `Ctrl+Shift+P` — mehrere Projekte verwalten, umbenennen, löschen |
| **Exportieren** | `Ctrl+E` oder Datei → Export — als `.lochcad`-Datei herunterladen |
| **Importieren** | `Ctrl+O` oder Datei → Import — `.lochcad`- oder `.json`-Datei laden |

---

## Schaltplan-Editor

Der Schaltplan-Editor ist das Herzstück von LochCAD. Hier entwirfst du deine Schaltung.

### Bauteile platzieren

1. Öffne die **Bauteil-Bibliothek** in der linken Seitenleiste.
2. Wähle ein Bauteil aus der Kategorie (Widerstände, Kondensatoren, ICs, etc.).
3. Klicke auf die Zeichenfläche, um es zu platzieren.
4. **Drehen**: `R` (90°-Schritte)
5. **Spiegeln**: `X` (horizontal)

### Drähte zeichnen

1. Wähle das **Draht-Werkzeug** (`W`).
2. Klicke auf einen Pin, um den Draht zu starten.
3. Klicke auf weitere Punkte für Zwischenstücke.
4. **Doppelklick** oder Klick auf einen Ziel-Pin beendet den Draht.
5. `Esc` bricht das Zeichnen ab.

### Net-Labels

- Taste `L` — setzt ein Net-Label an die aktuelle Position.
- Gleiche Label-Namen verbinden Netze — auch über verschiedene Blätter (Sheets) hinweg.
- Power-Labels (`VCC`, `GND`, etc.) werden automatisch als Spannungsversorgung erkannt.

### Multi-Sheet

- Über die **Sheet-Tabs** am unteren Rand können mehrere Blätter angelegt werden.
- Netze sind blattübergreifend über Net-Labels verbunden.

### Auswahl & Bearbeitung

| Aktion | Vorgehensweise |
|---|---|
| **Auswählen** | Klick auf Element, oder Rechteck aufziehen |
| **Alles auswählen** | `Ctrl+A` |
| **Verschieben** | Ausgewählte Elemente per Drag & Drop |
| **Löschen** | `Del` oder `Backspace` |
| **Kopieren / Einfügen** | `Ctrl+C` / `Ctrl+V` |
| **Undo / Redo** | `Ctrl+Z` / `Ctrl+Y` |

---

## Lochraster-Editor

Hier überträgst du deine Schaltung auf eine reale Lochrasterplatine.

### Schaltplan synchronisieren

1. Klicke in der Toolbar rechts auf **Sync** oder gehe zu **Werkzeuge → Sync Schaltplan → Lochraster**.
2. Alle Bauteile werden auf das Board übertragen, ggf. noch unplatziert.

### Platinen-Einstellungen

- **Board-Typ**: Perfboard (einzelne Löcher) oder Stripboard (verbundene Reihen)
- **Board-Größe**: Voreinstellungen von Klein (24×18) bis Eurocard (64×39) oder eigene Größe
- **Lochgitter**: Standard 2,54 mm

### Bauteile anordnen

- **Manuell**: Per Drag & Drop auf dem Board verschieben.
- **Auto-Layout**: Über Werkzeuge → Auto-Layout — platziert Bauteile automatisch.

### Verbindungen routen

| Werkzeug | Taste | Beschreibung |
|---|---|---|
| **Draht** | `W` | Draht auf der Unterseite der Platine |
| **Drahtbrücke** | — | Verbindung auf der Oberseite (über andere Leitungen hinweg) |
| **Lötbrücke** | — | Lötzinn-Verbindung zwischen benachbarten Pads |
| **Track schneiden** | — | Leiterbahn auf Stripboard unterbrechen |
| **Autorouter** | — | Automatisches Routen aller offenen Verbindungen |

### Ratsnest

Unverbundene Netze werden als rote Linien (**Ratsnest**) angezeigt. Ziel ist es, alle Ratsnest-Linien durch echte Verbindungen zu ersetzen.

---

## 3D-Vorschau

- Wechsle zum Tab **3D-Ansicht**.
- Die Platine wird mit allen platzierten Bauteilen dreidimensional dargestellt.
- **Navigation**: Maus zum Drehen, Scrollrad zum Zoomen, Rechtsklick zum Verschieben.
- Nützlich zur visuellen Kontrolle, ob alle Bauteile richtig platziert sind.

---

## Bauteil-Editor

Im **Bauteil-Editor** kannst du eigene Bauteile definieren:

1. Wechsle zum Tab **Bauteil-Editor**.
2. Zeichne das **Schaltplan-Symbol** (Linien, Rechtecke, Kreise, Bögen, Text).
3. Definiere **Pins** mit Namen, Richtung und elektrischem Typ.
4. Lege das **Footprint** fest (Pad-Positionen auf dem Lochraster).
5. Speichere das Bauteil — es erscheint dann in der Bibliothek unter „Custom".

---

## Prüfungen (ERC / DRC)

### ERC — Electrical Rules Check

Prüft den **Schaltplan** auf:
- Unverbundene Pins
- Mehrere Ausgänge auf einem Netz
- Fehlende Spannungsversorgung
- Unbenannte Netze

### DRC — Design Rules Check

Prüft das **Lochraster-Layout** auf:
- Unverbundene Netze (offene Ratsnest-Linien)
- Kurzschlüsse (verschiedene Netze verbunden)
- Bauteile außerhalb der Platine
- Überlappende Bauteile

### Ergebnisse

- Fehler und Warnungen werden im **Prüf-Panel** angezeigt.
- Klick auf einen Fehler markiert die betroffene Stelle im Editor.

---

## Export-Funktionen

Über **Datei → Export** stehen folgende Formate zur Verfügung:

| Format | Beschreibung |
|---|---|
| `.lochcad` | Vollständiges Projektformat (ZIP-Archiv) — zum Teilen oder Sichern |
| **SPICE-Netzliste** | Für Schaltungssimulation (z.B. LTspice, ngspice) |
| **Stückliste (CSV)** | Bauteil-Liste als CSV-Datei |
| **Stückliste (HTML)** | Formatierte Bauteil-Liste als HTML-Tabelle |
| **Netzliste (JSON)** | Strukturierte Netzliste im JSON-Format |
| **Bestückungsplan (PDF)** | Zweiseitiges PDF: Bauteilseite + Lötseite (gespiegelt) |

---

## Projektmanager

Öffne den Projektmanager mit `Ctrl+Shift+P`:

- **Neues Projekt** erstellen
- Zwischen gespeicherten **Projekten wechseln**
- Projekte **umbenennen** oder **löschen**
- **Archiv exportieren** — alle Projekte als `.lochcad-archive` sichern
- **Archiv importieren** — mehrere Projekte auf einmal laden

---

## Zusammenarbeit (Collaboration)

LochCAD bietet Echtzeit-Zusammenarbeit über WebSocket. Mehrere Nutzer können gleichzeitig an einem Projekt arbeiten.

### Voraussetzungen

- **Benutzerprofil**: Vor der ersten Zusammenarbeit muss ein Profil erstellt werden (Name + Farbe). Klicke auf das Account-Symbol oben rechts.
- **Collaboration-Server**: Ein WebSocket-Server muss laufen (siehe `server/collab-server.cjs`).

### Raum erstellen

1. Klicke auf **Teilen** in der TopBar.
2. Im Share-Dialog wähle **Raum erstellen**.
3. Die generierte Raum-ID wird angezeigt — teile sie mit anderen Teilnehmern.
4. Die URL wird automatisch mit `?room=...` aktualisiert.

### Raum beitreten

1. Klicke auf **Teilen** in der TopBar.
2. Im Share-Dialog wähle **Raum beitreten**.
3. Gib die Raum-ID ein und bestätige.
4. Dein lokales Projekt wird vor dem Beitritt automatisch gesichert und nach dem Verlassen wiederhergestellt.

### Während der Zusammenarbeit

| Feature | Beschreibung |
|---|---|
| **Presence-Avatare** | Farbige Kreise in der TopBar zeigen verbundene Teilnehmer |
| **Remote-Cursor** | Cursor anderer Nutzer werden als farbige Pfeile auf dem Canvas angezeigt |
| **Remote-Auswahl** | Von anderen Nutzern ausgewählte Elemente werden mit farbigem Rahmen markiert |
| **Live-Sync** | Alle Änderungen (Bauteile, Drähte, Verbindungen) werden in Echtzeit synchronisiert |
| **Awareness** | Aktiver View, Tool und Zeichenstatus werden übertragen |

### Raum verlassen

- Klicke auf den grünen **Live**-Button und wähle „Raum verlassen".
- Dein vorheriges lokales Projekt wird automatisch wiederhergestellt.

---

## Projekt-Notizen

Zu jedem Projekt können Markdown-Notizen hinterlegt werden:

1. Öffne die **Projekt-Notizen** (über das Menü oder den Projektmanager).
2. Schreibe Notizen im Markdown-Format.
3. Notizen werden zusammen mit dem Projekt gespeichert.
4. Export als `.md`-Datei möglich.

---

## Tastenkürzel-Referenz

### Allgemein

| Kürzel | Aktion |
|---|---|
| `Ctrl+S` | Projekt speichern |
| `Ctrl+Shift+P` | Projektmanager |
| `Ctrl+N` | Neues Projekt |
| `Ctrl+O` | Projekt öffnen |
| `Ctrl+E` | Projekt exportieren |

### Bearbeitung

| Kürzel | Aktion |
|---|---|
| `Ctrl+Z` | Rückgängig (Undo) |
| `Ctrl+Y` | Wiederholen (Redo) |
| `Ctrl+C` | Kopieren |
| `Ctrl+V` | Einfügen |
| `Ctrl+X` | Ausschneiden |
| `Ctrl+A` | Alles auswählen |
| `Del` / `Backspace` | Auswahl löschen |

### Werkzeuge

| Kürzel | Aktion |
|---|---|
| `W` | Draht-Werkzeug |
| `R` | Bauteil drehen (90°) |
| `X` | Bauteil spiegeln |
| `L` | Net-Label platzieren |
| `Esc` | Werkzeug abbrechen / Auswahl aufheben |

### Navigation

| Kürzel | Aktion |
|---|---|
| `Ctrl+=` | Zoom hinein |
| `Ctrl+-` | Zoom heraus |
| `Ctrl+0` | Zoom zurücksetzen |
| Scrollrad | Zoom |
| Mittlere Maustaste | Pan (Verschieben) |

---

*Letzte Aktualisierung: Februar 2026 — LochCAD v0.3.8*
