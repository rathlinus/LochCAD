# Mitwirken an LochCAD

Danke, dass du daran interessiert bist, zu LochCAD beizutragen! Jede Art von Beitrag — ob Bugfix, neues Feature, Dokumentation oder auch nur ein Issue — ist willkommen.

---

## Inhaltsverzeichnis

- [Verhaltenskodex](#verhaltenskodex)
- [Wie kann ich beitragen?](#wie-kann-ich-beitragen)
- [Entwicklungsumgebung einrichten](#entwicklungsumgebung-einrichten)
- [Branching & Commit-Konventionen](#branching--commit-konventionen)
- [Pull Requests](#pull-requests)
- [Code-Style](#code-style)
- [Issues melden](#issues-melden)

---

## Verhaltenskodex

Dieses Projekt folgt dem [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Mit deiner Teilnahme erklärst du dich damit einverstanden, diesen Kodex einzuhalten.

---

## Wie kann ich beitragen?

### Bugs melden

- Überprüfe zuerst, ob ein ähnliches [Issue](https://github.com/linusrath/LochCAD/issues) bereits existiert.
- Erstelle ein neues Issue mit dem **Bug Report**-Template.
- Beschreibe das Problem möglichst genau: Was passiert, was hast du erwartet, Schritte zum Reproduzieren.

### Features vorschlagen

- Öffne ein Issue mit dem **Feature Request**-Template.
- Beschreibe den Anwendungsfall und warum das Feature hilfreich wäre.

### Code beitragen

1. **Fork** das Repository.
2. Erstelle einen **Feature-Branch** aus `main`.
3. Implementiere deine Änderungen.
4. Stelle sicher, dass der Build funktioniert (`npm run build`).
5. Erstelle einen **Pull Request**.

### Dokumentation verbessern

- Verbesserungen an der Dokumentation sind genauso wertvoll wie Code-Beiträge.
- Dokumentation befindet sich in `docs/` und in den Inline-Kommentaren.

---

## Entwicklungsumgebung einrichten

### Voraussetzungen

- Node.js ≥ 18
- npm oder pnpm

### Setup

```bash
git clone https://github.com/linusrath/LochCAD.git
cd LochCAD
npm install
npm run dev
```

Die App läuft dann auf **http://localhost:3000**.

### Nützliche Befehle

| Befehl | Beschreibung |
|---|---|
| `npm run dev` | Entwicklungsserver starten |
| `npm run build` | Produktions-Build erstellen |
| `npm run preview` | Build-Vorschau starten |
| `npm run lint` | ESLint ausführen |

---

## Branching & Commit-Konventionen

### Branch-Namensschema

```
feature/kurze-beschreibung
fix/kurze-beschreibung
docs/kurze-beschreibung
refactor/kurze-beschreibung
```

### Commit-Messages

Wir verwenden [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <beschreibung>

[optionaler body]
```

**Typen:**

| Typ | Beschreibung |
|---|---|
| `feat` | Neues Feature |
| `fix` | Bugfix |
| `docs` | Nur Dokumentation |
| `style` | Formatierung (kein Code-Change) |
| `refactor` | Refactoring (kein neues Feature, kein Fix) |
| `perf` | Performance-Verbesserung |
| `test` | Tests hinzufügen/ändern |
| `chore` | Build, CI, Dependencies |

**Beispiele:**

```
feat(schematic): Busleitungen im Schaltplan-Editor
fix(perfboard): Lötbrücken-Rendering bei Zoom < 0.5
docs(readme): Screenshots hinzugefügt
refactor(engine): Netlist-Builder vereinfacht
```

---

## Pull Requests

1. Beschreibe **was** und **warum** du etwas geändert hast.
2. Verlinke zugehörige Issues (z.B. `Closes #42`).
3. Halte PRs möglichst klein und fokussiert.
4. Stelle sicher, dass `npm run build` fehlerfrei durchläuft.
5. Wenn du UI-Änderungen machst, füge ggf. Screenshots bei.

### PR-Template

Ein Template wird automatisch vorgeschlagen, wenn du einen PR erstellst.

---

## Code-Style

- **TypeScript** wird überall verwendet — kein `any` ohne guten Grund.
- **Funktionale React-Komponenten** mit Hooks.
- **Zustand** für State-Management (mit Immer für immutable Updates).
- **Tailwind CSS** für Styling — keine separaten CSS-Dateien (Ausnahme: `index.css`).
- **Lucide Icons** als Icon-Set.
- Dateien und Ordner in **kebab-case**: `schematic-editor/`, `auto-layout.ts`.
- Exportierte Typen in `src/types/index.ts`.
- Kommentare und UI-Texte auf **Deutsch** (Code und Variable-Namen auf Englisch).

---

## Issues melden

Gute Bug-Reports enthalten:

- **LochCAD-Version** (steht unten rechts in der App)
- **Browser & OS** (z.B. Chrome 120, Windows 11)
- **Schritte zum Reproduzieren** (1, 2, 3…)
- **Erwartetes Verhalten** vs. **tatsächliches Verhalten**
- **Screenshots** oder Screen-Recordings, wenn hilfreich
- **Konsolenausgabe** (F12 → Console), falls es Fehler gibt

---

## Sonstiges

- Große Features bitte **vorher als Issue diskutieren**, bevor viel Arbeit in einen PR fließt.
- Bei Fragen einfach ein Issue öffnen oder im PR kommentieren.
- Du bist unsicher, ob dein Beitrag passt? Frag einfach — wir beißen nicht.

---

Danke für deine Unterstützung!
