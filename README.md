<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="public/logo-light.png">
    <img alt="Periscope Logo" src="public/logo-dark.png" width="140" style="border-radius: 18px;">
  </picture>
</p>

<h1 align="center">Periscope</h1>

<p align="center">
  <strong>Sub-second RDS Performance Insights, 5-minute selective snapshot vault & autonomous toxic query detection.</strong>
</p>

<p align="center">
  <a href="#key-features"><img src="https://img.shields.io/badge/AAS_Granularity-1s_Ultra--Res-blue?style=flat-square" alt="1s Granularity"></a>
  <a href="#snapshot-vault--cost-analysis"><img src="https://img.shields.io/badge/AWS_PI_Retention_Savings-99.9%25-emerald?style=flat-square" alt="Savings"></a>
  <a href="#autonomous-toxic-query-radar"><img src="https://img.shields.io/badge/Toxic_Query_Radar-Zero--Downtime_DDL-amber?style=flat-square" alt="Radar"></a>
  <a href="#test-suite"><img src="https://img.shields.io/badge/Tests-73_Passing-brightgreen?style=flat-square" alt="Tests"></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-MIT-purple?style=flat-square" alt="License"></a>
</p>

---

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/demo_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="images/demo_light.png">
    <img alt="Periscope Dashboard Preview" src="images/demo_dark.png" width="100%" style="border-radius: 12px; border: 1px solid #30363d;">
  </picture>
</p>

---

## 🔭 Why Periscope?

AWS RDS Performance Insights is the gold standard for Average Active Sessions (AAS) diagnostics, but in practice, production engineering teams hit four major friction points:

1. **The 7-Day Free Tier Cliff**: Beyond 7 days, AWS mandates continuous retention billing ($0.0125/vCPU/hr) billed across every single provisioned vCPU in the database. A modest 64-vCPU production cluster incurs **~$7,000/year** just to retain performance history.
2. **Estate-Wide Waste**: In AWS, you cannot selectively snapshot only mission-critical databases for long retention—it is all or nothing per instance.
3. **Aggressive Downsampling & Lag**: Standard AWS console charts downsample micro-spikes. When an outage occurs for 45 seconds, the console often rounds it away into 1-minute or 5-minute smoothed averages.
4. **No Actionable Remediation**: AWS shows you that a query is pegging CPU or waiting on `IO:DataFileRead`, but leaves you to diagnose execution plans, temporary file bloat, and index creation.

**Periscope solves this:**
- ⚡ **1-Second Micro-Incident Zoom**: Inspect true real-time spikes without downsampling loss.
- 💾 **Periscope Snapshot Vault**: A lightweight, persistent SQLite background engine that captures 5-minute telemetry intervals, storing years of historical telemetry locally or in your private S3 bucket with **>99% cost reduction**.
- 🛡️ **Autonomous Toxic Query Radar**: Flags IO chokers, row lock deadlocks, and memory buffer bloat with copy-pasteable, zero-downtime remediation DDLs (`CREATE INDEX CONCURRENTLY`).
- 🎨 **Architectural Drawing-Board Aesthetic**: A precision-crafted UI in both Dark and Light modes featuring interactive hover legends, execution latency metrics, and smooth docking transitions.

---

## ✨ Key Features

### 📊 True Average Active Sessions (AAS) & Wait Breakdown
Decomposes database workload across 6 standard dimensions:
- **CPU**: Active computation threads (`CPU`).
- **Disk I/O**: Sequential reads, temp table writes (`IO:DataFileRead`, `IO:BufFileRead`).
- **Lock Contention**: Row-level locks, transaction deadlocks (`Lock:transaction`, `Lock:tuple`).
- **Buffer Concurrency**: Lightweight buffer locks, relation extensions (`Buffer:content`, `LWLock:LockManager`).
- **Client & Network**: Slow clients, synchronous socket reads (`Client:ClientRead`).
- **Other**: Background vacuuming, checkpoint flushes.

### 📈 Console-Aligned Query Metrics
Top SQL table populates metrics matching the native AWS PI engine:
- **Calls/sec**: Frequency of execution across microservices.
- **Rows/sec**: Volume of data scanned and returned.
- **Avg Latency (ms)**: Real-time execution duration per call.
- **Wait Breakdown Bars**: Visual representation of the exact wait event share for each SQL digest.

### 🛡️ Autonomous Toxic Query Radar
Periscope continuously analyzes query performance metrics and flags toxic query archetypes:
| Anomaly Archetype | Root Cause | Impact | Automated Remediation |
|---|---|---|---|
| **IO_CHOKER** | High `IO:DataFileRead` + low call count | Disk thrashing, cache eviction | Zero-downtime composite B-tree index |
| **CPU_MONOPOLIZER** | High AAS CPU load exceeding instance vCPUs | Compute exhaustion, queue backlog | Query rewrite, limit pushdown |
| **LOCK_CONVOY** | Heavy `Lock:transaction` or `Lock:tuple` | Serialized thread queues, 504 gateway timeouts | Explicit isolation calibration & row lock batching |
| **BUFFER_BLOAT** | Spilling to disk temp tables (`IO:BufFileRead`) | Memory pressure, shared buffer churn | `work_mem` adjustment & targeted index ordering |

### 💾 Periscope Snapshot Vault (Time Travel >7 Days)
- Selectively onboard specific databases without estate-wide cost inflation.
- Run the autonomous daemon (`periscope daemon --interval 300`) to record 5-minute delta snapshots.
- Travel back across **14-day, 30-day, or 90-day** historical windows seamlessly.

---

## 💰 Economics: AWS Extended Retention vs Periscope

AWS charges **$0.0125 per vCPU per hour** ($9.125 / vCPU-month) for 2-year retention.

| Monitored Fleet Size | AWS PI 2-Year Retention | Periscope Snapshot Vault | Annual Savings |
|---|---|---|---|
| **Small (16 vCPUs)** | $1,752 / year | **$0.00** (Local) / < $2 (S3) | **> 99.8%** |
| **Medium (64 vCPUs)** | $7,008 / year | **$0.00** (Local) / < $5 (S3) | **> 99.9%** |
| **Large (256 vCPUs)** | $28,032 / year | **$0.00** (Local) / < $12 (S3) | **> 99.9%** |
| **Enterprise (1024 vCPUs)** | $112,128 / year | **$0.00** (Local) / < $35 (S3) | **> 99.9%** |

Calculate your exact fleet savings in one command:
```bash
npx periscope cost --instances 8 --vcpus 64
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v20.0.0 or higher
- **AWS Credentials**: Standard profile configured in `~/.aws/credentials` or IAM environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`).

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/your-org/periscope.git
cd periscope

# Install dependencies
npm install

# Build client and server
npm run build
```

### 3. Launch Periscope
```bash
# Start development mode (Express server on 3001, Vite dev server on 5173)
npm run dev

# Or launch production web service
npm start
```

Visit **`http://localhost:5173`** (or `http://localhost:3001` in production mode).

---

## ⚡ Exploration & Demo Mode

Periscope includes built-in high-fidelity incident presets for development, onboarding tutorials, and testing without requiring live AWS credentials:
- **`prod-pg-orders-01`**: CPU saturation spike during high-concurrency checkout rush.
- **`prod-pg-inventory-02`**: Row-lock contention across concurrent microservices.
- **`analytics-mysql-dw`**: Disk I/O exhaustion caused by unindexed temp-table sorting.

Toggle between **Demo Mode** and **Live AWS** instantly from the header badge or via the **AWS Switch Role & Authentication** modal.

---

## 💻 CLI Reference

Periscope includes a full-featured CLI for CI/CD pipelines, cron jobs, and terminal-first administration:

```bash
periscope <command> [options]
```

| Command | Description | Example |
|---|---|---|
| `run` | Execute a single snapshot cycle across onboarded databases | `npx periscope run` |
| `daemon` | Start the persistent 5-minute recording background loop | `npx periscope daemon --interval 300` |
| `onboard` | Enroll an RDS instance into snapshotting with custom retention | `npx periscope onboard prod-orders-db --retention 30` |
| `offboard` | Remove a database from automated snapshotting | `npx periscope offboard prod-orders-db` |
| `onboarded` | List currently enrolled database targets and their status | `npx periscope onboarded` |
| `list` | Display stored snapshot spans and database sizes | `npx periscope list` |
| `inspect` | View recent snapshots, wait events, and AAS points in terminal | `npx periscope inspect --instance prod-orders-db --hours 24` |
| `anomalies` | Scan stored telemetry for toxic queries and print remediation DDL | `npx periscope anomalies --instance prod-orders-db` |
| `cost` | Compute AWS retention economics and calculate ROI | `npx periscope cost --instances 12 --vcpus 96` |
| `export` | Export snapshot database telemetry to a standalone JSON file | `npx periscope export --instance prod-orders-db --out dump.json` |

---

## 🔐 Minimum IAM Permissions

To run Periscope in live AWS environments with read-only permissions, attach this IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PeriscopeRdsDiscovery",
      "Effect": "Allow",
      "Action": [
        "rds:DescribeDBInstances",
        "rds:ListTagsForResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PeriscopePerformanceInsightsRead",
      "Effect": "Allow",
      "Action": [
        "pi:GetResourceMetrics",
        "pi:DescribeDimensionKeys",
        "pi:GetDimensionKeyDetails",
        "pi:ListAvailableResourceMetrics"
      ],
      "Resource": "arn:aws:pi:*:*:metrics/rds/*"
    }
  ]
}
```

Cross-account role assumptions (`sts:AssumeRole`) are fully supported directly from the UI or CLI with optional External ID verification.

---

## 🧪 Testing & Verification

Periscope has a comprehensive behavioral test suite verifying domain logic, granularity calculation, anomaly detection, SQLite storage transactions, and AWS SDK fallbacks:

```bash
# Run all 73 behavioral tests
npm test

# Production build verification
npm run build
```

---

## 📄 License

MIT License. Designed and built for engineering teams who demand complete visibility into RDS database performance without astronomical cloud retention bills.
