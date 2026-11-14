import {
  GetResourceMetricsCommand,
  DescribeDimensionKeysCommand,
  GetDimensionKeyDetailsCommand,
} from '@aws-sdk/client-pi';
import {
  getAwsClients,
  listRdsInstances,
  AwsSessionConfig,
  getSupportedMetricsForResource,
  buildSafeCounterMetricQueries,
} from './aws-client.ts';
import {
  snapshotStore,
  SnapshotStore,
  StoredSnapshot,
  StoredDimensionItem,
  StoredSqlStatement,
} from './snapshot-store.ts';
import {
  MOCK_INCIDENT_PRESETS,
  MOCK_SQL_STATEMENTS,
  generateMockTimeSeries,
} from './mock-data.ts';

export interface SnapshotterConfig {
  intervalMs?: number;
  sessionConfig: AwsSessionConfig;
  targetInstances?: string[]; // Empty means all PI-enabled instances
  autoFetchSqlText?: boolean;
}

export interface SnapshotterStatus {
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
  onboardedCount: number;
  activeOnboardedCount: number;
  isDemoMode: boolean;
}

export class SnapshotterEngine {
  private timer: NodeJS.Timeout | null = null;
  private isCapturing = false;
  private config: SnapshotterConfig;
  private store: SnapshotStore;
  private lastRunTime: Date | null = null;
  private nextRunTime: Date | null = null;
  private totalCapturesCount = 0;
  private lastDuration = 0;
  private lastStatus: 'idle' | 'running' | 'success' | 'partial' | 'error' = 'idle';
  private lastErrorMessage: string | null = null;
  private knownSqlCache = new Set<string>();

  constructor(config?: Partial<SnapshotterConfig>, store: SnapshotStore = snapshotStore) {
    this.store = store;
    this.config = {
      intervalMs: 5 * 60 * 1000, // 5 minutes default
      sessionConfig: {
        profile: 'default',
        region: 'ap-south-1',
        isDemoMode: false,
      },
      autoFetchSqlText: true,
      ...config,
    };
  }

  public updateConfig(newConfig: Partial<SnapshotterConfig>) {
    const wasRunning = this.timer !== null;
    if (wasRunning) {
      this.stopDaemon();
    }
    this.config = {
      ...this.config,
      ...newConfig,
      sessionConfig: {
        ...this.config.sessionConfig,
        ...(newConfig.sessionConfig || {}),
      },
    };
    if (wasRunning) {
      this.startDaemon();
    }
  }

  public getStatus(): SnapshotterStatus {
    const onboarded = this.store.getOnboardedInstances();
    const active = onboarded.filter((o) => o.status === 'active');

    return {
      isRunning: this.timer !== null,
      intervalMs: this.config.intervalMs || 300000,
      intervalMinutes: Math.round((this.config.intervalMs || 300000) / 60000),
      lastRun: this.lastRunTime ? this.lastRunTime.toISOString() : null,
      nextRun: this.nextRunTime ? this.nextRunTime.toISOString() : null,
      totalCaptures: this.totalCapturesCount,
      lastDurationMs: this.lastDuration,
      lastStatus: this.isCapturing ? 'running' : this.lastStatus,
      lastError: this.lastErrorMessage,
      monitoredInstances: active.map((o) => o.instanceId),
      onboardedCount: onboarded.length,
      activeOnboardedCount: active.length,
      isDemoMode: !!this.config.sessionConfig?.isDemoMode,
    };
  }

  public startDaemon(): void {
    if (this.timer) {
      return;
    }

    const interval = this.config.intervalMs || 300000;
    console.log(`[Snapshotter] Starting snapshot daemon (interval: ${interval / 1000}s)...`);

    // Execute initial snapshot capture immediately
    this.runCycle().catch((err) => {
      console.error('[Snapshotter] Initial capture error:', err);
    });

    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        console.error('[Snapshotter] Interval cycle error:', err);
      });
    }, interval);

    this.nextRunTime = new Date(Date.now() + interval);
  }

  public stopDaemon(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.nextRunTime = null;
      console.log('[Snapshotter] Stopped snapshot daemon.');
    }
  }

  /**
   * Run a full capture cycle across all target instances
   */
  public async runCycle(): Promise<{ capturedCount: number; errors: string[] }> {
    if (this.isCapturing) {
      console.warn('[Snapshotter] Cycle already in progress, skipping tick.');
      return { capturedCount: 0, errors: ['Capture already in progress'] };
    }

    this.isCapturing = true;
    const startTime = Date.now();
    this.lastRunTime = new Date(startTime);
    const errors: string[] = [];
    let capturedCount = 0;

    try {
      const instancesToCapture = await this.resolveTargetInstances();

      for (const inst of instancesToCapture) {
        try {
          await this.captureInstanceSnapshot(inst.id, inst.dbiResourceId, inst.vcpus);
          capturedCount++;
        } catch (instErr: any) {
          const errMsg = `Failed snapshot for ${inst.id}: ${instErr.message || instErr}`;
          console.error(`[Snapshotter] ${errMsg}`);
          errors.push(errMsg);
        }
      }

      this.lastDuration = Date.now() - startTime;
      this.lastStatus = errors.length === 0 ? 'success' : capturedCount > 0 ? 'partial' : 'error';
      this.lastErrorMessage = errors.length > 0 ? errors.join('; ') : null;
      this.totalCapturesCount += capturedCount;

      this.store.recordRun({
        runTimestamp: this.lastRunTime.toISOString(),
        durationMs: this.lastDuration,
        instancesCount: capturedCount,
        status: this.lastStatus,
        errorMessage: this.lastErrorMessage || undefined,
      });

      console.log(
        `[Snapshotter] Cycle complete: captured ${capturedCount}/${instancesToCapture.length} instances in ${this.lastDuration}ms.`
      );
    } catch (cycleErr: any) {
      this.lastDuration = Date.now() - startTime;
      this.lastStatus = 'error';
      this.lastErrorMessage = cycleErr.message || String(cycleErr);
      errors.push(this.lastErrorMessage!);

      this.store.recordRun({
        runTimestamp: this.lastRunTime.toISOString(),
        durationMs: this.lastDuration,
        instancesCount: 0,
        status: 'error',
        errorMessage: this.lastErrorMessage || undefined,
      });

      console.error('[Snapshotter] Fatal cycle error:', cycleErr);
    } finally {
      this.isCapturing = false;
      if (this.timer) {
        this.nextRunTime = new Date(Date.now() + (this.config.intervalMs || 300000));
      }
    }

    return { capturedCount, errors };
  }

  /**
   * Resolve target database instances to monitor.
   * STRICT ONBOARDING: Only instances explicitly onboarded into the snapshot store are monitored.
   * Prevents estate-wide indiscriminate snapshotting.
   */
  private async resolveTargetInstances(): Promise<Array<{ id: string; dbiResourceId: string; vcpus: number }>> {
    const onboarded = this.store.getOnboardedInstances();
    const active = onboarded.filter((o) => o.status === 'active');

    if (active.length === 0) {
      console.log('[Snapshotter] No databases onboarded for snapshotting. Standing by.');
      return [];
    }

    const activeMap = new Map(active.map((o) => [o.instanceId, o]));

    if (this.config.sessionConfig?.isDemoMode) {
      return MOCK_INCIDENT_PRESETS
        .filter((p) => activeMap.has(p.dbIdentifier))
        .map((p) => ({
          id: p.dbIdentifier,
          dbiResourceId: `db-${p.id.toUpperCase()}`,
          vcpus: p.vcpus,
        }));
    }

    try {
      const allInstances = await listRdsInstances(this.config.sessionConfig);
      const piInstances = allInstances.filter((i) => i.performanceInsightsEnabled && activeMap.has(i.id));

      if (piInstances.length > 0) {
        if (this.config.targetInstances && this.config.targetInstances.length > 0) {
          return piInstances
            .filter((i) => this.config.targetInstances!.includes(i.id))
            .map((i) => {
              const o = activeMap.get(i.id);
              return { id: i.id, dbiResourceId: i.dbiResourceId || o?.resourceId || i.id, vcpus: i.vcpus || o?.vcpus || 4 };
            });
        }

        return piInstances.map((i) => {
          const o = activeMap.get(i.id);
          return {
            id: i.id,
            dbiResourceId: i.dbiResourceId || o?.resourceId || i.id,
            vcpus: i.vcpus || o?.vcpus || 4,
          };
        });
      }
    } catch (e) {
      // Fall through to active store metadata
    }

    return active.map((o) => ({
      id: o.instanceId,
      dbiResourceId: o.resourceId || o.instanceId,
      vcpus: o.vcpus || 4,
    }));
  }

  /**
   * Capture 5-minute telemetry, AAS wait event breakdown, top SQL, wait events, hosts, users
   */
  public async captureInstanceSnapshot(
    instanceId: string,
    resourceId: string,
    vcpus = 4,
    customEnd?: Date
  ): Promise<number> {
    const end = customEnd || new Date();
    // Default window: last 5 minutes
    const start = new Date(end.getTime() - 5 * 60 * 1000);
    const timestampIso = end.toISOString();

    if (this.config.sessionConfig?.isDemoMode) {
      return this.captureDemoSnapshot(instanceId, resourceId, vcpus, start, end, timestampIso);
    }

    const { pi } = await getAwsClients(this.config.sessionConfig);
    const piIdentifier = resourceId.startsWith('db-') ? resourceId : instanceId;

    // 1. Fetch Performance Metrics (AAS slices + dynamically resolved OS counter metrics)
    const supportedSet = await getSupportedMetricsForResource(pi, piIdentifier);
    const safeCounterQueries = buildSafeCounterMetricQueries(supportedSet);
    const loadQueries = [{ Metric: 'db.load.avg', GroupBy: { Group: 'db.wait_event', Limit: 10 } }];

    let metricList: any[] = [];
    try {
      const metricCmd = new GetResourceMetricsCommand({
        ServiceType: 'RDS',
        Identifier: piIdentifier,
        StartTime: start,
        EndTime: end,
        PeriodInSeconds: 60, // 1-minute resolution within the 5m interval
        MetricQueries: [
          ...loadQueries,
          ...safeCounterQueries,
        ],
      });

      const metricRes = await pi.send(metricCmd);
      metricList = metricRes.MetricList || [];
    } catch (piErr: any) {
      if (piErr.name === 'InvalidArgumentException' || String(piErr).includes('not a known metric')) {
        console.warn(`[Snapshotter] Non-standard counter metric on ${piIdentifier}. Retrying with core db.load.avg...`);
        const fallbackCmd = new GetResourceMetricsCommand({
          ServiceType: 'RDS',
          Identifier: piIdentifier,
          StartTime: start,
          EndTime: end,
          PeriodInSeconds: 60,
          MetricQueries: loadQueries,
        });
        const fallbackRes = await pi.send(fallbackCmd);
        metricList = fallbackRes.MetricList || [];
      } else {
        throw piErr;
      }
    }

    // Process and aggregate metrics for the 5-minute period
    const aggregatedSlices: Record<string, number> = {};
    let sliceSum = 0;
    let baseLoadTotal = 0;
    let cpuUtilizationSum = 0;
    let cpuCount = 0;
    let memFreeKB = 0;
    let memCachedKB = 0;
    let memBuffersKB = 0;
    let iopsTotal = 0;
    let connections = 0;
    let detectedVcpus = vcpus;
    const rawPointsMap = new Map<string, any>();

    if (metricList) {
      for (const item of metricList) {
        const metricName = item.Key?.Metric || '';
        const waitEventName = item.Key?.Dimensions?.['db.wait_event.name'] || item.Key?.Dimensions?.['db.wait_event_type.name'] || null;

        if (item.DataPoints) {
          for (const dp of item.DataPoints) {
            if (!dp.Timestamp || dp.Value === undefined) continue;
            const val = dp.Value;
            const tsIso = dp.Timestamp.toISOString();

            if (!rawPointsMap.has(tsIso)) {
              rawPointsMap.set(tsIso, { timestamp: tsIso, slices: {}, totalAAS: 0 });
            }
            const pt = rawPointsMap.get(tsIso);

            if (metricName === 'db.load.avg') {
              if (waitEventName) {
                aggregatedSlices[waitEventName] = +((aggregatedSlices[waitEventName] || 0) + val).toFixed(4);
                sliceSum += val;
                pt.slices[waitEventName] = val;
                pt.totalAAS += val;
              } else {
                baseLoadTotal += val;
              }
            } else if (metricName.includes('numVCPUs') && val > 0) {
              detectedVcpus = Math.round(val);
            } else if (metricName.includes('cpuUtilization')) {
              cpuUtilizationSum += val;
              cpuCount++;
              pt.cpuUtilization = val;
            } else if (metricName.startsWith('os.memory.free')) {
              memFreeKB = val;
            } else if (metricName.startsWith('os.memory.cached') || metricName.includes('db.cache')) {
              memCachedKB = val;
            } else if (metricName.startsWith('os.memory.buffers')) {
              memBuffersKB = val;
            } else if (metricName.includes('diskIO')) {
              iopsTotal += val;
            } else if (metricName.includes('numbackends') || metricName.includes('Threads_connected')) {
              connections = Math.round(val);
            }
          }
        }
      }
    }

    const freeableKB = memFreeKB + memCachedKB + memBuffersKB;
    const memoryFreeGB = freeableKB > 0 ? +(freeableKB / (1024 * 1024)).toFixed(2) : 0;
    const avgCpu = cpuCount > 0 ? +(cpuUtilizationSum / cpuCount).toFixed(1) : 0;
    const totalAAS = sliceSum > 0 ? +(sliceSum / Math.max(1, rawPointsMap.size)).toFixed(4) : +(baseLoadTotal / Math.max(1, rawPointsMap.size)).toFixed(4);

    // 2. Fetch Top Dimensions (SQL, Wait Events, Hosts, Users)
    const dimensionsToStore: StoredDimensionItem[] = [];
    const sqlStatementsToStore: StoredSqlStatement[] = [];

    const dimTypes: Array<{ type: 'db.sql' | 'db.wait_event' | 'db.host' | 'db.user'; limit: number }> = [
      { type: 'db.sql', limit: 10 },
      { type: 'db.wait_event', limit: 10 },
      { type: 'db.host', limit: 5 },
      { type: 'db.user', limit: 5 },
    ];

    for (const { type, limit } of dimTypes) {
      try {
        const dimCmd = new DescribeDimensionKeysCommand({
          ServiceType: 'RDS',
          Identifier: piIdentifier,
          StartTime: start,
          EndTime: end,
          Metric: 'db.load.avg',
          GroupBy: { Group: type, Limit: limit },
          PartitionBy: { Group: 'db.wait_event', Limit: 5 },
        });

        const dimRes = await pi.send(dimCmd);

        if (dimRes.Keys) {
          for (const k of dimRes.Keys) {
            const id =
              k.Dimensions?.[`${type}.id`] ||
              k.Dimensions?.[`${type}.name`] ||
              k.Dimensions?.[`${type}.statement`] ||
              'unknown';
            const name = k.Dimensions?.[`${type}.name`] || k.Dimensions?.[`${type}.statement`] || id;
            const totalLoad = k.Total || 0;

            const waitBreakdown: Record<string, number> = {};
            if (k.Partitions) {
              for (let i = 0; i < k.Partitions.length; i++) {
                const partVal = k.Partitions[i] || 0;
                const partKey =
                  dimRes.PartitionKeys?.[i]?.Dimensions?.['db.wait_event.name'] ||
                  dimRes.PartitionKeys?.[i]?.Dimensions?.['db.wait_event.type'] ||
                  `wait_${i}`;
                if (partVal > 0) {
                  waitBreakdown[partKey] = +((partVal / (totalLoad || 1)) * 100).toFixed(0);
                }
              }
            }

            dimensionsToStore.push({
              instanceId,
              timestamp: timestampIso,
              dimensionType: type,
              dimensionId: id,
              dimensionName: name,
              loadAAS: +(totalLoad.toFixed(4)),
              waitBreakdown,
            });

            // If new SQL ID, fetch full untruncated SQL statement
            if (type === 'db.sql' && this.config.autoFetchSqlText && id !== 'unknown' && !this.knownSqlCache.has(id)) {
              try {
                const detailCmd = new GetDimensionKeyDetailsCommand({
                  ServiceType: 'RDS',
                  Identifier: piIdentifier,
                  Group: 'db.sql',
                  GroupIdentifier: id,
                });
                const detailRes = await pi.send(detailCmd);
                const fullSql = detailRes.Dimensions?.[0]?.Value;
                if (fullSql) {
                  this.knownSqlCache.add(id);
                  sqlStatementsToStore.push({
                    sqlId: id,
                    sqlText: fullSql,
                    firstSeen: timestampIso,
                    lastSeen: timestampIso,
                  });
                }
              } catch (sqlErr) {
                // Ignore individual SQL detail fetch errors
              }
            }
          }
        }
      } catch (dimErr) {
        console.warn(`[Snapshotter] Could not describe dimension ${type} on ${instanceId}:`, dimErr);
      }
    }

    const snapshotData: StoredSnapshot = {
      instanceId,
      resourceId,
      timestamp: timestampIso,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      periodSeconds: 300,
      vcpus: detectedVcpus,
      cpuUtilization: avgCpu,
      memoryFreeGB,
      iopsTotal: Math.round(iopsTotal),
      connections,
      totalAAS,
      slices: aggregatedSlices,
      rawPoints: Array.from(rawPointsMap.values()),
    };

    return this.store.saveSnapshot(snapshotData, dimensionsToStore, sqlStatementsToStore);
  }

  /**
   * Demo mode capture for simulation and offline demonstration
   */
  private captureDemoSnapshot(
    instanceId: string,
    resourceId: string,
    vcpus: number,
    start: Date,
    end: Date,
    timestampIso: string
  ): number {
    let scenario: 'cpu_spike' | 'row_locks' | 'io_choke' = 'cpu_spike';
    if (instanceId.includes('inventory')) scenario = 'row_locks';
    if (instanceId.includes('analytics')) scenario = 'io_choke';

    const points = generateMockTimeSeries(scenario, start, end, vcpus, undefined, undefined, [], [], [], [], 60);
    const lastPoint = points[points.length - 1] || {
      totalAAS: 1.5,
      slices: { CPU: 1.2, 'IO:DataFileRead': 0.3 },
      cpuUtilization: 45,
      memoryFreeGB: 12.4,
      iopsTotal: 250,
      connections: 18,
    };

    const sqlList = MOCK_SQL_STATEMENTS[scenario] || MOCK_SQL_STATEMENTS.cpu_spike;

    const dimensionsToStore: StoredDimensionItem[] = [];
    const sqlStatementsToStore: StoredSqlStatement[] = [];

    // Top SQL
    for (const sql of sqlList.slice(0, 8)) {
      const sqlPreview = (sql as any).name || sql.sql.replace(/\s+/g, ' ').trim().slice(0, 80);
      dimensionsToStore.push({
        instanceId,
        timestamp: timestampIso,
        dimensionType: 'db.sql',
        dimensionId: sql.id,
        dimensionName: sqlPreview,
        loadAAS: sql.loadAAS,
        waitBreakdown: sql.loadWaitBreakdown,
      });

      sqlStatementsToStore.push({
        sqlId: sql.id,
        sqlText: sql.sql,
        firstSeen: timestampIso,
        lastSeen: timestampIso,
      });
    }

    // Top Wait Events
    for (const [evt, val] of Object.entries(lastPoint.slices)) {
      dimensionsToStore.push({
        instanceId,
        timestamp: timestampIso,
        dimensionType: 'db.wait_event',
        dimensionId: evt,
        dimensionName: evt,
        loadAAS: Number(val),
        waitBreakdown: { [evt]: 100 },
      });
    }

    // Top Hosts & Users
    dimensionsToStore.push(
      {
        instanceId,
        timestamp: timestampIso,
        dimensionType: 'db.host',
        dimensionId: '10.0.12.84',
        dimensionName: '10.0.12.84 (app-worker-1a)',
        loadAAS: +(lastPoint.totalAAS * 0.55).toFixed(2),
        waitBreakdown: { CPU: 70, IO: 30 },
      },
      {
        instanceId,
        timestamp: timestampIso,
        dimensionType: 'db.user',
        dimensionId: 'api_orders_service',
        dimensionName: 'api_orders_service',
        loadAAS: +(lastPoint.totalAAS * 0.6).toFixed(2),
        waitBreakdown: { CPU: 80, Lock: 20 },
      }
    );

    const snapshotData: StoredSnapshot = {
      instanceId,
      resourceId,
      timestamp: timestampIso,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      periodSeconds: 300,
      vcpus,
      cpuUtilization: lastPoint.cpuUtilization,
      memoryFreeGB: lastPoint.memoryFreeGB,
      iopsTotal: lastPoint.iopsTotal,
      connections: lastPoint.connections,
      totalAAS: lastPoint.totalAAS,
      slices: lastPoint.slices,
      rawPoints: points,
    };

    return this.store.saveSnapshot(snapshotData, dimensionsToStore, sqlStatementsToStore);
  }

  /**
   * Seed historical snapshots (e.g. 14 days or 30 days) to demonstrate time travel
   */
  public async seedHistoricalData(days = 14, intervalMinutes = 30): Promise<number> {
    console.log(`[Snapshotter] Seeding ${days} days of historical snapshots (every ${intervalMinutes}m)...`);
    const instances = await this.resolveTargetInstances();
    let totalGenerated = 0;

    const now = Date.now();
    const intervalMs = intervalMinutes * 60 * 1000;
    const totalSteps = Math.floor((days * 24 * 60) / intervalMinutes);

    for (let step = totalSteps; step >= 0; step--) {
      const pointTime = new Date(now - step * intervalMs);
      const startTime = new Date(pointTime.getTime() - intervalMs);

      for (const inst of instances) {
        this.captureDemoSnapshot(
          inst.id,
          inst.dbiResourceId,
          inst.vcpus,
          startTime,
          pointTime,
          pointTime.toISOString()
        );
        totalGenerated++;
      }
    }

    console.log(`[Snapshotter] Seeded ${totalGenerated} historical snapshots across ${instances.length} instances.`);
    return totalGenerated;
  }
}

// Singleton engine instance
export const snapshotEngine = new SnapshotterEngine();
