import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSafeCounterMetricQueries,
  resolveAdaptiveGranularity,
  getLocalAwsProfilesMetadata,
} from '../server/aws-client.ts';
import { resolveWaitFilter } from '../server/index.ts';

describe('AWS Client, Metric Filtering & Granularity Engine (Behavioral Tests)', () => {
  describe('buildSafeCounterMetricQueries()', () => {
    it('falls back to safe universal baseline when supported metrics set is empty (preventing InvalidArgumentException)', () => {
      const emptySet = new Set<string>();
      const queries = buildSafeCounterMetricQueries(emptySet);

      assert.equal(queries.length, 5);
      assert.deepEqual(queries, [
        { Metric: 'os.general.numVCPUs.avg' },
        { Metric: 'os.cpuUtilization.total.avg' },
        { Metric: 'os.memory.free.avg' },
        { Metric: 'os.memory.cached.avg' },
        { Metric: 'os.memory.buffers.avg' },
      ]);
    });

    it('matches base metric names returned by AWS ListAvailableResourceMetrics (without .avg suffix)', () => {
      // AWS ListAvailableResourceMetrics returns base names like 'os.memory.free', 'os.memory.cached'
      const baseMetricsFromAws = new Set<string>([
        'os.general.numVCPUs',
        'os.cpuUtilization.total',
        'os.memory.free',
        'os.memory.cached',
        'os.memory.buffers',
      ]);

      const queries = buildSafeCounterMetricQueries(baseMetricsFromAws);
      const metricNames = queries.map((q) => q.Metric);

      assert.ok(metricNames.includes('os.general.numVCPUs.avg'));
      assert.ok(metricNames.includes('os.cpuUtilization.total.avg'));
      assert.ok(metricNames.includes('os.memory.free.avg'));
      assert.ok(metricNames.includes('os.memory.cached.avg'));
      assert.ok(metricNames.includes('os.memory.buffers.avg'));
    });

    it('filters query list strictly to metrics supported by the target RDS engine', () => {
      const supportedSet = new Set<string>([
        'os.general.numVCPUs.avg',
        'os.cpuUtilization.total.avg',
        'os.memory.free.avg',
        'os.memory.cached.avg',
        'os.diskIO.rdsdev.readIOsPS.avg',
        'os.diskIO.rdsdev.writeIOsPS.avg',
        'db.User.numbackends.avg',
        'unsupported.custom.metric.avg',
      ]);

      const queries = buildSafeCounterMetricQueries(supportedSet);
      const metricNames = queries.map((q) => q.Metric);

      // Verify supported desired metrics are present
      assert.ok(metricNames.includes('os.general.numVCPUs.avg'));
      assert.ok(metricNames.includes('os.cpuUtilization.total.avg'));
      assert.ok(metricNames.includes('os.memory.free.avg'));
      assert.ok(metricNames.includes('os.memory.cached.avg'));
      assert.ok(metricNames.includes('os.diskIO.rdsdev.readIOsPS.avg'));
      assert.ok(metricNames.includes('db.User.numbackends.avg'));

      // Verify unsupported metrics are not requested
      assert.ok(!metricNames.includes('unsupported.custom.metric.avg'));
      assert.ok(!metricNames.includes('db.Connections.Threads_connected.avg'));
    });

    it('dynamically adapts to non-standard EBS/NVMe storage devices when rdsdev is missing', () => {
      const supportedSet = new Set<string>([
        'os.general.numVCPUs.avg',
        'os.cpuUtilization.total.avg',
        'os.memory.free.avg',
        'os.diskIO.nvme0n1.readIOsPS.avg',
        'os.diskIO.nvme0n1.writeIOsPS.avg',
      ]);

      const queries = buildSafeCounterMetricQueries(supportedSet);
      const metricNames = queries.map((q) => q.Metric);

      assert.ok(metricNames.includes('os.diskIO.nvme0n1.readIOsPS.avg'));
      assert.ok(metricNames.includes('os.diskIO.nvme0n1.writeIOsPS.avg'));
    });
  });

  describe('resolveAdaptiveGranularity()', () => {
    it('selects 1s ultra-high-resolution for short windows <= 10 minutes', () => {
      assert.equal(resolveAdaptiveGranularity(60), 1); // 1m
      assert.equal(resolveAdaptiveGranularity(300), 1); // 5m
      assert.equal(resolveAdaptiveGranularity(600), 1); // 10m
    });

    it('selects 60s standard resolution for windows between 10m and 6 hours', () => {
      assert.equal(resolveAdaptiveGranularity(900), 60); // 15m
      assert.equal(resolveAdaptiveGranularity(3600), 60); // 1h
      assert.equal(resolveAdaptiveGranularity(3 * 3600), 60); // 3h
      assert.equal(resolveAdaptiveGranularity(6 * 3600), 60); // 6h
    });

    it('selects 300s (5-min) resolution for windows between 6h and 48 hours', () => {
      assert.equal(resolveAdaptiveGranularity(12 * 3600), 300); // 12h
      assert.equal(resolveAdaptiveGranularity(24 * 3600), 300); // 24h
      assert.equal(resolveAdaptiveGranularity(48 * 3600), 300); // 48h
    });

    it('selects 3600s (1-hour) resolution for windows between 48h and 30 days', () => {
      assert.equal(resolveAdaptiveGranularity(7 * 86400), 3600); // 7d
      assert.equal(resolveAdaptiveGranularity(14 * 86400), 3600); // 14d
      assert.equal(resolveAdaptiveGranularity(30 * 86400), 3600); // 30d
    });

    it('selects 86400s (1-day) resolution for extended multi-month windows (> 30 days)', () => {
      assert.equal(resolveAdaptiveGranularity(60 * 86400), 86400); // 60d
      assert.equal(resolveAdaptiveGranularity(90 * 86400), 86400); // 90d
    });

    it('honors valid explicit user overrides regardless of duration', () => {
      assert.equal(resolveAdaptiveGranularity(90 * 86400, 300), 300);
      assert.equal(resolveAdaptiveGranularity(60, 3600), 3600);
      assert.equal(resolveAdaptiveGranularity(600, 1), 1);
    });

    it('rejects invalid explicit periods and falls back to optimal calculation', () => {
      // 17 is not an AWS-supported granularity
      assert.equal(resolveAdaptiveGranularity(300, 17), 1);
      assert.equal(resolveAdaptiveGranularity(3600, 999), 60);
    });
  });

  describe('resolveWaitFilter()', () => {
    it('resolves direct wait event names containing colon to db.wait_event.name', () => {
      assert.deepEqual(resolveWaitFilter('Lock:transaction'), {
        'db.wait_event.name': 'Lock:transaction',
      });
      assert.deepEqual(resolveWaitFilter('IO:DataFileRead'), {
        'db.wait_event.name': 'IO:DataFileRead',
      });
      assert.deepEqual(resolveWaitFilter('Client:ClientRead'), {
        'db.wait_event.name': 'Client:ClientRead',
      });
      assert.deepEqual(resolveWaitFilter('LWLock:LockManager'), {
        'db.wait_event.name': 'LWLock:LockManager',
      });
    });

    it('maps high-level wait categories to AWS db.wait_event.type', () => {
      assert.deepEqual(resolveWaitFilter('cpu'), { 'db.wait_event.type': 'CPU' });
      assert.deepEqual(resolveWaitFilter('io'), { 'db.wait_event.type': 'IO' });
      assert.deepEqual(resolveWaitFilter('lock'), { 'db.wait_event.type': 'Lock' });
      assert.deepEqual(resolveWaitFilter('concurrency'), { 'db.wait_event.type': 'LWLock' });
      assert.deepEqual(resolveWaitFilter('buffer'), { 'db.wait_event.type': 'LWLock' });
      assert.deepEqual(resolveWaitFilter('lwlock'), { 'db.wait_event.type': 'LWLock' });
      assert.deepEqual(resolveWaitFilter('network'), { 'db.wait_event.type': 'Client' });
      assert.deepEqual(resolveWaitFilter('client'), { 'db.wait_event.type': 'Client' });
    });

    it('returns undefined for Other to prevent AWS PI rejection and enable in-memory filtering', () => {
      assert.equal(resolveWaitFilter('other'), undefined);
      assert.equal(resolveWaitFilter('Other'), undefined);
    });

    it('returns undefined for empty or missing filter inputs', () => {
      assert.equal(resolveWaitFilter(undefined), undefined);
      assert.equal(resolveWaitFilter(''), undefined);
      assert.equal(resolveWaitFilter('   '), undefined);
    });
  });

  describe('getLocalAwsProfilesMetadata()', () => {
    it('returns a valid list of profiles containing at least default fallback without throwing', () => {
      const profiles = getLocalAwsProfilesMetadata();
      assert.ok(Array.isArray(profiles));
      assert.ok(profiles.length >= 1);
      assert.ok(profiles.some((p) => p.name === 'default'));
    });
  });
});
