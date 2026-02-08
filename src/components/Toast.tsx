import React from 'react';
import { useToastStore } from '@/stores/toastStore';
import { X, AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';

const iconMap = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
  success: CheckCircle,
};

const colorMap = {
  info: 'border-lochcad-accent text-lochcad-accent',
  warning: 'border-lochcad-accent-warm text-lochcad-accent-warm',
  error: 'border-lochcad-error text-lochcad-error',
  success: 'border-lochcad-success text-lochcad-success',
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-lg border bg-lochcad-surface shadow-lg animate-fade-in min-w-[260px] max-w-[400px] ${colorMap[toast.type]}`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="text-sm text-lochcad-text flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 hover:opacity-70 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
