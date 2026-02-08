import React, { useState } from 'react';

const STORAGE_KEY = 'lochcad-hide-intro';

export function IntroScreen({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = useState(true);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  const handleDontShowAgain = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    handleClose();
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-lochcad-bg/90 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`relative w-full max-w-md mx-4 rounded-lg border border-lochcad-panel/30 bg-lochcad-surface shadow-lg transform transition-all duration-300 ${
          visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Logo + title */}
        <div className="flex flex-col items-center pt-8 pb-4 px-6">
          <img src="/lochcad-logo.svg" alt="LochCAD" className="w-24 h-24 mb-4" />
          <h1 className="text-xl font-bold text-lochcad-text font-mono tracking-tight">
            LochCAD
          </h1>
          <span className="text-[11px] text-lochcad-text-dim mt-1 font-mono">
            v0.3.8 &mdash; Schaltplan &amp; Lochraster CAD
          </span>
        </div>

        {/* Shortcuts */}
        <div className="mx-6 mb-4 border border-lochcad-panel/20 rounded bg-lochcad-bg/50 divide-y divide-lochcad-panel/15">
          <ShortcutRow keys="Ctrl+S" label="Projekt speichern" />
          <ShortcutRow keys="Ctrl+Shift+P" label="Projektmanager öffnen" />
          <ShortcutRow keys="Ctrl+N" label="Neues Projekt" />
          <ShortcutRow keys="Ctrl+O" label="Projekt öffnen" />
          <ShortcutRow keys="Ctrl+E" label="Projekt exportieren" />
          <ShortcutRow keys="Ctrl+Z / Y" label="Rückgängig / Wiederholen" />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-lochcad-panel/20">
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

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs">
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
