// ============================================================
// AuthModal — Create / Edit User Profile for Collaboration
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore, randomColor } from '@/stores/authStore';
import { X, User, Palette } from 'lucide-react';

const COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f43f5e', '#a855f7', '#64748b',
];

export function AuthModal() {
  const { profile, isAuthModalOpen, closeAuthModal, createProfile, updateProfile } = useAuthStore();
  const isEditing = !!profile;

  const [name, setName] = useState(profile?.displayName || '');
  const [color, setColor] = useState(profile?.color || randomColor());
  const [email, setEmail] = useState(profile?.email || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAuthModalOpen) {
      setName(profile?.displayName || '');
      setColor(profile?.color || randomColor());
      setEmail(profile?.email || '');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isAuthModalOpen, profile]);

  if (!isAuthModalOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    if (isEditing) {
      updateProfile({ displayName: trimmedName, color, email: email.trim() });
      closeAuthModal();
    } else {
      createProfile(trimmedName, color, email.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeAuthModal}>
      <div
        className="bg-lochcad-surface border border-lochcad-panel/40 rounded-xl shadow-2xl w-[400px] max-w-[95vw] animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-lochcad-panel/30">
          <div className="flex items-center gap-2">
            <User size={18} className="text-lochcad-accent" />
            <h2 className="text-sm font-semibold text-lochcad-text">
              {isEditing ? 'Profil bearbeiten' : 'Account erstellen'}
            </h2>
          </div>
          <button onClick={closeAuthModal} className="btn-icon">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Display Name */}
          <div>
            <label className="block text-xs text-lochcad-text-dim mb-1.5">Anzeigename *</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dein Name..."
              className="w-full px-3 py-2 bg-lochcad-bg border border-lochcad-panel/40 rounded-lg text-sm text-lochcad-text focus:border-lochcad-accent focus:outline-none"
              maxLength={30}
              required
            />
          </div>

          {/* Email (optional) */}
          <div>
            <label className="block text-xs text-lochcad-text-dim mb-1.5">E-Mail (optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 bg-lochcad-bg border border-lochcad-panel/40 rounded-lg text-sm text-lochcad-text focus:border-lochcad-accent focus:outline-none"
            />
          </div>

          {/* Color Picker */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-lochcad-text-dim mb-2">
              <Palette size={12} />
              Cursor-Farbe
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`w-7 h-7 rounded-full border-2 transition-all duration-150 hover:scale-110 ${
                    color === c
                      ? 'border-white shadow-lg scale-110'
                      : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-3 p-3 bg-lochcad-bg/60 rounded-lg border border-lochcad-panel/20">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md"
              style={{ backgroundColor: color }}
            >
              {name.trim() ? name.trim()[0].toUpperCase() : '?'}
            </div>
            <div>
              <div className="text-sm text-lochcad-text font-medium">
                {name.trim() || 'Dein Name'}
              </div>
              <div className="text-[10px] text-lochcad-text-dim">
                So sehen andere deinen Cursor
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2.5 bg-lochcad-accent hover:bg-lochcad-accent/90 disabled:bg-lochcad-panel/40 disabled:text-lochcad-text-dim text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isEditing ? 'Speichern' : 'Account erstellen'}
          </button>

          {!isEditing && (
            <p className="text-[10px] text-lochcad-text-dim text-center">
              Der Account wird lokal in deinem Browser gespeichert.
              Kein Passwort nötig.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
