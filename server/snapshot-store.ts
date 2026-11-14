import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface StoredSnapshot {
  id?: number;
  instanceId: string;
  resourceId: string;
  timestamp: string; // ISO string
  startTime: string;
  endTime: string;
  periodSeconds: number;
  vcpus: number;
  cpuUtilization: number;
  memoryFreeGB: number;
  iopsTotal: number;
  connections: number;
  totalAAS: number;
  slices: Record<string, number>;
  rawPoints?: any[];
}

export interface StoredDimensionItem {
  id?: number;
  snapshotId?: number;
  instanceId: string;
  timestamp: string;
  dimensionType: 'db.sql' | 'db.wait_event' | 'db.host' | 'db.user';
  dimensionId: string;
  dimensionName: string;
  loadAAS: number;
  waitBreakdown: Record<string, number>;
  sqlText?: string;
}

export interface StoredSqlStatement {
  sqlId: string;
  sqlText: string;
  firstSeen: string;
  lastSeen: string;
}

export interface StoredInstanceSummary {
  instanceId: string;
  resourceId: string;
  vcpus: number;
  totalSnapshots: number;
  earliestSnapshot: string;
  latestSnapshot: string;
}

export interface OnboardedInstance {
  instanceId: string;
  resourceId: string;
  engine: string;
  vcpus: number;
  status: 'active' | 'paused';
  intervalSeconds: number;
  retentionDays: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  totalSnapshots?: number;
  latestSnapshot?: string | null;
}

export interface SnapshotRunRecord {
  id?: number;
  runTimestamp: string;
  durationMs: number;
  instancesCount: number;
  status: 'success' | 'partial' | 'error';
  errorMessage?: string;
}

export class SnapshotStore {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(customPath?: string) {
    const dataDir = path.resolve(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = customPath || process.env.SNAPSHOT_DB_PATH || path.join(dataDir, 'snapshots.db');
    this.db = new DatabaseSync(this.dbPath);

    this.initDatabase();
  }

  private initDatabase() {
    // Enable WAL mode for high performance concurrent reading and non-blocking writes
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        period_seconds INTEGER NOT NULL,
        vcpus INTEGER NOT NULL,
        cpu_utilization REAL DEFAULT 0,
        memory_free_gb REAL DEFAULT 0,
        iops_total REAL DEFAULT 0,
        connections INTEGER DEFAULT 0,
        total_aas REAL DEFAULT 0,
        slices_json TEXT DEFAULT '{}',
        raw_points_json TEXT DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_instance_time 
        ON snapshots(instance_id, timestamp);

      CREATE TABLE IF NOT EXISTS top_dimensions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
        instance_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        dimension_type TEXT NOT NULL,
        dimension_id TEXT NOT NULL,
        dimension_name TEXT NOT NULL,
        load_aas REAL NOT NULL,
        wait_breakdown_json TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_dimensions_query 
        ON top_dimensions(dimension_type, instance_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_dimensions_snapshot 
        ON top_dimensions(snapshot_id);

      CREATE TABLE IF NOT EXISTS sql_statements (
        sql_id TEXT PRIMARY KEY,
        sql_text TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshot_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_timestamp TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        instances_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS onboarded_instances (
        instance_id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        engine TEXT DEFAULT 'postgres',
        vcpus INTEGER DEFAULT 4,
        status TEXT NOT NULL DEFAULT 'active',
        interval_seconds INTEGER DEFAULT 300,
        retention_days INTEGER DEFAULT 30,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS store_metadata (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
    } catch (e) {}
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Save a single snapshot and its top dimensions in a single atomic transaction
   */
  public saveSnapshot(
    snapshot: StoredSnapshot,
    dimensions: StoredDimensionItem[],
    sqlStatements: StoredSqlStatement[] = []
  ): number {
    this.db.exec('BEGIN TRANSACTION');
    try {
      // 1. Insert or update unique SQL statements
      const upsertSql = this.db.prepare(`
        INSERT INTO sql_statements (sql_id, sql_text, first_seen, last_seen)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(sql_id) DO UPDATE SET
          last_seen = excluded.last_seen,
          sql_text = CASE WHEN length(excluded.sql_text) > length(sql_statements.sql_text) THEN excluded.sql_text ELSE sql_statements.sql_text END
      `);

      for (const s of sqlStatements) {
        if (s.sqlId && s.sqlText) {
          upsertSql.run(
            s.sqlId,
            s.sqlText,
            s.firstSeen || snapshot.timestamp,
            s.lastSeen || snapshot.timestamp
          );
        }
      }

      // 2. Insert main snapshot row
      const insertSnapshot = this.db.prepare(`
        INSERT INTO snapshots (
          instance_id, resource_id, timestamp, start_time, end_time,
          period_seconds, vcpus, cpu_utilization, memory_free_gb,
          iops_total, connections, total_aas, slices_json, raw_points_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result: any = insertSnapshot.run(
        snapshot.instanceId || '',
        snapshot.resourceId || '',
        snapshot.timestamp || new Date().toISOString(),
        snapshot.startTime || new Date().toISOString(),
        snapshot.endTime || new Date().toISOString(),
        Number(snapshot.periodSeconds) || 300,
        Number(snapshot.vcpus) || 4,
        Number(snapshot.cpuUtilization) || 0,
        Number(snapshot.memoryFreeGB) || 0,
        Number(snapshot.iopsTotal) || 0,
        Number(snapshot.connections) || 0,
        Number(snapshot.totalAAS) || 0,
        JSON.stringify(snapshot.slices || {}),
        JSON.stringify(snapshot.rawPoints || [])
      );

      const snapshotId = Number(result.lastInsertRowid);

      // 3. Insert dimension items
      const insertDimension = this.db.prepare(`
        INSERT INTO top_dimensions (
          snapshot_id, instance_id, timestamp, dimension_type,
          dimension_id, dimension_name, load_aas, wait_breakdown_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const dim of dimensions) {
        insertDimension.run(
          snapshotId,
          snapshot.instanceId || '',
          snapshot.timestamp || new Date().toISOString(),
          dim.dimensionType || 'db.sql',
          dim.dimensionId || 'unknown',
          dim.dimensionName || dim.dimensionId || 'unknown',
          Number(dim.loadAAS) || 0,
          JSON.stringify(dim.waitBreakdown || {})
        );
      }

      this.db.exec('COMMIT');
      return snapshotId;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Log a snapshot run metadata record
   */
  public recordRun(record: SnapshotRunRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO snapshot_runs (run_timestamp, duration_ms, instances_count, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      record.runTimestamp,
      record.durationMs,
      record.instancesCount,
      record.status,
      record.errorMessage || null
    );
  }

  /**
   * Query historical time-series metrics for a given instance and time window
   */
  public queryHistoricalMetrics(
    instanceId: string,
    startTime: string,
    endTime: string,
    maxPoints = 500
  ): {
    dataPoints: any[];
    vcpus: number;
    totalPoints: number;
  } {
    const stmt = this.db.prepare(`
      SELECT * FROM snapshots
      WHERE instance_id = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    const rows: any[] = stmt.all(instanceId, startTime, endTime);
    if (rows.length === 0) {
      return { dataPoints: [], vcpus: 4, totalPoints: 0 };
    }

    const latestVcpus = rows[rows.length - 1].vcpus || 4;

    // If points are within limit, return raw points
    if (rows.length <= maxPoints) {
      const dataPoints = rows.map((r) => {
        let slices: Record<string, number> = {};
        try {
          slices = JSON.parse(r.slices_json);
        } catch (e) {}

        return {
          timestamp: r.timestamp,
          totalAAS: +(r.total_aas || 0).toFixed(4),
          slices,
          cpuUtilization: +(r.cpu_utilization || 0).toFixed(1),
          memoryFreeGB: +(r.memory_free_gb || 0).toFixed(2),
          iopsTotal: Math.round(r.iops_total || 0),
          connections: Math.round(r.connections || 0),
        };
      });

      return {
        dataPoints,
        vcpus: latestVcpus,
        totalPoints: rows.length,
      };
    }

    // Adaptive bucket aggregation for long time windows (e.g., months of data)
    const step = Math.ceil(rows.length / maxPoints);
    const aggregatedPoints: any[] = [];

    for (let i = 0; i < rows.length; i += step) {
      const chunk = rows.slice(i, i + step);
      const rep = chunk[0];

      let sumAas = 0;
      let sumCpu = 0;
      let sumMem = 0;
      let sumIops = 0;
      let sumConn = 0;
      const combinedSlices: Record<string, number> = {};

      for (const item of chunk) {
        sumAas += item.total_aas || 0;
        sumCpu += item.cpu_utilization || 0;
        sumMem += item.memory_free_gb || 0;
        sumIops += item.iops_total || 0;
        sumConn += item.connections || 0;

        try {
          const sl = JSON.parse(item.slices_json);
          for (const [k, v] of Object.entries(sl)) {
            combinedSlices[k] = (combinedSlices[k] || 0) + (Number(v) || 0);
          }
        } catch (e) {}
      }

      const count = chunk.length;
      const avgSlices: Record<string, number> = {};
      for (const [k, v] of Object.entries(combinedSlices)) {
        avgSlices[k] = +(v / count).toFixed(4);
      }

      aggregatedPoints.push({
        timestamp: rep.timestamp,
        totalAAS: +(sumAas / count).toFixed(4),
        slices: avgSlices,
        cpuUtilization: +(sumCpu / count).toFixed(1),
        memoryFreeGB: +(sumMem / count).toFixed(2),
        iopsTotal: Math.round(sumIops / count),
        connections: Math.round(sumConn / count),
      });
    }

    return {
      dataPoints: aggregatedPoints,
      vcpus: latestVcpus,
      totalPoints: rows.length,
    };
  }

  /**
   * Query aggregated top dimensions (Top SQL, Wait Events, Hosts, Users) for a historical window
   */
  public queryHistoricalDimensionKeys(
    instanceId: string,
    startTime: string,
    endTime: string,
    dimensionType: 'db.sql' | 'db.wait_event' | 'db.host' | 'db.user',
    limit = 10
  ): any[] {
    const stmt = this.db.prepare(`
      SELECT 
        d.dimension_id,
        d.dimension_name,
        AVG(d.load_aas) as avg_load,
        COUNT(d.id) as sample_count,
        GROUP_CONCAT(d.wait_breakdown_json) as all_breakdowns,
        s.sql_text
      FROM top_dimensions d
      LEFT JOIN sql_statements s ON d.dimension_id = s.sql_id
      WHERE d.instance_id = ?
        AND d.dimension_type = ?
        AND d.timestamp >= ?
        AND d.timestamp <= ?
      GROUP BY d.dimension_id, d.dimension_name
      ORDER BY avg_load DESC
      LIMIT ?
    `);

    const rows: any[] = stmt.all(instanceId, dimensionType, startTime, endTime, limit);

    return rows.map((r) => {
      // Aggregate wait breakdowns across snapshots
      const aggregatedWait: Record<string, number> = {};
      let totalWaitWeight = 0;

      if (r.all_breakdowns) {
        try {
          const parsedList = JSON.parse('[' + r.all_breakdowns + ']');
          for (const parsed of parsedList) {
            for (const [wType, wVal] of Object.entries(parsed)) {
              const num = Number(wVal) || 0;
              aggregatedWait[wType] = (aggregatedWait[wType] || 0) + num;
              totalWaitWeight += num;
            }
          }
        } catch (e) {}
      }

      const normalizedWait: Record<string, number> = {};
      if (totalWaitWeight > 0) {
        for (const [wType, wVal] of Object.entries(aggregatedWait)) {
          normalizedWait[wType] = Math.round((wVal / totalWaitWeight) * 100);
        }
      }

      return {
        id: r.dimension_id,
        name: r.dimension_name,
        sql: r.sql_text || (dimensionType === 'db.sql' ? r.dimension_name : ''),
        loadAAS: +(Number(r.avg_load) || 0).toFixed(4),
        loadWaitBreakdown: normalizedWait,
        callsPerSec: 0,
        avgLatencyMs: 0,
        rowsPerCall: 0,
        user: 'db_user',
        database: 'db',
        sampleCount: r.sample_count,
      };
    });
  }

  /**
   * Retrieve untruncated SQL text by SQL ID
   */
  public getSqlStatement(sqlId: string): string | null {
    const stmt = this.db.prepare('SELECT sql_text FROM sql_statements WHERE sql_id = ?');
    const row: any = stmt.get(sqlId);
    return row?.sql_text || null;
  }

  /**
   * List all DB instances that have captured snapshots with date ranges
   */
  public listStoredInstances(): StoredInstanceSummary[] {
    const stmt = this.db.prepare(`
      SELECT 
        instance_id,
        resource_id,
        MAX(vcpus) as vcpus,
        COUNT(id) as total_snapshots,
        MIN(timestamp) as earliest_snapshot,
        MAX(timestamp) as latest_snapshot
      FROM snapshots
      GROUP BY instance_id, resource_id
      ORDER BY latest_snapshot DESC
    `);

    const rows: any[] = stmt.all();
    return rows.map((r) => ({
      instanceId: r.instance_id,
      resourceId: r.resource_id,
      vcpus: r.vcpus || 4,
      totalSnapshots: r.total_snapshots,
      earliestSnapshot: r.earliest_snapshot,
      latestSnapshot: r.latest_snapshot,
    }));
  }

  /**
   * Database storage statistics and health
   */
  public getStats(): {
    dbPath: string;
    fileSizeBytes: number;
    fileSizeMB: number;
    totalSnapshots: number;
    totalDimensions: number;
    totalUniqueSqls: number;
    earliestSnapshot: string | null;
    latestSnapshot: string | null;
    lastRunRecord: SnapshotRunRecord | null;
  } {
    let fileSizeBytes = 0;
    try {
      if (fs.existsSync(this.dbPath)) {
        const stat = fs.statSync(this.dbPath);
        fileSizeBytes = stat.size;
      }
    } catch (e) {}

    const snapCountRow: any = this.db.prepare('SELECT COUNT(*) as count FROM snapshots').get();
    const dimCountRow: any = this.db.prepare('SELECT COUNT(*) as count FROM top_dimensions').get();
    const sqlCountRow: any = this.db.prepare('SELECT COUNT(*) as count FROM sql_statements').get();
    const rangeRow: any = this.db.prepare('SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM snapshots').get();
    const lastRunRow: any = this.db.prepare('SELECT * FROM snapshot_runs ORDER BY id DESC LIMIT 1').get();

    return {
      dbPath: this.dbPath,
      fileSizeBytes,
      fileSizeMB: +(fileSizeBytes / (1024 * 1024)).toFixed(2),
      totalSnapshots: snapCountRow?.count || 0,
      totalDimensions: dimCountRow?.count || 0,
      totalUniqueSqls: sqlCountRow?.count || 0,
      earliestSnapshot: rangeRow?.min_ts || null,
      latestSnapshot: rangeRow?.max_ts || null,
      lastRunRecord: lastRunRow ? {
        id: lastRunRow.id,
        runTimestamp: lastRunRow.run_timestamp,
        durationMs: lastRunRow.duration_ms,
        instancesCount: lastRunRow.instances_count,
        status: lastRunRow.status,
        errorMessage: lastRunRow.error_message,
      } : null,
    };
  }

  /**
   * Purge snapshots older than retentionDays (e.g. 90 or 365)
   */
  public purgeOldSnapshots(retentionDays: number): number {
    const cutoffDate = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
    const stmt = this.db.prepare('DELETE FROM snapshots WHERE timestamp < ?');
    const result: any = stmt.run(cutoffDate);
    // VACUUM to reclaim space
    this.db.exec('PRAGMA incremental_vacuum;');
    return result.changes || 0;
  }

  /**
   * Export all data as JSON
   */
  public exportData(instanceId?: string): {
    snapshots: any[];
    dimensions: any[];
    sqlStatements: any[];
    exportedAt: string;
  } {
    let snapQuery = 'SELECT * FROM snapshots';
    let dimQuery = 'SELECT * FROM top_dimensions';
    const params: any[] = [];

    if (instanceId) {
      snapQuery += ' WHERE instance_id = ?';
      dimQuery += ' WHERE instance_id = ?';
      params.push(instanceId);
    }

    const snapshots = this.db.prepare(snapQuery).all(...params);
    const dimensions = this.db.prepare(dimQuery).all(...params);
    const sqlStatements = this.db.prepare('SELECT * FROM sql_statements').all();

    return {
      snapshots,
      dimensions,
      sqlStatements,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Get all onboarded instances with snapshot count & latest snapshot time
   */
  public getOnboardedInstances(): OnboardedInstance[] {
    const stmt = this.db.prepare(`
      SELECT 
        o.instance_id,
        o.resource_id,
        o.engine,
        o.vcpus,
        o.status,
        o.interval_seconds,
        o.retention_days,
        o.notes,
        o.created_at,
        o.updated_at,
        COUNT(s.id) as total_snapshots,
        MAX(s.timestamp) as latest_snapshot
      FROM onboarded_instances o
      LEFT JOIN snapshots s ON o.instance_id = s.instance_id
      GROUP BY o.instance_id
      ORDER BY o.created_at DESC
    `);

    const rows: any[] = stmt.all();
    return rows.map((r) => ({
      instanceId: r.instance_id,
      resourceId: r.resource_id,
      engine: r.engine || 'postgres',
      vcpus: r.vcpus || 4,
      status: r.status as 'active' | 'paused',
      intervalSeconds: r.interval_seconds || 300,
      retentionDays: r.retention_days || 30,
      notes: r.notes || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      totalSnapshots: r.total_snapshots || 0,
      latestSnapshot: r.latest_snapshot || null,
    }));
  }

  /**
   * Onboard an instance to start tracking snapshots
   */
  public onboardInstance(data: {
    instanceId: string;
    resourceId: string;
    engine?: string;
    vcpus?: number;
    intervalSeconds?: number;
    retentionDays?: number;
    notes?: string;
  }): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO onboarded_instances (
        instance_id, resource_id, engine, vcpus, status,
        interval_seconds, retention_days, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id) DO UPDATE SET
        resource_id = excluded.resource_id,
        engine = excluded.engine,
        vcpus = excluded.vcpus,
        status = 'active',
        interval_seconds = excluded.interval_seconds,
        retention_days = excluded.retention_days,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      data.instanceId,
      data.resourceId,
      data.engine || 'postgres',
      data.vcpus || 4,
      data.intervalSeconds || 300,
      data.retentionDays || 30,
      data.notes || '',
      now,
      now
    );
  }

  /**
   * Pause or resume snapshotting for an onboarded instance
   */
  public updateOnboardedStatus(instanceId: string, status: 'active' | 'paused'): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE onboarded_instances
      SET status = ?, updated_at = ?
      WHERE instance_id = ?
    `);
    stmt.run(status, now, instanceId);
  }

  /**
   * Offboard an instance from snapshotting
   */
  public offboardInstance(instanceId: string): void {
    const stmt = this.db.prepare('DELETE FROM onboarded_instances WHERE instance_id = ?');
    stmt.run(instanceId);
  }

  /**
   * Check if an instance is onboarded and active
   */
  public isOnboarded(instanceId: string): boolean {
    const stmt = this.db.prepare('SELECT status FROM onboarded_instances WHERE instance_id = ?');
    const row: any = stmt.get(instanceId);
    return row?.status === 'active';
  }
}

// Singleton instance
export const snapshotStore = new SnapshotStore();
