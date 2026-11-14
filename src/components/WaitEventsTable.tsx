import React from 'react';
import { MetricDataPoint, WAIT_CATEGORY_COLORS, categorizeWaitEvent } from '../types';

interface WaitEventsTableProps {
  dataPoints: MetricDataPoint[];
  selectedWaitCategory?: string;
  selectedWaitCategories?: string[];
  onSelectCategory: (category?: string) => void;
  onToggleCategory?: (category: string) => void;
  onClearCategories?: () => void;
}

export const WaitEventsTable: React.FC<WaitEventsTableProps> = ({
  dataPoints,
  selectedWaitCategory,
  selectedWaitCategories = [],
  onSelectCategory,
  onToggleCategory,
  onClearCategories,
}) => {
  const activeCategories = selectedWaitCategories.length > 0
    ? selectedWaitCategories
    : (selectedWaitCategory ? [selectedWaitCategory] : []);

  // Aggregate wait events across the current time points
  const waitTotals = React.useMemo(() => {
    const totals: Record<string, { total: number; count: number }> = {};
    let grandTotal = 0;

    for (const dp of dataPoints) {
      for (const [waitName, val] of Object.entries(dp.slices)) {
        if (!totals[waitName]) totals[waitName] = { total: 0, count: 0 };
        totals[waitName].total += val;
        totals[waitName].count += 1;
        grandTotal += val;
      }
    }

    const items = Object.entries(totals).map(([name, stat]) => {
      const avgAAS = stat.count > 0 ? +(stat.total / stat.count).toFixed(2) : 0;
      const category = categorizeWaitEvent(name);
      const percentage = grandTotal > 0 ? Math.round((stat.total / grandTotal) * 100) : 0;
      return { name, category, avgAAS, percentage };
    });

    return items.sort((a, b) => b.avgAAS - a.avgAAS);
  }, [dataPoints]);

  const handleRowClick = (cat: string) => {
    if (onToggleCategory) {
      onToggleCategory(cat);
    } else {
      const isSelected = activeCategories.includes(cat);
      onSelectCategory(isSelected ? undefined : cat);
    }
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 font-semibold tracking-wider uppercase text-[10px] transition-colors">
            <th className="py-2.5 px-3 w-10 text-center">
              {activeCategories.length > 0 && (
                <button
                  type="button"
                  onClick={onClearCategories}
                  title="Clear all wait category scopes"
                  className="text-amber-500 hover:text-amber-700 dark:text-amber-400 dark:hover:text-white font-bold"
                >
                  ✕
                </button>
              )}
            </th>
            <th className="py-2.5 px-4">Wait Event Name</th>
            <th className="py-2.5 px-4">
              <div className="flex items-center gap-2">
                <span>Category</span>
                {activeCategories.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold lowercase text-[10px] border border-amber-500/30">
                    {activeCategories.length} selected
                  </span>
                )}
              </div>
            </th>
            <th className="py-2.5 px-4 text-right">Avg Load (AAS)</th>
            <th className="py-2.5 px-4 text-right">% of Total Load</th>
            <th className="py-2.5 px-4 w-48">Share Bar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/60 font-sans">
          {waitTotals.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-400 dark:text-slate-500">
                No active wait events recorded in this period
              </td>
            </tr>
          ) : (
            waitTotals.map((item) => {
              const col = WAIT_CATEGORY_COLORS[item.category] || WAIT_CATEGORY_COLORS.Other;
              const isSelected = activeCategories.includes(item.category) || activeCategories.includes(item.name);

              return (
                <tr
                  key={item.name}
                  onClick={() => handleRowClick(item.category)}
                  title={`Click to scope/unscope ${item.category} wait type (multi-select supported)`}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-500/15 dark:hover:bg-amber-500/20 border-l-4 border-amber-500 dark:border-amber-400'
                      : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/60 border-l-4 border-transparent'
                  }`}
                >
                  <td className="py-3 px-3 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleRowClick(item.category)}
                      className="rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-amber-500 focus:ring-amber-500/30 cursor-pointer w-3.5 h-3.5"
                    />
                  </td>
                  <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200">
                    {item.name}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-medium"
                      style={{ backgroundColor: `${col.bg}22`, color: col.text, border: `1px solid ${col.border}44` }}
                    >
                      {col.label}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                    {item.avgAAS.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-500 dark:text-slate-400">
                    {item.percentage}%
                  </td>
                  <td className="py-3 px-4">
                    <div className="h-2 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${item.percentage}%`, backgroundColor: col.bg }}
                      />
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
