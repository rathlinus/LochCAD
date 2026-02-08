import { create } from 'zustand';

export type ToastType = 'info' | 'warning' | 'error' | 'success';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastState {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  removeToast: (id: number) => void;
}

let _nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  showToast: (message, type = 'error') => {
    const id = _nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
