import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand } from '@aws-sdk/client-rds';
import {
  PIClient,
  GetResourceMetricsCommand,
  DescribeDimensionKeysCommand,
  GetDimensionKeyDetailsCommand,
  ListAvailableResourceMetricsCommand,
} from '@aws-sdk/client-pi';
import { fromIni } from '@aws-sdk/credential-providers';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getVCPUsForInstance } from './vcpus.js';

export interface AwsSessionConfig {
  profile?: string;
  region: string;
  roleArn?: string;
  roleSessionName?: string;
  externalId?: string;
  isDemoMode?: boolean;
}

export interface ProfileMetadata {
  name: string;
  region?: string;
  roleArn?: string;
  sourceProfile?: string;
}

// In-memory credential cache for assumed roles
const roleCache = new Map<string, {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}>();

// Parse ~/.aws/credentials and ~/.aws/config to discover profiles and their default regions/roles
export function getLocalAwsProfilesMetadata(): ProfileMetadata[] {
  const profileMap = new Map<string, ProfileMetadata>();
  const homeDir = os.homedir();

  // 1. Parse credentials file
  const credPath = path.join(homeDir, '.aws', 'credentials');
  if (fs.existsSync(credPath)) {
    try {
      const content = fs.readFileSync(credPath, 'utf8');
      const lines = content.split('\n');
      let currentSection = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          currentSection = trimmed.slice(1, -1).trim();
          if (!profileMap.has(currentSection)) {
            profileMap.set(currentSection, { name: currentSection });
          }
        }
      }
    } catch (e) {
      console.warn('Could not read ~/.aws/credentials', e);
    }
  }

  // 2. Parse config file (contains regions and role_arn)
  const configPath = path.join(homeDir, '.aws', 'config');
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const lines = content.split('\n');
      let currentSection = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          const raw = trimmed.slice(1, -1).trim();
          currentSection = raw.replace(/^profile\s+/, '').trim();
          if (!profileMap.has(currentSection)) {
            profileMap.set(currentSection, { name: currentSection });
          }
        } else if (currentSection && trimmed.includes('=')) {
          const [key, ...rest] = trimmed.split('=');
          const k = key.trim().toLowerCase();
          const val = rest.join('=').trim();
          const meta = profileMap.get(currentSection)!;

          if (k === 'region') meta.region = val;
          else if (k === 'role_arn') meta.roleArn = val;
          else if (k === 'source_profile') meta.sourceProfile = val;
        }
      }
    } catch (e) {
      console.warn('Could not read ~/.aws/config', e);
    }
  }

  if (!profileMap.has('default')) {
    profileMap.set('default', { name: 'default' });
  }

  return Array.from(profileMap.values());
}

// Clean and resolve credentials for the target session
export async function getAwsClients(config: AwsSessionConfig) {
  const targetProfile = config.profile || 'default';
  const region = config.region || 'ap-south-1';

  // Ensure process.env.AWS_PROFILE does not bleed across requests
  delete process.env.AWS_PROFILE;

  // Use fromIni with the specific profile
  const baseCredentials = fromIni({ profile: targetProfile });

  let clientCredentials: any = baseCredentials;

  // If a manual AssumeRole ARN is provided (and not already part of the profile's role_arn)
  if (config.roleArn && config.roleArn.startsWith('arn:aws:iam::')) {
    const cacheKey = `${targetProfile}_${config.roleArn}_${config.externalId || ''}`;
    const cached = roleCache.get(cacheKey);

    if (cached && cached.expiration.getTime() - Date.now() > 5 * 60 * 1000) {
      clientCredentials = {
        accessKeyId: cached.accessKeyId,
        secretAccessKey: cached.secretAccessKey,
        sessionToken: cached.sessionToken,
      };
    } else {
      const sts = new STSClient({ region, credentials: baseCredentials });
      const assumeCommand = new AssumeRoleCommand({
        RoleArn: config.roleArn,
        RoleSessionName: config.roleSessionName || 'QuickPI-ConsoleSession',
        ExternalId: config.externalId || undefined,
        DurationSeconds: 3600,
      });

      const roleResponse = await sts.send(assumeCommand);
      if (!roleResponse.Credentials?.AccessKeyId || !roleResponse.Credentials?.SecretAccessKey) {
        throw new Error('Failed to assume role: no credentials returned by AWS STS');
      }

      const creds = {
        accessKeyId: roleResponse.Credentials.AccessKeyId,
        secretAccessKey: roleResponse.Credentials.SecretAccessKey,
        sessionToken: roleResponse.Credentials.SessionToken!,
        expiration: roleResponse.Credentials.Expiration || new Date(Date.now() + 3600000),
      };

      roleCache.set(cacheKey, creds);
      clientCredentials = creds;
    }
  }

  const clientConfig: any = {
    region,
    credentials: clientCredentials,
  };

  const rds = new RDSClient(clientConfig);
  const pi = new PIClient(clientConfig);
  const sts = new STSClient(clientConfig);

  return { rds, pi, sts, region };
}

// Validates session and gets caller identity
export async function testAwsSession(config: AwsSessionConfig) {
  try {
    const { sts } = await getAwsClients(config);
    const callerIdentity = await sts.send(new GetCallerIdentityCommand({}));
    return {
      success: true,
      account: callerIdentity.Account,
      arn: callerIdentity.Arn,
      userId: callerIdentity.UserId,
    };
  } catch (error: any) {
    let msg = error.message || String(error);
    if (msg.includes('security token') || msg.includes('token not valid') || msg.includes('ExpiredToken')) {
      msg = `The security token for profile '${config.profile || 'default'}' is invalid or expired. If using AWS SSO or temporary credentials, run 'aws sso login' or refresh your credentials.`;
    }
    return {
      success: false,
      error: msg,
    };
  }
}

// Fetch RDS and Aurora instances in the target region/account
export async function listRdsInstances(config: AwsSessionConfig) {
  const { rds } = await getAwsClients(config);
  
  const [instancesRes, clustersRes] = await Promise.all([
    rds.send(new DescribeDBInstancesCommand({})),
    rds.send(new DescribeDBClustersCommand({})).catch(() => ({ DBClusters: [] })),
  ]);

  const clusterMap = new Map<string, any>();
  if (clustersRes.DBClusters) {
    for (const cl of clustersRes.DBClusters) {
      if (cl.DBClusterIdentifier) clusterMap.set(cl.DBClusterIdentifier, cl);
    }
  }

  const instances = (instancesRes.DBInstances || []).map((db) => {
    const cluster = db.DBClusterIdentifier ? clusterMap.get(db.DBClusterIdentifier) : undefined;
    const scaling = cluster?.ServerlessV2ScalingConfiguration ? {
      minCapacity: cluster.ServerlessV2ScalingConfiguration.MinCapacity,
      maxCapacity: cluster.ServerlessV2ScalingConfiguration.MaxCapacity,
    } : undefined;

    const vcpus = getVCPUsForInstance(db.DBInstanceClass, scaling);
    return {
      id: db.DBInstanceIdentifier!,
      dbiResourceId: db.DbiResourceId,
      engine: db.Engine || 'postgres',
      engineVersion: db.EngineVersion || '',
      instanceClass: db.DBInstanceClass || 'db.t3.medium',
      vcpus,
      status: db.DBInstanceStatus || 'unknown',
      endpoint: db.Endpoint?.Address || '',
      port: db.Endpoint?.Port,
      performanceInsightsEnabled: !!db.PerformanceInsightsEnabled,
      retentionDays: db.PerformanceInsightsRetentionPeriod || 7,
      clusterIdentifier: db.DBClusterIdentifier,
      serverlessScaling: scaling,
    };
  });

  return instances;
}

// In-memory cache for available metrics per resource
const resourceMetricsCache = new Map<string, Set<string>>();

export async function getSupportedMetricsForResource(
  pi: PIClient,
  piIdentifier: string
): Promise<Set<string>> {
  if (resourceMetricsCache.has(piIdentifier)) {
    return resourceMetricsCache.get(piIdentifier)!;
  }

  const supported = new Set<string>();
  try {
    const res = await pi.send(
      new ListAvailableResourceMetricsCommand({
        ServiceType: 'RDS',
        Identifier: piIdentifier,
        MetricTypes: ['os', 'db'],
      })
    );

    if (res.Metrics) {
      for (const m of res.Metrics) {
        if (m.Metric) {
          supported.add(m.Metric);
          // Also index with .avg suffix and stripped base so both formats match seamlessly
          if (!m.Metric.endsWith('.avg')) {
            supported.add(`${m.Metric}.avg`);
          } else {
            supported.add(m.Metric.replace(/\.avg$/, ''));
          }
        }
      }
    }
    if (supported.size > 0) {
      resourceMetricsCache.set(piIdentifier, supported);
    }
  } catch (err: any) {
    console.warn(`[QuickPI] Note: Could not call ListAvailableResourceMetrics for ${piIdentifier} (${err.message}). Using safe baseline.`);
  }

  return supported;
}

// Adaptive Granularity Engine
// AWS PI supports periodInSeconds: 1, 60, 300, 3600, 86400
export function resolveAdaptiveGranularity(durationSec: number, requestedPeriod?: number): number {
  const validPeriods = [1, 60, 300, 3600, 86400];
  const req = Number(requestedPeriod);
  if (validPeriods.includes(req)) return req;

  if (durationSec <= 600) return 1;          // <= 10m -> 1-second granularity
  if (durationSec <= 6 * 3600) return 60;     // <= 6h -> 1-minute granularity
  if (durationSec <= 48 * 3600) return 300;   // <= 48h -> 5-minute granularity
  if (durationSec <= 30 * 86400) return 3600; // <= 30d -> 1-hour granularity
  return 86400;                               // > 30d (e.g. 90d) -> 1-day granularity
}

export function buildSafeCounterMetricQueries(supportedSet: Set<string>): Array<{ Metric: string }> {
  // If we successfully discovered the supported metrics from AWS, only query ones that actually exist!
  if (supportedSet.size > 0) {
    const desired = [
      'os.general.numVCPUs.avg',
      'os.cpuUtilization.total.avg',
      'os.memory.free.avg',
      'os.memory.cached.avg',
      'os.memory.buffers.avg',
      'os.memory.total.avg',
      'os.diskIO.rdsdev.readIOsPS.avg',
      'os.diskIO.rdsdev.writeIOsPS.avg',
      'os.diskIO.filesystem.readIOsPS.avg',
      'os.diskIO.filesystem.writeIOsPS.avg',
      'db.User.numbackends.avg',
      'db.Connections.Threads_connected.avg',
    ];

    const matchingQueries: Array<{ Metric: string }> = [];
    for (const m of desired) {
      const base = m.replace(/\.(avg|min|max|sum)$/, '');
      if (supportedSet.has(m) || supportedSet.has(base)) {
        matchingQueries.push({ Metric: m });
      }
    }

    // Look for any diskIO metric if standard rdsdev isn't present (e.g. Aurora or non-standard EBS devices)
    if (!matchingQueries.some((q) => q.Metric.includes('readIOsPS'))) {
      for (const m of supportedSet) {
        if (m.startsWith('os.diskIO.') && (m.includes('readIOsPS') || m.includes('writeIOsPS'))) {
          const withAvg = m.endsWith('.avg') ? m : `${m}.avg`;
          if (!matchingQueries.some((q) => q.Metric === withAvg)) {
            matchingQueries.push({ Metric: withAvg });
          }
        }
      }
    }

    if (matchingQueries.length > 0) {
      return matchingQueries;
    }
  }

  // Safe fallback if ListAvailableResourceMetrics was not available:
  // Query universal baseline metrics that exist across all RDS engines
  return [
    { Metric: 'os.general.numVCPUs.avg' },
    { Metric: 'os.cpuUtilization.total.avg' },
    { Metric: 'os.memory.free.avg' },
    { Metric: 'os.memory.cached.avg' },
    { Metric: 'os.memory.buffers.avg' },
  ];
}
