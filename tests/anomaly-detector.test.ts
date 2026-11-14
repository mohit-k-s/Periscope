import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QueryAnomalyDetector } from '../server/anomaly-detector.ts';
import { TopSQLItem } from '../src/types.ts';

describe('Anomaly Detection Engine (Behavioral Tests)', () => {
  const detector = new QueryAnomalyDetector();

  test('IO_CHOKER Detection: flags runaway sequential scans and generates zero-downtime DDL', () => {
    const toxicQueries: TopSQLItem[] = [
      {
        id: 'sql_seq_scan_orders',
        sql: 'SELECT * FROM orders WHERE customer_id = $1 AND status = $2',
        loadAAS: 3.6,
        loadWaitBreakdown: {
          IO: 82,
          CPU: 18,
        },
        callsPerSec: 15,
        avgLatencyMs: 240,
        rowsPerCall: 5000,
        user: 'api_gateway',
        database: 'production',
      },
    ];

    const anomalies = detector.analyzeQueries(toxicQueries, 4);
    assert.equal(anomalies.length, 1);

    const anom = anomalies[0];
    assert.equal(anom.anomalyType, 'IO_CHOKER');
    assert.equal(anom.severity, 'CRITICAL');
    assert.ok(anom.toxicityScore >= 75, 'Toxicity score should be >= 75');
    assert.equal(anom.sqlId, 'sql_seq_scan_orders');
    assert.ok(anom.rootCause.includes('full table') || anom.rootCause.includes('IO wait') || anom.rootCause.includes('disk pages'));
    assert.ok(anom.impactAnalysis.includes('buffer pool') || anom.impactAnalysis.includes('cache'));

    // Verify Suggested DDL
    assert.ok(anom.suggestedDdl, 'Must generate zero-downtime CREATE INDEX statement');
    assert.ok(anom.suggestedDdl.includes('CREATE INDEX CONCURRENTLY'));
    assert.ok(anom.suggestedDdl.includes('orders'));
  });

  test('BUFFER_BLOAT Detection: flags temp table and buffer contention during heavy grouping/sorting', () => {
    const bufferQueries: TopSQLItem[] = [
      {
        id: 'sql_group_sort_bloat',
        sql: 'SELECT category, count(*), sum(price) FROM products GROUP BY category ORDER BY count(*) DESC',
        loadAAS: 2.2,
        loadWaitBreakdown: {
          concurrency: 55,
          IO: 45,
        },
        callsPerSec: 8,
        avgLatencyMs: 310,
        rowsPerCall: 20000,
        user: 'reporting_worker',
        database: 'production',
      },
    ];

    const anomalies = detector.analyzeQueries(bufferQueries, 4);
    assert.ok(anomalies.length >= 1);
    const anom = anomalies[0];
    assert.ok(anom.anomalyType === 'BUFFER_BLOAT' || anom.anomalyType === 'IO_CHOKER');
    assert.ok(anom.toxicityScore >= 50);
  });

  test('CPU_MONOPOLIZER Detection: flags compute-heavy query exhausting vCPU capacity', () => {
    const cpuQueries: TopSQLItem[] = [
      {
        id: 'sql_cpu_hog',
        sql: 'SELECT id, payload::jsonb FROM events WHERE jsonb_path_query_array(payload, $1) IS NOT NULL',
        loadAAS: 3.75, // Consuming 3.75 out of 4 vCPUs (> 90%)
        loadWaitBreakdown: {
          CPU: 94,
          IO: 6,
        },
        callsPerSec: 120,
        avgLatencyMs: 85,
        rowsPerCall: 10,
        user: 'event_consumer',
        database: 'production',
      },
    ];

    const anomalies = detector.analyzeQueries(cpuQueries, 4);
    assert.equal(anomalies.length, 1);

    const anom = anomalies[0];
    assert.equal(anom.anomalyType, 'CPU_MONOPOLIZER');
    assert.equal(anom.severity, 'CRITICAL');
    assert.ok(anom.toxicityScore >= 80);
    assert.ok(anom.rootCause.includes('vCPU') || anom.rootCause.includes('CPU'));
  });

  test('LOCK_CONVOY Detection: flags row/table lock contention causing thread pile-up', () => {
    const lockQueries: TopSQLItem[] = [
      {
        id: 'sql_lock_contention',
        sql: 'UPDATE inventory_items SET quantity = quantity - 1 WHERE warehouse_id = $1 AND sku = $2',
        loadAAS: 2.8,
        loadWaitBreakdown: {
          lock: 78,
          CPU: 22,
        },
        callsPerSec: 45,
        avgLatencyMs: 620,
        rowsPerCall: 1,
        user: 'checkout_svc',
        database: 'production',
      },
    ];

    const anomalies = detector.analyzeQueries(lockQueries, 4);
    assert.equal(anomalies.length, 1);

    const anom = anomalies[0];
    assert.equal(anom.anomalyType, 'LOCK_CONVOY');
    assert.ok(anom.toxicityScore >= 60);
    assert.ok(anom.rootCause.includes('lock') || anom.rootCause.includes('Lock'));
    assert.ok(anom.impactAnalysis.includes('cascade') || anom.impactAnalysis.includes('connection'));
  });

  test('Safe Queries: healthy and indexed queries with low load are NOT flagged', () => {
    const safeQueries: TopSQLItem[] = [
      {
        id: 'sql_primary_key_lookup',
        sql: 'SELECT id, email, created_at FROM users WHERE id = $1',
        loadAAS: 0.04,
        loadWaitBreakdown: {
          CPU: 90,
          IO: 10,
        },
        callsPerSec: 1500,
        avgLatencyMs: 0.8,
        rowsPerCall: 1,
        user: 'auth_svc',
        database: 'production',
      },
      {
        id: 'sql_fast_health_check',
        sql: 'SELECT 1',
        loadAAS: 0.01,
        loadWaitBreakdown: {
          CPU: 100,
        },
        callsPerSec: 200,
        avgLatencyMs: 0.2,
        rowsPerCall: 1,
        user: 'k8s_probe',
        database: 'production',
      },
    ];

    const anomalies = detector.analyzeQueries(safeQueries, 4);
    assert.equal(anomalies.length, 0, 'Safe queries must not trigger any false positive anomalies');
  });
});
