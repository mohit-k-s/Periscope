import { TopSQLItem } from '../src/types.ts';
import { snapshotStore, SnapshotStore } from './snapshot-store.ts';

export type AnomalyType =
  | 'IO_CHOKER'          // Runaway sequential DataFileRead / buffer pool thrashing
  | 'CPU_MONOPOLIZER'    // Cartesian product / bad hash join consuming CPU cores
  | 'LOCK_CONVOY'        // Row/relation lock bottleneck serializing transactions
  | 'PLAN_REGRESSION'    // Sudden shift from indexed lookup to sequential scan
  | 'BUFFER_BLOAT';      // External merge sorts dumping to disk (BufFileRead)

export interface QueryAnomaly {
  sqlId: string;
  sqlText: string;
  anomalyType: AnomalyType;
  anomalyTitle: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  toxicityScore: number; // 0 - 100
  loadAAS: number;
  pctOfVcpus: number;
  dominantWaitEvent: string;
  waitBreakdown: Record<string, number>;
  rootCause: string;
  impactAnalysis: string;
  suggestedFix: string;
  suggestedDdl?: string;
  detectedAt: string;
}

export class QueryAnomalyDetector {
  private store: SnapshotStore;

  constructor(store: SnapshotStore = snapshotStore) {
    this.store = store;
  }

  /**
   * Analyze an array of TopSQLItems and contextual instance metrics to flag toxic queries
   */
  public analyzeQueries(
    queries: TopSQLItem[],
    instanceVcpus = 4,
    instanceCpuPercent = 0,
    instanceIops = 0
  ): QueryAnomaly[] {
    const anomalies: QueryAnomaly[] = [];

    for (const q of queries) {
      const wait = q.loadWaitBreakdown || {};
      const ioPct = wait.io || wait.IO || 0;
      const cpuPct = wait.cpu || wait.CPU || 0;
      const lockPct = wait.lock || wait.Lock || 0;
      const concurrencyPct = wait.concurrency || wait.Concurrency || 0;
      const load = q.loadAAS || 0;
      const pctOfVcpus = +((load / Math.max(1, instanceVcpus)) * 100).toFixed(1);
      const sqlUpper = (q.sql || '').toUpperCase();

      // 1. Detect IO_CHOKER (Sequential DataFileRead / Cache Evictor)
      // High IO wait % (> 40%) with substantial AAS load relative to instance capacity
      if (ioPct >= 40 && (load >= 0.8 || pctOfVcpus >= 15)) {
        const isBufFile = sqlUpper.includes('ORDER BY') || sqlUpper.includes('GROUP BY');
        const anomalyType: AnomalyType = isBufFile && ioPct > 65 ? 'BUFFER_BLOAT' : 'IO_CHOKER';
        const title = anomalyType === 'BUFFER_BLOAT'
          ? 'Disk Spilling External Sort (IO:BufFileRead)'
          : 'Sequential Scan IO Choker (IO:DataFileRead)';

        const { tableName, filterColumns } = this.extractQueryHints(q.sql);
        let suggestedDdl: string | undefined = undefined;
        if (tableName && filterColumns.length > 0) {
          suggestedDdl = `CREATE INDEX CONCURRENTLY idx_${tableName}_${filterColumns.slice(0, 3).join('_')} ON ${tableName} (${filterColumns.slice(0, 3).join(', ')});`;
        }

        const toxicityScore = Math.min(100, Math.round(ioPct * 0.5 + pctOfVcpus * 0.8 + (load > instanceVcpus ? 30 : 0)));

        anomalies.push({
          sqlId: q.id,
          sqlText: q.sql,
          anomalyType,
          anomalyTitle: title,
          severity: toxicityScore >= 80 ? 'CRITICAL' : 'HIGH',
          toxicityScore,
          loadAAS: load,
          pctOfVcpus,
          dominantWaitEvent: 'IO:DataFileRead',
          waitBreakdown: wait,
          rootCause: `Executing full table / cold block scans (${ioPct}% IO wait). Query is bypassing cache and reading raw disk pages into shared buffers.`,
          impactAnalysis: `Evicts hot cached pages from database buffer pool. As other concurrent transactions lose cache hits, system-wide I/O queue fills up and active sessions cascade past provisioned vCPUs (${pctOfVcpus}% of instance capacity consumed by this query alone).`,
          suggestedFix: tableName
            ? `Add an index on ${tableName} for columns (${filterColumns.join(', ') || 'WHERE filter'}) to convert this sequential scan into an index scan.`
            : 'Inspect query execution plan with EXPLAIN (ANALYZE, BUFFERS). Add covering indexes or partition large tables.',
          suggestedDdl,
          detectedAt: new Date().toISOString(),
        });
        continue;
      }

      // 2. Detect CPU_MONOPOLIZER (Runaway CPU execution / Cartesian product / Unindexed regex)
      if (cpuPct >= 65 && (load >= 1.2 || pctOfVcpus >= 30)) {
        const toxicityScore = Math.min(100, Math.round(cpuPct * 0.4 + pctOfVcpus * 0.8));
        const { tableName, filterColumns } = this.extractQueryHints(q.sql);

        anomalies.push({
          sqlId: q.id,
          sqlText: q.sql,
          anomalyType: 'CPU_MONOPOLIZER',
          anomalyTitle: 'Runaway vCPU Monopolizer',
          severity: pctOfVcpus >= 50 ? 'CRITICAL' : 'HIGH',
          toxicityScore,
          loadAAS: load,
          pctOfVcpus,
          dominantWaitEvent: 'CPU',
          waitBreakdown: wait,
          rootCause: `Query is consuming ${pctOfVcpus}% of entire database vCPU budget running intensive CPU operations (hash join, in-memory table scan, or nested loop).`,
          impactAnalysis: `Deprives concurrent database connections of CPU cycles. Overall instance CPU utilization is pegged, increasing latency across the entire application API.`,
          suggestedFix: 'Examine join conditions. Verify join keys are indexed. Check for functions or type-casts in WHERE clauses preventing index utilization (e.g., lower(email) or json_extract).',
          detectedAt: new Date().toISOString(),
        });
        continue;
      }

      // 3. Detect LOCK_CONVOY (Transaction Lock Bottleneck / Lock:transaction)
      if (lockPct >= 25 || concurrencyPct >= 35) {
        const toxicityScore = Math.min(100, Math.round((lockPct + concurrencyPct) * 1.1 + pctOfVcpus * 0.5));
        const { tableName } = this.extractQueryHints(q.sql);

        anomalies.push({
          sqlId: q.id,
          sqlText: q.sql,
          anomalyType: 'LOCK_CONVOY',
          anomalyTitle: 'Transaction Lock Convoy / Serialization Blocker',
          severity: lockPct >= 50 ? 'CRITICAL' : 'HIGH',
          toxicityScore,
          loadAAS: load,
          pctOfVcpus,
          dominantWaitEvent: 'Lock:transaction',
          waitBreakdown: wait,
          rootCause: `High lock wait state (${lockPct}% lock wait). Query is blocked waiting for uncommitted row locks or table-level locks held by another transaction.`,
          impactAnalysis: `Serializes parallel client requests into a queue. Connections pile up (Little's Law) and connection pool saturation occurs.`,
          suggestedFix: `Keep transactions minimal and short. Commit immediately after updates. Check foreign key constraints on ${tableName || 'target table'} — missing FK indexes cause parent table locks on DELETE/UPDATE.`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Sort anomalies by toxicity score descending (most dangerous first)
    return anomalies.sort((a, b) => b.toxicityScore - a.toxicityScore);
  }

  /**
   * Helper to parse SQL text and extract target table and filter column names
   */
  private extractQueryHints(sql: string): { tableName?: string; filterColumns: string[] } {
    if (!sql) return { filterColumns: [] };
    const cleaned = sql.replace(/\s+/g, ' ');

    let tableName: string | undefined = undefined;
    const fromMatch = cleaned.match(/\bFROM\s+([a-zA-Z0-9_]+)/i);
    if (fromMatch && fromMatch[1]) {
      tableName = fromMatch[1];
    } else {
      const updateMatch = cleaned.match(/\bUPDATE\s+([a-zA-Z0-9_]+)/i);
      if (updateMatch && updateMatch[1]) tableName = updateMatch[1];
    }

    const filterColumns: string[] = [];
    const whereMatch = cleaned.match(/\bWHERE\s+(.*?)(?:\bGROUP\b|\bORDER\b|\bLIMIT\b|;|$)/i);
    if (whereMatch && whereMatch[1]) {
      const whereClause = whereMatch[1];
      const colMatches = whereClause.matchAll(/(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s*(?:=|<|>|!=|LIKE|IN|IS|BETWEEN)/gi);
      for (const m of colMatches) {
        if (m[1] && !['and', 'or', 'not', 'true', 'false', 'null', 'now'].includes(m[1].toLowerCase())) {
          if (!filterColumns.includes(m[1])) {
            filterColumns.push(m[1]);
          }
        }
      }
    }

    return { tableName, filterColumns };
  }
}

// Singleton anomaly detector
export const anomalyDetector = new QueryAnomalyDetector();
