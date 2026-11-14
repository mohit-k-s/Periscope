// High-fidelity Mock Datasets representing realistic production incidents
// Used when testing, exploring, or running in Demo Mode

export interface WaitStateSlice {
  name: string;
  category: 'cpu' | 'io' | 'lock' | 'concurrency' | 'network' | 'other';
  value: number; // in AAS (Average Active Sessions)
}

export interface MetricDataPoint {
  timestamp: string; // ISO string
  totalAAS: number;
  slices: Record<string, number>; // wait event name -> AAS
  // Counter metrics
  cpuUtilization: number; // percentage (0-100)
  memoryFreeGB: number;   // GB
  iopsTotal: number;      // IOPS
  connections: number;    // active sessions
}

export interface TopSQLItem {
  id: string; // hash/digest
  sql: string;
  loadAAS: number;
  loadWaitBreakdown: Record<string, number>; // category -> percentage
  callsPerSec: number;
  avgLatencyMs: number;
  rowsPerCall: number;
  user: string;
  database: string;
}

export interface MockIncidentPreset {
  id: string;
  name: string;
  description: string;
  dbIdentifier: string;
  engine: string;
  instanceClass: string;
  vcpus: number;
  region: string;
  status: string;
  scenario: 'cpu_spike' | 'row_locks' | 'io_choke';
}

export const MOCK_INCIDENT_PRESETS: MockIncidentPreset[] = [
  {
    id: 'prod-pg-orders-01',
    name: 'Production Orders DB (PostgreSQL 16)',
    description: 'Black Friday Checkout Rush — Unindexed query causes heavy CPU saturation and connection backlog',
    dbIdentifier: 'prod-pg-orders-01',
    engine: 'aurora-postgresql',
    instanceClass: 'db.r6g.2xlarge',
    vcpus: 8,
    region: 'us-east-1',
    status: 'available',
    scenario: 'cpu_spike',
  },
  {
    id: 'prod-pg-inventory-02',
    name: 'Inventory & Warehouses DB (PostgreSQL 15)',
    description: 'Flash Sale Deadlock — Concurrent UPDATE inventory row locks blocking threads across 12 microservices',
    dbIdentifier: 'prod-pg-inventory-02',
    engine: 'postgres',
    instanceClass: 'db.m6i.xlarge',
    vcpus: 4,
    region: 'us-west-2',
    status: 'available',
    scenario: 'row_locks',
  },
  {
    id: 'analytics-mysql-dw',
    name: 'Customer Analytics DB (MySQL 8.0)',
    description: 'ETL Batch Spikiness — EBS volume IOPS exhaustion caused by temp table on-disk sorting',
    dbIdentifier: 'analytics-mysql-dw',
    engine: 'aurora-mysql',
    instanceClass: 'db.r5b.xlarge',
    vcpus: 4,
    region: 'eu-west-1',
    status: 'available',
    scenario: 'io_choke',
  },
];

export const MOCK_SQL_STATEMENTS: Record<string, TopSQLItem[]> = {
  cpu_spike: [
    {
      id: 'sql-a9b2c3d4',
      sql: 'SELECT o.id, o.order_number, o.created_at, SUM(oi.quantity * oi.unit_price) as total\nFROM orders o\nJOIN order_items oi ON o.id = oi.order_id\nWHERE o.tenant_id = $1 AND o.status = $2 AND o.created_at >= NOW() - INTERVAL \'7 days\'\nGROUP BY o.id, o.order_number, o.created_at\nORDER BY o.created_at DESC\nLIMIT 100;',
      loadAAS: 6.84,
      loadWaitBreakdown: { cpu: 80, io: 12, lock: 2, concurrency: 4, other: 2 },
      callsPerSec: 1420.5,
      avgLatencyMs: 4.82,
      rowsPerCall: 98.4,
      user: 'api_orders_service',
      database: 'production_store',
    },
    {
      id: 'sql-e5f6g7h8',
      sql: 'SELECT user_id, email, phone, metadata->>\'loyalty_tier\' as tier\nFROM customers\nWHERE lower(email) = lower($1)\nLIMIT 1;',
      loadAAS: 3.12,
      loadWaitBreakdown: { cpu: 74, io: 17, concurrency: 7, other: 2 },
      callsPerSec: 2850.0,
      avgLatencyMs: 1.09,
      rowsPerCall: 1.0,
      user: 'api_auth_service',
      database: 'production_store',
    },
    {
      id: 'sql-i9j0k1l2',
      sql: 'UPDATE orders\nSET payment_status = $1, updated_at = NOW()\nWHERE id = $2 AND status = \'PENDING\';',
      loadAAS: 1.45,
      loadWaitBreakdown: { cpu: 30, io: 52, lock: 15, other: 3 },
      callsPerSec: 410.2,
      avgLatencyMs: 3.53,
      rowsPerCall: 1.0,
      user: 'payment_processor',
      database: 'production_store',
    },
    {
      id: 'sql-m3n4o5p6',
      sql: 'SELECT p.id, p.sku, p.name, p.price, inv.available_quantity\nFROM products p\nLEFT JOIN inventory inv ON inv.product_id = p.id\nWHERE p.category_id = $1\nORDER BY p.featured_score DESC, p.created_at DESC\nLIMIT 24;',
      loadAAS: 0.92,
      loadWaitBreakdown: { cpu: 45, io: 38, concurrency: 15, other: 2 },
      callsPerSec: 920.0,
      avgLatencyMs: 1.0,
      rowsPerCall: 24.0,
      user: 'catalog_cache',
      database: 'production_store',
    },
    {
      id: 'sql-q7r8s9t0',
      sql: 'INSERT INTO audit_logs (id, actor_id, action, ip_address, timestamp, payload)\nVALUES (gen_random_uuid(), $1, $2, $3, NOW(), $4::jsonb);',
      loadAAS: 0.42,
      loadWaitBreakdown: { io: 68, cpu: 20, network: 10, other: 2 },
      callsPerSec: 3200.0,
      avgLatencyMs: 0.13,
      rowsPerCall: 1.0,
      user: 'audit_daemon',
      database: 'production_store',
    },
  ],

  row_locks: [
    {
      id: 'sql-lock-001',
      sql: 'UPDATE inventory\nSET reserved_quantity = reserved_quantity + $1,\n    available_quantity = available_quantity - $1,\n    version = version + 1\nWHERE sku = $2 AND warehouse_id = $3 AND available_quantity >= $1;',
      loadAAS: 5.75,
      loadWaitBreakdown: { lock: 86, cpu: 8, io: 4, other: 2 },
      callsPerSec: 890.0,
      avgLatencyMs: 28.4,
      rowsPerCall: 1.0,
      user: 'checkout_worker',
      database: 'inventory_db',
    },
    {
      id: 'sql-lock-002',
      sql: 'SELECT * FROM inventory\nWHERE sku = $1 AND warehouse_id = $2\nFOR UPDATE;',
      loadAAS: 2.80,
      loadWaitBreakdown: { lock: 90, cpu: 5, io: 3, other: 2 },
      callsPerSec: 640.0,
      avgLatencyMs: 19.2,
      rowsPerCall: 1.0,
      user: 'order_allocator',
      database: 'inventory_db',
    },
    {
      id: 'sql-lock-003',
      sql: 'INSERT INTO reservation_holds (hold_id, cart_id, sku, quantity, expires_at)\nVALUES ($1, $2, $3, $4, NOW() + INTERVAL \'15 minutes\');',
      loadAAS: 0.65,
      loadWaitBreakdown: { io: 58, cpu: 25, lock: 15, other: 2 },
      callsPerSec: 1100.0,
      avgLatencyMs: 0.59,
      rowsPerCall: 1.0,
      user: 'cart_service',
      database: 'inventory_db',
    },
  ],

  io_choke: [
    {
      id: 'sql-io-001',
      sql: 'SELECT user_id, DATE(created_at) as event_date, COUNT(*) as page_views, SUM(dwell_seconds) as total_time\nFROM analytics_events\nWHERE created_at >= NOW() - INTERVAL \'30 days\'\nGROUP BY user_id, DATE(created_at)\nHAVING COUNT(*) > 10\nORDER BY total_time DESC;',
      loadAAS: 4.80,
      loadWaitBreakdown: { io: 82, cpu: 12, concurrency: 4, other: 2 },
      callsPerSec: 35.0,
      avgLatencyMs: 137.0,
      rowsPerCall: 1250.0,
      user: 'etl_pipeline',
      database: 'analytics_warehouse',
    },
    {
      id: 'sql-io-002',
      sql: 'CREATE TEMPORARY TABLE tmp_session_aggregates AS\nSELECT session_id, ip_hash, user_agent, count(distinct page_url) as unique_pages\nFROM clickstream_staging\nWHERE processed = 0\nGROUP BY session_id, ip_hash, user_agent;',
      loadAAS: 2.30,
      loadWaitBreakdown: { io: 88, cpu: 8, other: 4 },
      callsPerSec: 12.0,
      avgLatencyMs: 191.0,
      rowsPerCall: 5400.0,
      user: 'etl_pipeline',
      database: 'analytics_warehouse',
    },
  ],
};

// Generates time-series data points tailored to the requested start/end time and incident scenario
export function generateMockTimeSeries(
  scenario: 'cpu_spike' | 'row_locks' | 'io_choke',
  startTime: Date,
  endTime: Date,
  vcpus: number,
  selectedSqlId?: string,
  selectedWaitCategory?: string,
  selectedSqlIds?: string[],
  selectedWaitCategories?: string[],
  selectedHostIds?: string[],
  selectedUserIds?: string[],
  periodInSeconds: number = 60
): MetricDataPoint[] {
  const points: MetricDataPoint[] = [];
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const durationMs = Math.max(endMs - startMs, 60000);

  const activeSqlIds = selectedSqlIds && selectedSqlIds.length > 0 ? selectedSqlIds : (selectedSqlId ? [selectedSqlId] : []);
  const activeWaitCategories = selectedWaitCategories && selectedWaitCategories.length > 0
    ? selectedWaitCategories
    : (selectedWaitCategory ? [selectedWaitCategory] : []);
  
  // Decide number of points based on requested granularity
  const idealSteps = Math.floor(durationMs / (Math.max(1, periodInSeconds) * 1000));
  const steps = Math.min(600, Math.max(15, idealSteps));
  const stepMs = durationMs / steps;

  // Midpoint for an incident spike
  const incidentCenterMs = startMs + durationMs * 0.55;
  const incidentWidthMs = durationMs * 0.22;

  for (let i = 0; i <= steps; i++) {
    const currentMs = startMs + i * stepMs;
    const currentIso = new Date(currentMs).toISOString();

    // Gaussian bell curve multiplier for the incident spike
    const dist = (currentMs - incidentCenterMs) / incidentWidthMs;
    const spikeIntensity = Math.exp(-0.5 * dist * dist); // 0 to 1

    let cpu = 0.5;
    let io = 0.3;
    let lock = 0.05;
    let concurrency = 0.1;
    let network = 0.05;
    let other = 0.03;

    // Small jitter
    const jitter = Math.sin(i * 0.8) * 0.2 + (Math.random() * 0.15 - 0.07);

    if (scenario === 'cpu_spike') {
      // Spikes well above Max vCPU (e.g. 8 vCPUs -> reaches 14 AAS)
      cpu = 1.2 + spikeIntensity * (vcpus * 1.5) + jitter;
      io = 0.6 + spikeIntensity * 1.8 + Math.abs(jitter * 0.5);
      lock = 0.1 + spikeIntensity * 0.4;
      concurrency = 0.2 + spikeIntensity * 0.6;
      network = 0.1 + spikeIntensity * 0.3;
      other = 0.04 + spikeIntensity * 0.1;
    } else if (scenario === 'row_locks') {
      // Row lock contention storm (Crimson Red)
      cpu = 0.8 + spikeIntensity * 1.5 + jitter * 0.4;
      lock = 0.2 + spikeIntensity * (vcpus * 1.8) + jitter;
      io = 0.4 + spikeIntensity * 0.8;
      concurrency = 0.2 + spikeIntensity * 0.9;
      network = 0.1;
      other = 0.03 + spikeIntensity * 0.06;
    } else {
      // IO Choke / EBS throttles (Cobalt Blue)
      io = 0.8 + spikeIntensity * (vcpus * 1.6) + jitter;
      cpu = 0.5 + spikeIntensity * 1.2 + jitter * 0.3;
      concurrency = 0.3 + spikeIntensity * 1.0;
      lock = 0.05;
      network = 0.1;
      other = 0.04 + spikeIntensity * 0.08;
    }

    // Ensure non-negative
    cpu = Math.max(0.1, cpu);
    io = Math.max(0.1, io);
    lock = Math.max(0.01, lock);
    concurrency = Math.max(0.05, concurrency);
    network = Math.max(0.02, network);
    other = Math.max(0.01, other);

    // If filtered by specific wait categories (e.g. Lock, CPU, IO, Other)
    if (activeWaitCategories.length > 0) {
      const lowers = activeWaitCategories.map((c) => c.toLowerCase());
      if (!lowers.some((c) => c.includes('cpu'))) cpu = 0;
      if (!lowers.some((c) => c.includes('io'))) io = 0;
      if (!lowers.some((c) => c.includes('lock'))) lock = 0;
      if (!lowers.some((c) => c.includes('concurrency') || c.includes('buffer') || c.includes('lwlock'))) concurrency = 0;
      if (!lowers.some((c) => c.includes('network') || c.includes('client'))) network = 0;
      if (!lowers.some((c) => c.includes('other') || c.includes('activity') || c.includes('vacuum') || c.includes('timeout'))) other = 0;
    }

    // If filtered by specific SQL queries
    if (activeSqlIds.length > 0) {
      // Each query accounts for roughly 30-40% of load
      const factor = Math.min(1.0, activeSqlIds.length * 0.35);
      cpu *= factor;
      io *= factor;
      lock *= factor;
      concurrency *= factor;
      network *= factor;
      other *= factor;
    }

    const totalAAS = +(cpu + io + lock + concurrency + network + other).toFixed(2);

    // Correlated counter metrics
    const cpuUtilization = Math.min(99.5, Math.max(5, (cpu / vcpus) * 90 + Math.random() * 4));
    const memoryFreeGB = Math.max(1.2, 32 - (totalAAS * 1.2) - (spikeIntensity * 6));
    const iopsTotal = Math.round(300 + io * 850 + (spikeIntensity * 2200));
    const connections = Math.round(25 + totalAAS * 8 + (spikeIntensity * 45));

    points.push({
      timestamp: currentIso,
      totalAAS,
      slices: {
        'CPU': +cpu.toFixed(2),
        'IO:DataFileRead': +(io * 0.7).toFixed(2),
        'IO:BufFileRead': +(io * 0.3).toFixed(2),
        'Lock:transaction': +(lock * 0.8).toFixed(2),
        'Lock:tuple': +(lock * 0.2).toFixed(2),
        'Buffer:content': +concurrency.toFixed(2),
        'Client:ClientRead': +network.toFixed(2),
        'Activity:AutoVacuum': +other.toFixed(2),
      },
      cpuUtilization: +cpuUtilization.toFixed(1),
      memoryFreeGB: +memoryFreeGB.toFixed(1),
      iopsTotal,
      connections,
    });
  }

  return points;
}
