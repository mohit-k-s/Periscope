#!/usr/bin/env node
import { snapshotEngine } from './snapshotter.ts';
import { snapshotStore } from './snapshot-store.ts';
import { anomalyDetector } from './anomaly-detector.ts';
import fs from 'fs';
import path from 'path';

function printHelp() {
  console.log(`
===================================================================
                Periscope — RDS Performance Insights CLI
===================================================================

Usage:
  periscope <command> [options]
  (or: npx periscope <command>)

Commands:
  run          Take a single snapshot right now across monitored DBs
  daemon       Start background snapshotter loop (default: every 5 minutes)
  onboard      Onboard an individual database into Periscope (prevents estate-wide waste)
  offboard     Offboard/remove a database from Periscope
  onboarded    List currently onboarded databases and their status
  list         List stored database instances and their snapshot spans
  inspect      Inspect recent snapshots and metrics for an instance
  anomalies    Scan stored telemetry to flag I/O Chokers, CPU monopolizers & locks
  cost         Calculate cost comparison: AWS Extended PI vs Local/S3
  seed         Populate synthetic historical snapshots for testing time-travel
  export       Export snapshot database to JSON file
  help         Display this help guide

Options:
  --instance <id>     Target specific DB instance (e.g. prod-pg-orders-01)
  --interval <sec>    Daemon loop interval in seconds (default: 300 = 5 mins)
  --profile <name>    AWS Profile from ~/.aws/credentials (default: default)
  --region <region>   AWS Region (default: ap-south-1)
  --role-arn <arn>    IAM Role ARN to assume
  --hours <n>         Hours of history to inspect (default: 24)
  --days <n>          Days of history to seed (default: 14)
  --out <file.json>   Output file for exported data
  --demo              Force demo mode (runs without active AWS credentials)

Examples:
  npx tsx server/cli.ts run --demo
  npx tsx server/cli.ts daemon --interval 300
  npx tsx server/cli.ts list
  npx tsx server/cli.ts inspect --instance prod-pg-orders-01 --hours 6
  npx tsx server/cli.ts cost --instances 8 --vcpus 64
===================================================================
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = true;
      }
    }
  }

  return { command, options };
}

async function handleRun(options: Record<string, any>) {
  console.log('[CLI] Initiating snapshot capture...');
  const isDemo = !!options.demo;
  
  snapshotEngine.updateConfig({
    intervalMs: (Number(options.interval) || 300) * 1000,
    sessionConfig: {
      profile: options.profile || 'default',
      region: options.region || 'ap-south-1',
      roleArn: options['role-arn'],
      isDemoMode: isDemo,
    },
    targetInstances: options.instance ? [options.instance] : undefined,
  });

  const result = await snapshotEngine.runCycle();
  if (result.errors.length > 0) {
    console.error('[CLI] Capture completed with errors:', result.errors);
  } else {
    console.log(`[CLI] Successfully captured snapshots for ${result.capturedCount} database instance(s).`);
  }

  const stats = snapshotStore.getStats();
  console.log(`[CLI] Snapshot Store: ${stats.totalSnapshots} total snapshots across database file (${stats.fileSizeMB} MB).`);
}

async function handleDaemon(options: Record<string, any>) {
  const intervalSec = Number(options.interval) || 300;
  const isDemo = !!options.demo;

  console.log(`===================================================================`);
  console.log(`  Starting Snapshotter Daemon: recording every ${intervalSec} seconds (${intervalSec / 60} mins)`);
  console.log(`  Database File: ${snapshotStore.getDbPath()}`);
  console.log(`  Mode: ${isDemo ? 'DEMO (Simulation)' : 'LIVE AWS'}`);
  console.log(`  Press Ctrl+C to stop.`);
  console.log(`===================================================================`);

  snapshotEngine.updateConfig({
    intervalMs: intervalSec * 1000,
    sessionConfig: {
      profile: options.profile || 'default',
      region: options.region || 'ap-south-1',
      roleArn: options['role-arn'],
      isDemoMode: isDemo,
    },
    targetInstances: options.instance ? [options.instance] : undefined,
  });

  snapshotEngine.startDaemon();

  // Keep process alive and handle graceful shutdown
  const shutdown = () => {
    console.log('\n[CLI] Shutting down snapshotter daemon cleanly...');
    snapshotEngine.stopDaemon();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function handleList() {
  const instances = snapshotStore.listStoredInstances();
  const stats = snapshotStore.getStats();

  console.log(`===================================================================`);
  console.log(`  Stored Databases & Snapshot History`);
  console.log(`  Total Snapshots: ${stats.totalSnapshots} | DB Size: ${stats.fileSizeMB} MB`);
  console.log(`===================================================================`);

  if (instances.length === 0) {
    console.log('  No snapshots found in database. Run "periscope run" to capture one.');
    return;
  }

  console.table(
    instances.map((i) => ({
      'Instance ID': i.instanceId,
      vCPUs: i.vcpus,
      'Snapshots Count': i.totalSnapshots,
      'Earliest Snapshot': new Date(i.earliestSnapshot).toLocaleString(),
      'Latest Snapshot': new Date(i.latestSnapshot).toLocaleString(),
    }))
  );
}

function handleInspect(options: Record<string, any>) {
  const instanceId = options.instance;
  if (!instanceId) {
    console.error('Error: Please specify --instance <instanceId>. Use "periscope list" to see stored instances.');
    process.exit(1);
  }

  const hours = Number(options.hours) || 24;
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);

  console.log(`[CLI] Inspecting ${instanceId} over past ${hours} hours...`);
  const metrics = snapshotStore.queryHistoricalMetrics(instanceId, start.toISOString(), end.toISOString(), 20);
  const topSql = snapshotStore.queryHistoricalDimensionKeys(instanceId, start.toISOString(), end.toISOString(), 'db.sql', 5);

  console.log(`\n--- Metric Points Sample (${metrics.totalPoints} total records found) ---`);
  if (metrics.dataPoints.length > 0) {
    console.table(
      metrics.dataPoints.slice(0, 8).map((pt) => ({
        Timestamp: new Date(pt.timestamp).toLocaleTimeString(),
        'Total AAS': pt.totalAAS,
        'CPU Util %': pt.cpuUtilization,
        'Free Mem (GB)': pt.memoryFreeGB,
        IOPS: pt.iopsTotal,
        Backends: pt.connections,
      }))
    );
  } else {
    console.log('No metric points found in this time window.');
  }

  console.log(`\n--- Top SQL in Window ---`);
  if (topSql.length > 0) {
    console.table(
      topSql.map((s) => ({
        'SQL ID': s.id,
        'AAS Load': s.loadAAS,
        Statement: (s.sql || s.name || '').replace(/\s+/g, ' ').slice(0, 60) + '...',
      }))
    );
  } else {
    console.log('No SQL statements recorded for this window.');
  }
}

function handleCost(options: Record<string, any>) {
  const instanceCount = Number(options.instances) || 5;
  const totalVcpus = Number(options.vcpus) || 32;

  // AWS PI Extended Retention pricing:
  // $0.0125 per vCPU-hour = $9.125 per vCPU-month (730 hours/month)
  const awsVcpuHourRate = 0.0125;
  const monthlyHours = 730;
  const awsCostPerVcpuMonth = awsVcpuHourRate * monthlyHours; // $9.125
  const awsMonthlyTotal = totalVcpus * awsCostPerVcpuMonth;
  const awsAnnualTotal = awsMonthlyTotal * 12;

  // Snapshotter storage:
  // 1 snapshot every 5 min = 288/day = 8,640/month
  // ~10KB/snapshot uncompressed -> ~25MB/month per instance
  const mbPerInstanceMonth = 25;
  const totalGbMonth = (instanceCount * mbPerInstanceMonth) / 1024;
  // S3 Standard pricing: $0.023 per GB/month
  const s3MonthlyStorageCost = Math.max(0.01, +(totalGbMonth * 0.023).toFixed(4));
  const s3AnnualStorageCost = +(s3MonthlyStorageCost * 12).toFixed(2);
  const netAnnualSavings = awsAnnualTotal - s3AnnualStorageCost;
  const savingsPercent = ((netAnnualSavings / awsAnnualTotal) * 100).toFixed(2);

  console.log(`
===================================================================
               AWS Performance Insights Cost Analysis
===================================================================

Fleet Parameters:
  • Monitored Database Instances : ${instanceCount}
  • Total Provisioned vCPUs      : ${totalVcpus} vCPUs (avg ${Math.round(totalVcpus / instanceCount)} vCPUs/instance)
  • Retention Target             : 1 to 24 Months (beyond free 7-day tier)

1. AWS Performance Insights Extended Retention ("Advanced Mode"):
  • Rate                         : $0.0125 per vCPU-hour
  • Cost per vCPU per month      : $${awsCostPerVcpuMonth.toFixed(2)} / vCPU / month
  • Monthly AWS Retention Fee    : $${awsMonthlyTotal.toFixed(2)} / month
  • Annual AWS Retention Fee     : $${awsAnnualTotal.toFixed(2)} / year
  * Note: AWS bills 24/7 on total vCPUs regardless of query activity.

2. Self-Hosted 5-Minute Snapshotter (SQLite / S3):
  • Ingestion Frequency          : Every 5 minutes (288 snapshots/day/instance)
  • Data Stored per DB per Month : ~${mbPerInstanceMonth} MB (~${(mbPerInstanceMonth * 12).toFixed(0)} MB/year)
  • Total Fleet Storage Volume   : ${totalGbMonth.toFixed(2)} GB / month (${(totalGbMonth * 12).toFixed(2)} GB / year)
  • Storage Cost (Local Disk)    : $0.00
  • Storage Cost (AWS S3 Std)    : ~$${s3MonthlyStorageCost} / month (~$${s3AnnualStorageCost} / year)
  • AWS PI API Query Fees        : $0.00 (within standard AWS API limits)

-------------------------------------------------------------------
FINANCIAL SUMMARY & ROI:
  • Net Annual Savings           : $${netAnnualSavings.toFixed(2)} / year
  • Cost Reduction               : ${savingsPercent}% SAVINGS
===================================================================
`);
}

async function handleSeed(options: Record<string, any>) {
  const days = Number(options.days) || 14;
  console.log(`[CLI] Seeding ${days} days of historical snapshots for time travel...`);
  const count = await snapshotEngine.seedHistoricalData(days, 30);
  console.log(`[CLI] Done! Created ${count} snapshots. Use "periscope inspect" or open the web dashboard to travel back in time.`);
}

function handleExport(options: Record<string, any>) {
  const outFile = options.out || path.resolve(process.cwd(), `pi-snapshots-export-${Date.now()}.json`);
  console.log(`[CLI] Exporting snapshot database to ${outFile}...`);
  const data = snapshotStore.exportData(options.instance);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[CLI] Export complete: ${data.snapshots.length} snapshots, ${data.dimensions.length} dimensions saved to ${outFile}.`);
}

function handleAnomalies(options: Record<string, any>) {
  const instances = snapshotStore.listStoredInstances();
  const instanceId = options.instance || (instances[0] ? instances[0].instanceId : 'analytics-mysql-dw');
  const hours = Number(options.hours) || 48;
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);

  console.log(`[CLI] Scanning ${instanceId} for anomalous & toxic queries over past ${hours} hours...`);
  const topSql = snapshotStore.queryHistoricalDimensionKeys(instanceId, start.toISOString(), end.toISOString(), 'db.sql', 20);

  const anomalies = anomalyDetector.analyzeQueries(topSql, 4);

  console.log(`\n===================================================================`);
  console.log(`               ANOMALOUS & TOXIC QUERY DETECTION`);
  console.log(`===================================================================`);
  if (anomalies.length === 0) {
    console.log('✓ No toxic query anomalies detected. All queries operating within normal performance thresholds.');
    return;
  }

  console.log(`🚨 Flagged ${anomalies.length} anomalous query pattern(s) on ${instanceId}:\n`);

  for (const anom of anomalies) {
    const icon = anom.severity === 'CRITICAL' ? '🔴' : '🟠';
    console.log(`${icon} [${anom.severity}] ${anom.anomalyTitle} (Toxicity Score: ${anom.toxicityScore}/100)`);
    console.log(`   SQL ID         : ${anom.sqlId}`);
    console.log(`   Load Impact    : ${anom.loadAAS} AAS (${anom.pctOfVcpus}% of instance vCPUs)`);
    console.log(`   Wait Dominance : ${anom.dominantWaitEvent} (${anom.waitBreakdown.io || anom.waitBreakdown.IO || 0}% I/O Wait)`);
    console.log(`   Root Cause     : ${anom.rootCause}`);
    console.log(`   Impact         : ${anom.impactAnalysis}`);
    console.log(`   Suggested Fix  : ${anom.suggestedFix}`);
    if (anom.suggestedDdl) {
      console.log(`   Remediation DDL: \x1b[36m${anom.suggestedDdl}\x1b[0m`);
    }
    console.log(`   SQL Statement  : ${(anom.sqlText || '').replace(/\s+/g, ' ').slice(0, 100)}...`);
    console.log(`-------------------------------------------------------------------`);
  }
}

function handleOnboard(options: Record<string, any>) {
  const instanceId = options.instance || process.argv[3];
  if (!instanceId || instanceId.startsWith('--')) {
    console.error('Error: Please specify instance identifier to onboard, e.g. "periscope onboard prod-pg-orders-01"');
    process.exit(1);
  }

  const retentionDays = Number(options.retention) || 30;
  const notes = typeof options.notes === 'string' ? options.notes : 'Onboarded via CLI';
  const vcpus = Number(options.vcpus) || 4;

  snapshotStore.onboardInstance({
    instanceId,
    resourceId: `db-${instanceId.toUpperCase()}`,
    engine: 'postgres',
    vcpus,
    retentionDays,
    notes,
  });

  console.log(`\n✓ Successfully ONBOARDED "${instanceId}" into Periscope.`);
  console.log(`  • Status: ACTIVE (will be snapshotted every 5 minutes)`);
  console.log(`  • Retention Policy: ${retentionDays} days`);
  console.log(`  • Notes: ${notes}`);
}

function handleOffboard(options: Record<string, any>) {
  const instanceId = options.instance || process.argv[3];
  if (!instanceId || instanceId.startsWith('--')) {
    console.error('Error: Please specify instance identifier to offboard, e.g. "periscope offboard prod-pg-orders-01"');
    process.exit(1);
  }

  snapshotStore.offboardInstance(instanceId);
  console.log(`\n✓ Successfully OFFBOARDED "${instanceId}". Snapshot daemon will no longer capture this database.`);
}

function handleOnboarded() {
  const list = snapshotStore.getOnboardedInstances();
  console.log(`===================================================================`);
  console.log(`               ONBOARDED DATABASE TARGETS`);
  console.log(`===================================================================`);
  if (list.length === 0) {
    console.log('No databases currently onboarded. Use "periscope onboard <instance-id>" to enroll one.');
    return;
  }

  console.table(
    list.map((o) => ({
      'Instance ID': o.instanceId,
      Status: o.status === 'active' ? '🟢 Active' : '⏸ Paused',
      vCPUs: o.vcpus,
      'Snapshots Taken': o.totalSnapshots,
      'Retention (Days)': o.retentionDays,
      'Onboarded At': new Date(o.createdAt).toLocaleDateString(),
      Notes: o.notes ? o.notes.slice(0, 30) + '...' : '—',
    }))
  );
}

async function main() {
  const { command, options } = parseArgs();

  switch (command.toLowerCase()) {
    case 'run':
      await handleRun(options);
      break;
    case 'daemon':
      await handleDaemon(options);
      break;
    case 'onboard':
      handleOnboard(options);
      break;
    case 'offboard':
      handleOffboard(options);
      break;
    case 'onboarded':
    case 'targets':
      handleOnboarded();
      break;
    case 'list':
      handleList();
      break;
    case 'inspect':
      handleInspect(options);
      break;
    case 'cost':
      handleCost(options);
      break;
    case 'anomalies':
      handleAnomalies(options);
      break;
    case 'seed':
      await handleSeed(options);
      break;
    case 'export':
      handleExport(options);
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error('[CLI] Unhandled error:', err);
  process.exit(1);
});
