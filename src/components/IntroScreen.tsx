import React, { useState } from 'react';

const STORAGE_KEY = 'lochcad-hide-intro';

// ── Tutorial steps ──────────────────────────────────────────────
const tutorialSteps = [
  {
    title: 'Schaltplan zeichnen',
    content: [
      'Wähle ein Bauteil aus der Bibliothek (links) und klicke auf die Zeichenfläche, um es zu platzieren.',
      'Mit R drehen, mit X spiegeln.',
      'Werkzeug „Draht" (W) auswählen und Pins durch Klicken verbinden. Doppelklick beendet den Draht.',
      'Net-Labels (L) benennen zusammengehörende Netze, auch über Blätter hinweg.',
    ],
  },
  {
    title: 'Auf Lochraster übertragen',
    content: [
      'Über Werkzeuge → „Sync Schaltplan → Lochraster" werden die Bauteile auf die Platine übertragen.',
      'Im Lochraster-Tab Bauteile per Drag & Drop oder über Auto-Layout anordnen.',
      'Verbindungen manuell mit dem Draht-Werkzeug (W) routen — oder den Autorouter verwenden.',
      'Zusätzlich gibt es Drahtbrücken (oben) und Lötbrücken (unten) für benachbarte Löcher.',
    ],
  },
  {
    title: 'Prüfen & Exportieren',
    content: [
      'ERC (Schaltplan) und DRC (Lochraster) prüfen auf Fehler wie fehlende Verbindungen oder Kurzschlüsse.',
      'Unter 3D-Ansicht das Layout räumlich kontrollieren.',
      'Über Datei → Export: .lochcad-Projekt, SPICE-Netzliste, Stückliste (CSV/HTML) oder Netzlisten-JSON.',
    ],
  },
];

// ── Main component ──────────────────────────────────────────────
export function IntroScreen({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  // ── Tutorial view ──
  if (showTutorial) {
    const step = tutorialSteps[tutorialStep];
    const isLast = tutorialStep === tutorialSteps.length - 1;

    return (
      <div
        className={`fixed inset-0 z-[9999] flex items-center justify-center bg-lochcad-bg/90 transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="relative w-full max-w-xl mx-4 rounded-lg border border-lochcad-panel/30 bg-lochcad-surface shadow-lg">
          {/* Step header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-7 h-7 rounded bg-lochcad-accent/20 text-lochcad-accent text-xs font-bold font-mono">
                {tutorialStep + 1}
              </span>
              <h2 className="text-sm font-semibold text-lochcad-text">{step.title}</h2>
            </div>
            <span className="text-[10px] text-lochcad-text-dim font-mono">
              {tutorialStep + 1}/{tutorialSteps.length}
            </span>
          </div>

          {/* Step progress bar */}
          <div className="mx-5 h-0.5 rounded-full bg-lochcad-panel/20 mb-4">
            <div
              className="h-full rounded-full bg-lochcad-accent transition-all duration-300"
              style={{ width: `${((tutorialStep + 1) / tutorialSteps.length) * 100}%` }}
            />
          </div>

          {/* Step content */}
          <ul className="mx-5 mb-4 space-y-1.5">
            {step.content.map((line, i) => (
              <li key={i} className="flex gap-2.5 text-xs text-lochcad-text/85 leading-relaxed">
                <span className="text-lochcad-accent mt-0.5 shrink-0">›</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {/* Nav */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-lochcad-panel/20">
            <button
              onClick={() => {
                if (tutorialStep === 0) setShowTutorial(false);
                else setTutorialStep((s) => s - 1);
              }}
              className="text-xs text-lochcad-text-dim hover:text-lochcad-text transition-colors cursor-pointer"
            >
              {tutorialStep === 0 ? '← Zurück' : '← Vorheriger Schritt'}
            </button>
            <button
              onClick={() => {
                if (isLast) handleClose();
                else setTutorialStep((s) => s + 1);
              }}
              className="px-4 py-1.5 rounded bg-lochcad-accent hover:bg-lochcad-accent-hover text-white text-xs font-medium transition-colors cursor-pointer"
            >
              {isLast ? 'Fertig' : 'Weiter →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Welcome view ──
  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-lochcad-bg/90 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`relative w-full max-w-xl mx-4 rounded-lg border border-lochcad-panel/30 bg-lochcad-surface shadow-lg transform transition-all duration-300 ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Logo + title */}
        <div className="flex flex-col items-center pt-5 pb-1 px-6">
          <img src="/lochcad-logo.svg" alt="LochCAD" className="w-16 h-16 mb-3" />
          <h1 className="text-xl font-bold text-lochcad-text font-mono tracking-tight">
            LochCAD
          </h1>
          <span className="text-[11px] text-lochcad-text-dim mt-1 font-mono">
            v0.3.8 &mdash; Schaltplan &amp; Lochraster CAD
          </span>
        </div>

        {/* Description */}
        <p className="mx-6 mt-2 mb-3 text-xs text-lochcad-text-dim leading-relaxed text-center">
          Schaltpläne zeichnen, auf Lochraster übertragen, in 3D prüfen und als
          Netzliste oder Stückliste exportieren — kostenlos im Browser.
        </p>

        {/* What you can do */}
        <div className="mx-6 mb-2 grid grid-cols-4 gap-2">
          <InfoChip label="Schaltplan-Editor" sub="Symbole, Drähte, Busse" />
          <InfoChip label="Lochraster-Editor" sub="Platine, Lötbrücken, Routing" />
          <InfoChip label="3D-Vorschau" sub="Interaktive Boardansicht" />
          <InfoChip label="Export" sub="SPICE, BOM, .lochcad" />
        </div>

        {/* Shortcuts */}
        <div className="mx-6 mb-3 border border-lochcad-panel/20 rounded bg-lochcad-bg/50 grid grid-cols-2 divide-lochcad-panel/15">
          <ShortcutRow keys="Ctrl+S" label="Projekt speichern" />
          <ShortcutRow keys="Ctrl+Shift+P" label="Projektmanager" />
          <ShortcutRow keys="Ctrl+N" label="Neues Projekt" />
          <ShortcutRow keys="Ctrl+O" label="Projekt öffnen" />
          <ShortcutRow keys="W" label="Draht-Werkzeug" />
          <ShortcutRow keys="R / X" label="Drehen / Spiegeln" />
          <ShortcutRow keys="Del / ⌫" label="Auswahl löschen" />
          <ShortcutRow keys="Ctrl+Z / Y" label="Undo / Redo" />
          <ShortcutRow keys="Ctrl+A" label="Alles auswählen" />
          <ShortcutRow keys="Ctrl+= / −" label="Zoom rein / raus" />
          <ShortcutRow keys="Ctrl+0" label="Zoom zurücksetzen" />
          <ShortcutRow keys="Esc" label="Werkzeug abbrechen" />
        </div>

        {/* Tutorial button */}
        <div className="mx-6 mb-3">
          <button
            onClick={() => setShowTutorial(true)}
            className="w-full py-2 rounded border border-lochcad-panel/30 bg-lochcad-bg/50 hover:bg-lochcad-panel/25 text-xs text-lochcad-text-dim hover:text-lochcad-text transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-lochcad-accent">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Kurzanleitung anzeigen
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-lochcad-panel/20">
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <input
              type="checkbox"
              className="accent-lochcad-accent w-3.5 h-3.5 cursor-pointer"
              onChange={(e) => {
                if (e.target.checked) localStorage.setItem(STORAGE_KEY, 'true');
                else localStorage.removeItem(STORAGE_KEY);
              }}
            />
            <span className="text-[11px] text-lochcad-text-dim group-hover:text-lochcad-text transition-colors">
              Nicht mehr anzeigen
            </span>
          </label>
          <button
            onClick={handleClose}
            className="px-5 py-1.5 rounded bg-lochcad-accent hover:bg-lochcad-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            Weiter
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Small helpers ───────────────────────────────────────────────

function InfoChip({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="rounded bg-lochcad-bg/50 border border-lochcad-panel/15 px-3 py-2">
      <div className="text-[11px] font-medium text-lochcad-text">{label}</div>
      <div className="text-[10px] text-lochcad-text-dim mt-0.5">{sub}</div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-xs border-r border-b border-lochcad-panel/15 last:border-r-0 [&:nth-last-child(-n+2)]:border-b-0">
      <span className="text-lochcad-text-dim">{label}</span>
      <div className="flex items-center gap-1">
        {keys.split(/(\s*\/\s*|\s*\+\s*)/).map((part, i) => {
          const trimmed = part.trim();
          if (!trimmed) return null;
          if (trimmed === '+' || trimmed === '/') {
            return (
              <span key={i} className="text-lochcad-text-dim text-[10px]">{trimmed}</span>
            );
          }
          return (
            <kbd
              key={i}
              className="px-1.5 py-0.5 rounded bg-lochcad-panel/30 text-lochcad-text font-mono text-[10px] border border-lochcad-panel/20"
            >
              {trimmed}
            </kbd>
          );
        })}
      </div>
    </div>
  );
}

export function shouldShowIntro(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'true';
}
