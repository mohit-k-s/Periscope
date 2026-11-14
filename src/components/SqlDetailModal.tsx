import React, { useState } from 'react';
import { TopSQLItem, WAIT_CATEGORY_COLORS, categorizeWaitEvent } from '../types';
import { X, Copy, Check, Terminal, Play, Cpu, Clock, Layers } from 'lucide-react';

interface SqlDetailModalProps {
  item: TopSQLItem | null;
  fullSql?: string;
  onClose: () => void;
}

export const SqlDetailModal: React.FC<SqlDetailModalProps> = ({
  item,
  fullSql,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'sql' | 'plan' | 'stats'>('sql');

  if (!item) return null;

  const sqlText = fullSql || item.sql;

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="relative w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] transition-colors">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">SQL Statement Details</h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700">
                  {item.id}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Database: <span className="text-slate-700 dark:text-slate-300 font-mono">{item.database}</span> • User:{' '}
                <span className="text-slate-700 dark:text-slate-300 font-mono">{item.user}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stats Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-6 py-3 bg-slate-100/70 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 text-xs">
          <div className="p-2 rounded bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 shadow-sm">
            <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Load (AAS)</div>
            <div className="text-sm font-bold font-mono text-amber-600 dark:text-amber-400">{item.loadAAS.toFixed(2)}</div>
          </div>
          <div className="p-2 rounded bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 shadow-sm">
            <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Calls / Second</div>
            <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200">
              {item.callsPerSec > 0 ? item.callsPerSec.toLocaleString() : '—'}
            </div>
          </div>
          <div className="p-2 rounded bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 shadow-sm">
            <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Avg Latency</div>
            <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200">
              {item.avgLatencyMs > 0 ? (item.avgLatencyMs < 0.01 ? '< 0.01 ms' : `${item.avgLatencyMs.toFixed(2)} ms`) : '—'}
            </div>
          </div>
          <div className="p-2 rounded bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 shadow-sm">
            <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-semibold">Rows / Sec</div>
            <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200">
              {item.rowsPerCall > 0 ? item.rowsPerCall.toLocaleString() : '—'}
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('sql')}
              className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'sql'
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              Formatted SQL Statement
            </button>
            <button
              onClick={() => setActiveTab('plan')}
              className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'plan'
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              Execution Plan (EXPLAIN)
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'stats'
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              Wait Breakdown
            </button>
          </div>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-xs font-medium text-slate-200 border border-slate-700 transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy SQL</span>
              </>
            )}
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 font-mono text-xs">
          {activeTab === 'sql' && (
            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-x-auto text-emerald-300 leading-relaxed whitespace-pre font-mono">
              {sqlText}
            </div>
          )}

          {activeTab === 'plan' && (
            <div className="space-y-4 font-sans text-xs">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300">
                To capture execution plans live on Amazon RDS, ensure `auto_explain` or Database Insights execution plan sampling is enabled in your DB Parameter Group.
              </div>
              <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-slate-300 leading-relaxed whitespace-pre">
{`->  Sort  (cost=1254.20..1256.70 rows=1000 width=72)
      Sort Key: orders.created_at DESC
      ->  Hash Join  (cost=45.12..1198.40 rows=1000 width=72)
            Hash Cond: (order_items.order_id = orders.id)
            ->  Seq Scan on order_items  (cost=0.00..890.10 rows=45000 width=32)
            ->  Hash  (cost=32.62..32.62 rows=1000 width=40)
                  ->  Bitmap Heap Scan on orders  (cost=12.20..32.62 rows=1000 width=40)
                        Recheck Cond: (tenant_id = 42)`}
              </div>
            </div>
          )}

          {activeTab === 'stats' && (
            <div className="space-y-3 font-sans">
              <div className="text-xs font-semibold text-slate-300 mb-2">Wait Event Proportions for this Statement:</div>
              <div className="space-y-2.5">
                {Object.entries(item.loadWaitBreakdown)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, pct]) => {
                    const category = categorizeWaitEvent(cat);
                    const col = WAIT_CATEGORY_COLORS[category] || WAIT_CATEGORY_COLORS.Other;
                    const sliceAAS = +(item.loadAAS * (pct / 100)).toFixed(2);
                    return (
                      <div key={cat} className="space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-mono font-medium text-slate-200 flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: col.bg }} />
                            <span>{cat}</span>
                            <span className="text-[10px] text-slate-400 font-sans">({category})</span>
                          </span>
                          <span className="font-mono text-slate-300">
                            {sliceAAS > 0 ? `${sliceAAS < 0.01 ? '< 0.01' : sliceAAS.toFixed(2)} AAS · ` : ''}{pct}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: col.bg }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-white transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
