// ============================================================
// CheckPanel — Error list for DRC / ERC results
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  X,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MapPin,
  RefreshCw,
  Trash2,
  Filter,
} from 'lucide-react';
import { useCheckStore } from '@/stores/checkStore';
import type { Violation } from '@/types';

type SeverityFilter = 'all' | 'error' | 'warning' | 'info';

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error: <AlertCircle size={14} className="text-red-400 shrink-0" />,
  warning: <AlertTriangle size={14} className="text-yellow-400 shrink-0" />,
  info: <Info size={14} className="text-blue-400 shrink-0" />,
};

const SEVERITY_BG: Record<string, string> = {
  error: 'border-l-red-500 bg-red-500/5 hover:bg-red-500/10',
  warning: 'border-l-yellow-500 bg-yellow-500/5 hover:bg-yellow-500/10',
  info: 'border-l-blue-500 bg-blue-500/5 hover:bg-blue-500/10',
};

const TYPE_LABELS: Record<string, string> = {
  // ERC
  unconnected_pin: 'Nicht verbundener Pin',
  multiple_drivers: 'Mehrere Treiber',
  no_driver: 'Kein Treiber',
  no_power_source: 'Keine Stromquelle',
  conflicting_pin_types: 'Pin-Typ-Konflikt',
  unconnected_wire: 'Nicht verbundener Draht',
  floating_wire: 'Loses Drahtende',
  duplicate_reference: 'Doppeltes Kennzeichen',
  missing_value: 'Fehlender Wert',
  short_circuit: 'Kurzschluss',
  // DRC
  overlapping_components: 'Überlappende Bauteile',
  out_of_bounds: 'Außerhalb der Grenzen',
  unconnected_net: 'Nicht verbundenes Netz',
  missing_track_cut: 'Fehlender Leiterbahn-Schnitt',
  crowded_strip: 'Überfüllte Leiterbahn',
  connection_out_of_bounds: 'Verbindung außerhalb',
};

function ViolationItem({
  violation,
  isHighlighted,
  onHighlight,
}: {
  violation: Violation;
  isHighlighted: boolean;
  onHighlight: (id: string | null) => void;
}) {
  return (
    <button
      className={`w-full text-left px-3 py-2 border-l-2 transition-colors cursor-pointer ${
        SEVERITY_BG[violation.severity]
      } ${isHighlighted ? 'ring-1 ring-lochcad-accent/50 bg-lochcad-accent/10' : ''}`}
      onClick={() => onHighlight(isHighlighted ? null : violation.id)}
    >
      <div className="flex items-start gap-2">
        {SEVERITY_ICON[violation.severity]}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-lochcad-panel/40 text-gray-400 shrink-0">
              {TYPE_LABELS[violation.type] || violation.type}
            </span>
          </div>
          <p className="text-[11px] text-gray-300 mt-1 break-words leading-relaxed">
            {violation.message}
          </p>
          {violation.position && (
            <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-500">
              <MapPin size={10} />
              {'x' in violation.position
                ? `(${Math.round(violation.position.x)}, ${Math.round(violation.position.y)})`
                : `Hole (${violation.position.col}, ${violation.position.row})`}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function SummaryBadge({ count, severity }: { count: number; severity: string }) {
  const colors: Record<string, string> = {
    error: 'bg-red-500/20 text-red-400',
    warning: 'bg-yellow-500/20 text-yellow-400',
    info: 'bg-blue-500/20 text-blue-400',
  };
  if (count === 0) return null;
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${colors[severity]}`}>
      {count}
    </span>
  );
}

export function CheckPanel() {
  const panelOpen = useCheckStore((s) => s.panelOpen);
  const activeCheck = useCheckStore((s) => s.activeCheck);
  const ercResult = useCheckStore((s) => s.ercResult);
  const drcResult = useCheckStore((s) => s.drcResult);
  const highlightedId = useCheckStore((s) => s.highlightedViolationId);
  const closePanel = useCheckStore((s) => s.closePanel);
  const highlightViolation = useCheckStore((s) => s.highlightViolation);
  const runERCCheck = useCheckStore((s) => s.runERCCheck);
  const runDRCCheck = useCheckStore((s) => s.runDRCCheck);
  const clearResults = useCheckStore((s) => s.clearResults);
  const setActiveCheck = useCheckStore((s) => s.setActiveCheck);

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['error', 'warning', 'info']));

  const result = activeCheck === 'erc' ? ercResult : activeCheck === 'drc' ? drcResult : null;
  const violations = result?.violations || [];

  const filteredViolations = severityFilter === 'all'
    ? violations
    : violations.filter(v => v.severity === severityFilter);

  // Group by severity
  const grouped = useMemo(() => {
    const groups: Record<string, Violation[]> = { error: [], warning: [], info: [] };
    for (const v of filteredViolations) {
      groups[v.severity]?.push(v);
    }
    return groups;
  }, [filteredViolations]);

  if (!panelOpen) return null;

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const passed = result?.passed;
  const timestamp = result?.timestamp
    ? new Date(result.timestamp).toLocaleTimeString()
    : null;

  return (
    <div className="w-80 bg-lochcad-surface border-l border-lochcad-panel/30 flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-lochcad-panel/30">
        <div className="flex items-center gap-2">
          {/* Tab buttons */}
          <button
            className={`text-xs px-2 py-1 rounded transition-colors ${
              activeCheck === 'erc'
                ? 'bg-lochcad-accent/20 text-lochcad-accent'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            onClick={() => setActiveCheck('erc')}
          >
            ERC
          </button>
          <button
            className={`text-xs px-2 py-1 rounded transition-colors ${
              activeCheck === 'drc'
                ? 'bg-lochcad-accent/20 text-lochcad-accent'
                : 'text-gray-400 hover:text-gray-200'
            }`}
            onClick={() => setActiveCheck('drc')}
          >
            DRC
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn-icon"
            onClick={() => activeCheck === 'erc' ? runERCCheck() : runDRCCheck()}
            data-tooltip="Re-run check"
          >
            <RefreshCw size={14} />
          </button>
          <button
            className="btn-icon"
            onClick={() => clearResults(activeCheck || undefined)}
            data-tooltip="Clear results"
          >
            <Trash2 size={14} />
          </button>
          <button className="btn-icon" onClick={closePanel} data-tooltip="Close panel">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {result && (
        <div className="px-3 py-2 border-b border-lochcad-panel/20 flex items-center gap-2">
          {passed && violations.length === 0 ? (
            <div className="flex items-center gap-1.5 text-green-400 text-xs">
              <CheckCircle2 size={14} />
              <span>All checks passed</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <SummaryBadge count={result.summary.errors} severity="error" />
              <SummaryBadge count={result.summary.warnings} severity="warning" />
              <SummaryBadge count={result.summary.info ?? 0} severity="info" />
              <span className="text-[10px] text-gray-500">
                {violations.length} issue{violations.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
          {timestamp && (
            <span className="text-[10px] text-gray-600 ml-auto">{timestamp}</span>
          )}
        </div>
      )}

      {/* Filter bar */}
      {violations.length > 0 && (
        <div className="px-3 py-1.5 border-b border-lochcad-panel/20 flex items-center gap-1">
          <Filter size={12} className="text-gray-500" />
          {(['all', 'error', 'warning', 'info'] as SeverityFilter[]).map((f) => (
            <button
              key={f}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                severityFilter === f
                  ? 'bg-lochcad-accent/20 text-lochcad-accent'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => setSeverityFilter(f)}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Violation list */}
      <div className="flex-1 overflow-y-auto">
        {!result && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 text-xs gap-2 px-4 text-center">
            <AlertTriangle size={24} className="text-gray-600" />
            <p>
              Run {activeCheck === 'erc' ? 'ERC' : activeCheck === 'drc' ? 'DRC' : 'a check'} to
              see results
            </p>
            <button
              className="px-3 py-1.5 rounded bg-lochcad-accent/20 text-lochcad-accent hover:bg-lochcad-accent/30 transition-colors text-xs mt-1"
              onClick={() => activeCheck === 'erc' ? runERCCheck() : activeCheck === 'drc' ? runDRCCheck() : null}
            >
              Run {activeCheck === 'erc' ? 'ERC' : 'DRC'}
            </button>
          </div>
        )}

        {result && violations.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-green-400 text-xs gap-2">
            <CheckCircle2 size={24} />
            <p>No issues found!</p>
          </div>
        )}

        {result && filteredViolations.length === 0 && violations.length > 0 && (
          <div className="flex items-center justify-center h-32 text-gray-500 text-xs">
            No {severityFilter} issues found
          </div>
        )}

        {/* Grouped violations */}
        {(['error', 'warning', 'info'] as const).map((severity) => {
          const items = grouped[severity];
          if (!items || items.length === 0) return null;
          const isExpanded = expandedGroups.has(severity);

          return (
            <div key={severity}>
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium bg-lochcad-panel/20 hover:bg-lochcad-panel/30 transition-colors border-b border-lochcad-panel/10"
                onClick={() => toggleGroup(severity)}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {SEVERITY_ICON[severity]}
                <span className="capitalize">{severity}s</span>
                <span className="text-gray-500 ml-auto">{items.length}</span>
              </button>
              {isExpanded && (
                <div className="divide-y divide-lochcad-panel/10">
                  {items.map((v) => (
                    <ViolationItem
                      key={v.id}
                      violation={v}
                      isHighlighted={highlightedId === v.id}
                      onHighlight={highlightViolation}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
