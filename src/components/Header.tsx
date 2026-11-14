import React from 'react';
import {
  Database,
  Globe,
  KeyRound,
  RotateCw,
  Zap,
  Cpu,
  Layers,
  ChevronDown,
  Camera,
  Sun,
  Moon,
  Compass,
} from 'lucide-react';
import {
  AwsSessionConfig,
  AwsCallerIdentity,
  DbInstanceInfo,
  AWS_REGIONS,
} from '../types';

interface HeaderProps {
  sessionConfig: AwsSessionConfig;
  identity: AwsCallerIdentity | null;
  onOpenRoleModal: () => void;
  onOpenSnapshotModal?: () => void;
  onRegionChange: (region: string) => void;
  instances: DbInstanceInfo[];
  selectedInstance: DbInstanceInfo | null;
  onSelectInstance: (instance: DbInstanceInfo) => void;
  loading: boolean;
  onRefresh: () => void;
  currentVcpus: number;
  onUpdateVcpus: (vcpus: number) => void;
  totalInstancesCount: number;
  piEnabledCount: number;
  onlyPiEnabled: boolean;
  onToggleOnlyPiEnabled: (val: boolean) => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  sessionConfig,
  identity,
  onOpenRoleModal,
  onOpenSnapshotModal,
  onRegionChange,
  instances,
  selectedInstance,
  onSelectInstance,
  loading,
  onRefresh,
  currentVcpus,
  onUpdateVcpus,
  totalInstancesCount,
  piEnabledCount,
  onlyPiEnabled,
  onToggleOnlyPiEnabled,
  theme = 'dark',
  onToggleTheme,
}) => {
  const [isEditingVcpu, setIsEditingVcpu] = React.useState(false);
  const [customVcpuInput, setCustomVcpuInput] = React.useState(String(currentVcpus));

  React.useEffect(() => {
    setCustomVcpuInput(String(currentVcpus));
  }, [currentVcpus]);

  const handleVcpuSubmit = (val: number) => {
    if (val > 0) {
      onUpdateVcpus(val);
      setIsEditingVcpu(false);
    }
  };
  return (
    <header className="sticky top-0 z-40 bg-[#fdfcf9]/95 dark:bg-[#16171c]/95 backdrop-blur border-b border-[#e5e0d5] dark:border-zinc-800/80 px-4 py-2 transition-colors shadow-sm dark:shadow-none">
      <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
        
        {/* Left: Brand & Identity Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="relative group flex items-center justify-center">
              <img
                id="header-brand-logo"
                src={theme === 'dark' ? '/icon-dark.png' : '/icon-light.png'}
                alt="Periscope Logo"
                className="h-9 w-auto max-w-[56px] object-contain rounded-md shadow-sm border border-stone-300/80 dark:border-zinc-750 bg-stone-100 dark:bg-[#111213] p-0.5 transition-transform duration-200 group-hover:scale-105"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-wider font-mono text-stone-900 dark:text-white uppercase">
                  Periscope
                </span>
              </div>
              <div className="text-[10px] text-stone-500 dark:text-zinc-400 font-mono hidden sm:block">
                Architectural RDS Telemetry · 5m Snapshots · Toxic Query Radar
              </div>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1 hidden md:block" />

          {/* Account / Role Button */}
          <button
            onClick={onOpenRoleModal}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              sessionConfig.isDemoMode
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                : 'bg-slate-100 hover:bg-slate-200/80 border-slate-300 text-slate-800 dark:bg-slate-800/80 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200'
            }`}
          >
            {sessionConfig.isDemoMode ? (
              <>
                <Zap className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 fill-amber-400/20" />
                <span className="font-mono text-[11px] font-semibold">⚡ Demo Mode</span>
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="font-mono text-[11px] truncate max-w-[140px]">
                  {sessionConfig.roleArn
                    ? sessionConfig.roleArn.split('/').slice(-1)[0]
                    : identity?.account || sessionConfig.profile || 'Default Profile'}
                </span>
              </>
            )}
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>
        </div>

        {/* Right Controls: Region, Instance Picker, Snapshots, Theme, Refresh */}
        <div className="flex items-center gap-2.5 flex-wrap">
          
          {/* Region Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2 py-1 rounded-lg">
            <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
            <select
              value={sessionConfig.region}
              onChange={(e) => onRegionChange(e.target.value)}
              className="bg-transparent text-xs text-slate-800 dark:text-slate-200 font-mono focus:outline-none cursor-pointer"
            >
              {AWS_REGIONS.map((r) => (
                <option key={r.id} value={r.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                  {r.id}
                </option>
              ))}
            </select>
          </div>

          {/* Database Instance Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 px-2.5 py-1 rounded-lg">
            <Database className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
            <select
              value={selectedInstance?.id || ''}
              onChange={(e) => {
                const found = instances.find((i) => i.id === e.target.value);
                if (found) onSelectInstance(found);
              }}
              className="bg-transparent text-xs text-slate-900 dark:text-white font-medium focus:outline-none cursor-pointer max-w-[210px] truncate"
            >
              {instances.length === 0 ? (
                <option value="" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">No PI-enabled instances</option>
              ) : (
                instances.map((inst) => (
                  <option key={inst.id} value={inst.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                    {inst.id} ({inst.instanceClass}) {!inst.performanceInsightsEnabled ? '[PI Disabled]' : ''}
                  </option>
                ))
              )}
            </select>
            
            {/* PI Only filter toggle button */}
            {totalInstancesCount > 0 && (
              <button
                type="button"
                onClick={() => onToggleOnlyPiEnabled(!onlyPiEnabled)}
                title={onlyPiEnabled ? 'Showing only PI-enabled databases. Click to show all.' : 'Showing all databases. Click to filter only PI-enabled.'}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                  onlyPiEnabled
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'bg-slate-200/80 dark:bg-slate-700/60 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400'
                }`}
              >
                PI: {piEnabledCount}/{totalInstancesCount}
              </button>
            )}

            {selectedInstance && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsEditingVcpu(!isEditingVcpu)}
                  title="Click to adjust Max vCPU threshold"
                  className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded bg-slate-200/80 dark:bg-slate-750 hover:bg-slate-300/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-650 transition-colors"
                >
                  <Cpu className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-semibold text-slate-900 dark:text-white">{currentVcpus}</span> vCPU
                  <span className="text-[9px] text-slate-500 dark:text-slate-400">✎</span>
                </button>

                {isEditingVcpu && (
                  <div className="absolute right-0 top-8 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-2.5 min-w-[190px] text-xs space-y-2 animate-fadeIn text-slate-900 dark:text-slate-100">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                      Adjust Max vCPU Line
                    </div>
                    <div className="flex items-center gap-1">
                      {[1, 2, 4, 8, 16, 32].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => handleVcpuSubmit(num)}
                          className={`px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors ${
                            currentVcpus === num
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200 dark:border-slate-800">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">Custom:</span>
                      <input
                        type="number"
                        min="1"
                        max="256"
                        value={customVcpuInput}
                        onChange={(e) => setCustomVcpuInput(e.target.value)}
                        className="w-14 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-900 dark:text-white font-mono focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleVcpuSubmit(Number(customVcpuInput))}
                        className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[10px]"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Snapshotter & Time Travel Archive Button */}
          {onOpenSnapshotModal && (
            <button
              onClick={onOpenSnapshotModal}
              title="Open Performance Insights Snapshotter & Time Travel Archive"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100/90 dark:bg-indigo-500/15 dark:hover:bg-indigo-500/25 border border-indigo-200 dark:border-indigo-500/40 text-xs font-semibold text-indigo-700 dark:text-indigo-300 transition-all shadow-sm shadow-indigo-500/5 dark:shadow-indigo-500/10"
            >
              <Camera className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Snapshots</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse ml-0.5" />
            </button>
          )}

          {/* Theme Toggle (Light / Dark) */}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle theme"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/90 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-all shadow-sm"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400 hover:rotate-45 transition-transform" />
                  <span className="hidden md:inline text-[11px] font-medium">Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-indigo-600 hover:-rotate-12 transition-transform" />
                  <span className="hidden md:inline text-[11px] font-medium text-slate-800">Dark</span>
                </>
              )}
            </button>
          )}

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            disabled={loading}
            title="Refresh metrics (Shortcut: R)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/90 dark:bg-slate-800 dark:hover:bg-slate-750 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-all disabled:opacity-50 shadow-sm"
          >
            <RotateCw className={`w-3.5 h-3.5 text-amber-500 dark:text-amber-400 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

      </div>
    </header>
  );
};
