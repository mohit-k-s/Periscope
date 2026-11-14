export interface AwsSessionConfig {
  profile?: string;
  region: string;
  roleArn?: string;
  roleSessionName?: string;
  externalId?: string;
  isDemoMode?: boolean;
}

export interface AwsCallerIdentity {
  account: string;
  arn: string;
  userId: string;
  isDemoMode?: boolean;
}

export interface ProfileMetadata {
  name: string;
  region?: string;
  roleArn?: string;
  sourceProfile?: string;
}

export interface DbInstanceInfo {
  id: string;
  dbiResourceId: string;
  engine: string;
  engineVersion: string;
  instanceClass: string;
  vcpus: number;
  status: string;
  endpoint: string;
  port?: number;
  performanceInsightsEnabled: boolean;
  retentionDays?: number;
  incidentScenario?: 'cpu_spike' | 'row_locks' | 'io_choke';
  name?: string;
  description?: string;
}

export interface MetricDataPoint {
  timestamp: string;
  totalAAS: number;
  slices: Record<string, number>;
  cpuUtilization: number;
  memoryFreeGB: number;
  iopsTotal: number;
  connections: number;
}

export interface TopSQLItem {
  id: string;
  sql: string;
  loadAAS: number;
  loadWaitBreakdown: Record<string, number>;
  callsPerSec: number;
  avgLatencyMs: number;
  rowsPerCall: number;
  user: string;
  database: string;
}

export interface WaitEventItem {
  name: string;
  category: 'CPU' | 'IO' | 'Lock' | 'Concurrency' | 'Network' | 'Other';
  loadAAS: number;
  percentage: number;
}

export interface SavedRolePreset {
  id: string;
  label: string;
  roleArn: string;
  profile?: string;
  externalId?: string;
  region: string;
}

export const AWS_REGIONS = [
  { id: 'ap-south-1', name: 'Asia Pacific (Mumbai)' },
  { id: 'us-east-1', name: 'US East (N. Virginia)' },
  { id: 'us-east-2', name: 'US East (Ohio)' },
  { id: 'us-west-1', name: 'US West (N. California)' },
  { id: 'us-west-2', name: 'US West (Oregon)' },
  { id: 'eu-west-1', name: 'Europe (Ireland)' },
  { id: 'eu-west-2', name: 'Europe (London)' },
  { id: 'eu-central-1', name: 'Europe (Frankfurt)' },
  { id: 'ap-southeast-1', name: 'Asia Pacific (Singapore)' },
  { id: 'ap-southeast-2', name: 'Asia Pacific (Sydney)' },
  { id: 'ap-northeast-1', name: 'Asia Pacific (Tokyo)' },
  { id: 'sa-east-1', name: 'South America (São Paulo)' },
  { id: 'ca-central-1', name: 'Canada (Central)' },
];

export const WAIT_CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; fill: string; label: string }> = {
  CPU: { bg: '#10b981', border: '#059669', text: '#34d399', fill: 'rgba(16, 185, 129, 0.85)', label: 'CPU' },
  IO: { bg: '#3b82f6', border: '#2563eb', text: '#60a5fa', fill: 'rgba(59, 130, 246, 0.85)', label: 'I/O' },
  Lock: { bg: '#ef4444', border: '#dc2626', text: '#f87171', fill: 'rgba(239, 68, 68, 0.85)', label: 'Lock' },
  Concurrency: { bg: '#8b5cf6', border: '#7c3aed', text: '#a78bfa', fill: 'rgba(139, 92, 246, 0.85)', label: 'Concurrency' },
  Network: { bg: '#f59e0b', border: '#d97706', text: '#fbbf24', fill: 'rgba(245, 158, 11, 0.85)', label: 'Network' },
  Other: { bg: '#6b7280', border: '#4b5563', text: '#9ca3af', fill: 'rgba(107, 114, 128, 0.85)', label: 'Other' },
};

export function categorizeWaitEvent(eventName: string): 'CPU' | 'IO' | 'Lock' | 'Concurrency' | 'Network' | 'Other' {
  if (!eventName) return 'Other';
  const lower = eventName.toLowerCase();
  if (lower === 'cpu' || lower.startsWith('cpu:') || lower.startsWith('cpu')) return 'CPU';
  if (
    lower === 'network' ||
    lower.startsWith('client:') ||
    lower.startsWith('network:') ||
    lower.includes('client') ||
    lower.includes('socket') ||
    lower.includes('network')
  ) {
    return 'Network';
  }
  if (
    lower === 'concurrency' ||
    lower === 'lwlock' ||
    lower === 'buffer' ||
    lower.startsWith('buffer:') ||
    lower.startsWith('lwlock:') ||
    lower.startsWith('bufferpin:') ||
    lower.includes('latch') ||
    lower.includes('concurrency')
  ) {
    return 'Concurrency';
  }
  if (
    lower === 'lock' ||
    lower.startsWith('lock:') ||
    lower.includes('deadlock') ||
    lower.startsWith('tuple:')
  ) {
    return 'Lock';
  }
  if (
    lower === 'io' ||
    lower.startsWith('io:') ||
    lower.includes('datafile') ||
    lower.includes('checkpoint') ||
    lower.includes('wal') ||
    lower.includes('read') ||
    lower.includes('write')
  ) {
    return 'IO';
  }
  if (lower.includes('lock')) return 'Lock';
  return 'Other';
}

export type GranularitySetting = 'auto' | '1s' | '1m' | '5m' | '1h';

export function resolvePeriodInSeconds(setting: GranularitySetting, durationMs: number): number {
  if (setting === '1s') return 1;
  if (setting === '1m') return 60;
  if (setting === '5m') return 300;
  if (setting === '1h') return 3600;

  // Auto Adaptive Resolution
  const durationSec = durationMs / 1000;
  if (durationSec <= 600) return 1;         // <= 10m -> 1-second ultra-high-res granularity
  if (durationSec <= 6 * 3600) return 60;    // <= 6h -> 1-minute granularity
  if (durationSec <= 48 * 3600) return 300;  // <= 48h -> 5-minute granularity
  return 3600;                               // > 48h (e.g. 7d) -> 1-hour granularity
}

export interface SnapshotStatus {
  isRunning: boolean;
  intervalMs: number;
  intervalMinutes: number;
  lastRun: string | null;
  nextRun: string | null;
  totalCaptures: number;
  lastDurationMs: number;
  lastStatus: 'idle' | 'running' | 'success' | 'partial' | 'error';
  lastError: string | null;
  monitoredInstances: string[];
  onboardedCount?: number;
  activeOnboardedCount?: number;
  isDemoMode: boolean;
}

export interface OnboardedInstance {
  instanceId: string;
  resourceId: string;
  engine: string;
  vcpus: number;
  status: 'active' | 'paused';
  intervalSeconds: number;
  retentionDays: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  totalSnapshots?: number;
  latestSnapshot?: string | null;
}

export interface StoredInstanceSummary {
  instanceId: string;
  resourceId: string;
  vcpus: number;
  totalSnapshots: number;
  earliestSnapshot: string;
  latestSnapshot: string;
}

export interface SnapshotDbStats {
  dbPath: string;
  fileSizeBytes: number;
  fileSizeMB: number;
  totalSnapshots: number;
  totalDimensions: number;
  totalUniqueSqls: number;
  earliestSnapshot: string | null;
  latestSnapshot: string | null;
}

export interface CostAnalysisResult {
  instances: number;
  vcpus: number;
  awsRatePerHourPerVcpu: number;
  awsCostPerVcpuMonth: number;
  awsMonthlyTotal: number;
  awsAnnualTotal: number;
  snapshotterStorageMonthly: number;
  snapshotterStorageAnnual: number;
  netAnnualSavings: number;
  savingsPercent: number;
}

export type AnomalyType =
  | 'IO_CHOKER'
  | 'CPU_MONOPOLIZER'
  | 'LOCK_CONVOY'
  | 'PLAN_REGRESSION'
  | 'BUFFER_BLOAT';

export interface QueryAnomaly {
  sqlId: string;
  sqlText: string;
  anomalyType: AnomalyType;
  anomalyTitle: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  toxicityScore: number;
  loadAAS: number;
  pctOfVcpus: number;
  dominantWaitEvent: string;
  waitBreakdown: Record<string, number>;
  rootCause: string;
  impactAnalysis: string;
  suggestedFix: string;
  suggestedDdl?: string;
  detectedAt: string;
}

