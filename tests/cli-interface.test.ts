import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('CLI Tool Interface (Behavioral Tests)', () => {
  const cliPath = path.resolve(process.cwd(), 'server/cli.ts');
  const tempDbPath = path.join(os.tmpdir(), `test-pi-cli-${Date.now()}.db`);
  const tempExportPath = path.join(os.tmpdir(), `test-pi-export-${Date.now()}.json`);

  const runCli = (args: string[]): string => {
    return execFileSync(
      process.execPath,
      ['--import', 'tsx', cliPath, ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SNAPSHOT_DB_PATH: tempDbPath,
          NODE_ENV: 'test',
        },
      }
    );
  };

  after(() => {
    // Cleanup temporary files
    try {
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      if (fs.existsSync(tempExportPath)) fs.unlinkSync(tempExportPath);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('periscope help', () => {
    it('prints usage instructions and command listing', () => {
      const output = runCli(['help']);
      assert.ok(output.includes('Periscope — RDS Performance Insights CLI'));
      assert.ok(output.includes('Commands:'));
      assert.ok(output.includes('onboard'));
      assert.ok(output.includes('offboard'));
      assert.ok(output.includes('cost'));
      assert.ok(output.includes('anomalies'));
    });
  });

  describe('periscope cost', () => {
    it('calculates fleet retention economics and outputs ROI comparison', () => {
      const output = runCli(['cost', '--instances', '10', '--vcpus', '80']);
      assert.ok(output.includes('AWS Performance Insights Cost Analysis'));
      assert.ok(output.includes('80 vCPUs'));
      assert.ok(output.includes('AWS Retention Fee'));
      assert.ok(output.includes('Self-Hosted 5-Minute Snapshotter'));
      assert.ok(output.includes('SAVINGS'));
      assert.ok(output.includes('100.00% SAVINGS') || output.includes('99.'));
    });
  });

  describe('Onboarding & Offboarding Lifecycle via CLI', () => {
    it('reports empty list when no databases are enrolled in a new database', () => {
      const output = runCli(['onboarded']);
      assert.ok(output.includes('No databases currently onboarded'));
    });

    it('onboards an RDS database with custom retention and vCPUs', () => {
      const output = runCli([
        'onboard',
        'prod-pg-orders-01',
        '--vcpus',
        '8',
        '--retention',
        '45',
        '--notes',
        'Production checkout primary',
      ]);
      assert.ok(output.includes('Successfully ONBOARDED "prod-pg-orders-01"'));
      assert.ok(output.includes('ACTIVE'));
      assert.ok(output.includes('45 days'));
    });

    it('lists newly enrolled database in targets table', () => {
      const output = runCli(['onboarded']);
      assert.ok(output.includes('prod-pg-orders-01'));
      assert.ok(output.includes('Active'));
    });

    it('seeds historical snapshot telemetry for onboarded database', () => {
      const output = runCli(['seed', '--days', '2']);
      assert.ok(output.includes('Seeding 2 days of historical snapshots'));
      assert.ok(output.includes('Done! Created'));
    });

    it('lists stored snapshots and database metrics span', () => {
      const output = runCli(['list']);
      assert.ok(output.includes('prod-pg-orders-01'));
      assert.ok(output.includes('Snapshots Count'));
    });

    it('inspects recent snapshots and metrics for the instance', () => {
      const output = runCli(['inspect', '--instance', 'prod-pg-orders-01', '--hours', '48']);
      assert.ok(output.includes('Inspecting prod-pg-orders-01'));
      assert.ok(output.includes('Metric Points Sample'));
      assert.ok(output.includes('Total AAS'));
    });

    it('scans stored telemetry for toxic and anomalous queries', () => {
      const output = runCli(['anomalies', '--instance', 'prod-pg-orders-01']);
      assert.ok(output.includes('ANOMALOUS & TOXIC QUERY DETECTION'));
    });

    it('exports database snapshots and dimensions to JSON file', () => {
      const output = runCli(['export', '--instance', 'prod-pg-orders-01', '--out', tempExportPath]);
      assert.ok(output.includes('Export complete'));
      assert.ok(fs.existsSync(tempExportPath));

      const exportedJson = JSON.parse(fs.readFileSync(tempExportPath, 'utf8'));
      assert.ok(Array.isArray(exportedJson.snapshots));
      assert.ok(exportedJson.snapshots.length > 0);
      assert.ok(Array.isArray(exportedJson.dimensions));
    });

    it('offboards database instance from snapshotter and verifies empty state', () => {
      const output = runCli(['offboard', 'prod-pg-orders-01']);
      assert.ok(output.includes('Successfully OFFBOARDED "prod-pg-orders-01"'));

      const statusOutput = runCli(['onboarded']);
      assert.ok(statusOutput.includes('No databases currently onboarded'));
    });
  });
});
