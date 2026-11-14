import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getLocalAwsProfilesMetadata,
  getAwsClients,
  testAwsSession,
  listRdsInstances,
  AwsSessionConfig,
  getSupportedMetricsForResource,
  buildSafeCounterMetricQueries,
  resolveAdaptiveGranularity,
} from './aws-client.js';
import {
  MOCK_INCIDENT_PRESETS,
  MOCK_SQL_STATEMENTS,
  generateMockTimeSeries,
} from './mock-data.js';
import {
  GetResourceMetricsCommand,
  DescribeDimensionKeysCommand,
  GetDimensionKeyDetailsCommand,
} from '@aws-sdk/client-pi';
import { snapshotEngine } from './snapshotter.ts';
import { snapshotStore } from './snapshot-store.ts';
import { anomalyDetector } from './anomaly-detector.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve production frontend assets if built
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

// Helper to resolve wait filter into accurate AWS Performance Insights dimension keys
// Uses 'db.wait_event.type' or 'db.wait_event.name' to match PartitionBy group 'db.wait_event'
export function resolveWaitFilter(waitCategoryOrName?: string): Record<string, string> | undefined {
  if (!waitCategoryOrName) return undefined;
  const trimmed = waitCategoryOrName.trim();
  if (!trimmed) return undefined;

  // If specific wait event name with colon (e.g. "Lock:transaction", "IO:DataFileRead", "Client:ClientRead")
  if (trimmed.includes(':')) {
    return { 'db.wait_event.name': trimmed };
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'cpu') {
    return { 'db.wait_event.type': 'CPU' };
  }
  if (lower === 'io') {
    return { 'db.wait_event.type': 'IO' };
  }
  if (lower === 'lock') {
    return { 'db.wait_event.type': 'Lock' };
  }
  if (lower === 'concurrency' || lower === 'lwlock' || lower === 'buffer') {
    return { 'db.wait_event.type': 'LWLock' };
  }
  if (lower === 'network' || lower === 'client') {
    return { 'db.wait_event.type': 'Client' };
  }
  if (lower === 'other') {
    // AWS RDS Performance Insights has no 'Other' type.
    // Returning undefined prevents passing an invalid filter to AWS PI,
    // so all dimension keys are returned and filtered in-memory.
    return undefined;
  }

  // Capitalize first letter for AWS wait type (e.g. "Timeout", "Activity")
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return { 'db.wait_event.type': capitalized };
}

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

// List local profiles discovered from ~/.aws with regions and roles
app.get('/api/aws/profiles', (req, res) => {
  try {
    const profiles = getLocalAwsProfilesMetadata();
    res.json({
      profiles: profiles.map((p) => p.name),
      metadata: profiles,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test current AWS session / switch role
app.post('/api/aws/test-session', async (req, res) => {
  const config: AwsSessionConfig = req.body;
  if (config.isDemoMode) {
    return res.json({
      success: true,
      account: '123456789012 (Demo)',
      arn: 'arn:aws:iam::123456789012:role/DemoDatabaseAdmin',
      userId: 'DEMO-USER-PI',
      isDemoMode: true,
    });
  }

  try {
    const result = await testAwsSession(config);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List DB Instances in Region & Account
app.post('/api/aws/instances', async (req, res) => {
  const config: AwsSessionConfig & { includeAll?: boolean } = req.body;

  if (config.isDemoMode) {
    return res.json({
      instances: MOCK_INCIDENT_PRESETS.map((p) => ({
        id: p.dbIdentifier,
        dbiResourceId: `db-${p.id.toUpperCase()}`,
        engine: p.engine,
        engineVersion: '16.2',
        instanceClass: p.instanceClass,
        vcpus: p.vcpus,
        status: p.status,
        endpoint: `${p.dbIdentifier}.c1234567890.us-east-1.rds.amazonaws.com`,
        port: p.engine.includes('postgres') ? 5432 : 3306,
        performanceInsightsEnabled: true,
        retentionDays: 7,
        incidentScenario: p.scenario,
        name: p.name,
        description: p.description,
      })),
      totalCount: MOCK_INCIDENT_PRESETS.length,
      piEnabledCount: MOCK_INCIDENT_PRESETS.length,
    });
  }

  try {
    const allInstances = await listRdsInstances(config);
    const piEnabledInstances = allInstances.filter((i) => i.performanceInsightsEnabled);

    // Filter by PI enabled unless includeAll is explicitly requested
    const returnedInstances = config.includeAll ? allInstances : piEnabledInstances;

    res.json({
      instances: returnedInstances,
      totalCount: allInstances.length,
      piEnabledCount: piEnabledInstances.length,
    });
  } catch (err: any) {
    console.error('Error fetching RDS instances:', err);
    res.status(500).json({
      error: err.message || 'Failed to list RDS instances',
      instances: [],
      totalCount: 0,
      piEnabledCount: 0,
    });
  }
});

// Fetch Performance Insights Telemetry (AAS + Counter Metrics)
app.post('/api/pi/metrics', async (req, res) => {
  const {
    sessionConfig,
    instanceId,
    resourceId, // e.g. db-XXXXX (DbiResourceId)
    startTime,
    endTime,
    periodInSeconds,
    selectedSqlId,
    selectedSqlIds,
    selectedWaitCategory,
    selectedWaitCategories,
    selectedHostId,
    selectedHostIds,
    selectedUserId,
    selectedUserIds,
    vcpus = 4,
    source,
  } = req.body;

  const start = new Date(startTime || Date.now() - 3600000);
  const end = new Date(endTime || Date.now());

  // Adaptive Granularity Engine
  // AWS PI supports periodInSeconds: 1, 60, 300, 3600, 86400
  const durationSec = Math.max(1, (end.getTime() - start.getTime()) / 1000);
  const resolvedPeriod = resolveAdaptiveGranularity(durationSec, periodInSeconds);

  // Check if historical snapshot archive should be queried
  // (Either explicitly requested via source='snapshot' or when querying older than 7 days)
  const isOlderThan7Days = Date.now() - start.getTime() > 7 * 86400 * 1000;
  if (source === 'snapshot' || isOlderThan7Days) {
    const historical = snapshotStore.queryHistoricalMetrics(instanceId, start.toISOString(), end.toISOString());
    if (historical.dataPoints.length > 0) {
      return res.json({
        periodInSeconds: resolvedPeriod || 300,
        dataPoints: historical.dataPoints,
        vcpus: historical.vcpus,
        source: 'snapshot_archive',
        totalPoints: historical.totalPoints,
      });
    }
  }

  // Normalize multi-selection arrays
  const sqlIds: string[] = Array.isArray(selectedSqlIds) && selectedSqlIds.length > 0
    ? selectedSqlIds.filter(Boolean)
    : (selectedSqlId ? [selectedSqlId] : []);

  const hostIds: string[] = Array.isArray(selectedHostIds) && selectedHostIds.length > 0
    ? selectedHostIds.filter(Boolean)
    : (selectedHostId ? [selectedHostId] : []);

  const userIds: string[] = Array.isArray(selectedUserIds) && selectedUserIds.length > 0
    ? selectedUserIds.filter(Boolean)
    : (selectedUserId ? [selectedUserId] : []);

  const waitCategories: string[] = Array.isArray(selectedWaitCategories) && selectedWaitCategories.length > 0
    ? selectedWaitCategories.filter(Boolean)
    : (selectedWaitCategory ? [selectedWaitCategory] : []);

  // Demo mode or fallback
  if (sessionConfig?.isDemoMode || !resourceId || resourceId.startsWith('db-PROD') || resourceId.startsWith('db-ANALYTICS')) {
    let scenario: 'cpu_spike' | 'row_locks' | 'io_choke' = 'cpu_spike';
    if (instanceId?.includes('inventory')) scenario = 'row_locks';
    if (instanceId?.includes('analytics')) scenario = 'io_choke';

    const points = generateMockTimeSeries(
      scenario,
      start,
      end,
      vcpus,
      selectedSqlId,
      selectedWaitCategory,
      sqlIds,
      waitCategories,
      hostIds,
      userIds,
      resolvedPeriod
    );

    return res.json({
      periodInSeconds: resolvedPeriod,
      dataPoints: points,
      vcpus,
    });
  }

  try {
    const { pi } = await getAwsClients(sessionConfig);
    const piIdentifier = resourceId.startsWith('db-') ? resourceId : instanceId;

    // Build load metric queries
    // When multiple entities of a dimension are selected, issue a db.load.avg query for each entity
    const loadMetricQueries: any[] = [];

    if (sqlIds.length > 0) {
      // Query load for each selected SQL ID (up to 10)
      for (const sqlId of sqlIds.slice(0, 10)) {
        loadMetricQueries.push({
          Metric: 'db.load.avg',
          GroupBy: { Group: 'db.wait_event', Limit: 10 },
          Filter: { 'db.sql.id': sqlId },
        });
      }
    } else if (hostIds.length > 0) {
      // Query load for each selected Host (up to 10)
      for (const hId of hostIds.slice(0, 10)) {
        loadMetricQueries.push({
          Metric: 'db.load.avg',
          GroupBy: { Group: 'db.wait_event', Limit: 10 },
          Filter: { 'db.host.id': hId },
        });
      }
    } else if (userIds.length > 0) {
      // Query load for each selected User (up to 10)
      for (const uId of userIds.slice(0, 10)) {
        loadMetricQueries.push({
          Metric: 'db.load.avg',
          GroupBy: { Group: 'db.wait_event', Limit: 10 },
          Filter: { 'db.user.name': uId },
        });
      }
    } else {
      // Base instance load: query both overall AAS total and top 25 wait event dimensions
      loadMetricQueries.push({
        Metric: 'db.load.avg',
      });
      loadMetricQueries.push({
        Metric: 'db.load.avg',
        GroupBy: { Group: 'db.wait_event', Limit: 25 },
      });
    }

    // Query supported metrics from AWS for this specific resource to avoid InvalidArgumentException
    const supportedSet = await getSupportedMetricsForResource(pi, piIdentifier);
    const safeCounterQueries = buildSafeCounterMetricQueries(supportedSet);

    let metricList: any[] = [];
    try {
      const command = new GetResourceMetricsCommand({
        ServiceType: 'RDS',
        Identifier: piIdentifier,
        StartTime: start,
        EndTime: end,
        PeriodInSeconds: resolvedPeriod,
        MetricQueries: [
          ...loadMetricQueries,
          ...safeCounterQueries,
        ],
      });

      const response = await pi.send(command);
      metricList = response.MetricList || [];
    } catch (piErr: any) {
      // If AWS throws InvalidArgumentException: The specified metric is not a known metric,
      // gracefully retry with core load queries only so AAS and top wait breakdown never fails!
      if (piErr.name === 'InvalidArgumentException' || String(piErr).includes('not a known metric')) {
        console.warn(`[QuickPI] Non-standard counter metric detected on ${piIdentifier}. Retrying with core baseline metrics...`);
        try {
          const safeRetryCmd = new GetResourceMetricsCommand({
            ServiceType: 'RDS',
            Identifier: piIdentifier,
            StartTime: start,
            EndTime: end,
            PeriodInSeconds: resolvedPeriod,
            MetricQueries: [
              ...loadMetricQueries,
              { Metric: 'os.general.numVCPUs.avg' },
              { Metric: 'os.cpuUtilization.total.avg' },
              { Metric: 'os.memory.free.avg' },
              { Metric: 'os.memory.cached.avg' },
              { Metric: 'os.memory.buffers.avg' },
            ],
          });
          const safeRetryRes = await pi.send(safeRetryCmd);
          metricList = safeRetryRes.MetricList || [];
        } catch {
          // If custom OS metrics are fully locked down, retry with load only so AAS never fails
          const fallbackCmd = new GetResourceMetricsCommand({
            ServiceType: 'RDS',
            Identifier: piIdentifier,
            StartTime: start,
            EndTime: end,
            PeriodInSeconds: resolvedPeriod,
            MetricQueries: loadMetricQueries,
          });
          const fallbackRes = await pi.send(fallbackCmd);
          metricList = fallbackRes.MetricList || [];
        }
      } else {
        throw piErr;
      }
    }

    // Transform AWS response into unified points
    const timestampMap = new Map<string, any>();
    let detectedNumVcpus = vcpus;
    const lowerWaitCategories = waitCategories.map((c) => c.toLowerCase());

    if (metricList) {
      for (const item of metricList) {
        const metricName = item.Key?.Metric || '';
        const hasDimensions = item.Key?.Dimensions && Object.keys(item.Key.Dimensions).length > 0;
        const waitState = hasDimensions
          ? (item.Key?.Dimensions?.['db.wait_event.name'] || item.Key?.Dimensions?.['db.wait_event_type.name'] || 'CPU')
          : null;

        if (item.DataPoints) {
          for (const dp of item.DataPoints) {
            if (!dp.Timestamp) continue;
            const tsIso = dp.Timestamp.toISOString();

            if (!timestampMap.has(tsIso)) {
              timestampMap.set(tsIso, {
                timestamp: tsIso,
                totalAAS: 0,
                sliceSum: 0,
                baseTotal: 0,
                slices: {},
                cpuUtilization: 0,
                memFreeKB: 0,
                memCachedKB: 0,
                memBuffersKB: 0,
                memTotalKB: 0,
                memoryFreeGB: 0,
                iopsTotal: 0,
                connections: 0,
              });
            }

            const pt = timestampMap.get(tsIso);
            const val = dp.Value || 0;

            if (metricName === 'db.load.avg') {
              if (hasDimensions && waitState) {
                // If wait categories are scoped, verify whether this slice belongs to one of them
                if (lowerWaitCategories.length > 0) {
                  const cat = categorizeWaitEvent(waitState).toLowerCase();
                  if (!lowerWaitCategories.includes(cat)) {
                    continue; // Skip slice not belonging to selected wait categories
                  }
                }
                pt.slices[waitState] = +((pt.slices[waitState] || 0) + val).toFixed(4);
                pt.sliceSum = +(pt.sliceSum + val).toFixed(4);
              } else if (!hasDimensions) {
                // Aggregate base load (true total instance AAS)
                pt.baseTotal = +(pt.baseTotal + val).toFixed(4);
              }
            } else if (metricName.includes('numVCPUs') && val > 0) {
              detectedNumVcpus = Math.round(val);
            } else if (metricName.includes('cpuUtilization')) {
              pt.cpuUtilization = +(val.toFixed(1));
              pt.hasCpu = true;
            } else if (metricName.startsWith('os.memory.free')) {
              pt.memFreeKB = val;
              pt.hasMem = true;
            } else if (metricName.startsWith('os.memory.cached') || metricName.includes('db.cache')) {
              pt.memCachedKB = val;
              pt.hasMem = true;
            } else if (metricName.startsWith('os.memory.buffers')) {
              pt.memBuffersKB = val;
              pt.hasMem = true;
            } else if (metricName.startsWith('os.memory.total')) {
              pt.memTotalKB = val;
            } else if (metricName.includes('diskIO') && (metricName.includes('readIOsPS') || metricName.includes('writeIOsPS'))) {
              pt.iopsTotal = +(pt.iopsTotal + val).toFixed(1);
              pt.hasIops = true;
            } else if (metricName.includes('numbackends') || metricName.includes('Threads_connected')) {
              pt.connections = Math.round(val);
              pt.hasConn = true;
            }
          }
        }
      }
    }

    const chronological = Array.from(timestampMap.values())
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Step-interpolation / Sample-and-Hold for OS Counter Metrics:
    // In AWS Performance Insights, db.load.avg (AAS) is sampled every 1 second, but OS counter metrics
    // (CPU, Memory, IOPS, Connections) are sampled at 60s intervals. We forward-fill the last known
    // metrics across sub-minute 1s points so values don't plummet to 0 between 60s sample boundaries.
    let lastCpu = 0;
    let lastMemFreeKB = 0;
    let lastMemCachedKB = 0;
    let lastMemBuffersKB = 0;
    let lastIops = 0;
    let lastConn = 0;

    for (const pt of chronological) {
      if (pt.hasCpu) lastCpu = pt.cpuUtilization;
      else if (lastCpu > 0) pt.cpuUtilization = lastCpu;

      if (pt.hasMem) {
        lastMemFreeKB = pt.memFreeKB;
        lastMemCachedKB = pt.memCachedKB;
        lastMemBuffersKB = pt.memBuffersKB;
      } else if (lastMemFreeKB > 0 || lastMemCachedKB > 0 || lastMemBuffersKB > 0) {
        pt.memFreeKB = lastMemFreeKB;
        pt.memCachedKB = lastMemCachedKB;
        pt.memBuffersKB = lastMemBuffersKB;
      }

      if (pt.hasIops) lastIops = pt.iopsTotal;
      else if (lastIops > 0) pt.iopsTotal = lastIops;

      if (pt.hasConn) lastConn = pt.connections;
      else if (lastConn > 0) pt.connections = lastConn;
    }

    // Back-fill any initial points before the first 60s OS sample in the window
    const firstWithCpu = chronological.find((p) => p.hasCpu);
    if (firstWithCpu && firstWithCpu.cpuUtilization > 0) {
      for (const pt of chronological) {
        if (pt.hasCpu) break;
        pt.cpuUtilization = firstWithCpu.cpuUtilization;
      }
    }
    const firstWithMem = chronological.find((p) => p.hasMem);
    if (firstWithMem) {
      for (const pt of chronological) {
        if (pt.hasMem) break;
        pt.memFreeKB = firstWithMem.memFreeKB;
        pt.memCachedKB = firstWithMem.memCachedKB;
        pt.memBuffersKB = firstWithMem.memBuffersKB;
      }
    }
    const firstWithIops = chronological.find((p) => p.hasIops);
    if (firstWithIops && firstWithIops.iopsTotal > 0) {
      for (const pt of chronological) {
        if (pt.hasIops) break;
        pt.iopsTotal = firstWithIops.iopsTotal;
      }
    }
    const firstWithConn = chronological.find((p) => p.hasConn);
    if (firstWithConn && firstWithConn.connections > 0) {
      for (const pt of chronological) {
        if (pt.hasConn) break;
        pt.connections = firstWithConn.connections;
      }
    }

    const sortedPoints = chronological.map((pt) => {
      // In AWS PI, if base unpartitioned total exceeds top slice sum, the residual is categorized as "Other"
      const residual = +(Math.max(0, pt.baseTotal - pt.sliceSum)).toFixed(4);
      if (residual > 0.001) {
        if (lowerWaitCategories.length === 0 || lowerWaitCategories.includes('other')) {
          pt.slices['Other'] = +((pt.slices['Other'] || 0) + residual).toFixed(4);
          pt.sliceSum = +(pt.sliceSum + residual).toFixed(4);
        }
      }

      // Use dimensional slice sum if available; otherwise use base unpartitioned total
      const total = pt.sliceSum > 0 ? pt.sliceSum : (lowerWaitCategories.length === 0 ? pt.baseTotal : 0);
      if (total > 0 && Object.keys(pt.slices).length === 0 && lowerWaitCategories.length === 0) {
        pt.slices['CPU'] = total;
      }

      // Accurate Linux Freeable Memory: free + cached + buffers (values in KB -> convert to GB)
      const freeableKB = (pt.memFreeKB || 0) + (pt.memCachedKB || 0) + (pt.memBuffersKB || 0);
      const freeGB = freeableKB > 0
        ? +(freeableKB / (1024 * 1024)).toFixed(2)
        : (pt.memFreeKB > 0 ? +(pt.memFreeKB / (1024 * 1024)).toFixed(2) : 0);

      return {
        timestamp: pt.timestamp,
        totalAAS: +(total.toFixed(4)),
        slices: pt.slices,
        cpuUtilization: pt.cpuUtilization,
        memoryFreeGB: freeGB,
        iopsTotal: Math.round(pt.iopsTotal),
        connections: pt.connections,
      };
    });

    res.json({
      periodInSeconds,
      dataPoints: sortedPoints,
      vcpus: detectedNumVcpus,
    });
  } catch (err: any) {
    const msg = err.message || '';
    if (err.name === 'NotAuthorizedException' || msg.includes('not authorized') || msg.includes('NotAuthorized')) {
      console.warn(`[QuickPI] Performance Insights is disabled or unauthorized on ${instanceId || resourceId}`);
      return res.json({
        periodInSeconds,
        dataPoints: [],
        vcpus,
        piDisabled: true,
        error: 'Performance Insights is not enabled on this instance.',
      });
    }

    console.error('Error in /api/pi/metrics:', err);
    res.status(500).json({ error: err.message, dataPoints: [] });
  }
});

// Fetch Dimension Keys (Top SQL, Wait Events, Hosts, Users)
app.post('/api/pi/dimension-keys', async (req, res) => {
  const {
    sessionConfig,
    instanceId,
    resourceId,
    startTime,
    endTime,
    groupBy = 'db.sql',
    maxResults = 10,
    selectedWaitCategory,
    selectedWaitCategories,
    selectedHostId,
    selectedUserId,
    selectedSqlId,
    source,
  } = req.body;

  const start = new Date(startTime || Date.now() - 3600000);
  const end = new Date(endTime || Date.now());

  const activeWaitCategory = selectedWaitCategory || (Array.isArray(selectedWaitCategories) && selectedWaitCategories[0]);

  // Query historical snapshot archive if requested or older than AWS 7-day retention
  const isOlderThan7Days = Date.now() - start.getTime() > 7 * 86400 * 1000;
  if (source === 'snapshot' || isOlderThan7Days) {
    const targetDim = (groupBy === 'db.wait_state' ? 'db.wait_event' : groupBy) as any;
    const historicalItems = snapshotStore.queryHistoricalDimensionKeys(instanceId, start.toISOString(), end.toISOString(), targetDim, maxResults);
    if (historicalItems.length > 0) {
      return res.json({ items: historicalItems, groupBy, source: 'snapshot_archive' });
    }
  }

  // Demo mode or fallback
  if (sessionConfig?.isDemoMode || !resourceId || resourceId.startsWith('db-PROD') || resourceId.startsWith('db-ANALYTICS')) {
    if (groupBy === 'db.host') {
      let hosts = [
        { id: 'host-10-0-12-84', name: '10.0.12.84 (app-worker-pool-1a)', loadAAS: 4.82, loadWaitBreakdown: { CPU: 70, IO: 30 } },
        { id: 'host-10-0-14-21', name: '10.0.14.21 (checkout-api-1b)', loadAAS: 2.15, loadWaitBreakdown: { Lock: 60, CPU: 40 } },
        { id: 'host-10-0-18-99', name: '10.0.18.99 (inventory-sync)', loadAAS: 1.10, loadWaitBreakdown: { IO: 80, CPU: 20 } },
      ];
      if (activeWaitCategory) {
        const targetCat = activeWaitCategory.toLowerCase();
        const filtered = hosts.filter((h) => {
          return Object.entries(h.loadWaitBreakdown).some(([catKey, val]) => {
            if (val <= 0) return false;
            return categorizeWaitEvent(catKey).toLowerCase() === targetCat || catKey.toLowerCase() === targetCat;
          });
        });
        hosts = filtered.length > 0 ? filtered : hosts;
      }
      return res.json({ items: hosts, groupBy });
    }

    if (groupBy === 'db.user') {
      let users = [
        { id: 'user-orders', name: 'api_orders_service', loadAAS: 5.20, loadWaitBreakdown: { CPU: 75, IO: 25 } },
        { id: 'user-auth', name: 'api_auth_service', loadAAS: 2.10, loadWaitBreakdown: { CPU: 80, Lock: 20 } },
        { id: 'user-payment', name: 'payment_processor', loadAAS: 1.15, loadWaitBreakdown: { IO: 60, Lock: 40 } },
      ];
      if (activeWaitCategory) {
        const targetCat = activeWaitCategory.toLowerCase();
        const filtered = users.filter((u) => {
          return Object.entries(u.loadWaitBreakdown).some(([catKey, val]) => {
            if (val <= 0) return false;
            return categorizeWaitEvent(catKey).toLowerCase() === targetCat || catKey.toLowerCase() === targetCat;
          });
        });
        users = filtered.length > 0 ? filtered : users;
      }
      return res.json({ items: users, groupBy });
    }

    let scenario: 'cpu_spike' | 'row_locks' | 'io_choke' = 'cpu_spike';
    if (instanceId?.includes('inventory')) scenario = 'row_locks';
    if (instanceId?.includes('analytics')) scenario = 'io_choke';

    let sqls = MOCK_SQL_STATEMENTS[scenario] || MOCK_SQL_STATEMENTS.cpu_spike;

    if (activeWaitCategory) {
      const targetCat = activeWaitCategory.toLowerCase();
      const filtered = sqls.filter((item) => {
        return Object.entries(item.loadWaitBreakdown).some(([catKey, val]) => {
          if (val <= 0) return false;
          return categorizeWaitEvent(catKey).toLowerCase() === targetCat || catKey.toLowerCase() === targetCat;
        });
      });
      sqls = filtered.length > 0 ? filtered : sqls;
    }

    return res.json({
      items: sqls.slice(0, maxResults),
      groupBy,
    });
  }

  try {
    const { pi } = await getAwsClients(sessionConfig);
    const piIdentifier = resourceId.startsWith('db-') ? resourceId : instanceId;

    const targetGroupBy = groupBy === 'db.wait_state' ? 'db.wait_event' : groupBy;
    const waitFilter = resolveWaitFilter(activeWaitCategory);

    // Dynamic PartitionBy and Filter to strictly satisfy AWS PI validation:
    // "The specified filter dimension should belong to either groupBy group or partitionBy group"
    let partitionGroup = 'db.wait_event';
    let filterToApply: Record<string, string> | undefined = undefined;

    if (targetGroupBy === 'db.sql') {
      if (selectedHostId) {
        partitionGroup = 'db.host';
        filterToApply = { 'db.host.id': selectedHostId };
      } else if (selectedUserId) {
        partitionGroup = 'db.user';
        filterToApply = { 'db.user.name': selectedUserId };
      } else if (waitFilter) {
        partitionGroup = 'db.wait_event';
        filterToApply = waitFilter;
      }
    } else {
      // groupBy is db.host, db.user, or db.wait_event
      if (waitFilter) {
        partitionGroup = 'db.wait_event';
        filterToApply = waitFilter;
      }
    }

    const isSqlGroup = targetGroupBy === 'db.sql';
    const effectiveGroupBy = isSqlGroup ? 'db.sql_tokenized' : targetGroupBy;
    const additionalMetricsToRequest = isSqlGroup
      ? [
          'db.sql_tokenized.stats.calls_per_sec.avg',
          'db.sql_tokenized.stats.avg_latency_per_call.avg',
          'db.sql_tokenized.stats.rows_per_sec.avg',
        ]
      : undefined;

    let response: any;
    try {
      const command = new DescribeDimensionKeysCommand({
        ServiceType: 'RDS',
        Identifier: piIdentifier,
        StartTime: start,
        EndTime: end,
        Metric: 'db.load.avg',
        GroupBy: {
          Group: effectiveGroupBy,
          Limit: maxResults,
        },
        PartitionBy: {
          Group: partitionGroup,
          Limit: 10,
        },
        Filter: filterToApply,
        AdditionalMetrics: additionalMetricsToRequest,
      });
      response = await pi.send(command);
    } catch (dimErr: any) {
      if (isSqlGroup) {
        console.warn(`[QuickPI] Retrying with db.sql fallback without additional metrics: ${dimErr.message}`);
        const fallbackCmd = new DescribeDimensionKeysCommand({
          ServiceType: 'RDS',
          Identifier: piIdentifier,
          StartTime: start,
          EndTime: end,
          Metric: 'db.load.avg',
          GroupBy: {
            Group: 'db.sql',
            Limit: maxResults,
          },
          PartitionBy: {
            Group: partitionGroup,
            Limit: 10,
          },
          Filter: filterToApply,
        });
        response = await pi.send(fallbackCmd);
      } else {
        throw dimErr;
      }
    }

    const items = (response.Keys || []).map((k: any) => {
      const id =
        k.Dimensions?.[`${effectiveGroupBy}.id`] ||
        k.Dimensions?.['db.sql.id'] ||
        k.Dimensions?.[`${targetGroupBy}.id`] ||
        k.Dimensions?.[`${targetGroupBy}.name`] ||
        k.Dimensions?.[`${targetGroupBy}.statement`] ||
        'unknown';
      const name =
        k.Dimensions?.[`${effectiveGroupBy}.statement`] ||
        k.Dimensions?.['db.sql.statement'] ||
        k.Dimensions?.[`${targetGroupBy}.statement`] ||
        k.Dimensions?.[`${targetGroupBy}.name`] ||
        id;
      const totalLoad = k.Total || 0;

      // Extract partition wait state breakdowns
      const waitBreakdown: Record<string, number> = {};
      let partitionSum = 0;
      if (k.Partitions) {
        for (let i = 0; i < k.Partitions.length; i++) {
          const partVal = k.Partitions[i] || 0;
          partitionSum += partVal;
          const partKey =
            response.PartitionKeys?.[i]?.Dimensions?.['db.wait_event.name'] ||
            response.PartitionKeys?.[i]?.Dimensions?.['db.wait_event.type'] ||
            `wait_${i}`;
          if (partVal > 0) {
            waitBreakdown[partKey] = +((partVal / (totalLoad || 1)) * 100).toFixed(0);
          }
        }
      }

      // If total load exceeds sum of top partitions, allocate residual to "Other" (matching AWS PI legend)
      const residual = totalLoad - partitionSum;
      if (residual > 0.0001 && totalLoad > 0) {
        const otherPct = Math.round((residual / totalLoad) * 100);
        if (otherPct > 0) {
          waitBreakdown['Other'] = otherPct;
        }
      }

      // Extract execution metrics (Calls/sec, Avg latency, Rows/sec) from AWS PI AdditionalMetrics
      const addMetrics = k.AdditionalMetrics || {};
      let callsPerSec = 0;
      let avgLatencyMs = 0;
      let rowsPerCall = 0;

      for (const [mKey, mVal] of Object.entries(addMetrics)) {
        const lowerKey = mKey.toLowerCase();
        const num = Number(mVal) || 0;
        if (lowerKey.includes('calls_per_sec') || lowerKey.includes('count_per_sec')) {
          callsPerSec = +num.toFixed(2);
        } else if (lowerKey.includes('latency') || lowerKey.includes('timer_wait') || lowerKey.includes('time_per_call')) {
          avgLatencyMs = +num.toFixed(2);
        } else if (lowerKey.includes('rows')) {
          rowsPerCall = +num.toFixed(2);
        }
      }

      // If additional metrics were not populated by the engine, estimate logically from loadAAS:
      // (DB Load ≈ Calls/sec * (Latency(ms) / 1000))
      if (callsPerSec === 0 && totalLoad > 0) {
        const isIoHeavy = Object.keys(waitBreakdown).some((w) => w.toLowerCase().includes('io') || w.toLowerCase().includes('datafile'));
        const isLockHeavy = Object.keys(waitBreakdown).some((w) => w.toLowerCase().includes('lock'));
        const estimatedLatency = isLockHeavy ? 18.5 : isIoHeavy ? 5.2 : 0.85;
        avgLatencyMs = avgLatencyMs > 0 ? avgLatencyMs : estimatedLatency;
        callsPerSec = +((totalLoad / (avgLatencyMs / 1000))).toFixed(2);
        rowsPerCall = rowsPerCall > 0 ? rowsPerCall : +(callsPerSec * 0.98).toFixed(2);
      } else if (callsPerSec > 0 && avgLatencyMs === 0 && totalLoad > 0) {
        avgLatencyMs = +(((totalLoad / callsPerSec) * 1000)).toFixed(2);
      }

      return {
        id,
        name,
        sql: isSqlGroup ? (k.Dimensions?.[`${effectiveGroupBy}.statement`] || k.Dimensions?.['db.sql.statement'] || name) : '',
        loadAAS: +(totalLoad.toFixed(4)),
        loadWaitBreakdown: waitBreakdown,
        callsPerSec,
        avgLatencyMs,
        rowsPerCall,
        user: k.Dimensions?.['db.user.name'] || 'rds_user',
        database: 'db',
      };
    });

    let finalItems = items;
    if (activeWaitCategory) {
      const targetCat = activeWaitCategory.toLowerCase();
      if (targetGroupBy === 'db.wait_event') {
        const filtered = items.filter((it) => categorizeWaitEvent(it.name).toLowerCase() === targetCat);
        finalItems = filtered.length > 0 ? filtered : items;
      } else {
        const filtered = items.filter((it) => {
          return Object.entries(it.loadWaitBreakdown).some(([catKey, pct]) => {
            if (pct <= 0) return false;
            return categorizeWaitEvent(catKey).toLowerCase() === targetCat || catKey.toLowerCase() === targetCat;
          });
        });
        finalItems = filtered.length > 0 ? filtered : items;
      }
    }

    res.json({ items: finalItems, groupBy });
  } catch (err: any) {
    const msg = err.message || '';
    if (err.name === 'NotAuthorizedException' || msg.includes('not authorized') || msg.includes('NotAuthorized')) {
      return res.json({ items: [], groupBy, piDisabled: true });
    }

    console.error('Error in /api/pi/dimension-keys:', err);
    res.status(500).json({ error: err.message, items: [] });
  }
});

// Fetch untruncated SQL text via GetDimensionKeyDetails
app.post('/api/pi/sql-details', async (req, res) => {
  const { sessionConfig, instanceId, resourceId, sqlId } = req.body;

  if (sessionConfig?.isDemoMode || !resourceId || resourceId.startsWith('db-PROD')) {
    // Search mock data
    for (const list of Object.values(MOCK_SQL_STATEMENTS)) {
      const found = list.find((s) => s.id === sqlId);
      if (found) return res.json({ fullSql: found.sql });
    }
    return res.json({ fullSql: `-- SQL ID: ${sqlId}\nSELECT * FROM orders;` });
  }

  try {
    const { pi } = await getAwsClients(sessionConfig);
    const piIdentifier = resourceId.startsWith('db-') ? resourceId : instanceId;

    const command = new GetDimensionKeyDetailsCommand({
      ServiceType: 'RDS',
      Identifier: piIdentifier,
      Group: 'db.sql',
      GroupIdentifier: sqlId,
    });

    const response = await pi.send(command);
    const fullSql = response.Dimensions?.[0]?.Value || 'Unable to retrieve full SQL text';
    res.json({ fullSql });
  } catch (err: any) {
    console.error('Error in /api/pi/sql-details:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// Snapshotter & Time Travel API Endpoints
// ==========================================

// Get snapshotter status
app.get('/api/snapshots/status', (req, res) => {
  res.json(snapshotEngine.getStatus());
});

// Start background snapshot daemon
app.post('/api/snapshots/start', (req, res) => {
  const { intervalMs, sessionConfig, targetInstances } = req.body || {};
  if (intervalMs || sessionConfig || targetInstances) {
    snapshotEngine.updateConfig({ intervalMs, sessionConfig, targetInstances });
  }
  snapshotEngine.startDaemon();
  res.json({ success: true, status: snapshotEngine.getStatus() });
});

// Stop snapshot daemon
app.post('/api/snapshots/stop', (req, res) => {
  snapshotEngine.stopDaemon();
  res.json({ success: true, status: snapshotEngine.getStatus() });
});

// Trigger immediate snapshot capture
app.post('/api/snapshots/trigger', async (req, res) => {
  try {
    const result = await snapshotEngine.runCycle();
    res.json({ success: true, ...result, stats: snapshotStore.getStats() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List instances with historical snapshots
app.get('/api/snapshots/instances', (req, res) => {
  res.json({
    instances: snapshotStore.listStoredInstances(),
    stats: snapshotStore.getStats(),
  });
});

// List onboarded database targets
app.get('/api/snapshots/onboarded', (req, res) => {
  res.json({
    onboarded: snapshotStore.getOnboardedInstances(),
  });
});

// Onboard a database instance for selective snapshotting
app.post('/api/snapshots/onboard', (req, res) => {
  try {
    const { instanceId, resourceId, engine, vcpus, intervalSeconds, retentionDays, notes } = req.body;
    if (!instanceId) {
      return res.status(400).json({ error: 'instanceId is required' });
    }
    snapshotStore.onboardInstance({
      instanceId,
      resourceId: resourceId || instanceId,
      engine,
      vcpus: Number(vcpus) || 4,
      intervalSeconds: Number(intervalSeconds) || 300,
      retentionDays: Number(retentionDays) || 30,
      notes,
    });
    res.json({
      success: true,
      onboarded: snapshotStore.getOnboardedInstances(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update onboarded database status (active vs paused)
app.post('/api/snapshots/onboard/status', (req, res) => {
  try {
    const { instanceId, status } = req.body;
    if (!instanceId || !status) {
      return res.status(400).json({ error: 'instanceId and status (active|paused) required' });
    }
    snapshotStore.updateOnboardedStatus(instanceId, status);
    res.json({
      success: true,
      onboarded: snapshotStore.getOnboardedInstances(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Offboard a database instance (stop tracking)
app.delete('/api/snapshots/onboard/:instanceId', (req, res) => {
  try {
    const { instanceId } = req.params;
    snapshotStore.offboardInstance(instanceId);
    res.json({
      success: true,
      onboarded: snapshotStore.getOnboardedInstances(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Database storage stats
app.get('/api/snapshots/stats', (req, res) => {
  res.json(snapshotStore.getStats());
});

// Query historical metrics from snapshot archive
app.post('/api/snapshots/metrics', (req, res) => {
  const { instanceId, startTime, endTime, maxPoints } = req.body;
  const start = startTime || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const end = endTime || new Date().toISOString();
  const result = snapshotStore.queryHistoricalMetrics(instanceId, start, end, maxPoints || 500);
  res.json(result);
});

// Query historical dimension keys from snapshot archive
app.post('/api/snapshots/dimension-keys', (req, res) => {
  const { instanceId, startTime, endTime, dimensionType = 'db.sql', limit = 10 } = req.body;
  const start = startTime || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const end = endTime || new Date().toISOString();
  const items = snapshotStore.queryHistoricalDimensionKeys(instanceId, start, end, dimensionType, limit);
  res.json({ items, groupBy: dimensionType });
});

// Financial cost analysis & savings calculator endpoint
app.get('/api/snapshots/cost-analysis', (req, res) => {
  const vcpus = Number(req.query.vcpus) || 32;
  const instances = Number(req.query.instances) || 5;

  const awsVcpuHourRate = 0.0125;
  const monthlyHours = 730;
  const costPerVcpuMonth = awsVcpuHourRate * monthlyHours; // $9.125
  const awsMonthly = +(vcpus * costPerVcpuMonth).toFixed(2);
  const awsAnnual = +(awsMonthly * 12).toFixed(2);

  const mbPerInstanceMonth = 25;
  const totalGbMonth = (instances * mbPerInstanceMonth) / 1024;
  const s3MonthlyStorageCost = Math.max(0.01, +(totalGbMonth * 0.023).toFixed(4));
  const s3AnnualStorageCost = +(s3MonthlyStorageCost * 12).toFixed(2);

  res.json({
    instances,
    vcpus,
    awsRatePerHourPerVcpu: awsVcpuHourRate,
    awsCostPerVcpuMonth: costPerVcpuMonth,
    awsMonthlyTotal: awsMonthly,
    awsAnnualTotal: awsAnnual,
    snapshotterStorageMonthly: s3MonthlyStorageCost,
    snapshotterStorageAnnual: s3AnnualStorageCost,
    netAnnualSavings: +(awsAnnual - s3AnnualStorageCost).toFixed(2),
    savingsPercent: +(((awsAnnual - s3AnnualStorageCost) / awsAnnual) * 100).toFixed(2),
  });
});

// Seed synthetic historical data for demo & testing
app.post('/api/snapshots/seed', async (req, res) => {
  try {
    const { days = 14, intervalMinutes = 30 } = req.body || {};
    const count = await snapshotEngine.seedHistoricalData(Number(days) || 14, Number(intervalMinutes) || 30);
    res.json({ success: true, seededCount: count, stats: snapshotStore.getStats() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Detect anomalous & toxic queries (I/O Chokers, CPU Monopolizers, Lock Convoys)
app.post('/api/anomalies/detect', async (req, res) => {
  const { sessionConfig, instanceId, resourceId, startTime, endTime, vcpus = 4 } = req.body;
  try {
    const start = startTime ? new Date(startTime).toISOString() : new Date(Date.now() - 3600000).toISOString();
    const end = endTime ? new Date(endTime).toISOString() : new Date().toISOString();

    let sqlItems: any[] = [];
    if (sessionConfig?.isDemoMode || !resourceId || resourceId.startsWith('db-PROD') || resourceId.startsWith('db-ANALYTICS')) {
      let scenario = 'cpu_spike';
      if (instanceId?.includes('inventory')) scenario = 'row_locks';
      if (instanceId?.includes('analytics')) scenario = 'io_choke';
      sqlItems = MOCK_SQL_STATEMENTS[scenario] || MOCK_SQL_STATEMENTS.cpu_spike;
    } else {
      sqlItems = snapshotStore.queryHistoricalDimensionKeys(instanceId, start, end, 'db.sql', 20);
    }

    const anomalies = anomalyDetector.analyzeQueries(sqlItems, Number(vcpus) || 4);
    res.json({ anomalies, totalAnomalies: anomalies.length });
  } catch (err: any) {
    console.error('Error in /api/anomalies/detect:', err);
    res.status(500).json({ error: err.message, anomalies: [] });
  }
});

// Catch-all for single-page app routing
if (fs.existsSync(distPath)) {
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

export { app };

const isRunningTests =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.some((arg) => arg.includes('--test')) ||
  process.argv.some((arg) => arg.includes('--test')) ||
  Boolean(process.env.NODE_TEST_CONTEXT);
if (!isRunningTests) {
  app.listen(PORT, () => {
    console.log(`[QuickPI Server] Running on http://localhost:${PORT}`);
    
    // Auto-start snapshotter daemon if enabled
    if (process.env.AUTO_SNAPSHOT !== 'false') {
      snapshotEngine.startDaemon();
    }
  });
}
