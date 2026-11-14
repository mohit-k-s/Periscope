import React, { useState, useEffect } from 'react';
import {
  Camera,
  Play,
  Pause,
  RotateCw,
  Clock,
  HardDrive,
  DollarSign,
  TrendingUp,
  Database,
  Calendar,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  X,
  CheckCircle,
  FileText,
  PlusCircle,
  Trash2,
  Sliders,
  Check,
  ShieldCheck,
} from 'lucide-react';
import {
  SnapshotStatus,
  StoredInstanceSummary,
  SnapshotDbStats,
  CostAnalysisResult,
  DbInstanceInfo,
  OnboardedInstance,
} from '../types';
import {
  fetchSnapshotStatus,
  startSnapshotDaemon,
  stopSnapshotDaemon,
  triggerSnapshot,
  fetchSnapshotInstances,
  fetchCostAnalysis,
  seedSnapshotHistory,
  fetchOnboardedInstances,
  onboardDatabaseInstance,
  updateOnboardedStatus,
  offboardDatabaseInstance,
} from '../api';

interface SnapshotManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectHistoricalWindow: (instanceId: string, start: Date, end: Date) => void;
  currentInstance: DbInstanceInfo | null;
  estateInstances?: DbInstanceInfo[];
}

export const SnapshotManagerModal: React.FC<SnapshotManagerModalProps> = ({
  isOpen,
  onClose,
  onSelectHistoricalWindow,
  currentInstance,
  estateInstances = [],
}) => {
  const [activeTab, setActiveTab] = useState<'onboarding' | 'time_travel' | 'cost_roi' | 'storage'>('onboarding');
  const [status, setStatus] = useState<SnapshotStatus | null>(null);
  const [instances, setInstances] = useState<StoredInstanceSummary[]>([]);
  const [onboardedList, setOnboardedList] = useState<OnboardedInstance[]>([]);
  const [stats, setStats] = useState<SnapshotDbStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Onboarding form state
  const [onboardingTarget, setOnboardingTarget] = useState<DbInstanceInfo | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(30);
  const [customNotes, setCustomNotes] = useState<string>('');

  // Cost calculator state
  const [calcFleetInstances, setCalcFleetInstances] = useState<number>(5);
  const [calcFleetVcpus, setCalcFleetVcpus] = useState<number>(32);
  const [costAnalysis, setCostAnalysis] = useState<CostAnalysisResult | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statusRes, instRes, costRes, onboardedRes] = await Promise.all([
        fetchSnapshotStatus(),
        fetchSnapshotInstances(),
        fetchCostAnalysis(calcFleetInstances, calcFleetVcpus),
        fetchOnboardedInstances(),
      ]);
      setStatus(statusRes);
      setInstances(instRes.instances);
      setStats(instRes.stats);
      setCostAnalysis(costRes);
      setOnboardedList(onboardedRes);
    } catch (e: any) {
      console.error('Failed to load snapshot manager data', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchCostAnalysis(calcFleetInstances, calcFleetVcpus)
        .then(setCostAnalysis)
        .catch(console.error);
    }
  }, [calcFleetInstances, calcFleetVcpus, isOpen]);

  if (!isOpen) return null;

  const handleToggleDaemon = async () => {
    try {
      if (status?.isRunning) {
        const res = await stopSnapshotDaemon();
        setStatus(res.status);
        setMessage({ type: 'success', text: 'Snapshot daemon paused.' });
      } else {
        const res = await startSnapshotDaemon();
        setStatus(res.status);
        setMessage({ type: 'success', text: 'Snapshot daemon started (recording every 5m for onboarded databases).' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to toggle snapshot daemon' });
    }
  };

  const handleTriggerNow = async () => {
    try {
      setTriggering(true);
      const res = await triggerSnapshot();
      setMessage({
        type: 'success',
        text: `Snapshot successfully captured for ${res.capturedCount} onboarded database instance(s)!`,
      });
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to capture snapshot' });
    } finally {
      setTriggering(false);
    }
  };

  const handleSeedHistory = async () => {
    try {
      setLoading(true);
      const res = await seedSnapshotHistory(14, 30);
      setMessage({
        type: 'success',
        text: `Seeded ${res.seededCount} historical snapshots across onboarded databases! You can now travel back in time.`,
      });
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to seed history' });
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardSubmit = async () => {
    if (!onboardingTarget) return;
    try {
      setLoading(true);
      const res = await onboardDatabaseInstance({
        instanceId: onboardingTarget.id,
        resourceId: onboardingTarget.dbiResourceId || onboardingTarget.id,
        engine: onboardingTarget.engine,
        vcpus: onboardingTarget.vcpus,
        intervalSeconds: 300,
        retentionDays,
        notes: customNotes || `Onboarded from Console UI`,
      });
      setOnboardedList(res.onboarded);
      setOnboardingTarget(null);
      setCustomNotes('');
      setMessage({
        type: 'success',
        text: `Enrolled "${onboardingTarget.id}" into 5-minute snapshotter with ${retentionDays}-day retention.`,
      });
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to onboard database' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleInstanceStatus = async (instanceId: string, currentStatus: 'active' | 'paused') => {
    try {
      const next = currentStatus === 'active' ? 'paused' : 'active';
      const res = await updateOnboardedStatus(instanceId, next);
      setOnboardedList(res.onboarded);
      setMessage({
        type: 'success',
        text: `Updated "${instanceId}" status to ${next.toUpperCase()}.`,
      });
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to toggle status' });
    }
  };

  const handleOffboard = async (instanceId: string) => {
    if (!confirm(`Are you sure you want to offboard "${instanceId}"? The snapshotter will stop recording snapshots for this database. Historical snapshots remain archived.`)) {
      return;
    }
    try {
      setLoading(true);
      const res = await offboardDatabaseInstance(instanceId);
      setOnboardedList(res.onboarded);
      setMessage({
        type: 'success',
        text: `Offboarded "${instanceId}". Existing historical snapshots remain safe in archive.`,
      });
      await loadData();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to offboard database' });
    } finally {
      setLoading(false);
    }
  };

  const onboardedMap = new Map(onboardedList.map((o) => [o.instanceId, o]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#14151b] text-stone-900 dark:text-zinc-100 border border-stone-200 dark:border-zinc-800 rounded-xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh] overflow-hidden transition-colors">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between bg-stone-50 dark:bg-[#181a24]">
          <div className="flex items-center space-x-3">
            <div className="relative flex items-center justify-center">
              <img
                src="/icon-dark.png"
                alt="Periscope Icon"
                className="h-8 w-auto rounded border border-stone-300 dark:border-zinc-700 bg-stone-100 dark:bg-[#111213] p-0.5 hidden dark:block"
              />
              <img
                src="/icon-light.png"
                alt="Periscope Icon"
                className="h-8 w-auto rounded border border-stone-300 dark:border-zinc-700 bg-stone-100 dark:bg-[#111213] p-0.5 block dark:hidden"
              />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-stone-900 dark:text-white flex items-center space-x-2">
                <span>Periscope Snapshot Vault</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border border-indigo-500/30 font-semibold">
                  Selective 5m Engine
                </span>
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400 font-mono">
                Onboard specific mission-critical databases without estate-wide bloat
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Daemon Status Pill */}
            <div className="flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-mono bg-stone-100 dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700">
              <span
                className={`w-2 h-2 rounded-full ${
                  status?.isRunning ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse' : 'bg-stone-400 dark:bg-zinc-500'
                }`}
              />
              <span className={status?.isRunning ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-stone-600 dark:text-zinc-400'}>
                {status?.isRunning ? `Daemon Active (${onboardedList.filter(o => o.status === 'active').length} DBs)` : 'Daemon Stopped'}
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded text-stone-400 hover:text-stone-800 dark:hover:text-white hover:bg-stone-200 dark:hover:bg-zinc-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Controls & Status Bar */}
        <div className="px-6 py-3 bg-stone-50/80 dark:bg-[#111217] border-b border-stone-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-4 text-stone-600 dark:text-zinc-400 font-mono text-[11px]">
            <div>
              <span className="text-stone-500 dark:text-zinc-500">Onboarded:</span>{' '}
              <strong className="text-indigo-700 dark:text-indigo-300 font-bold">
                {onboardedList.filter((o) => o.status === 'active').length} of {estateInstances.length} DBs
              </strong>
            </div>
            <div>
              <span className="text-stone-500 dark:text-zinc-500">Total Snapshots:</span>{' '}
              <strong className="text-stone-900 dark:text-white">{stats?.totalSnapshots || 0}</strong>
            </div>
            <div>
              <span className="text-stone-500 dark:text-zinc-500">DB Size:</span>{' '}
              <strong className="text-stone-900 dark:text-white">{stats?.fileSizeMB || 0} MB</strong>
            </div>
            {status?.lastRun && (
              <div>
                <span className="text-stone-500 dark:text-zinc-500">Last Capture:</span>{' '}
                <span className="text-stone-800 dark:text-zinc-300 font-semibold">
                  {new Date(status.lastRun).toLocaleTimeString()}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleToggleDaemon}
              className={`px-3 py-1 rounded font-medium flex items-center space-x-1.5 transition text-xs ${
                status?.isRunning
                  ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40 dark:hover:bg-amber-500/30'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
              }`}
            >
              {status?.isRunning ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Daemon</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Start Daemon</span>
                </>
              )}
            </button>

            <button
              onClick={handleTriggerNow}
              disabled={triggering || onboardedList.filter((o) => o.status === 'active').length === 0}
              title={onboardedList.filter((o) => o.status === 'active').length === 0 ? 'Onboard at least 1 database first' : 'Trigger snapshot now'}
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded font-medium flex items-center space-x-1.5 shadow-sm transition text-xs"
            >
              <RotateCw className={`w-3.5 h-3.5 ${triggering ? 'animate-spin' : ''}`} />
              <span>{triggering ? 'Capturing...' : 'Capture Now'}</span>
            </button>
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            className={`px-6 py-2 text-xs flex items-center justify-between ${
              message.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/70 border-b border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/70 border-b border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
            }`}
          >
            <div className="flex items-center space-x-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{message.text}</span>
            </div>
            <button onClick={() => setMessage(null)} className="text-xs hover:underline font-semibold">
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-stone-200 dark:border-zinc-800 flex space-x-4 bg-stone-100/60 dark:bg-[#16171e]">
          <button
            onClick={() => setActiveTab('onboarding')}
            className={`pb-2.5 px-1 font-medium text-xs flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'onboarding'
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-stone-500 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Database Onboarding</span>
            <span className="ml-1 px-1.5 py-0.2 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded text-[10px] font-semibold">
              {onboardedList.length} Enrolled
            </span>
          </button>

          <button
            onClick={() => setActiveTab('time_travel')}
            className={`pb-2.5 px-1 font-medium text-xs flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'time_travel'
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-stone-500 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Time Travel & Archive</span>
            <span className="ml-1 px-1.5 py-0.2 bg-stone-200 dark:bg-zinc-800 text-stone-700 dark:text-zinc-300 rounded text-[10px] font-medium">
              {instances.length} Historical
            </span>
          </button>

          <button
            onClick={() => setActiveTab('cost_roi')}
            className={`pb-2.5 px-1 font-medium text-xs flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'cost_roi'
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-stone-500 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>Cost Analysis & AWS Savings</span>
            <span className="ml-1 px-1.5 py-0.2 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded text-[10px] font-semibold">
              99.9% ROI
            </span>
          </button>

          <button
            onClick={() => setActiveTab('storage')}
            className={`pb-2.5 px-1 font-medium text-xs flex items-center space-x-1.5 border-b-2 transition ${
              activeTab === 'storage'
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-stone-500 dark:text-zinc-400 hover:text-stone-800 dark:hover:text-zinc-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Storage & Architecture</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {/* TAB 0: Database Onboarding */}
          {activeTab === 'onboarding' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 p-4 rounded-xl text-xs">
                <div className="space-y-1">
                  <div className="font-semibold text-stone-900 dark:text-white flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Selective Onboarding Control</span>
                  </div>
                  <p className="text-stone-600 dark:text-zinc-300 leading-relaxed">
                    Only onboarded databases are monitored and snapshotted every 5 minutes.
                    Non-onboarded databases in your estate remain untouched to eliminate unnecessary storage and API queries.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[11px] text-stone-500 dark:text-zinc-400 block font-mono">Monitored Fleet Capacity:</span>
                  <span className="text-sm font-bold font-mono text-emerald-700 dark:text-emerald-400">
                    {onboardedList.reduce((acc, cur) => acc + (cur.status === 'active' ? cur.vcpus : 0), 0)} vCPUs
                  </span>
                </div>
              </div>

              {/* Onboarding Dialog / Drawer if active */}
              {onboardingTarget && (
                <div className="p-4 bg-white dark:bg-[#181922] border-2 border-indigo-500/40 rounded-xl space-y-3 shadow-lg animate-fadeIn text-xs">
                  <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-2">
                    <span className="font-semibold text-stone-900 dark:text-white">
                      Enroll Database: <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">{onboardingTarget.id}</span>
                    </span>
                    <button onClick={() => setOnboardingTarget(null)} className="text-stone-400 hover:text-stone-700 dark:hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-stone-700 dark:text-zinc-300 block mb-1 font-medium font-mono text-[11px]">Retention Policy (Days):</label>
                      <select
                        value={retentionDays}
                        onChange={(e) => setRetentionDays(Number(e.target.value))}
                        className="w-full bg-stone-50 dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-stone-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      >
                        <option value={7}>7 Days</option>
                        <option value={30}>30 Days (Recommended)</option>
                        <option value={90}>90 Days (Quarterly)</option>
                        <option value={365}>365 Days (1 Year)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-stone-700 dark:text-zinc-300 block mb-1 font-medium font-mono text-[11px]">Custom Notes / Cluster Role:</label>
                      <input
                        type="text"
                        placeholder="e.g. Core production checkout service"
                        value={customNotes}
                        onChange={(e) => setCustomNotes(e.target.value)}
                        className="w-full bg-stone-50 dark:bg-zinc-900 border border-stone-300 dark:border-zinc-700 rounded-lg px-2.5 py-1.5 text-stone-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-1">
                    <button
                      onClick={() => setOnboardingTarget(null)}
                      className="px-3 py-1 bg-stone-200 hover:bg-stone-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-stone-700 dark:text-zinc-200 rounded font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleOnboardSubmit}
                      disabled={loading}
                      className="px-3.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium flex items-center space-x-1 shadow-sm"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Confirm & Start 5m Snapshotting</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Discovered Estate Databases Table */}
              <div className="border border-stone-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#16171d] shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-100 dark:bg-[#1c1d26] text-stone-600 dark:text-zinc-400 border-b border-stone-200 dark:border-zinc-800 font-mono text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-2.5">Database Identifier</th>
                      <th className="px-4 py-2.5">Engine / vCPUs</th>
                      <th className="px-4 py-2.5">Snapshot Status</th>
                      <th className="px-4 py-2.5">Retention / Notes</th>
                      <th className="px-4 py-2.5 text-right">Onboarding Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 dark:divide-zinc-800">
                    {estateInstances.map((inst) => {
                      const onboardInfo = onboardedMap.get(inst.id);
                      const isOnboarded = !!onboardInfo;
                      const isActive = onboardInfo?.status === 'active';

                      return (
                        <tr key={inst.id} className="hover:bg-stone-50 dark:hover:bg-zinc-800/40 transition-colors">
                          <td className="px-4 py-3 font-mono font-medium text-stone-900 dark:text-white">
                            <div className="flex items-center space-x-2">
                              <Database className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                              <span className="font-bold">{inst.id}</span>
                            </div>
                            <div className="text-[10px] text-stone-500 dark:text-zinc-400 font-normal">
                              {inst.instanceClass}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-stone-700 dark:text-zinc-300 font-mono">
                            <div>{inst.engine}</div>
                            <div className="text-stone-500 dark:text-zinc-400 text-[10px]">{inst.vcpus} vCPUs</div>
                          </td>

                          <td className="px-4 py-3">
                            {isOnboarded ? (
                              <div className="flex items-center space-x-1.5">
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    isActive ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse' : 'bg-amber-500 dark:bg-amber-400'
                                  }`}
                                />
                                <span
                                  className={`font-mono text-xs font-semibold ${
                                    isActive ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                                  }`}
                                >
                                  {isActive ? 'Active (5m)' : 'Paused'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-stone-500 dark:text-zinc-400 text-xs flex items-center space-x-1.5 font-mono">
                                <span className="w-2 h-2 rounded-full bg-stone-400 dark:bg-zinc-600" />
                                <span>Not Monitored</span>
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-stone-600 dark:text-zinc-400 text-xs">
                            {isOnboarded ? (
                              <div>
                                <span className="text-stone-900 dark:text-zinc-200 font-mono font-medium">{onboardInfo.retentionDays}d retention</span>
                                {onboardInfo.notes && (
                                  <div className="text-[10px] text-stone-500 dark:text-zinc-400 truncate max-w-[180px]">
                                    {onboardInfo.notes}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-stone-400 dark:text-zinc-500 italic">Excluded from snapshots</span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-right">
                            {isOnboarded ? (
                              <div className="flex items-center justify-end space-x-2">
                                <button
                                  onClick={() => handleToggleInstanceStatus(inst.id, onboardInfo.status)}
                                  className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                                    isActive
                                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20 dark:border-amber-500/30'
                                      : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 dark:border-emerald-500/30'
                                  }`}
                                >
                                  {isActive ? 'Pause' : 'Resume'}
                                </button>
                                <button
                                  onClick={() => handleOffboard(inst.id)}
                                  title="Remove database from snapshotting"
                                  className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setOnboardingTarget(inst)}
                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium text-xs inline-flex items-center space-x-1.5 shadow-sm transition"
                              >
                                <PlusCircle className="w-3.5 h-3.5" />
                                <span>Onboard</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 1: Time Travel & Stored Instances */}
          {activeTab === 'time_travel' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-white">Archived Database Telemetry</h3>
                  <p className="text-xs text-stone-600 dark:text-zinc-400 font-mono">
                    Select any historical snapshot window to load past telemetry directly into your AAS dashboard.
                  </p>
                </div>
                <button
                  onClick={handleSeedHistory}
                  disabled={loading}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded text-xs flex items-center space-x-1.5 transition font-mono"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Seed 14-Day History</span>
                </button>
              </div>

              {instances.length === 0 ? (
                <div className="text-center py-10 bg-stone-50/70 dark:bg-zinc-900/50 rounded-lg border border-dashed border-stone-200 dark:border-zinc-800">
                  <Database className="w-8 h-8 text-stone-400 dark:text-zinc-600 mx-auto mb-2" />
                  <p className="text-sm text-stone-600 dark:text-zinc-400 font-medium">No snapshots recorded yet.</p>
                  <p className="text-xs text-stone-500 dark:text-zinc-500 mt-1">
                    Onboard a database and click "Capture Now" to start recording snapshots.
                  </p>
                </div>
              ) : (
                <div className="border border-stone-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-[#16171d] shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-stone-100 dark:bg-[#1c1d26] text-stone-600 dark:text-zinc-400 border-b border-stone-200 dark:border-zinc-800 font-mono text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-2.5">Instance Identifier</th>
                        <th className="px-4 py-2.5">vCPUs</th>
                        <th className="px-4 py-2.5">Recorded Points</th>
                        <th className="px-4 py-2.5">Time Span</th>
                        <th className="px-4 py-2.5 text-right">Time Travel Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200 dark:divide-zinc-800">
                      {instances.map((inst) => {
                        const earliest = new Date(inst.earliestSnapshot);
                        const latest = new Date(inst.latestSnapshot);
                        const spanDays = +(
                          (latest.getTime() - earliest.getTime()) /
                          (86400 * 1000)
                        ).toFixed(1);

                        return (
                          <tr key={inst.instanceId} className="hover:bg-stone-50 dark:hover:bg-zinc-800/40 transition-colors">
                            <td className="px-4 py-3 font-mono font-medium text-stone-900 dark:text-white flex items-center space-x-2">
                              <Database className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                              <span className="font-bold">{inst.instanceId}</span>
                            </td>
                            <td className="px-4 py-3 text-stone-700 dark:text-zinc-300 font-mono">{inst.vcpus} vCPUs</td>
                            <td className="px-4 py-3 text-stone-700 dark:text-zinc-300 font-mono">
                              <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 text-indigo-700 dark:text-indigo-300 font-medium">
                                {inst.totalSnapshots} snapshots
                              </span>
                            </td>
                            <td className="px-4 py-3 text-stone-600 dark:text-zinc-400 font-mono text-[11px]">
                              <div>{earliest.toLocaleDateString()} to {latest.toLocaleDateString()}</div>
                              <div className="text-stone-500 dark:text-zinc-500 text-[10px]">({spanDays} days archived)</div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => {
                                  const jumpEnd = latest;
                                  const jumpStart = new Date(jumpEnd.getTime() - 24 * 3600 * 1000);
                                  onSelectHistoricalWindow(inst.instanceId, jumpStart, jumpEnd);
                                  onClose();
                                }}
                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium text-xs inline-flex items-center space-x-1.5 shadow-sm transition"
                              >
                                <span>Travel Back</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Cost Analysis & AWS Savings */}
          {activeTab === 'cost_roi' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-rose-50/80 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-rose-700 dark:text-rose-400 font-semibold mb-1 font-mono">AWS Extended PI Cost</div>
                  <div className="text-2xl font-bold font-mono text-rose-950 dark:text-white">
                    ${costAnalysis?.awsAnnualTotal.toLocaleString()}
                    <span className="text-xs font-normal text-stone-500 dark:text-zinc-400"> /year</span>
                  </div>
                  <div className="text-xs text-rose-700/80 dark:text-rose-300/80 mt-1 font-mono">
                    ${costAnalysis?.awsMonthlyTotal.toFixed(2)} /month @ $0.0125/vCPU-hr
                  </div>
                </div>

                <div className="bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold mb-1 font-mono">Snapshotter Storage Cost</div>
                  <div className="text-2xl font-bold font-mono text-emerald-800 dark:text-emerald-300">
                    ${costAnalysis?.snapshotterStorageAnnual.toFixed(2)}
                    <span className="text-xs font-normal text-stone-500 dark:text-zinc-400"> /year</span>
                  </div>
                  <div className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-1 font-mono">
                    ${costAnalysis?.snapshotterStorageMonthly.toFixed(2)} /mo (Local SQLite = $0)
                  </div>
                </div>

                <div className="bg-indigo-50/80 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40 rounded-xl p-4 shadow-sm">
                  <div className="text-xs text-indigo-700 dark:text-indigo-400 font-semibold mb-1 font-mono">Net Fleet Savings</div>
                  <div className="text-2xl font-bold font-mono text-indigo-900 dark:text-indigo-300">
                    ${costAnalysis?.netAnnualSavings.toLocaleString()}
                    <span className="text-xs font-normal text-stone-500 dark:text-zinc-400"> /year</span>
                  </div>
                  <div className="text-xs text-indigo-700 dark:text-indigo-300 mt-1 font-semibold font-mono">
                    {costAnalysis?.savingsPercent}% Cost Reduction
                  </div>
                </div>
              </div>

              <div className="bg-stone-50/80 dark:bg-zinc-900/60 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-4">
                <h4 className="text-xs font-semibold text-stone-700 dark:text-zinc-300 uppercase tracking-wider font-mono">
                  Interactive Fleet Cost Calculator
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs text-stone-600 dark:text-zinc-400 flex justify-between mb-1 font-mono">
                      <span>Database Instances:</span>
                      <strong className="text-stone-900 dark:text-white font-mono">{calcFleetInstances} DBs</strong>
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={calcFleetInstances}
                      onChange={(e) => setCalcFleetInstances(Number(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-stone-600 dark:text-zinc-400 flex justify-between mb-1 font-mono">
                      <span>Total Provisioned vCPUs across Fleet:</span>
                      <strong className="text-stone-900 dark:text-white font-mono">{calcFleetVcpus} vCPUs</strong>
                    </label>
                    <input
                      type="range"
                      min={4}
                      max={256}
                      step={4}
                      value={calcFleetVcpus}
                      onChange={(e) => setCalcFleetVcpus(Number(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-stone-50/80 dark:bg-[#181a24] border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3 text-xs leading-relaxed">
                <h4 className="font-semibold text-stone-900 dark:text-white flex items-center space-x-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  <span>Why AWS Performance Insights Extended Retention is Costly</span>
                </h4>
                <ul className="space-y-2 text-stone-600 dark:text-zinc-300 list-disc pl-4">
                  <li>
                    <strong className="text-stone-900 dark:text-white">vCPU-Hour Metering:</strong> AWS charges{' '}
                    <span className="font-mono text-amber-700 dark:text-amber-300 font-bold">$0.0125 per vCPU-hour</span> ($9.13 per
                    vCPU-month) for extended retention. A 64-vCPU instance (`db.r6g.16xlarge`) costs{' '}
                    <strong className="text-stone-900 dark:text-white">$584/month</strong> ($7,008/year) just for performance
                    metric retention!
                  </li>
                  <li>
                    <strong className="text-stone-900 dark:text-white">Selective Onboarding Eliminates Estate Waste:</strong> By enrolling only the databases you care about into the snapshotter, you prevent paying or polling for dozens of non-critical test/dev databases.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* TAB 3: Storage & Architecture */}
          {activeTab === 'storage' && (
            <div className="space-y-5 text-xs">
              <div className="bg-stone-50/80 dark:bg-zinc-900/60 border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
                <h4 className="font-semibold text-stone-900 dark:text-white flex items-center space-x-2">
                  <HardDrive className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Local SQLite High-Performance Storage (`node:sqlite`)</span>
                </h4>
                <p className="text-stone-600 dark:text-zinc-300 leading-relaxed">
                  The snapshotter writes directly to a local WAL-mode SQLite database with zero external
                  compilation dependencies, utilizing Node.js 22+ built-in synchronous SQLite primitives.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 font-mono">
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded border border-stone-200 dark:border-zinc-800 shadow-sm">
                    <div className="text-stone-500 dark:text-zinc-500 text-[10px]">Database Path</div>
                    <div className="text-stone-900 dark:text-white truncate font-bold" title={stats?.dbPath}>
                      {stats?.dbPath.split('/').slice(-2).join('/')}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded border border-stone-200 dark:border-zinc-800 shadow-sm">
                    <div className="text-stone-500 dark:text-zinc-500 text-[10px]">Disk Space Used</div>
                    <div className="text-indigo-600 dark:text-indigo-400 font-bold">{stats?.fileSizeMB} MB</div>
                  </div>
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded border border-stone-200 dark:border-zinc-800 shadow-sm">
                    <div className="text-stone-500 dark:text-zinc-500 text-[10px]">Snapshots Recorded</div>
                    <div className="text-stone-900 dark:text-white font-bold">{stats?.totalSnapshots}</div>
                  </div>
                  <div className="bg-white dark:bg-zinc-950 p-2.5 rounded border border-stone-200 dark:border-zinc-800 shadow-sm">
                    <div className="text-stone-500 dark:text-zinc-500 text-[10px]">Onboarded Targets</div>
                    <div className="text-emerald-700 dark:text-emerald-400 font-bold">{onboardedList.length}</div>
                  </div>
                </div>
              </div>

              <div className="bg-stone-50/80 dark:bg-[#181d2a] border border-stone-200 dark:border-zinc-800 rounded-xl p-5 space-y-3">
                <h4 className="font-semibold text-stone-900 dark:text-white flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>CLI Usage & Terminal Automation</span>
                </h4>
                <p className="text-stone-600 dark:text-zinc-400">
                  You can onboard databases, run single captures, or execute scheduled cron jobs via the CLI:
                </p>
                <pre className="p-3 bg-stone-900 text-stone-100 rounded-lg border border-stone-700 font-mono text-[11px] overflow-x-auto space-y-1 shadow-inner">
                  <div><span className="text-indigo-400"># Onboard an individual database target</span></div>
                  <div>npx periscope onboard &lt;db-identifier&gt; --retention 30</div>
                  <div className="pt-2"><span className="text-indigo-400"># List all onboarded database targets</span></div>
                  <div>npm run snapshot:targets</div>
                  <div className="pt-2"><span className="text-indigo-400"># Run a snapshot cycle across onboarded targets</span></div>
                  <div>npm run snapshot:run</div>
                  <div className="pt-2"><span className="text-indigo-400"># Start the 5-minute persistent background daemon</span></div>
                  <div>npm run snapshot:daemon -- --interval 300</div>
                  <div className="pt-2"><span className="text-indigo-400"># Offboard a database from snapshotting</span></div>
                  <div>npm run snapshot:offboard -- analytics-mysql-dw</div>
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-stone-200 dark:border-zinc-800 bg-[#fbf9f4] dark:bg-[#181a24] flex items-center justify-between text-xs text-stone-600 dark:text-zinc-400 font-mono">
          <span>Targeting {onboardedList.filter((o) => o.status === 'active').length} of {estateInstances.length} estate databases</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-stone-200 hover:bg-stone-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-stone-800 dark:text-white rounded-lg font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
