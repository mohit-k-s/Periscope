import React, { useState } from 'react';
import { TopSQLItem, WAIT_CATEGORY_COLORS, QueryAnomaly, categorizeWaitEvent } from '../types';
import { Copy, Check, ExternalLink, Filter, Code, Flame } from 'lucide-react';

interface TopSqlTableProps {
  items: TopSQLItem[];
  anomalies?: QueryAnomaly[];
  selectedSqlId?: string;
  selectedSqlIds?: string[];
  onSelectSql: (item: TopSQLItem) => void;
  onSelectAllSql?: () => void;
  onClearSqlSelection?: () => void;
  onOpenDetails: (item: TopSQLItem) => void;
  maxLoadAAS?: number;
}

export const TopSqlTable: React.FC<TopSqlTableProps> = ({
  items,
  anomalies = [],
  selectedSqlId,
  selectedSqlIds = [],
  onSelectSql,
  onSelectAllSql,
  onClearSqlSelection,
  onOpenDetails,
  maxLoadAAS = 10,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeIds = selectedSqlIds.length > 0
    ? selectedSqlIds
    : (selectedSqlId ? [selectedSqlId] : []);

  const allSelected = items.length > 0 && items.every((i) => activeIds.includes(i.id));

  const handleCopy = (sql: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(sql);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const highestLoad = Math.max(...items.map((i) => i.loadAAS), 1);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 font-semibold tracking-wider uppercase text-[10px] transition-colors">
            <th className="py-2.5 px-3 w-10 text-center">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  if (allSelected) {
                    onClearSqlSelection?.();
                  } else {
                    onSelectAllSql?.();
                  }
                }}
                title={allSelected ? 'Deselect all queries' : 'Select all queries'}
                className="rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-amber-500 focus:ring-amber-500/30 cursor-pointer w-3.5 h-3.5"
              />
            </th>
            <th className="py-2.5 px-4 w-48">Load by Wait (AAS)</th>
            <th className="py-2.5 px-4">
              <div className="flex items-center gap-2">
                <span>SQL Statement</span>
                {activeIds.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-normal lowercase text-[10px] border border-amber-500/30 font-semibold">
                    {activeIds.length} selected
                  </span>
                )}
              </div>
            </th>
            <th className="py-2.5 px-3 text-right">Calls/sec</th>
            <th className="py-2.5 px-3 text-right">Rows/sec</th>
            <th className="py-2.5 px-3 text-right">Avg Latency</th>
            <th className="py-2.5 px-3 text-center w-24">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/60 font-sans">
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-8 text-center text-slate-400 dark:text-slate-500">
                No active SQL queries found in the selected time slice
              </td>
            </tr>
          ) : (
            items.map((item, rowIdx) => {
              const isSelected = activeIds.includes(item.id);
              const loadPercent = Math.min(100, (item.loadAAS / highestLoad) * 100);

              return (
                <tr
                  key={item.id}
                  onClick={() => onSelectSql(item)}
                  title={isSelected ? 'Click to unscope this query' : 'Click to scope AAS chart to this query (multi-select supported)'}
                  className={`group cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:hover:bg-amber-500/20 border-l-4 border-amber-500 dark:border-amber-400'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/60 border-l-4 border-transparent'
                  }`}
                >
                  {/* Multi-select Checkbox */}
                  <td className="py-3 px-3 text-center align-top pt-3.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onSelectSql(item)}
                      className="rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-amber-500 focus:ring-amber-500/30 cursor-pointer w-3.5 h-3.5"
                    />
                  </td>
                  {/* Load by Wait Segmented Bar */}
                  <td className="py-3 px-4 align-top">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 w-10 text-right">
                        {item.loadAAS.toFixed(2)}
                      </span>
                      <div className="relative group/bar flex-1">
                        <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden flex shadow-inner cursor-pointer">
                          {Object.entries(item.loadWaitBreakdown).map(([cat, pct]) => {
                            const category = categorizeWaitEvent(cat);
                            const col = WAIT_CATEGORY_COLORS[category] || WAIT_CATEGORY_COLORS.Other;
                            const sliceAAS = +(item.loadAAS * (pct / 100)).toFixed(2);
                            return (
                              <div
                                key={cat}
                                title={`${cat} (${col.label}): ${sliceAAS > 0 ? `${sliceAAS} AAS · ` : ''}${pct}%`}
                                style={{
                                  width: `${(pct / 100) * loadPercent}%`,
                                  backgroundColor: col.bg,
                                }}
                                className="h-full transition-all hover:brightness-110"
                              />
                            );
                          })}
                        </div>

                        {/* Interactive Legend Popover matching AWS Performance Insights UX */}
                        <div
                          className={`absolute left-0 ${
                            rowIdx < 2 ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
                          } hidden group-hover/bar:block z-50 pointer-events-none`}
                        >
                          <div className="bg-slate-900/95 dark:bg-slate-900/95 text-white text-[11px] rounded-lg p-3 shadow-2xl border border-slate-700/80 min-w-[220px] font-mono backdrop-blur-md">
                            <div className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider mb-2 border-b border-slate-700/60 pb-1 flex justify-between items-center">
                              <span>Legend</span>
                              <span className="text-amber-400 font-mono font-bold">{item.loadAAS.toFixed(2)} AAS</span>
                            </div>
                            <div className="space-y-1.5">
                              {Object.entries(item.loadWaitBreakdown)
                                .sort(([, a], [, b]) => b - a)
                                .map(([cat, pct]) => {
                                  const category = categorizeWaitEvent(cat);
                                  const col = WAIT_CATEGORY_COLORS[category] || WAIT_CATEGORY_COLORS.Other;
                                  const sliceAAS = +(item.loadAAS * (pct / 100)).toFixed(2);
                                  return (
                                    <div key={cat} className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.bg }} />
                                        <span className="text-slate-200 truncate max-w-[130px]" title={cat}>{cat}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0 font-mono text-[10px]">
                                        <span className="text-slate-100 font-semibold">
                                          {sliceAAS < 0.01 && sliceAAS > 0 ? '< 0.01' : sliceAAS.toFixed(2)}
                                        </span>
                                        <span className="text-slate-400">({pct}%)</span>
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* SQL Statement Preview */}
                  <td className="py-3 px-4 align-top">
                    {(() => {
                      const anom = anomalies.find((a) => a.sqlId === item.id);
                      return (
                        <div className="flex items-start gap-2">
                          <div className="flex-1">
                            {anom && (
                              <div className="mb-1.5 flex items-center gap-1.5">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wide ${
                                    anom.severity === 'CRITICAL'
                                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 dark:border-rose-500/40'
                                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 dark:border-amber-500/40'
                                  }`}
                                >
                                  <Flame className="w-3 h-3 text-rose-500 dark:text-rose-400" />
                                  <span>{anom.anomalyTitle}</span>
                                  <span className="opacity-75">({anom.toxicityScore}/100)</span>
                                </span>
                              </div>
                            )}
                            <div className="font-mono text-slate-800 dark:text-slate-200 text-xs line-clamp-2 leading-relaxed bg-slate-100/90 dark:bg-slate-950/60 p-2 rounded border border-slate-200 dark:border-slate-800/80 group-hover:border-slate-300 dark:group-hover:border-slate-700">
                              {item.sql}
                            </div>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500 font-mono">
                              <span>ID: {item.id.slice(0, 16)}...</span>
                              {isSelected && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/30">
                                  ● Scoped to Chart
                                </span>
                              )}
                              <span>•</span>
                              <span>User: {item.user}</span>
                              <span>•</span>
                              <span>DB: {item.database}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </td>

                  {/* Execution Metrics (Calls/sec, Rows/sec, Avg latency) */}
                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300 align-top pt-3.5">
                    {item.callsPerSec > 0 ? (
                      item.callsPerSec >= 10
                        ? item.callsPerSec.toLocaleString(undefined, { maximumFractionDigits: 1 })
                        : item.callsPerSec.toFixed(2)
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300 align-top pt-3.5">
                    {item.rowsPerCall > 0 ? (
                      item.rowsPerCall >= 10
                        ? item.rowsPerCall.toLocaleString(undefined, { maximumFractionDigits: 1 })
                        : item.rowsPerCall.toFixed(2)
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300 align-top pt-3.5">
                    {item.avgLatencyMs > 0 ? (
                      <span
                        className={
                          item.avgLatencyMs > 100
                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                            : item.avgLatencyMs > 20
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : 'text-slate-700 dark:text-slate-300'
                        }
                      >
                        {item.avgLatencyMs < 0.01 ? '< 0.01 ms' : `${item.avgLatencyMs >= 10 ? item.avgLatencyMs.toFixed(1) : item.avgLatencyMs.toFixed(2)} ms`}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-3 text-center align-top pt-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={(e) => handleCopy(item.sql, item.id, e)}
                        title="Copy SQL Query"
                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                      >
                        {copiedId === item.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDetails(item);
                        }}
                        title="Inspect Full SQL & Plan"
                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
