import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

// Point to in-memory database before importing server modules
process.env.SNAPSHOT_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import { app } from '../server/index.ts';

describe('REST API Interface (Behavioral Tests)', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('GET /api/aws/profiles', () => {
    it('returns profiles list and metadata', async () => {
      const res = await fetch(`${baseUrl}/api/aws/profiles`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.profiles));
      assert.ok(Array.isArray(json.metadata));
      assert.ok(json.profiles.includes('default'));
    });
  });

  describe('Snapshotter Daemon & Onboarding API Endpoints', () => {
    it('GET /api/snapshots/status returns current snapshotter status', async () => {
      const res = await fetch(`${baseUrl}/api/snapshots/status`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(typeof json.isRunning, 'boolean');
      assert.equal(typeof json.intervalMinutes, 'number');
      assert.equal(typeof json.onboardedCount, 'number');
    });

    it('POST /api/snapshots/onboard validates required fields', async () => {
      const res = await fetch(`${baseUrl}/api/snapshots/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.ok(json.error.includes('instanceId is required'));
    });

    it('POST /api/snapshots/onboard enrolls an RDS instance into snapshotting', async () => {
      const payload = {
        instanceId: 'prod-pg-orders-api',
        resourceId: 'db-PRODORDERSAPI',
        engine: 'postgres',
        vcpus: 8,
        retentionDays: 45,
        notes: 'API integration test database',
      };

      const res = await fetch(`${baseUrl}/api/snapshots/onboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.success, true);
      assert.ok(Array.isArray(json.onboarded));
      const enrolled = json.onboarded.find((o: any) => o.instanceId === 'prod-pg-orders-api');
      assert.ok(enrolled);
      assert.equal(enrolled.vcpus, 8);
      assert.equal(enrolled.retentionDays, 45);
      assert.equal(enrolled.status, 'active');
    });

    it('GET /api/snapshots/onboarded lists enrolled database targets', async () => {
      const res = await fetch(`${baseUrl}/api/snapshots/onboarded`);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.onboarded));
      const found = json.onboarded.find((o: any) => o.instanceId === 'prod-pg-orders-api');
      assert.ok(found);
      assert.equal(found.status, 'active');
      assert.equal(found.vcpus, 8);
    });

    it('POST /api/snapshots/onboard/status toggles status between active and paused', async () => {
      // Pause
      const pauseRes = await fetch(`${baseUrl}/api/snapshots/onboard/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'prod-pg-orders-api', status: 'paused' }),
      });
      assert.equal(pauseRes.status, 200);
      const pauseJson = await pauseRes.json();
      assert.equal(pauseJson.success, true);
      const pausedItem = pauseJson.onboarded.find((o: any) => o.instanceId === 'prod-pg-orders-api');
      assert.equal(pausedItem.status, 'paused');

      // Resume
      const resumeRes = await fetch(`${baseUrl}/api/snapshots/onboard/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: 'prod-pg-orders-api', status: 'active' }),
      });
      assert.equal(resumeRes.status, 200);
      const resumeJson = await resumeRes.json();
      assert.equal(resumeJson.success, true);
      const activeItem = resumeJson.onboarded.find((o: any) => o.instanceId === 'prod-pg-orders-api');
      assert.equal(activeItem.status, 'active');
    });

    it('DELETE /api/snapshots/onboard/:instanceId offboards the database from snapshotting', async () => {
      const delRes = await fetch(`${baseUrl}/api/snapshots/onboard/prod-pg-orders-api`, {
        method: 'DELETE',
      });
      assert.equal(delRes.status, 200);
      const delJson = await delRes.json();
      assert.equal(delJson.success, true);
      assert.ok(Array.isArray(delJson.onboarded));

      // Verify excluded from status
      const listRes = await fetch(`${baseUrl}/api/snapshots/onboarded`);
      const listJson = await listRes.json();
      const target = listJson.onboarded.find((o: any) => o.instanceId === 'prod-pg-orders-api');
      assert.equal(target, undefined);
    });
  });

  describe('GET /api/snapshots/cost-analysis', () => {
    it('calculates fleet retention costs and validates >99% ROI', async () => {
      const res = await fetch(`${baseUrl}/api/snapshots/cost-analysis?instances=8&vcpus=64`);
      assert.equal(res.status, 200);
      const json = await res.json();

      assert.equal(json.instances, 8);
      assert.equal(json.vcpus, 64);
      assert.equal(json.awsRatePerHourPerVcpu, 0.0125);
      // 64 vCPUs * $0.0125 * 730 hours = $584/mo
      assert.equal(json.awsMonthlyTotal, 584);
      assert.equal(json.awsAnnualTotal, 7008);
      assert.ok(json.netAnnualSavings > 7000);
      assert.ok(json.savingsPercent >= 99.9);
    });
  });

  describe('POST /api/anomalies/detect', () => {
    it('analyzes and returns flagged toxic query anomalies for simulated workload', async () => {
      const res = await fetch(`${baseUrl}/api/anomalies/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'analytics-mysql-dw',
          resourceId: 'db-ANALYTICS01',
          vcpus: 4,
          sessionConfig: { isDemoMode: true },
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.anomalies));
      assert.ok(json.totalAnomalies > 0);

      const first = json.anomalies[0];
      assert.ok(first.sqlId);
      assert.ok(first.anomalyType);
      assert.ok(first.toxicityScore > 0);
      assert.ok(first.suggestedFix);
    });
  });

  describe('Performance Insights Telemetry Endpoints', () => {
    it('POST /api/pi/metrics returns time series AAS points with adaptive granularity', async () => {
      const now = Date.now();
      const res = await fetch(`${baseUrl}/api/pi/metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'prod-pg-orders-01',
          resourceId: 'db-PROD01',
          startTime: new Date(now - 3600000).toISOString(),
          endTime: new Date(now).toISOString(),
          vcpus: 4,
          sessionConfig: { isDemoMode: true },
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.periodInSeconds, 60); // 1h window -> 60s
      assert.ok(Array.isArray(json.dataPoints));
      assert.ok(json.dataPoints.length > 0);
      assert.equal(json.vcpus, 4);

      const pt = json.dataPoints[0];
      assert.ok(pt.timestamp);
      assert.equal(typeof pt.totalAAS, 'number');
    });

    it('POST /api/pi/dimension-keys returns top SQL items in demo mode', async () => {
      const now = Date.now();
      const res = await fetch(`${baseUrl}/api/pi/dimension-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceId: 'prod-pg-orders-01',
          resourceId: 'db-PROD01',
          groupBy: 'db.sql',
          startTime: new Date(now - 3600000).toISOString(),
          endTime: new Date(now).toISOString(),
          vcpus: 4,
          sessionConfig: { isDemoMode: true },
        }),
      });

      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok(Array.isArray(json.items));
      assert.ok(json.items.length > 0);

      const sqlItem = json.items[0];
      assert.ok(sqlItem.id);
      assert.ok(sqlItem.sql);
      assert.equal(typeof sqlItem.loadAAS, 'number');
    });
  });
});
