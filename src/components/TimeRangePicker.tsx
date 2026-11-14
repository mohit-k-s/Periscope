import React from 'react';
import { Clock, Play, Pause, X, Layers, Filter, Zap, Lock, Archive, Sparkles } from 'lucide-react';
import { GranularitySetting } from '../types';

export type TimeRangePreset = '5m' | '15m' | '1h' | '3h' | '24h' | '7d' | '14d' | '30d' | '90d';

interface TimeRangePickerProps {
  currentPreset: TimeRangePreset;
  onSelectPreset: (preset: TimeRangePreset) => void;
  startTime: Date;
  endTime: Date;
  isLive: boolean;
  onToggleLive: () => void;
  sliceBy: string;
  onChangeSliceBy: (slice: string) => void;
  granularity: GranularitySetting;
  onChangeGranularity: (g: GranularitySetting) => void;
  resolvedPeriodInSeconds?: number;
  isOnboarded?: boolean;
  onOpenSnapshotModal?: () => void;
  selectedSqlId?: string;
  selectedSqlIds?: string[];
  selectedWaitCategory?: string;
  selectedWaitCategories?: string[];
  selectedHostId?: string;
  selectedHostIds?: string[];
  selectedUserId?: string;
  selectedUserIds?: string[];
  onRemoveFilter?: (type: 'sql' | 'wait' | 'host' | 'user', value: string) => void;
  onClearFilters: () => void;
}

export const TimeRangePicker: React.FC<TimeRangePickerProps> = ({
  currentPreset,
  onSelectPreset,
  startTime,
  endTime,
  isLive,
  onToggleLive,
  sliceBy,
  onChangeSliceBy,
  granularity,
  onChangeGranularity,
  resolvedPeriodInSeconds = 60,
  isOnboarded = false,
  onOpenSnapshotModal,
  selectedSqlId,
  selectedSqlIds = [],
  selectedWaitCategory,
  selectedWaitCategories = [],
  selectedHostId,
  selectedHostIds = [],
  selectedUserId,
  selectedUserIds = [],
  onRemoveFilter,
  onClearFilters,
}) => {
  const basePresets: { id: TimeRangePreset; label: string }[] = [
    { id: '5m', label: '5m' },
    { id: '15m', label: '15m' },
    { id: '1h', label: '1h' },
    { id: '3h', label: '3h' },
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
  ];

  const archivePresets: { id: TimeRangePreset; label: string }[] = [
    { id: '14d', label: '14d' },
    { id: '30d', label: '30d' },
    { id: '90d', label: '90d' },
  ];

  const formatWindow = (d: Date) => {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const activeSqlIds = selectedSqlIds.length > 0 ? selectedSqlIds : (selectedSqlId ? [selectedSqlId] : []);
  const activeWaitCategories = selectedWaitCategories.length > 0 ? selectedWaitCategories : (selectedWaitCategory ? [selectedWaitCategory] : []);
  const activeHostIds = selectedHostIds.length > 0 ? selectedHostIds : (selectedHostId ? [selectedHostId] : []);
  const activeUserIds = selectedUserIds.length > 0 ? selectedUserIds : (selectedUserId ? [selectedUserId] : []);

  const totalFilterCount = activeSqlIds.length + activeWaitCategories.length + activeHostIds.length + activeUserIds.length;
  const hasFilter = totalFilterCount > 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2 px-4 bg-[#fdfcf9]/95 dark:bg-[#16171c]/95 border-b border-[#e5e1d8] dark:border-zinc-800/80 transition-colors">
      
      {/* Left: Time Presets & Live Streaming */}
      <div className="flex items-center gap-2 flex-wrap">
        
        {/* Standard Presets (<= 7d) */}
        <div className="flex items-center bg-stone-100 dark:bg-zinc-800/80 p-0.5 rounded-lg border border-stone-300/80 dark:border-zinc-700/80">
          {basePresets.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectPreset(p.id)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                currentPreset === p.id
                  ? 'bg-amber-500 text-stone-950 shadow-sm shadow-amber-500/20 font-bold'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200/70 dark:hover:bg-zinc-700/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Extended Presets Beyond 7d (Snapshot Archive) */}
        {isOnboarded ? (
          <div className="flex items-center gap-0.5 bg-indigo-50/90 dark:bg-indigo-950/40 p-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800/60 animate-fadeIn">
            <span
              className="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 px-1.5 flex items-center gap-1 select-none"
              title="Persistent SQLite snapshot vault (Bypasses AWS 7-day limit)"
            >
              <Archive className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
              <span className="hidden xl:inline">Archive:</span>
            </span>
            {archivePresets.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectPreset(p.id)}
                className={`px-2 py-1 text-xs font-semibold rounded-md transition-all ${
                  currentPreset === p.id
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
                }`}
                title={`Query ${p.label} telemetry from local persistent snapshot archive`}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center bg-stone-100/90 dark:bg-zinc-800/60 p-0.5 rounded-lg border border-dashed border-stone-300 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => onOpenSnapshotModal?.()}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
              title="AWS Performance Insights free tier is limited to 7 days. Click to onboard this DB and unlock 14d, 30d, 90d historical telemetry with zero AWS costs."
            >
              <Lock className="w-3 h-3 text-amber-500" />
              <span className="text-[11px] font-medium text-stone-700 dark:text-zinc-300">+14d/30d/90d</span>
              <span className="text-[9px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.2 rounded border border-amber-500/30 hover:bg-amber-500/25">
                Onboard DB
              </span>
            </button>
          </div>
        )}

        <div className="hidden sm:flex items-center gap-1.5 text-xs text-stone-500 dark:text-zinc-400 font-mono px-2 py-1 bg-stone-100 dark:bg-zinc-800/40 rounded-lg border border-stone-200 dark:border-zinc-800">
          <Clock className="w-3.5 h-3.5 text-stone-400 dark:text-zinc-500" />
          <span>{formatWindow(startTime)}</span>
          <span className="text-stone-400 dark:text-zinc-600">→</span>
          <span>{formatWindow(endTime)}</span>
        </div>

        {/* Live Auto-Refresh Toggle */}
        <button
          onClick={onToggleLive}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
            isLive
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400 font-semibold'
              : 'bg-stone-100 dark:bg-zinc-800/80 border-stone-300 dark:border-zinc-700 text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white'
          }`}
        >
          {isLive ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
              <span>Live (60s)</span>
              <Pause className="w-3 h-3 ml-0.5 text-emerald-600 dark:text-emerald-400" />
            </>
          ) : (
            <>
              <Play className="w-3 h-3 text-stone-500 dark:text-zinc-400" />
              <span>Paused</span>
            </>
          )}
        </button>
      </div>

      {/* Right: Slicing Dimension Selector & Active Filter Indicators */}
      <div className="flex items-center gap-2 flex-wrap">
        
        {/* Slice By Dimension (Wait State) */}
        <div
          className="flex items-center gap-1.5 bg-stone-100 dark:bg-zinc-800/80 border border-stone-300 dark:border-zinc-700 px-2.5 py-1 rounded-lg select-none"
          title="AAS database load is sliced and stacked by Wait State. Scope by SQL, Host, or User using the interactive table filters below."
        >
          <Layers className="w-3.5 h-3.5 text-stone-500 dark:text-zinc-400" />
          <span className="text-[11px] text-stone-500 dark:text-zinc-400 font-mono">Slice:</span>
          <span className="text-xs font-semibold font-mono text-stone-800 dark:text-zinc-200">Wait State</span>
        </div>

        {/* Granularity / Resolution Selector */}
        <div className="flex items-center gap-1.5 bg-stone-100 dark:bg-zinc-800/80 border border-stone-300 dark:border-zinc-700 px-2 py-1 rounded-lg">
          <Zap className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
          <span className="text-[11px] text-stone-500 dark:text-zinc-400 font-mono">Res:</span>
          <select
            value={granularity}
            onChange={(e) => onChangeGranularity(e.target.value as any)}
            className="bg-transparent text-xs text-stone-800 dark:text-white font-medium focus:outline-none cursor-pointer"
          >
            <option value="auto" className="bg-white dark:bg-[#16171c] text-stone-900 dark:text-white">
              Auto ({resolvedPeriodInSeconds === 1 ? '1s' : resolvedPeriodInSeconds === 60 ? '1m' : resolvedPeriodInSeconds === 300 ? '5m' : resolvedPeriodInSeconds === 3600 ? '1h' : '1d'})
            </option>
            <option value="1s" className="bg-white dark:bg-[#16171c] text-stone-900 dark:text-white">1s (High-Res)</option>
            <option value="1m" className="bg-white dark:bg-[#16171c] text-stone-900 dark:text-white">1m</option>
            <option value="5m" className="bg-white dark:bg-[#16171c] text-stone-900 dark:text-white">5m</option>
            <option value="1h" className="bg-white dark:bg-[#16171c] text-stone-900 dark:text-white">1h</option>
          </select>
        </div>

        {/* Active Multi-Filter Pill Banner */}
        {hasFilter && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* SQL Pills */}
            {activeSqlIds.map((id) => (
              <div
                key={id}
                className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-700 dark:text-amber-300 animate-fadeIn"
              >
                <Filter className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400" />
                <span className="text-[11px] font-mono truncate max-w-[120px]" title={id}>
                  SQL: {id.slice(0, 8)}...
                </span>
                <button
                  type="button"
                  onClick={() => (onRemoveFilter ? onRemoveFilter('sql', id) : onClearFilters())}
                  title="Remove SQL scope"
                  className="p-0.5 hover:bg-amber-500/20 rounded text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Wait Category Pills */}
            {activeWaitCategories.map((cat) => (
              <div
                key={cat}
                className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 border border-blue-500/30 rounded-lg text-xs text-blue-700 dark:text-blue-300 animate-fadeIn"
              >
                <Filter className="w-2.5 h-2.5 text-blue-500 dark:text-blue-400" />
                <span className="text-[11px] font-mono">
                  Wait: {cat}
                </span>
                <button
                  type="button"
                  onClick={() => (onRemoveFilter ? onRemoveFilter('wait', cat) : onClearFilters())}
                  title={`Remove ${cat} wait scope`}
                  className="p-0.5 hover:bg-blue-500/20 rounded text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Host Pills */}
            {activeHostIds.map((hId) => (
              <div
                key={hId}
                className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 border border-purple-500/30 rounded-lg text-xs text-purple-700 dark:text-purple-300 animate-fadeIn"
              >
                <Filter className="w-2.5 h-2.5 text-purple-500 dark:text-purple-400" />
                <span className="text-[11px] font-mono truncate max-w-[120px]" title={hId}>
                  Host: {hId.slice(0, 10)}...
                </span>
                <button
                  type="button"
                  onClick={() => (onRemoveFilter ? onRemoveFilter('host', hId) : onClearFilters())}
                  title="Remove host scope"
                  className="p-0.5 hover:bg-purple-500/20 rounded text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* User Pills */}
            {activeUserIds.map((uId) => (
              <div
                key={uId}
                className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-700 dark:text-emerald-300 animate-fadeIn"
              >
                <Filter className="w-2.5 h-2.5 text-emerald-500 dark:text-emerald-400" />
                <span className="text-[11px] font-mono truncate max-w-[120px]" title={uId}>
                  User: {uId}
                </span>
                <button
                  type="button"
                  onClick={() => (onRemoveFilter ? onRemoveFilter('user', uId) : onClearFilters())}
                  title="Remove user scope"
                  className="p-0.5 hover:bg-emerald-500/20 rounded text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            {/* Clear All Button */}
            {totalFilterCount >= 2 && (
              <button
                type="button"
                onClick={onClearFilters}
                title="Clear all active scopes"
                className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 transition-colors"
              >
                Clear all ({totalFilterCount})
              </button>
            )}
          </div>
        )}

      </div>

    </div>
  );
};
