# Changelog

Alle nennenswerten Änderungen an LochCAD werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Dieses Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

---

## [Unreleased]

### Hinzugefügt
- **Echtzeit-Zusammenarbeit**: WebSocket-basiertes Kollaborationssystem mit Räumen, Presence-Tracking, Remote-Cursorn und Live-State-Sync
- **Benutzerprofile**: Profil erstellen (Name, Farbe), wird lokal gespeichert und für Zusammenarbeit verwendet
- **Remote-Cursor-Darstellung**: Cursor anderer Teilnehmer werden als farbige Pfeile direkt auf dem Konva-Canvas angezeigt (skalierungsunabhängig)
- **Remote-Auswahl-Hervorhebung**: Von anderen Nutzern ausgewählte Bauteile/Drähte werden mit farbigem Rahmen markiert
- **Share-Dialog**: Raum erstellen oder per ID beitreten, mit automatischer URL-Aktualisierung
- **Presence-Avatare**: Farbige Avatar-Kreise an der TopBar zeigen verbundene Teilnehmer
- **PDF-Export**: Bestückungsplan als zweiseitiges PDF (Bauteilseite + Lötseite gespiegelt)
- **PDF-Vorschau-Modal**: Vorschau des generierten PDFs vor dem Download
- **Projekt-Notizen**: Markdown-Notizen pro Projekt, exportierbar als `.md`
- **Perfboard-Vorschau im Projektmanager**: Miniatur-Canvas zeigt bestückte Platine in der Projektliste
- **Projekt-Archiv**: Alle Projekte als `.lochcad-archive` (ZIP) ex- und importieren
- **Auto-Save**: Automatische Sicherung im LocalStorage mit Wiederherstellung

### Geändert
- **Toolbar vereinfacht**: Doppelte Undo/Redo-, Drehen/Spiegeln- und ERC/DRC-Buttons aus der Toolbar entfernt (existieren bereits in TopBar-Menüs)
- **Popup-Exklusivität**: Alle Toolbar-Popups (Sync, Layout, Overflow) schließen sich gegenseitig
- **TopBar responsiv**: Ansicht-Tabs verwenden Flex-Layout statt absoluter Positionierung, Labels werden auf kleinen Bildschirmen ausgeblendet
- **TopBar aufgeräumt**: Doppelte Undo/Redo-Schnellaktionen und redundante Tastenkürzel-Handler entfernt
- **Cursor-Tracking**: Konva-basierte Remote-Cursor-Layer statt HTML-Overlay (korrekte Darstellung bei Pan/Zoom)
- **Seitenleisten-Suche**: Verbessertes Padding beim Suchfeld verhindert Icon-Clipping

### Entfernt
- Nicht funktionaler „Bauteil"-Button aus Schaltplan- und Lochraster-Toolbar
- Doppelter Netlist-Eintrag im Werkzeuge-Menü (existiert bereits unter Datei → Export)
- Workspace-Badges unter Presence-Avataren

## [0.3.8] — 2026-02-11

### Hinzugefügt
- Open-Source-Release: README, Lizenz, Contributing Guide, Changelog
- GitHub-Templates für Issues und Pull Requests
- Dokumentation (Benutzerhandbuch, Architektur, API-Referenz)
- GitHub Pages Dokumentationsseite
