import {
  AwsSessionConfig,
  AwsCallerIdentity,
  DbInstanceInfo,
  MetricDataPoint,
  TopSQLItem,
  ProfileMetadata,
} from './types';

const API_BASE = '/api';

export async function fetchProfiles(): Promise<{ profiles: string[]; metadata: ProfileMetadata[] }> {
  try {
    const res = await fetch(`${API_BASE}/aws/profiles`);
    const data = await res.json();
    return {
      profiles: data.profiles || ['default'],
      metadata: data.metadata || [],
    };
  } catch (e) {
    console.error('Failed to fetch AWS profiles', e);
    return { profiles: ['default'], metadata: [] };
  }
}

export async function testAwsSession(config: AwsSessionConfig): Promise<AwsCallerIdentity> {
  const res = await fetch(`${API_BASE}/aws/test-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to authenticate AWS session');
  }

  return data;
}

export async function fetchInstances(
  config: AwsSessionConfig,
  includeAll = false
): Promise<{ instances: DbInstanceInfo[]; totalCount: number; piEnabledCount: number }> {
  const res = await fetch(`${API_BASE}/aws/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...config, includeAll }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to list RDS instances');
  }

  return {
    instances: data.instances || [],
    totalCount: data.totalCount || 0,
    piEnabledCount: data.piEnabledCount || 0,
  };
}

export interface MetricQueryParams {
  sessionConfig: AwsSessionConfig;
  instanceId: string;
  resourceId: string;
  startTime: string;
  endTime: string;
  periodInSeconds?: number;
  selectedSqlId?: string;
  selectedSqlIds?: string[];
  selectedWaitCategory?: string;
  selectedWaitCategories?: string[];
  selectedHostId?: string;
  selectedHostIds?: string[];
  selectedUserId?: string;
  selectedUserIds?: string[];
  vcpus?: number;
  source?: 'aws' | 'snapshot';
}

export async function fetchMetrics(params: MetricQueryParams): Promise<{
  dataPoints: MetricDataPoint[];
  vcpus: number;
  periodInSeconds: number;
}> {
  const res = await fetch(`${API_BASE}/pi/metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch performance metrics');
  }

  return data;
}

export interface DimensionQueryParams {
  sessionConfig: AwsSessionConfig;
  instanceId: string;
  resourceId: string;
  startTime: string;
  endTime: string;
  groupBy?: string;
  maxResults?: number;
  selectedWaitCategory?: string;
  selectedWaitCategories?: string[];
  selectedHostId?: string;
  selectedUserId?: string;
  selectedSqlId?: string;
  source?: 'aws' | 'snapshot';
}

export async function fetchDimensionKeys(params: DimensionQueryParams): Promise<TopSQLItem[]> {
  const res = await fetch(`${API_BASE}/pi/dimension-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch dimension keys');
  }

  return data.items || [];
}

export async function fetchSqlDetails(
  sessionConfig: AwsSessionConfig,
  instanceId: string,
  resourceId: string,
  sqlId: string
): Promise<string> {
  const res = await fetch(`${API_BASE}/pi/sql-details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionConfig, instanceId, resourceId, sqlId }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch SQL details');
  }

  return data.fullSql || '';
}

// Snapshotter & Time Travel API
export async function fetchSnapshotStatus(): Promise<import('./types').SnapshotStatus> {
  const res = await fetch(`${API_BASE}/snapshots/status`);
  if (!res.ok) throw new Error('Failed to fetch snapshotter status');
  return res.json();
}

export async function startSnapshotDaemon(intervalMs?: number): Promise<{ success: boolean; status: import('./types').SnapshotStatus }> {
  const res = await fetch(`${API_BASE}/snapshots/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intervalMs }),
  });
  if (!res.ok) throw new Error('Failed to start snapshotter daemon');
  return res.json();
}

export async function stopSnapshotDaemon(): Promise<{ success: boolean; status: import('./types').SnapshotStatus }> {
  const res = await fetch(`${API_BASE}/snapshots/stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to stop snapshotter daemon');
  return res.json();
}

export async function triggerSnapshot(): Promise<any> {
  const res = await fetch(`${API_BASE}/snapshots/trigger`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to trigger snapshot');
  return res.json();
}

export async function fetchSnapshotInstances(): Promise<{
  instances: import('./types').StoredInstanceSummary[];
  stats: import('./types').SnapshotDbStats;
}> {
  const res = await fetch(`${API_BASE}/snapshots/instances`);
  if (!res.ok) throw new Error('Failed to fetch snapshot instances');
  return res.json();
}

export async function fetchOnboardedInstances(): Promise<import('./types').OnboardedInstance[]> {
  const res = await fetch(`${API_BASE}/snapshots/onboarded`);
  if (!res.ok) throw new Error('Failed to fetch onboarded instances');
  const data = await res.json();
  return data.onboarded || [];
}

export async function onboardDatabaseInstance(params: {
  instanceId: string;
  resourceId?: string;
  engine?: string;
  vcpus?: number;
  intervalSeconds?: number;
  retentionDays?: number;
  notes?: string;
}): Promise<{ success: boolean; onboarded: import('./types').OnboardedInstance[] }> {
  const res = await fetch(`${API_BASE}/snapshots/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to onboard database');
  return res.json();
}

export async function updateOnboardedStatus(
  instanceId: string,
  status: 'active' | 'paused'
): Promise<{ success: boolean; onboarded: import('./types').OnboardedInstance[] }> {
  const res = await fetch(`${API_BASE}/snapshots/onboard/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId, status }),
  });
  if (!res.ok) throw new Error('Failed to update onboarded status');
  return res.json();
}

export async function offboardDatabaseInstance(
  instanceId: string
): Promise<{ success: boolean; onboarded: import('./types').OnboardedInstance[] }> {
  const res = await fetch(`${API_BASE}/snapshots/onboard/${encodeURIComponent(instanceId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to offboard database');
  return res.json();
}

export async function fetchCostAnalysis(instances = 5, vcpus = 32): Promise<import('./types').CostAnalysisResult> {
  const res = await fetch(`${API_BASE}/snapshots/cost-analysis?instances=${instances}&vcpus=${vcpus}`);
  if (!res.ok) throw new Error('Failed to fetch cost analysis');
  return res.json();
}

export async function seedSnapshotHistory(days = 14, intervalMinutes = 30): Promise<any> {
  const res = await fetch(`${API_BASE}/snapshots/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days, intervalMinutes }),
  });
  if (!res.ok) throw new Error('Failed to seed snapshot history');
  return res.json();
}

export async function fetchAnomalies(params: {
  sessionConfig: AwsSessionConfig;
  instanceId: string;
  resourceId: string;
  startTime: string;
  endTime: string;
  vcpus?: number;
}): Promise<import('./types').QueryAnomaly[]> {
  const res = await fetch(`${API_BASE}/anomalies/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to detect query anomalies');
  const data = await res.json();
  return data.anomalies || [];
}
