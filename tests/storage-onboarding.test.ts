import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotStore, StoredSnapshot, StoredDimensionItem } from '../server/snapshot-store.ts';

describe('Storage & Onboarding Subsystem (Behavioral Tests)', () => {
  let store: SnapshotStore;

  beforeEach(() => {
    // Create an isolated in-memory store for every test suite run
    store = new SnapshotStore(':memory:');
  });

  test('Database initialization: creates tables and defaults in-memory', () => {
    const stats = store.getStats();
    assert.equal(typeof stats.totalSnapshots, 'number');
    assert.equal(typeof stats.totalDimensions, 'number');
    assert.equal(typeof stats.totalUniqueSqls, 'number');
  });

  test('Onboarding lifecycle: enrolls an RDS instance with custom policy', () => {
    store.onboardInstance({
      instanceId: 'prod-aurora-cluster-01',
      resourceId: 'db-CLUSTER-01',
      engine: 'aurora-postgresql',
      vcpus: 16,
      intervalSeconds: 300,
      retentionDays: 60,
      notes: 'Main payment gateway cluster',
    });

    const onboarded = store.getOnboardedInstances();
    const target = onboarded.find((o) => o.instanceId === 'prod-aurora-cluster-01');

    assert.ok(target, 'Target instance should be found in onboarded list');
    assert.equal(target?.status, 'active');
    assert.equal(target?.engine, 'aurora-postgresql');
    assert.equal(target?.vcpus, 16);
    assert.equal(target?.intervalSeconds, 300);
    assert.equal(target?.retentionDays, 60);
    assert.equal(target?.notes, 'Main payment gateway cluster');
    assert.ok(target?.createdAt);
    assert.ok(target?.updatedAt);
  });

  test('Onboarding idempotency: upserts existing database when enrolled again with updated config', () => {
    store.onboardInstance({
      instanceId: 'db-inventory-shard',
      resourceId: 'db-RES-INV-1',
      engine: 'postgres',
      vcpus: 4,
      intervalSeconds: 300,
      retentionDays: 14,
      notes: 'Initial config',
    });

    // Re-enroll with updated 30-day retention and notes
    store.onboardInstance({
      instanceId: 'db-inventory-shard',
      resourceId: 'db-RES-INV-1',
      engine: 'postgres',
      vcpus: 8,
      intervalSeconds: 60,
      retentionDays: 30,
      notes: 'Upgraded to 8 vCPUs with 1m high-res interval',
    });

    const onboarded = store.getOnboardedInstances();
    const matches = onboarded.filter((o) => o.instanceId === 'db-inventory-shard');

    assert.equal(matches.length, 1, 'Should NOT create duplicate rows');
    assert.equal(matches[0].vcpus, 8);
    assert.equal(matches[0].intervalSeconds, 60);
    assert.equal(matches[0].retentionDays, 30);
    assert.equal(matches[0].notes, 'Upgraded to 8 vCPUs with 1m high-res interval');
  });

  test('Status transitions: toggles between active and paused', () => {
    store.onboardInstance({
      instanceId: 'db-batch-reports',
      resourceId: 'db-RES-BATCH',
      vcpus: 4,
    });

    assert.equal(store.isOnboarded('db-batch-reports'), true, 'Should initially be onboarded and active');

    // Pause monitoring
    store.updateOnboardedStatus('db-batch-reports', 'paused');
    let target = store.getOnboardedInstances().find((o) => o.instanceId === 'db-batch-reports');
    assert.equal(target?.status, 'paused');
    assert.equal(store.isOnboarded('db-batch-reports'), false, 'Paused database should not be active');

    // Resume monitoring
    store.updateOnboardedStatus('db-batch-reports', 'active');
    assert.equal(store.isOnboarded('db-batch-reports'), true, 'Resumed database should be active');
  });

  test('Offboarding: removes instance from active monitoring', () => {
    store.onboardInstance({
      instanceId: 'db-deprecated-service',
      resourceId: 'db-RES-DEP',
      vcpus: 2,
    });

    assert.equal(store.isOnboarded('db-deprecated-service'), true);

    store.offboardInstance('db-deprecated-service');

    assert.equal(store.isOnboarded('db-deprecated-service'), false);
    const allOnboarded = store.getOnboardedInstances();
    assert.ok(!allOnboarded.some((o) => o.instanceId === 'db-deprecated-service'));
  });

  test('Snapshot persistence & atomic transaction: saves telemetry with dimensions & SQL', () => {
    store.onboardInstance({
      instanceId: 'prod-orders-db',
      resourceId: 'db-ORDERS-RES',
      vcpus: 8,
    });

    const nowIso = new Date().toISOString();
    const snapshot: StoredSnapshot = {
      instanceId: 'prod-orders-db',
      resourceId: 'db-ORDERS-RES',
      timestamp: nowIso,
      startTime: nowIso,
      endTime: nowIso,
      periodSeconds: 60,
      vcpus: 8,
      cpuUtilization: 74.5,
      memoryFreeGB: 18.2,
      iopsTotal: 3420,
      connections: 112,
      totalAAS: 5.42,
      slices: {
        CPU: 3.2,
        'IO:DataFileRead': 1.8,
        'Lock:transaction': 0.42,
      },
    };

    const dimensions: StoredDimensionItem[] = [
      {
        instanceId: 'prod-orders-db',
        timestamp: nowIso,
        dimensionType: 'db.sql',
        dimensionId: 'sql_orders_checkout_99',
        dimensionName: 'SELECT * FROM orders WHERE status = $1',
        loadAAS: 3.85,
        waitBreakdown: { CPU: 60, IO: 40 },
        sqlText: 'SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC',
      },
    ];

    const sqlId = 'sql_orders_checkout_99';
    const sqlText = 'SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC';

    const snapshotId = store.saveSnapshot(snapshot, dimensions, [
      {
        sqlId,
        sqlText,
        firstSeen: nowIso,
        lastSeen: nowIso,
      },
    ]);

    assert.ok(snapshotId > 0, 'saveSnapshot should return positive autoincrement ID');

    // Verify stored instance summary
    const summaries = store.listStoredInstances();
    const sum = summaries.find((s) => s.instanceId === 'prod-orders-db');
    assert.ok(sum, 'Stored summary must contain instance');
    assert.equal(sum?.totalSnapshots, 1);
    assert.equal(sum?.vcpus, 8);

    // Verify SQL statement preserved
    const retrievedSql = store.getSqlStatement(sqlId);
    assert.equal(retrievedSql, sqlText, 'Full SQL statement text must be preserved untruncated');
  });

  test('Historical metrics query: aggregates snapshots over time window', () => {
    const instanceId = 'db-time-travel-test';
    store.onboardInstance({ instanceId, resourceId: 'db-TT', vcpus: 4 });

    const baseTime = Date.now();
    // Insert 5 simulated historical snapshots spanning 5 hours
    for (let i = 0; i < 5; i++) {
      const snapTime = new Date(baseTime - (4 - i) * 3600 * 1000).toISOString();
      store.saveSnapshot(
        {
          instanceId,
          resourceId: 'db-TT',
          timestamp: snapTime,
          startTime: snapTime,
          endTime: snapTime,
          periodSeconds: 300,
          vcpus: 4,
          cpuUtilization: 20 + i * 10,
          memoryFreeGB: 10,
          iopsTotal: 500,
          connections: 50,
          totalAAS: 1.5 + i * 0.5,
          slices: { CPU: 1.0, IO: 0.5 + i * 0.5 },
        },
        []
      );
    }

    const startIso = new Date(baseTime - 5 * 3600 * 1000).toISOString();
    const endIso = new Date(baseTime + 1000).toISOString();

    const historical = store.queryHistoricalMetrics(instanceId, startIso, endIso);
    assert.equal(historical.dataPoints.length, 5, 'Should return 5 chronological data points');
    assert.equal(historical.vcpus, 4);
    assert.ok(historical.dataPoints[0].totalAAS > 0);
    assert.ok(historical.dataPoints[4].totalAAS > historical.dataPoints[0].totalAAS, 'Load trend should be preserved');
  });

  test('Historical dimension keys: aggregates loadAAS and wait states across samples', () => {
    const instanceId = 'db-dim-test';
    store.onboardInstance({ instanceId, resourceId: 'db-DIM', vcpus: 8 });

    const now = new Date();
    const nowIso = now.toISOString();

    store.saveSnapshot(
      {
        instanceId,
        resourceId: 'db-DIM',
        timestamp: nowIso,
        startTime: nowIso,
        endTime: nowIso,
        periodSeconds: 300,
        vcpus: 8,
        cpuUtilization: 50,
        memoryFreeGB: 12,
        iopsTotal: 1000,
        connections: 20,
        totalAAS: 3.5,
        slices: { CPU: 3.5 },
      },
      [
        {
          instanceId,
          timestamp: nowIso,
          dimensionType: 'db.sql',
          dimensionId: 'sql_heavy_1',
          dimensionName: 'SELECT * FROM big_table',
          loadAAS: 2.8,
          waitBreakdown: { CPU: 80, IO: 20 },
        },
        {
          instanceId,
          timestamp: nowIso,
          dimensionType: 'db.sql',
          dimensionId: 'sql_light_2',
          dimensionName: 'SELECT 1',
          loadAAS: 0.2,
          waitBreakdown: { CPU: 100 },
        },
      ]
    );

    const dims = store.queryHistoricalDimensionKeys(
      instanceId,
      new Date(now.getTime() - 3600 * 1000).toISOString(),
      nowIso,
      'db.sql',
      5
    );

    assert.equal(dims.length, 2);
    assert.equal(dims[0].id, 'sql_heavy_1', 'Heaviest query must rank first');
    assert.ok(dims[0].loadAAS >= 2.5);
    assert.equal(dims[1].id, 'sql_light_2');
  });
});
