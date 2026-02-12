// ============================================================
// Auth Store — User profile for collaboration
// ============================================================

import { create } from 'zustand';
import { v4 as uuid } from 'uuid';

const AUTH_KEY = 'lochcad-user-profile';

const USER_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f43f5e', '#a855f7', '#64748b',
];

export interface UserProfile {
  id: string;
  displayName: string;
  color: string;
  email: string;
  createdAt: string;
}

interface AuthState {
  profile: UserProfile | null;
  isAuthModalOpen: boolean;
  createProfile: (name: string, color?: string, email?: string) => void;
  updateProfile: (updates: Partial<Pick<UserProfile, 'displayName' | 'color' | 'email'>>) => void;
  deleteProfile: () => void;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  hasAccount: () => boolean;
}

function loadProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProfile(profile: UserProfile) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(profile));
}

export function randomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

export const useAuthStore = create<AuthState>((set, get) => ({
  profile: loadProfile(),
  isAuthModalOpen: false,

  createProfile: (name, color, email) => {
    const profile: UserProfile = {
      id: uuid(),
      displayName: name,
      color: color || randomColor(),
      email: email || '',
      createdAt: new Date().toISOString(),
    };
    saveProfile(profile);
    set({ profile, isAuthModalOpen: false });
  },

  updateProfile: (updates) => {
    const current = get().profile;
    if (!current) return;
    const updated = { ...current, ...updates };
    saveProfile(updated);
    set({ profile: updated });
  },

  deleteProfile: () => {
    localStorage.removeItem(AUTH_KEY);
    set({ profile: null });
  },

  openAuthModal: () => set({ isAuthModalOpen: true }),
  closeAuthModal: () => set({ isAuthModalOpen: false }),
  hasAccount: () => !!get().profile,
}));
