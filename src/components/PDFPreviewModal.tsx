import React, { useRef, useEffect } from 'react';
import { X, Download } from 'lucide-react';

interface PDFPreviewModalProps {
  blobUrl: string;
  filename: string;
  onClose: () => void;
}

export function PDFPreviewModal({ blobUrl, filename, onClose }: PDFPreviewModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.click();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="bg-lochcad-surface rounded-xl border border-lochcad-panel/40 shadow-2xl w-[90vw] max-w-[900px] h-[90vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-lochcad-panel/30 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-lochcad-accent/15 flex items-center justify-center">
              <Download size={16} className="text-lochcad-accent" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-lochcad-text leading-tight">Bestueckungsplan Vorschau</h2>
              <p className="text-[10px] text-lochcad-text-dim">{filename}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-lochcad-accent text-white hover:bg-lochcad-accent/80 transition-colors"
              onClick={handleDownload}
            >
              <Download size={14} />
              PDF herunterladen
            </button>
            <button className="btn-icon hover:bg-lochcad-panel/40" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* PDF Preview */}
        <div className="flex-1 min-h-0 p-2">
          <iframe
            src={blobUrl}
            className="w-full h-full rounded-lg border border-lochcad-panel/20"
            title="PDF Vorschau"
          />
        </div>
      </div>
    </div>
  );
}
