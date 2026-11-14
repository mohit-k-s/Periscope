import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotStore } from '../server/snapshot-store.ts';
import { SnapshotterEngine } from '../server/snapshotter.ts';

describe('Snapshotter Engine & Onboarding Gatekeeper (Behavioral Tests)', () => {
  let store: SnapshotStore;
  let engine: SnapshotterEngine;

  beforeEach(() => {
    store = new SnapshotStore(':memory:');
    engine = new SnapshotterEngine(
      {
        intervalMs: 60000,
        sessionConfig: { isDemoMode: true, region: 'us-east-1' },
      },
      store
    );
  });

  afterEach(() => {
    engine.stopDaemon();
  });

  test('Gating behavior: skips capture completely when zero databases are onboarded', async () => {
    // Empty out any default seeded instances to simulate fresh estate
    for (const inst of store.getOnboardedInstances()) {
      store.offboardInstance(inst.instanceId);
    }

    assert.equal(store.getOnboardedInstances().length, 0);

    const result = await engine.runCycle();
    assert.equal(result.capturedCount, 0, 'Must capture 0 instances when no instances are onboarded');
    assert.equal(result.errors.length, 0);

    const stats = store.getStats();
    assert.equal(stats.totalSnapshots, 0, 'No snapshots should be written to store');
  });

  test('Gating behavior: strictly captures ONLY onboarded databases, completely ignoring non-onboarded databases', async () => {
    // Clear out
    for (const inst of store.getOnboardedInstances()) {
      store.offboardInstance(inst.instanceId);
    }

    // Estate has: prod-pg-orders-01, prod-pg-inventory-02, analytics-mysql-dw
    // We strictly onboard ONLY 'prod-pg-orders-01'
    store.onboardInstance({
      instanceId: 'prod-pg-orders-01',
      resourceId: 'db-PROD-PG-ORDERS-01',
      vcpus: 8,
      status: 'active',
    });

    const result = await engine.runCycle();
    assert.equal(result.capturedCount, 1, 'Should capture exactly 1 onboarded database');

    const storedSummaries = store.listStoredInstances();
    assert.equal(storedSummaries.length, 1);
    assert.equal(storedSummaries[0].instanceId, 'prod-pg-orders-01');

    // Confirm non-onboarded instances were NOT snapshotted
    assert.ok(!storedSummaries.some((s) => s.instanceId === 'prod-pg-inventory-02'));
    assert.ok(!storedSummaries.some((s) => s.instanceId === 'analytics-mysql-dw'));
  });

  test('Gating behavior: paused onboarded databases are skipped during capture', async () => {
    for (const inst of store.getOnboardedInstances()) {
      store.offboardInstance(inst.instanceId);
    }

    // Onboard two databases
    store.onboardInstance({ instanceId: 'prod-pg-orders-01', resourceId: 'db-1', vcpus: 8 });
    store.onboardInstance({ instanceId: 'prod-pg-inventory-02', resourceId: 'db-2', vcpus: 4 });

    // Pause one database
    store.updateOnboardedStatus('prod-pg-inventory-02', 'paused');

    const result = await engine.runCycle();
    assert.equal(result.capturedCount, 1, 'Should only capture the 1 active database');

    const storedSummaries = store.listStoredInstances();
    assert.equal(storedSummaries.length, 1);
    assert.equal(storedSummaries[0].instanceId, 'prod-pg-orders-01');
  });

  test('Daemon lifecycle: starts, reports status, and stops cleanly', () => {
    const statusInitial = engine.getStatus();
    assert.equal(statusInitial.isRunning, false);

    engine.startDaemon();
    const statusRunning = engine.getStatus();
    assert.equal(statusRunning.isRunning, true);
    assert.ok(statusRunning.nextRun);

    // Multiple calls should be idempotent
    engine.startDaemon();
    assert.equal(engine.getStatus().isRunning, true);

    engine.stopDaemon();
    const statusStopped = engine.getStatus();
    assert.equal(statusStopped.isRunning, false);
    assert.equal(statusStopped.nextRun, null);
  });

  test('Manual trigger: triggers a snapshot on-demand', async () => {
    for (const inst of store.getOnboardedInstances()) {
      store.offboardInstance(inst.instanceId);
    }

    store.onboardInstance({ instanceId: 'prod-pg-orders-01', resourceId: 'db-1', vcpus: 8 });

    const triggerRes = await engine.runCycle();
    assert.equal(triggerRes.capturedCount, 1);
    assert.equal(triggerRes.errors.length, 0);

    const stats = store.getStats();
    assert.equal(stats.totalSnapshots, 1);
  });

  test('History seeding: generates multi-day historical snapshots for active instances', async () => {
    for (const inst of store.getOnboardedInstances()) {
      store.offboardInstance(inst.instanceId);
    }

    store.onboardInstance({ instanceId: 'prod-pg-orders-01', resourceId: 'db-1', vcpus: 8 });

    // Seed 3 days of historical snapshots every 60 minutes
    const seededCount = await engine.seedHistoricalData(3, 60);
    assert.ok(seededCount > 0, 'Should have generated historical snapshots');

    const stats = store.getStats();
    assert.equal(stats.totalSnapshots, seededCount);
    assert.ok(stats.earliestSnapshot);
    assert.ok(stats.latestSnapshot);

    // Verify time travel query can read the seeded historical window
    const historical = store.queryHistoricalMetrics(
      'prod-pg-orders-01',
      stats.earliestSnapshot!,
      stats.latestSnapshot!
    );
    assert.ok(historical.dataPoints.length > 0, 'Historical query must return dataPoints from seeded archive');
  });
});
