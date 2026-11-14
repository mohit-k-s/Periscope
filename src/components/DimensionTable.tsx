import React from 'react';
import { WAIT_CATEGORY_COLORS, categorizeWaitEvent } from '../types';
import { Server, Users, Filter, Check } from 'lucide-react';

export interface DimensionItem {
  id: string;
  name: string;
  loadAAS: number;
  loadWaitBreakdown: Record<string, number>;
}

interface DimensionTableProps {
  type: 'hosts' | 'users';
  items: DimensionItem[];
  selectedId?: string;
  selectedIds?: string[];
  onSelectItem: (item: DimensionItem) => void;
  loading?: boolean;
}

export const DimensionTable: React.FC<DimensionTableProps> = ({
  type,
  items,
  selectedId,
  selectedIds = [],
  onSelectItem,
  loading,
}) => {
  const isHost = type === 'hosts';
  const Icon = isHost ? Server : Users;
  const label = isHost ? 'Database Client Host' : 'Database User';

  const activeIds = selectedIds.length > 0
    ? selectedIds
    : (selectedId ? [selectedId] : []);

  const highestLoad = Math.max(...items.map((i) => i.loadAAS), 0.001);

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 font-semibold tracking-wider uppercase text-[10px] transition-colors">
            <th className="py-2.5 px-3 w-10 text-center">#</th>
            <th className="py-2.5 px-4 w-48">Load by Wait (AAS)</th>
            <th className="py-2.5 px-4">
              <div className="flex items-center gap-2">
                <span>{label}</span>
                {activeIds.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold lowercase text-[10px] border border-amber-500/30">
                    {activeIds.length} selected
                  </span>
                )}
              </div>
            </th>
            <th className="py-2.5 px-4 text-right">Avg Load (AAS)</th>
            <th className="py-2.5 px-4 text-right">% of Total</th>
            <th className="py-2.5 px-4 text-center w-28">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/60 font-sans">
          {loading ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-500 dark:text-slate-400">
                Loading {isHost ? 'database hosts' : 'database users'}...
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-400 dark:text-slate-500">
                No active {isHost ? 'client hosts' : 'users'} recorded in the selected time period
              </td>
            </tr>
          ) : (
            items.map((item, rowIdx) => {
              const keyToCheck = isHost ? item.id : item.name;
              const isSelected = activeIds.includes(item.id) || activeIds.includes(item.name);
              const loadPercent = Math.min(100, (item.loadAAS / highestLoad) * 100);

              return (
                <tr
                  key={item.id}
                  onClick={() => onSelectItem(item)}
                  title={isSelected ? 'Click to unscope' : `Click to scope dashboard to ${item.name}`}
                  className={`group cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:hover:bg-amber-500/20 border-l-4 border-amber-500 dark:border-amber-400'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/60 border-l-4 border-transparent'
                  }`}
                >
                  {/* Multi-select Checkbox */}
                  <td className="py-3 px-3 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onSelectItem(item)}
                      className="rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-amber-500 focus:ring-amber-500/30 cursor-pointer w-3.5 h-3.5"
                    />
                  </td>
                  {/* Load by Wait Segmented Bar */}
                  <td className="py-3 px-4 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-200 w-12 text-right">
                        {item.loadAAS.toFixed(item.loadAAS < 0.01 ? 4 : 2)}
                      </span>
                      <div className="relative group/bar flex-1">
                        <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden flex shadow-inner cursor-pointer">
                          {Object.entries(item.loadWaitBreakdown).map(([waitName, pct]) => {
                            const cat = categorizeWaitEvent(waitName);
                            const col = WAIT_CATEGORY_COLORS[cat] || WAIT_CATEGORY_COLORS.Other;
                            const sliceAAS = +(item.loadAAS * (pct / 100)).toFixed(2);
                            return (
                              <div
                                key={waitName}
                                title={`${waitName} (${col.label}): ${sliceAAS > 0 ? `${sliceAAS} AAS · ` : ''}${pct}%`}
                                style={{
                                  width: `${(pct / 100) * loadPercent}%`,
                                  backgroundColor: col.bg,
                                }}
                                className="h-full transition-all hover:brightness-110"
                              />
                            );
                          })}
                        </div>

                        {/* Interactive Legend Popover */}
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
                                .map(([waitName, pct]) => {
                                  const cat = categorizeWaitEvent(waitName);
                                  const col = WAIT_CATEGORY_COLORS[cat] || WAIT_CATEGORY_COLORS.Other;
                                  const sliceAAS = +(item.loadAAS * (pct / 100)).toFixed(2);
                                  return (
                                    <div key={waitName} className="flex items-center justify-between gap-3">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: col.bg }} />
                                        <span className="text-slate-200 truncate max-w-[130px]" title={waitName}>{waitName}</span>
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

                  {/* Name & ID */}
                  <td className="py-3 px-4 align-middle">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 group-hover:text-amber-500 transition-colors">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="font-mono font-medium text-slate-800 dark:text-slate-200 text-xs flex items-center gap-2">
                          <span>{item.name || 'Unknown'}</span>
                          {isHost && item.name === 'Unknown' && (
                            <span className="text-[10px] text-slate-500 font-normal">
                              (local / background worker)
                            </span>
                          )}
                          {isSelected && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold text-[10px] border border-amber-500/30">
                              ● Scoped to Chart
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          ID: {item.id.slice(0, 16)}...
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Avg Load */}
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200 align-middle">
                    {item.loadAAS.toFixed(item.loadAAS < 0.01 ? 4 : 2)}
                  </td>

                  {/* % Share */}
                  <td className="py-3 px-4 text-right font-mono text-slate-500 dark:text-slate-400 align-middle">
                    {loadPercent.toFixed(1)}%
                  </td>

                  {/* Action */}
                  <td className="py-3 px-4 text-center align-middle">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectItem(item);
                      }}
                      className={`px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                        isSelected
                          ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                          : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {isSelected ? 'Unscope' : 'Scope'}
                    </button>
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
