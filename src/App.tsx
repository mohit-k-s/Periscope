import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AwsSessionConfig,
  AwsCallerIdentity,
  DbInstanceInfo,
  MetricDataPoint,
  TopSQLItem,
  GranularitySetting,
  resolvePeriodInSeconds,
  QueryAnomaly,
  OnboardedInstance,
} from './types';
import {
  fetchProfiles,
  fetchInstances,
  fetchMetrics,
  fetchDimensionKeys,
  fetchSqlDetails,
  fetchAnomalies,
  fetchOnboardedInstances,
} from './api';
import { Header } from './components/Header';
import { SwitchRoleModal } from './components/SwitchRoleModal';
import { TimeRangePicker, TimeRangePreset } from './components/TimeRangePicker';
import { AASChart } from './components/AASChart';
import { TopSqlTable } from './components/TopSqlTable';
import { WaitEventsTable } from './components/WaitEventsTable';
import { DimensionTable, DimensionItem } from './components/DimensionTable';
import { SqlDetailModal } from './components/SqlDetailModal';
import { CounterMetrics } from './components/CounterMetrics';
import { SnapshotManagerModal } from './components/SnapshotManagerModal';
import { AnomaliesView } from './components/AnomaliesView';
import { InitialSplashScreen } from './components/InitialSplashScreen';
import {
  Database,
  Layers,
  Server,
  Users,
  Code,
  Flame,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';

const STORAGE_SESSION = 'quickpi_session_config';
const STORAGE_SELECTED_DB = 'periscope_selected_db';

export function App() {
  // Theme State (Light / Dark mode)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('quickpi_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return 'dark';
  });

  useEffect(() => {
    localStorage.setItem('quickpi_theme', theme);
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    const favicon = document.getElementById('favicon') as HTMLLinkElement | null;
    if (favicon) {
      favicon.href = theme === 'dark' ? '/icon-dark.png' : '/icon-light.png';
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Session Configuration & Identity
  const [profiles, setProfiles] = useState<string[]>(['default']);
  const [profileMetadata, setProfileMetadata] = useState<import('./types').ProfileMetadata[]>([]);
  const [sessionConfig, setSessionConfig] = useState<AwsSessionConfig>(() => {
    return {
      profile: 'default',
      region: 'us-east-1',
      isDemoMode: true, // Switched to Demo Mode for README screenshot
      roleSessionName: 'Periscope-Demo',
    };
  });

  const [callerIdentity, setCallerIdentity] = useState<AwsCallerIdentity | null>(null);
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [isSnapshotModalOpen, setIsSnapshotModalOpen] = useState(false);

  // Onboarded Instances Tracking (for gating >7d time presets)
  const [onboardedList, setOnboardedList] = useState<OnboardedInstance[]>([]);

  const refreshOnboarded = useCallback(async () => {
    try {
      const list = await fetchOnboardedInstances();
      setOnboardedList(list);
    } catch (e) {
      console.warn('Failed to load onboarded instances:', e);
    }
  }, []);

  useEffect(() => {
    refreshOnboarded();
  }, [refreshOnboarded]);

  // Instances & Selected DB
  const [instances, setInstances] = useState<DbInstanceInfo[]>([]);
  const [totalInstancesCount, setTotalInstancesCount] = useState<number>(0);
  const [piEnabledCount, setPiEnabledCount] = useState<number>(0);
  const [onlyPiEnabled, setOnlyPiEnabled] = useState<boolean>(true);
  const [selectedInstance, setSelectedInstance] = useState<DbInstanceInfo | null>(null);
  const [activeVcpus, setActiveVcpus] = useState<number>(4);

  // Persistent DB Selection Handler across browser sessions
  const handleSelectInstance = useCallback((inst: DbInstanceInfo | null) => {
    setSelectedInstance(inst);
    if (inst) {
      try {
        localStorage.setItem(STORAGE_SELECTED_DB, inst.id);
      } catch {}
      if (inst.vcpus) {
        setActiveVcpus(inst.vcpus);
      }
    }
  }, []);

  // Initial Splash Screen States
  const [showSplash, setShowSplash] = useState(true);
  const [splashReady, setSplashReady] = useState(false);
  const [splashMessage, setSplashMessage] = useState('Discovering RDS database fleet...');

  // Time travel selection handler
  const handleSelectHistoricalWindow = (instanceId: string, start: Date, end: Date) => {
    setIsLive(false);
    setTimeWindow({ start, end });
    const target = instances.find((i) => i.id === instanceId);
    if (target && target.id !== selectedInstance?.id) {
      handleSelectInstance(target);
    }
  };

  // Compute whether selected instance is actively onboarded on snapshots
  const isSelectedInstanceOnboarded = Boolean(
    selectedInstance &&
    (onboardedList.some((o) => o.instanceId === selectedInstance.id && o.status === 'active') ||
      (sessionConfig.isDemoMode && selectedInstance.id === 'prod-pg-orders-01'))
  );

  // Sync active vCPUs when selected instance changes
  useEffect(() => {
    if (selectedInstance?.vcpus) {
      setActiveVcpus(selectedInstance.vcpus);
    }
  }, [selectedInstance]);

  // Time Window & Slicing
  const [timePreset, setTimePreset] = useState<TimeRangePreset>('1h');
  const [timeWindow, setTimeWindow] = useState<{ start: Date; end: Date }>(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000); // 1 hour
    return { start, end };
  });

  const [isLive, setIsLive] = useState(true);
  const [sliceBy, setSliceBy] = useState('db.wait_state');
  const [granularity, setGranularity] = useState<GranularitySetting>('auto');
  const [activePeriod, setActivePeriod] = useState<number>(60);

  // Multi-Scoping State
  const [selectedSqlIds, setSelectedSqlIds] = useState<string[]>([]);
  const [selectedWaitCategories, setSelectedWaitCategories] = useState<string[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Bottom Tabs & Anomalies State
  const [anomalies, setAnomalies] = useState<QueryAnomaly[]>([]);
  const [bottomTab, setBottomTab] = useState<'top_sql' | 'anomalies' | 'wait_events' | 'hosts' | 'users'>('top_sql');

  // Multi-scoping helper functions
  const handleToggleSql = (item: TopSQLItem) => {
    setSelectedSqlIds((prev) => {
      const exists = prev.includes(item.id);
      return exists ? prev.filter((id) => id !== item.id) : [...prev, item.id];
    });
    // Clear conflicting entity dimensions (AWS PI cannot join multiple external dimension groups)
    setSelectedHostIds([]);
    setSelectedUserIds([]);
  };

  const handleSelectAllSql = () => {
    setSelectedSqlIds(topSqlItems.map((i) => i.id));
    setSelectedHostIds([]);
    setSelectedUserIds([]);
  };

  const handleClearSqlSelection = () => {
    setSelectedSqlIds([]);
  };

  const handleToggleWaitCategory = (category?: string) => {
    if (!category) {
      setSelectedWaitCategories([]);
      return;
    }
    setSelectedWaitCategories((prev) => {
      const exists = prev.includes(category);
      return exists ? prev.filter((c) => c !== category) : [...prev, category];
    });
  };

  const handleToggleHost = (item: DimensionItem) => {
    setSelectedHostIds((prev) => {
      const exists = prev.includes(item.id);
      return exists ? prev.filter((id) => id !== item.id) : [...prev, item.id];
    });
    // Clear conflicting entity dimensions
    setSelectedSqlIds([]);
    setSelectedUserIds([]);
  };

  const handleToggleUser = (item: DimensionItem) => {
    setSelectedUserIds((prev) => {
      const exists = prev.includes(item.name);
      return exists ? prev.filter((name) => name !== item.name) : [...prev, item.name];
    });
    // Clear conflicting entity dimensions
    setSelectedSqlIds([]);
    setSelectedHostIds([]);
  };

  const handleRemoveFilter = (type: 'sql' | 'wait' | 'host' | 'user', value: string) => {
    if (type === 'sql') setSelectedSqlIds((prev) => prev.filter((id) => id !== value));
    if (type === 'wait') setSelectedWaitCategories((prev) => prev.filter((c) => c !== value));
    if (type === 'host') setSelectedHostIds((prev) => prev.filter((id) => id !== value));
    if (type === 'user') setSelectedUserIds((prev) => prev.filter((u) => u !== value));
  };

  const clearFilters = () => {
    setSelectedSqlIds([]);
    setSelectedWaitCategories([]);
    setSelectedHostIds([]);
    setSelectedUserIds([]);
  };

  // Metrics & Dimension Telemetry
  const [metricsData, setMetricsData] = useState<MetricDataPoint[]>([]);
  const [topSqlItems, setTopSqlItems] = useState<TopSQLItem[]>([]);
  const [hostItems, setHostItems] = useState<DimensionItem[]>([]);
  const [userItems, setUserItems] = useState<DimensionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal inspection
  const [inspectingItem, setInspectingItem] = useState<TopSQLItem | null>(null);
  const [fullSqlText, setFullSqlText] = useState<string>('');

  // Initial load: profiles & instances
  useEffect(() => {
    fetchProfiles().then(({ profiles, metadata }) => {
      setProfiles(profiles);
      setProfileMetadata(metadata);
    });
  }, []);

  // Save session config
  useEffect(() => {
    localStorage.setItem(STORAGE_SESSION, JSON.stringify(sessionConfig));
  }, [sessionConfig]);

  // Load instances when session config changes or when onlyPiEnabled changes
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchInstances(sessionConfig, !onlyPiEnabled)
      .then(({ instances: insts, totalCount, piEnabledCount: piCount }) => {
        if (!isMounted) return;
        setInstances(insts);
        setTotalInstancesCount(totalCount);
        setPiEnabledCount(piCount);

        if (insts.length > 0) {
          const savedDbId = (() => {
            try {
              return localStorage.getItem(STORAGE_SELECTED_DB);
            } catch {
              return null;
            }
          })();

          setSelectedInstance((prev) => {
            if (prev) {
              const current = insts.find((i) => i.id === prev.id);
              if (current) return current;
            }
            if (savedDbId) {
              const saved = insts.find((i) => i.id === savedDbId);
              if (saved) {
                if (saved.vcpus) setActiveVcpus(saved.vcpus);
                return saved;
              }
            }
            if (insts[0].vcpus) setActiveVcpus(insts[0].vcpus);
            return insts[0];
          });
          setSplashMessage('Connecting to Performance Insights telemetry...');
        } else {
          setSelectedInstance(null);
          setSplashReady(true);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Failed to load instances for this account/region');
        setSplashReady(true);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [sessionConfig, onlyPiEnabled]);

  // Calculate time window from preset (supports 14d, 30d, 90d when onboarded)
  const setPresetRange = useCallback((preset: TimeRangePreset) => {
    setTimePreset(preset);
    const end = new Date();
    let durationMs = 60 * 60 * 1000;
    if (preset === '5m') durationMs = 5 * 60 * 1000;
    else if (preset === '15m') durationMs = 15 * 60 * 1000;
    else if (preset === '1h') durationMs = 60 * 60 * 1000;
    else if (preset === '3h') durationMs = 3 * 60 * 60 * 1000;
    else if (preset === '24h') durationMs = 24 * 60 * 60 * 1000;
    else if (preset === '7d') durationMs = 7 * 24 * 60 * 60 * 1000;
    else if (preset === '14d') durationMs = 14 * 24 * 60 * 60 * 1000;
    else if (preset === '30d') durationMs = 30 * 24 * 60 * 60 * 1000;
    else if (preset === '90d') durationMs = 90 * 24 * 60 * 60 * 1000;

    const start = new Date(end.getTime() - durationMs);
    setTimeWindow({ start, end });
  }, []);

  // Fetch performance metrics & Top SQL / Hosts / Users
  const loadTelemetry = useCallback(async () => {
    if (!selectedInstance) return;

    // Guard: don't query PI API if the instance has Performance Insights disabled
    if (!selectedInstance.performanceInsightsEnabled && !sessionConfig.isDemoMode) {
      setMetricsData([]);
      setTopSqlItems([]);
      setHostItems([]);
      setUserItems([]);
      setAnomalies([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const windowMs = timeWindow.end.getTime() - timeWindow.start.getTime();
      const periodToUse = resolvePeriodInSeconds(granularity, windowMs);
      const isExtendedPreset = ['14d', '30d', '90d'].includes(timePreset);
      const isBeyondAwsFreeTier = isExtendedPreset || (timePreset !== '7d' && (Date.now() - timeWindow.start.getTime() > 7.1 * 86400 * 1000));
      const shouldUseSnapshotSource = isSelectedInstanceOnboarded && isBeyondAwsFreeTier;

      const [metricsRes, sqlRes, hostsRes, usersRes] = await Promise.all([
        fetchMetrics({
          sessionConfig,
          instanceId: selectedInstance.id,
          resourceId: selectedInstance.dbiResourceId,
          startTime: timeWindow.start.toISOString(),
          endTime: timeWindow.end.toISOString(),
          periodInSeconds: periodToUse,
          vcpus: activeVcpus,
          selectedSqlIds,
          selectedWaitCategories,
          selectedHostIds,
          selectedUserIds,
          source: shouldUseSnapshotSource ? 'snapshot' : 'aws',
        }),
        fetchDimensionKeys({
          sessionConfig,
          instanceId: selectedInstance.id,
          resourceId: selectedInstance.dbiResourceId,
          startTime: timeWindow.start.toISOString(),
          endTime: timeWindow.end.toISOString(),
          groupBy: 'db.sql',
          maxResults: 15,
          selectedWaitCategories,
          selectedHostId: selectedHostIds[0],
          selectedUserId: selectedUserIds[0],
          source: shouldUseSnapshotSource ? 'snapshot' : 'aws',
        }),
        fetchDimensionKeys({
          sessionConfig,
          instanceId: selectedInstance.id,
          resourceId: selectedInstance.dbiResourceId,
          startTime: timeWindow.start.toISOString(),
          endTime: timeWindow.end.toISOString(),
          groupBy: 'db.host',
          maxResults: 10,
          selectedWaitCategories,
          source: shouldUseSnapshotSource ? 'snapshot' : 'aws',
        }),
        fetchDimensionKeys({
          sessionConfig,
          instanceId: selectedInstance.id,
          resourceId: selectedInstance.dbiResourceId,
          startTime: timeWindow.start.toISOString(),
          endTime: timeWindow.end.toISOString(),
          groupBy: 'db.user',
          maxResults: 10,
          selectedWaitCategories,
          source: shouldUseSnapshotSource ? 'snapshot' : 'aws',
        }),
      ]);

      setMetricsData(metricsRes.dataPoints);
      setActivePeriod(metricsRes.periodInSeconds || periodToUse);
      setTopSqlItems(sqlRes);
      setHostItems(hostsRes as any);
      setUserItems(usersRes as any);
      setError(null);

      // Async fetch of detected query anomalies
      fetchAnomalies({
        sessionConfig,
        instanceId: selectedInstance.id,
        resourceId: selectedInstance.dbiResourceId,
        startTime: timeWindow.start.toISOString(),
        endTime: timeWindow.end.toISOString(),
        vcpus: activeVcpus,
      })
        .then(setAnomalies)
        .catch((e) => console.warn('Could not detect anomalies:', e));
    } catch (err: any) {
      console.error('Error fetching telemetry:', err);
      setError(err.message || 'Failed to load performance telemetry');
    } finally {
      setLoading(false);
      setSplashReady(true);
    }
  }, [selectedInstance, sessionConfig, timeWindow, granularity, selectedSqlIds, selectedWaitCategories, selectedHostIds, selectedUserIds, activeVcpus, isSelectedInstanceOnboarded, timePreset]);

  useEffect(() => {
    loadTelemetry();
  }, [loadTelemetry]);

  // Live Auto-Refresh (every 60 seconds)
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      // Advance window forward smoothly
      const duration = timeWindow.end.getTime() - timeWindow.start.getTime();
      const end = new Date();
      const start = new Date(end.getTime() - duration);
      setTimeWindow({ start, end });
    }, 60000);

    return () => clearInterval(interval);
  }, [isLive, timeWindow]);

  // Keyboard Shortcuts (1=15m, 2=1h, 3=3h, 4=24h, R=refresh, Space=live, Esc=clear)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === '1') setPresetRange('15m');
      else if (e.key === '2') setPresetRange('1h');
      else if (e.key === '3') setPresetRange('3h');
      else if (e.key === '4') setPresetRange('24h');
      else if (e.key === 'r' || e.key === 'R') loadTelemetry();
      else if (e.key === ' ') {
        e.preventDefault();
        setIsLive((prev) => !prev);
      } else if (e.key === 'Escape') {
        clearFilters();
        setInspectingItem(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setPresetRange, loadTelemetry]);

  // Zoom into timeline
  const handleZoomRange = (start: Date, end: Date) => {
    setIsLive(false);
    setTimeWindow({ start, end });
  };

  // Inspect SQL Details
  const handleOpenDetails = async (item: TopSQLItem) => {
    setInspectingItem(item);
    setFullSqlText('');
    if (selectedInstance) {
      try {
        const full = await fetchSqlDetails(
          sessionConfig,
          selectedInstance.id,
          selectedInstance.dbiResourceId,
          item.id
        );
        setFullSqlText(full);
      } catch (e) {
        setFullSqlText(item.sql);
      }
    }
  };

  const isExtendedPreset = ['14d', '30d', '90d'].includes(timePreset);
  const isBeyondAwsFreeTier = isExtendedPreset || (timePreset !== '7d' && (Date.now() - timeWindow.start.getTime() > 7.1 * 86400 * 1000));

  return (
    <div className="min-h-screen bg-transparent text-stone-900 dark:text-zinc-100 flex flex-col font-sans transition-colors duration-150">
      
      {/* Initial Boot Splash Screen with Logo Docking Animation */}
      {showSplash && (
        <InitialSplashScreen
          isReady={splashReady}
          statusMessage={splashMessage}
          theme={theme}
          onDismiss={() => setShowSplash(false)}
        />
      )}

      {/* Top Navigation */}
      <Header
        sessionConfig={sessionConfig}
        identity={callerIdentity}
        onOpenRoleModal={() => setIsRoleModalOpen(true)}
        onOpenSnapshotModal={() => setIsSnapshotModalOpen(true)}
        onRegionChange={(region) => setSessionConfig((prev) => ({ ...prev, region }))}
        instances={instances}
        selectedInstance={selectedInstance}
        onSelectInstance={(inst) => {
          handleSelectInstance(inst);
          clearFilters();
        }}
        loading={loading}
        onRefresh={loadTelemetry}
        currentVcpus={activeVcpus}
        onUpdateVcpus={setActiveVcpus}
        totalInstancesCount={totalInstancesCount}
        piEnabledCount={piEnabledCount}
        onlyPiEnabled={onlyPiEnabled}
        onToggleOnlyPiEnabled={setOnlyPiEnabled}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Time & Dimension Controls */}
      <TimeRangePicker
        currentPreset={timePreset}
        onSelectPreset={setPresetRange}
        startTime={timeWindow.start}
        endTime={timeWindow.end}
        isLive={isLive}
        onToggleLive={() => setIsLive(!isLive)}
        sliceBy={sliceBy}
        onChangeSliceBy={setSliceBy}
        granularity={granularity}
        onChangeGranularity={setGranularity}
        resolvedPeriodInSeconds={activePeriod}
        isOnboarded={isSelectedInstanceOnboarded}
        onOpenSnapshotModal={() => setIsSnapshotModalOpen(true)}
        selectedSqlIds={selectedSqlIds}
        selectedWaitCategories={selectedWaitCategories}
        selectedHostIds={selectedHostIds}
        selectedUserIds={selectedUserIds}
        onRemoveFilter={handleRemoveFilter}
        onClearFilters={clearFilters}
      />

      {/* Main Diagnostic Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 space-y-4">
        
        {/* Time-Travel Snapshot Archive Banner (Only shown beyond AWS 7-day retention) */}
        {isSelectedInstanceOnboarded && isBeyondAwsFreeTier && (
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/30 rounded-lg text-xs text-indigo-950 dark:text-indigo-200 flex items-center justify-between shadow-sm">
            <div className="flex items-center space-x-2">
              <span className="p-1 rounded bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">🕒</span>
              <div>
                <strong className="text-indigo-900 dark:text-white">Time Travel Mode:</strong> Viewing historical telemetry from{' '}
                <span className="font-mono text-indigo-700 dark:text-indigo-300 font-semibold">{timeWindow.start.toLocaleString()}</span> to{' '}
                <span className="font-mono text-indigo-700 dark:text-indigo-300 font-semibold">{timeWindow.end.toLocaleString()}</span> retrieved from persistent SQLite snapshot archive (bypassing AWS 7-day limit).
              </div>
            </div>
            <button
              onClick={() => setIsSnapshotModalOpen(true)}
              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium underline text-xs ml-2 shrink-0"
            >
              Snapshot Archive Details →
            </button>
          </div>
        )}

        {/* Error notification banner */}
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-500/40 rounded-lg text-xs text-rose-800 dark:text-rose-300 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setIsRoleModalOpen(true)}
              className="px-2.5 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-900 dark:hover:bg-rose-800 dark:text-rose-200 rounded font-semibold text-[11px] transition-colors"
            >
              Configure AWS Credentials
            </button>
          </div>
        )}

        {/* Performance Insights Disabled Notice */}
        {selectedInstance && !selectedInstance.performanceInsightsEnabled && (
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
              <div>
                <span className="font-semibold">Performance Insights is not enabled</span> on{' '}
                <span className="font-mono text-slate-900 dark:text-white font-bold">{selectedInstance.id}</span>.
                <span className="text-slate-500 dark:text-slate-400 ml-1">
                  Enable it in AWS RDS to capture Average Active Sessions and Top SQL queries.
                </span>
              </div>
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900/80 px-2 py-1 rounded border border-slate-200 dark:border-slate-800">
              aws rds modify-db-instance --db-instance-identifier {selectedInstance.id} --enable-performance-insights
            </div>
          </div>
        )}

        {/* Selected DB Instance Card */}
        {selectedInstance && (
          <div className="bg-[#fdfcf9] dark:bg-[#15161b] border border-[#e5e1d8] dark:border-zinc-800/90 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4 transition-colors">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-amber-500/20">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-stone-900 dark:text-white tracking-tight">{selectedInstance.id}</h2>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300">
                    {selectedInstance.engine} {selectedInstance.engineVersion}
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-semibold">
                    {selectedInstance.instanceClass} ({selectedInstance.vcpus} vCPUs)
                  </span>
                  {isSelectedInstanceOnboarded ? (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Snapshot Vault Enrolled (&gt;7d unlocked)
                    </span>
                  ) : (
                    <button
                      onClick={() => setIsSnapshotModalOpen(true)}
                      className="text-[10px] font-mono px-2 py-0.5 rounded bg-stone-100 hover:bg-stone-200 dark:bg-zinc-800 dark:hover:bg-zinc-750 text-stone-600 dark:text-zinc-400 border border-stone-300 dark:border-zinc-700 transition flex items-center gap-1"
                      title="Click to enroll this DB in automatic snapshots to retain telemetry beyond 7 days"
                    >
                      <span>Not Onboarded</span>
                      <span className="text-amber-500 underline font-semibold">+Onboard</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5 font-mono">
                  {selectedInstance.description || `Endpoint: ${selectedInstance.endpoint}:${selectedInstance.port || 5432}`}
                </p>
              </div>
            </div>

            {/* Quick incident switchers for Demo Mode */}
            {sessionConfig.isDemoMode && instances.length > 0 && (
              <div className="flex items-center gap-2 bg-stone-100/90 dark:bg-zinc-800/60 p-1 rounded-lg border border-stone-200 dark:border-zinc-700/80 text-xs">
                <span className="text-[11px] text-stone-500 dark:text-zinc-400 font-semibold px-2 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                  Scenario:
                </span>
                {instances.map((inst) => (
                  <button
                    key={inst.id}
                    onClick={() => {
                      handleSelectInstance(inst);
                      clearFilters();
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                      selectedInstance.id === inst.id
                        ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                        : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-200 dark:hover:bg-zinc-750'
                    }`}
                  >
                    {inst.incidentScenario === 'cpu_spike'
                      ? '1. CPU Saturation'
                      : inst.incidentScenario === 'row_locks'
                      ? '2. Row Deadlocks'
                      : '3. IOPS Choke'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Hero AAS Stacked Chart */}
        <div className="bg-[#fdfcf9] dark:bg-[#15161b] border border-[#e5e1d8] dark:border-zinc-800/90 rounded-xl overflow-hidden shadow-sm transition-colors">
          <AASChart
            dataPoints={metricsData}
            vcpus={activeVcpus}
            onZoomRange={handleZoomRange}
            selectedWaitCategories={selectedWaitCategories}
            onSelectWaitCategory={handleToggleWaitCategory}
            selectedSqlIds={selectedSqlIds}
            selectedHostIds={selectedHostIds}
            selectedUserIds={selectedUserIds}
            onResetSqlFilter={() => setSelectedSqlIds([])}
            onClearFilters={clearFilters}
            theme={theme}
          />

          {/* Collapsible System Counter Metrics (CPU, Memory, IOPS, Connections) */}
          <CounterMetrics dataPoints={metricsData} />
        </div>

        {/* Bottom Master-Detail Panel (Top SQL, Wait Events, Hosts, Users) */}
        <div className="bg-[#fdfcf9] dark:bg-[#15161b] border border-[#e5e1d8] dark:border-zinc-800/90 rounded-xl overflow-hidden shadow-sm transition-colors">
          
          {/* Tab Navigation */}
          <div className="flex items-center justify-between border-b border-[#e5e1d8] dark:border-zinc-800 px-4 bg-[#fbf9f4]/80 dark:bg-[#16171c]/80">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setBottomTab('top_sql')}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs font-bold border-b-2 transition-colors ${
                  bottomTab === 'top_sql'
                    ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Code className="w-4 h-4" />
                <span>Top SQL Statements</span>
                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {selectedSqlIds.length > 0 ? `${selectedSqlIds.length}/${topSqlItems.length}` : topSqlItems.length}
                </span>
              </button>

              <button
                onClick={() => setBottomTab('anomalies')}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs font-bold border-b-2 transition-colors ${
                  bottomTab === 'anomalies'
                    ? 'border-rose-500 text-rose-700 dark:text-rose-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Flame className={`w-4 h-4 ${anomalies.length > 0 ? 'text-rose-500 dark:text-rose-400 animate-pulse' : ''}`} />
                <span>Anomalous Queries</span>
                {anomalies.length > 0 && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 font-mono font-bold">
                    {anomalies.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setBottomTab('wait_events')}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs font-bold border-b-2 transition-colors ${
                  bottomTab === 'wait_events'
                    ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Wait Events Breakdown</span>
                {selectedWaitCategories.length > 0 && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/30">
                    {selectedWaitCategories.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setBottomTab('hosts')}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs font-bold border-b-2 transition-colors ${
                  bottomTab === 'hosts'
                    ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Server className="w-4 h-4" />
                <span>Database Hosts</span>
                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {selectedHostIds.length > 0 ? `${selectedHostIds.length}/${hostItems.length}` : hostItems.length}
                </span>
              </button>

              <button
                onClick={() => setBottomTab('users')}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs font-bold border-b-2 transition-colors ${
                  bottomTab === 'users'
                    ? 'border-amber-500 text-amber-700 dark:text-amber-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Users</span>
                <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {selectedUserIds.length > 0 ? `${selectedUserIds.length}/${userItems.length}` : userItems.length}
                </span>
              </button>
            </div>

            {/* Hint / Instructions */}
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Click or check multiple rows to combine scopes on the chart</span>
            </div>
          </div>

          {/* Tab Views */}
          <div className="p-0">
            {bottomTab === 'top_sql' && (
              <TopSqlTable
                items={topSqlItems}
                anomalies={anomalies}
                selectedSqlIds={selectedSqlIds}
                onSelectSql={handleToggleSql}
                onSelectAllSql={handleSelectAllSql}
                onClearSqlSelection={handleClearSqlSelection}
                onOpenDetails={handleOpenDetails}
              />
            )}

            {bottomTab === 'anomalies' && (
              <div className="p-4">
                <AnomaliesView
                  anomalies={anomalies}
                  loading={loading}
                  onScopeToQuery={(sqlId) => {
                    setSelectedSqlIds([sqlId]);
                    setSelectedHostIds([]);
                    setSelectedUserIds([]);
                  }}
                  onOpenSqlDetail={(item) => {
                    handleOpenDetails(item);
                  }}
                />
              </div>
            )}

            {bottomTab === 'wait_events' && (
              <WaitEventsTable
                dataPoints={metricsData}
                selectedWaitCategories={selectedWaitCategories}
                onSelectCategory={(cat) => cat && handleToggleWaitCategory(cat)}
                onToggleCategory={handleToggleWaitCategory}
                onClearCategories={() => setSelectedWaitCategories([])}
              />
            )}

            {bottomTab === 'hosts' && (
              <DimensionTable
                type="hosts"
                items={hostItems}
                selectedIds={selectedHostIds}
                onSelectItem={handleToggleHost}
                loading={loading}
              />
            )}

            {bottomTab === 'users' && (
              <DimensionTable
                type="users"
                items={userItems}
                selectedIds={selectedUserIds}
                onSelectItem={handleToggleUser}
                loading={loading}
              />
            )}
          </div>

        </div>

      </main>

      {/* Footer & Keyboard Shortcuts Hint */}
      <footer className="border-t border-slate-200 dark:border-slate-800/80 py-2.5 px-4 text-center text-[11px] text-slate-500 dark:text-slate-500 bg-white/70 dark:bg-slate-900/50 transition-colors">
        <div className="flex flex-wrap items-center justify-center gap-4 font-mono">
          <span>Shortcuts:</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">1</kbd> 15m</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">2</kbd> 1h</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">3</kbd> 3h</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">4</kbd> 24h</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">R</kbd> Refresh</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">Space</kbd> Pause/Live</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300">Esc</kbd> Clear Filter</span>
        </div>
      </footer>

      {/* Switch Role Modal */}
      <SwitchRoleModal
        isOpen={isRoleModalOpen}
        onClose={() => setIsRoleModalOpen(false)}
        currentConfig={sessionConfig}
        currentIdentity={callerIdentity}
        profiles={profiles}
        profileMetadata={profileMetadata}
        onApplyConfig={(newConfig, identity) => {
          setSessionConfig(newConfig);
          setCallerIdentity(identity);
          clearFilters();
        }}
      />

      {/* SQL Detail Modal */}
      <SqlDetailModal
        item={inspectingItem}
        fullSql={fullSqlText}
        onClose={() => setInspectingItem(null)}
      />

      {/* Snapshotter & Time Travel Archive Modal */}
      <SnapshotManagerModal
        isOpen={isSnapshotModalOpen}
        onClose={() => {
          setIsSnapshotModalOpen(false);
          refreshOnboarded();
        }}
        onSelectHistoricalWindow={handleSelectHistoricalWindow}
        currentInstance={selectedInstance}
        estateInstances={instances}
      />

    </div>
  );
}

export default App;
