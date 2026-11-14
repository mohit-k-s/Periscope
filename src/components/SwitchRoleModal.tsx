import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  X,
  KeyRound,
  Server,
  Zap,
  Bookmark,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
} from 'lucide-react';
import {
  AwsSessionConfig,
  AwsCallerIdentity,
  SavedRolePreset,
  AWS_REGIONS,
} from '../types';
import { testAwsSession } from '../api';

interface SwitchRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig: AwsSessionConfig;
  currentIdentity: AwsCallerIdentity | null;
  profiles: string[];
  profileMetadata?: import('../types').ProfileMetadata[];
  onApplyConfig: (config: AwsSessionConfig, identity: AwsCallerIdentity) => void;
}

const STORAGE_SAVED_ROLES = 'quickpi_saved_roles';

export const SwitchRoleModal: React.FC<SwitchRoleModalProps> = ({
  isOpen,
  onClose,
  currentConfig,
  currentIdentity,
  profiles,
  profileMetadata = [],
  onApplyConfig,
}) => {
  const [isDemoMode, setIsDemoMode] = useState<boolean>(!!currentConfig.isDemoMode);
  const [selectedProfile, setSelectedProfile] = useState<string>(currentConfig.profile || 'default');
  const [selectedRegion, setSelectedRegion] = useState<string>(currentConfig.region || 'ap-south-1');
  const [roleArn, setRoleArn] = useState<string>(currentConfig.roleArn || '');
  const [roleSessionName, setRoleSessionName] = useState<string>(currentConfig.roleSessionName || 'Periscope-Session');
  const [externalId, setExternalId] = useState<string>(currentConfig.externalId || '');
  
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Synchronize modal state whenever modal opens or currentConfig changes
  useEffect(() => {
    if (isOpen) {
      setIsDemoMode(!!currentConfig.isDemoMode);
      setSelectedProfile(currentConfig.profile || 'default');
      setSelectedRegion(currentConfig.region || 'ap-south-1');
      setRoleArn(currentConfig.roleArn || '');
      setRoleSessionName(currentConfig.roleSessionName || 'Periscope-Session');
      setExternalId(currentConfig.externalId || '');
      setTestResult(null);
    }
  }, [isOpen, currentConfig]);

  // When changing profile, auto-switch to its configured region if available
  const handleProfileChange = (profileName: string) => {
    setSelectedProfile(profileName);
    const meta = profileMetadata.find((p) => p.name === profileName);
    if (meta?.region) {
      setSelectedRegion(meta.region);
    }
    setTestResult(null);
  };

  // Saved Role Presets in LocalStorage
  const [savedPresets, setSavedPresets] = useState<SavedRolePreset[]>([]);
  const [newPresetLabel, setNewPresetLabel] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_SAVED_ROLES);
      if (raw) {
        const parsed: SavedRolePreset[] = JSON.parse(raw);
        setSavedPresets(parsed.filter((p) => p.id !== 'demo-preset'));
      } else {
        setSavedPresets([]);
      }
    } catch (e) {
      console.warn('Failed to load saved roles', e);
    }
  }, []);

  const savePresetsToStorage = (presets: SavedRolePreset[]) => {
    setSavedPresets(presets);
    localStorage.setItem(STORAGE_SAVED_ROLES, JSON.stringify(presets));
  };

  const handleSaveCurrentAsPreset = () => {
    if (!newPresetLabel.trim()) return;
    const newPreset: SavedRolePreset = {
      id: `role-${Date.now()}`,
      label: newPresetLabel.trim(),
      roleArn: roleArn.trim(),
      profile: selectedProfile,
      externalId: externalId.trim(),
      region: selectedRegion,
    };
    const updated = [...savedPresets, newPreset];
    savePresetsToStorage(updated);
    setNewPresetLabel('');
  };

  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedPresets.filter((p) => p.id !== id);
    savePresetsToStorage(updated);
  };

  const handleSelectPreset = (preset: SavedRolePreset) => {
    setRoleArn(preset.roleArn);
    setSelectedProfile(preset.profile || 'default');
    setExternalId(preset.externalId || '');
    setSelectedRegion(preset.region);
    setTestResult(null);
  };

  const handleTestAndApply = async () => {
    setTesting(true);
    setTestResult(null);

    const targetConfig: AwsSessionConfig = {
      profile: selectedProfile,
      region: selectedRegion,
      roleArn: roleArn.trim() || undefined,
      roleSessionName: roleSessionName.trim() || 'Periscope-Session',
      externalId: externalId.trim() || undefined,
      isDemoMode,
    };

    try {
      const identity = await testAwsSession(targetConfig);
      setTestResult({
        success: true,
        message: isDemoMode
          ? 'Demo Mode active: Realistic simulated RDS incidents loaded'
          : `Connected to Account: ${identity.account} (${identity.arn})`,
      });

      setTimeout(() => {
        onApplyConfig(targetConfig, identity);
        onClose();
      }, 700);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Authentication failed. Check credentials or AssumeRole permissions.',
      });
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 rounded-xl shadow-2xl overflow-hidden transition-colors">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/80">
          <div className="flex items-center gap-3">
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
              <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <span>AWS Switch Role & Authentication</span>
                <span className="text-[10px] font-mono tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                  PERISCOPE
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">Configure cross-account IAM role assumptions or local profiles</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">

          {/* Quick Presets / Bookmarks */}
          {savedPresets.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                  Saved Accounts & Roles
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {savedPresets.map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`group flex items-center justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                      roleArn === preset.roleArn
                        ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300 shadow-sm'
                        : 'bg-slate-50 hover:bg-slate-100/90 dark:bg-slate-800/50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/70 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="text-xs font-semibold truncate">{preset.label}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate font-mono">
                        {preset.roleArn ? preset.roleArn.split('/').slice(-1)[0] : preset.profile}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeletePreset(preset.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 text-slate-400 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Demo Mode Toggle */}
          <div className="p-3 rounded-lg bg-amber-500/10 dark:bg-amber-500/5 border border-amber-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <div>
                <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">⚡ Demo / Incident Simulation Mode</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Loads realistic multi-scenario Postgres & MySQL incidents for testing & README screenshots</div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isDemoMode}
                onChange={(e) => {
                  setIsDemoMode(e.target.checked);
                  setTestResult(null);
                }}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          <div className="space-y-4 pt-1">
            {/* Local Profile & Region */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Source AWS Profile (from ~/.aws)
                  </label>
                  <select
                    value={selectedProfile}
                    onChange={(e) => handleProfileChange(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono shadow-sm transition-colors"
                  >
                    {profiles.map((p) => {
                      const meta = profileMetadata.find((m) => m.name === p);
                      return (
                        <option key={p} value={p}>
                          {p} {meta?.roleArn ? `(Role: ${meta.roleArn.split('/').slice(-1)[0]})` : ''} {meta?.region ? `[${meta.region}]` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Default Region</label>
                  <select
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono shadow-sm transition-colors"
                  >
                    {AWS_REGIONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} ({r.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cross-Account Assume Role Details */}
              <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  <Server className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                  Cross-Account Assume Role (Optional)
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Role ARN (Target Account)
                  </label>
                  <input
                    type="text"
                    placeholder="arn:aws:iam::123456789012:role/DBReadOrAdminRole"
                    value={roleArn}
                    onChange={(e) => setRoleArn(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono shadow-sm transition-colors"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      External ID (if required)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. corp-secret-token"
                      value={externalId}
                      onChange={(e) => setExternalId(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono shadow-sm transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Role Session Name</label>
                    <input
                      type="text"
                      value={roleSessionName}
                      onChange={(e) => setRoleSessionName(e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 font-mono shadow-sm transition-colors"
                    />
                  </div>
                </div>

                {/* Bookmark current role */}
                {roleArn.trim() && (
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700/50">
                    <input
                      type="text"
                      placeholder="Preset name (e.g. Prod DB Role)"
                      value={newPresetLabel}
                      onChange={(e) => setNewPresetLabel(e.target.value)}
                      className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-amber-500 shadow-sm transition-colors"
                    />
                    <button
                      type="button"
                      onClick={handleSaveCurrentAsPreset}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200/80 hover:bg-slate-300/80 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs rounded-lg font-medium border border-slate-300/60 dark:border-transparent transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Save Bookmark
                    </button>
                  </div>
                )}
              </div>
            </div>

          {/* Test Status Feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <div className="truncate font-medium">{testResult.message}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-700/80 flex items-center justify-between transition-colors">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {currentIdentity ? (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Active: <span className="font-mono font-medium text-slate-800 dark:text-slate-300">{currentIdentity.account}</span>
              </span>
            ) : (
              <span className="text-slate-400 dark:text-slate-500">Not authenticated</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleTestAndApply}
              disabled={testing}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors shadow-md shadow-amber-500/20 disabled:opacity-50"
            >
              {testing ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Switch & Apply'
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
