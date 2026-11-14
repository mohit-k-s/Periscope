// Robust Multi-Tier vCPU Resolver for Amazon RDS, Aurora, and DocumentDB instances
// Covers:
// 1. All modern AWS sizes (nano to 48xlarge) across all families (Graviton, Intel, AMD, High-Mem)
// 2. Legacy instance quirks (T2, M1, M2, M3)
// 3. Aurora Serverless v2 (db.serverless) cluster ACU mapping
// 4. Fallback heuristics

export interface ClusterScalingConfig {
  minCapacity?: number;
  maxCapacity?: number;
}

// Deterministic size multiplier map across AWS EC2 and RDS
const SIZE_VCPU_MAP: Record<string, number> = {
  'nano': 2,
  'micro': 2,
  'small': 2,
  'medium': 2,
  'large': 2,
  'xlarge': 4,
  '2xlarge': 8,
  '3xlarge': 12,
  '4xlarge': 16,
  '6xlarge': 24,
  '8xlarge': 32,
  '9xlarge': 36,
  '12xlarge': 48,
  '16xlarge': 64,
  '18xlarge': 72,
  '24xlarge': 96,
  '32xlarge': 128,
  '48xlarge': 192,
  '56xlarge': 224,
};

// Legacy instance exceptions where vCPU count differs from modern standards
const LEGACY_INSTANCE_EXCEPTIONS: Record<string, number> = {
  // T2 family (older single-core instances)
  'db.t2.nano': 1,
  'db.t2.micro': 1,
  'db.t2.small': 1,
  'db.t2.medium': 2,
  'db.t2.large': 2,
  'db.t2.xlarge': 4,
  'db.t2.2xlarge': 8,

  // Generation 1 & 2 instances
  'db.m1.small': 1,
  'db.m1.medium': 1,
  'db.m1.large': 2,
  'db.m1.xlarge': 4,
  'db.m2.xlarge': 2,
  'db.m2.2xlarge': 4,
  'db.m2.4xlarge': 8,
  'db.m3.medium': 1,
  'db.m3.large': 2,
  'db.m3.xlarge': 4,
  'db.m3.2xlarge': 8,
  'db.cr1.8xlarge': 32,
};

export function getVCPUsForInstance(
  instanceClass?: string,
  clusterScaling?: ClusterScalingConfig
): number {
  if (!instanceClass) return 4;
  const normalized = instanceClass.trim().toLowerCase();

  // 1. Check legacy exceptions first
  if (LEGACY_INSTANCE_EXCEPTIONS[normalized]) {
    return LEGACY_INSTANCE_EXCEPTIONS[normalized];
  }

  // 2. Aurora Serverless v2 handling (db.serverless)
  if (normalized === 'db.serverless' || normalized.includes('serverless')) {
    if (clusterScaling?.maxCapacity && clusterScaling.maxCapacity > 0) {
      // In Aurora Serverless v2, 1 ACU = ~2 GB RAM + ~0.25 to 0.5 vCPUs
      // Performance Insights sets Max vCPU to MaxCapacity * 0.5 (e.g. 8 ACUs -> 4 vCPUs; 16 ACUs -> 8 vCPUs)
      return Math.max(2, Math.round(clusterScaling.maxCapacity * 0.5));
    }
    // Default sensible ceiling for serverless when cluster scaling is unconstrained
    return 4;
  }

  // 3. Extract size suffix from 'db.<family>.<size>' or '<family>.<size>'
  // e.g., 'db.r6g.2xlarge' -> '2xlarge'
  // e.g., 'db.x2iedn.32xlarge' -> '32xlarge'
  // e.g., 'db.m7i-flex.large' -> 'large'
  const parts = normalized.split('.');
  const sizeSuffix = parts.length > 2 ? parts.slice(2).join('.') : parts[parts.length - 1];

  if (SIZE_VCPU_MAP[sizeSuffix]) {
    return SIZE_VCPU_MAP[sizeSuffix];
  }

  // 4. Substring and regex heuristic fallback for exotic sizes (e.g., metal, custom)
  if (sizeSuffix.includes('48xlarge')) return 192;
  if (sizeSuffix.includes('32xlarge')) return 128;
  if (sizeSuffix.includes('24xlarge')) return 96;
  if (sizeSuffix.includes('18xlarge')) return 72;
  if (sizeSuffix.includes('16xlarge')) return 64;
  if (sizeSuffix.includes('12xlarge')) return 48;
  if (sizeSuffix.includes('9xlarge')) return 36;
  if (sizeSuffix.includes('8xlarge')) return 32;
  if (sizeSuffix.includes('6xlarge')) return 24;
  if (sizeSuffix.includes('4xlarge')) return 16;
  if (sizeSuffix.includes('3xlarge')) return 12;
  if (sizeSuffix.includes('2xlarge')) return 8;
  if (sizeSuffix.includes('xlarge')) return 4;
  if (sizeSuffix.includes('large')) return 2;
  if (sizeSuffix.includes('medium')) return 2;
  if (sizeSuffix.includes('small') || sizeSuffix.includes('micro') || sizeSuffix.includes('nano')) return 2;
  if (sizeSuffix.includes('metal')) return 64;

  return 4;
}
