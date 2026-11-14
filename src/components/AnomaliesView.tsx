import React, { useState } from 'react';
import {
  AlertTriangle,
  Flame,
  Zap,
  Lock,
  HardDrive,
  Copy,
  Check,
  ChevronRight,
  ShieldAlert,
  ArrowUpRight,
  Wrench,
} from 'lucide-react';
import { QueryAnomaly, TopSQLItem } from '../types';

interface AnomaliesViewProps {
  anomalies: QueryAnomaly[];
  loading: boolean;
  onScopeToQuery: (sqlId: string) => void;
  onOpenSqlDetail: (item: TopSQLItem) => void;
}

export const AnomaliesView: React.FC<AnomaliesViewProps> = ({
  anomalies,
  loading,
  onScopeToQuery,
  onOpenSqlDetail,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-slate-500 flex flex-col items-center justify-center">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mb-2" />
        <span className="text-xs">Analyzing queries for sequential scan and lock anomalies...</span>
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div className="py-10 text-center bg-slate-900/40 rounded-xl border border-slate-800">
        <ShieldAlert className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
        <h4 className="text-sm font-semibold text-white">No Toxic Query Anomalies Detected</h4>
        <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
          All active queries in this time slice are operating within safe I/O and lock limits without
          buffer pool cache thrashing or CPU monopolization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Alert Header */}
      <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-500/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-xs transition-colors shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-rose-500/20 text-rose-500 dark:text-rose-400 shrink-0">
            <Flame className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="font-semibold text-rose-900 dark:text-rose-200 text-sm flex items-center gap-2">
              <span>{anomalies.length} Database-Degrading Query Anomalies Flagged</span>
            </div>
            <div className="text-rose-700/80 dark:text-rose-300/80 mt-0.5">
              These queries are consuming disproportionate I/O and locks, evicting cache blocks, and driving cascading connection latency.
            </div>
          </div>
        </div>
      </div>

      {/* Anomaly Cards Grid */}
      <div className="grid grid-cols-1 gap-3.5">
        {anomalies.map((anom) => {
          const isCritical = anom.severity === 'CRITICAL';
          const isIoChoker = anom.anomalyType === 'IO_CHOKER' || anom.anomalyType === 'BUFFER_BLOAT';
          const isLock = anom.anomalyType === 'LOCK_CONVOY';

          const icon = isIoChoker ? (
            <HardDrive className="w-4 h-4 text-rose-500 dark:text-rose-400" />
          ) : isLock ? (
            <Lock className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          ) : (
            <Zap className="w-4 h-4 text-red-500 dark:text-red-400" />
          );

          return (
            <div
              key={anom.sqlId}
              className={`rounded-xl border p-4.5 transition-all bg-white dark:bg-slate-900/60 shadow-sm ${
                isCritical
                  ? 'border-rose-300 dark:border-rose-500/40 hover:border-rose-400 dark:hover:border-rose-500/70 shadow-rose-900/5 dark:shadow-rose-950/20'
                  : 'border-amber-300 dark:border-amber-500/30 hover:border-amber-400 dark:hover:border-amber-500/50'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="flex items-center space-x-2.5">
                  <div
                    className={`p-1.5 rounded-lg shrink-0 ${
                      isCritical ? 'bg-rose-500/15' : 'bg-amber-500/15'
                    }`}
                  >
                    {icon}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900 dark:text-white text-sm tracking-tight">
                        {anom.anomalyTitle}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                          isCritical
                            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {anom.severity}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      SQL ID: {anom.sqlId}
                    </div>
                  </div>
                </div>

                {/* Score & Capacity Badges */}
                <div className="flex items-center space-x-2 text-xs font-mono">
                  <div className="bg-slate-100 dark:bg-slate-950 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 text-[10px]">Toxicity:</span>{' '}
                    <strong
                      className={
                        anom.toxicityScore >= 80 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'
                      }
                    >
                      {anom.toxicityScore}/100
                    </strong>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 text-[10px]">AAS Load:</span>{' '}
                    <strong className="text-slate-900 dark:text-white">{anom.loadAAS.toFixed(2)}</strong>{' '}
                    <span className="text-slate-500 dark:text-slate-400 text-[10px]">({anom.pctOfVcpus}% vCPUs)</span>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-950 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 text-[10px]">Dominant Wait:</span>{' '}
                    <span className="text-indigo-600 dark:text-indigo-300 font-semibold">{anom.dominantWaitEvent}</span>
                  </div>
                </div>
              </div>

              {/* SQL Statement Box */}
              <div className="mb-3">
                <div className="font-mono text-xs text-slate-800 dark:text-slate-200 bg-slate-100/90 dark:bg-slate-950/80 p-3 rounded-lg border border-slate-200 dark:border-slate-800/80 leading-relaxed overflow-x-auto max-h-24">
                  {anom.sqlText}
                </div>
              </div>

              {/* Diagnosis & Impact Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-xs">
                <div className="bg-slate-50 dark:bg-slate-950/40 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <span className="font-semibold text-rose-700 dark:text-rose-300 block mb-1">Root Cause Mechanics:</span>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{anom.rootCause}</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-950/40 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <span className="font-semibold text-amber-700 dark:text-amber-300 block mb-1">Cascading System Impact:</span>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{anom.impactAnalysis}</p>
                </div>
              </div>

              {/* Remediation & DDL Suggestion */}
              {anom.suggestedDdl && (
                <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-lg p-3 text-xs mb-3 space-y-1.5">
                  <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 font-semibold">
                    <div className="flex items-center space-x-1.5">
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Recommended Index Remediation (Zero-Downtime DDL):</span>
                    </div>
                    <button
                      onClick={() => handleCopy(anom.suggestedDdl!, anom.sqlId + '_ddl')}
                      className="text-[11px] text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-white flex items-center space-x-1 bg-emerald-100/80 dark:bg-emerald-900/40 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-700/50 transition font-medium"
                    >
                      {copiedId === anom.sqlId + '_ddl' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy DDL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="font-mono text-[11px] text-emerald-900 dark:text-emerald-200 bg-white dark:bg-black/60 p-2 rounded border border-emerald-200 dark:border-transparent overflow-x-auto">
                    {anom.suggestedDdl}
                  </pre>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800/80 text-xs">
                <span className="text-slate-600 dark:text-slate-400">{anom.suggestedFix}</span>
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => onScopeToQuery(anom.sqlId)}
                    className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-medium transition flex items-center space-x-1"
                  >
                    <span>Scope AAS Chart</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() =>
                      onOpenSqlDetail({
                        id: anom.sqlId,
                        sql: anom.sqlText,
                        loadAAS: anom.loadAAS,
                        loadWaitBreakdown: anom.waitBreakdown,
                        callsPerSec: 0,
                        avgLatencyMs: 0,
                        rowsPerCall: 0,
                        user: 'db_user',
                        database: 'db',
                      })
                    }
                    className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium border border-slate-200 dark:border-slate-700 transition"
                  >
                    Inspect Full Query
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
