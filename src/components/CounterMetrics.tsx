import React, { useState } from 'react';
import { MetricDataPoint } from '../types';
import { ChevronDown, ChevronRight, Activity, Cpu, HardDrive, Network, Users } from 'lucide-react';

interface CounterMetricsProps {
  dataPoints: MetricDataPoint[];
}

export const CounterMetrics: React.FC<CounterMetricsProps> = ({ dataPoints }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (dataPoints.length === 0) return null;

  // Find the latest point that has valid counter metrics (sample-and-hold fallback for 1s granularity)
  const latest = [...dataPoints].reverse().find(
    (d) => (d.cpuUtilization > 0 || d.memoryFreeGB > 0 || d.iopsTotal > 0 || d.connections > 0)
  ) || dataPoints[dataPoints.length - 1];

  // Helper to draw mini architectural sparkline with area gradient and endpoint reticle
  const renderSparkline = (values: number[], strokeColor: string, id: string, isPercent = false) => {
    const min = Math.min(...values, 0);
    const max = Math.max(...values, isPercent ? 100 : 1);
    const range = max - min || 1;
    const h = 32;
    const w = 124;

    const coords = values.map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * (w - 8) + 4;
      const y = h - ((v - min) / range) * (h - 8) - 4;
      return { x, y };
    });

    const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaPoints = `${coords[0].x.toFixed(1)},${h} ${points} ${coords[coords.length - 1].x.toFixed(1)},${h}`;
    const lastCoord = coords[coords.length - 1];

    return (
      <svg width={w} height={h} className="overflow-visible shrink-0">
        <defs>
          <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Subtle Baseline Grid */}
        <line
          x1="4"
          y1={h - 4}
          x2={w - 4}
          y2={h - 4}
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeDasharray="2 2"
        />

        {/* Area Gradient */}
        <polygon fill={`url(#spark-${id})`} points={areaPoints} />

        {/* Line Stroke */}
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />

        {/* Endpoint Target Reticle */}
        {lastCoord && (
          <>
            <circle cx={lastCoord.x} cy={lastCoord.y} r="3" fill={strokeColor} />
            <circle cx={lastCoord.x} cy={lastCoord.y} r="5.5" fill="none" stroke={strokeColor} strokeWidth="1" strokeOpacity="0.5" />
          </>
        )}
      </svg>
    );
  };

  const cpuVals = dataPoints.map((d) => d.cpuUtilization);
  const memVals = dataPoints.map((d) => d.memoryFreeGB);
  const iopsVals = dataPoints.map((d) => d.iopsTotal);
  const connVals = dataPoints.map((d) => d.connections);

  return (
    <div className="bg-[#fdfcf9] dark:bg-[#14151a] border-b border-[#e5e1d8] dark:border-zinc-800/80 transition-colors">
      {/* Toggle Bar */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 flex items-center justify-between text-xs font-semibold text-stone-700 dark:text-zinc-300 hover:text-stone-950 dark:hover:text-white hover:bg-stone-100/70 dark:hover:bg-zinc-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? <ChevronDown className="w-4 h-4 text-stone-500 dark:text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-stone-500 dark:text-zinc-400" />}
          <Activity className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          <span className="font-mono tracking-tight">System Counter Metrics (OS & Database)</span>
        </div>

        {/* Quick summary badges */}
        <div className="flex items-center gap-4 text-[11px] font-mono text-stone-500 dark:text-zinc-400">
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            CPU: <span className="text-stone-900 dark:text-zinc-100 font-bold">{latest?.cpuUtilization}%</span>
          </span>
          <span className="flex items-center gap-1" title="Freeable Memory: unallocated RAM plus Linux page cache and buffer memory that can be reclaimed instantly">
            <HardDrive className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            Free RAM: <span className="text-stone-900 dark:text-zinc-100 font-bold">
              {latest?.memoryFreeGB !== undefined
                ? (latest.memoryFreeGB > 0 ? `${latest.memoryFreeGB} GB` : '< 0.05 GB')
                : 'N/A'}
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Network className="w-3 h-3 text-purple-600 dark:text-purple-400" />
            IOPS: <span className="text-stone-900 dark:text-zinc-100 font-bold">{latest?.iopsTotal}</span>
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            Connections: <span className="text-stone-900 dark:text-zinc-100 font-bold">{latest?.connections}</span>
          </span>
        </div>
      </button>

      {/* Expanded Metrics Grid */}
      {isOpen && (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-stone-50/70 dark:bg-[#111215]/60 border-t border-[#e5e1d8] dark:border-zinc-800">
          
          {/* CPU Utilization */}
          <div className="p-3 bg-white dark:bg-[#18191f] rounded-lg border border-stone-200/90 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] text-stone-500 dark:text-zinc-400 uppercase font-semibold font-mono flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                CPU Utilization
              </div>
              <div className="text-lg font-bold font-mono text-stone-900 dark:text-white mt-1">
                {latest?.cpuUtilization}%
              </div>
              <div className="text-[10px] font-mono text-stone-400 dark:text-zinc-500">Max OS load: {Math.max(...cpuVals)}%</div>
            </div>
            {renderSparkline(cpuVals, '#10b981', 'cpu', true)}
          </div>

          {/* Freeable Memory */}
          <div className="p-3 bg-white dark:bg-[#18191f] rounded-lg border border-stone-200/90 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] text-stone-500 dark:text-zinc-400 uppercase font-semibold font-mono flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                Freeable Memory
              </div>
              <div className="text-lg font-bold font-mono text-stone-900 dark:text-white mt-1">
                {latest?.memoryFreeGB} GB
              </div>
              <div className="text-[10px] font-mono text-stone-400 dark:text-zinc-500">Min free: {Math.min(...memVals)} GB</div>
            </div>
            {renderSparkline(memVals, '#3b82f6', 'mem')}
          </div>

          {/* Disk IOPS */}
          <div className="p-3 bg-white dark:bg-[#18191f] rounded-lg border border-stone-200/90 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] text-stone-500 dark:text-zinc-400 uppercase font-semibold font-mono flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                Disk Read/Write IOPS
              </div>
              <div className="text-lg font-bold font-mono text-stone-900 dark:text-white mt-1">
                {latest?.iopsTotal}
              </div>
              <div className="text-[10px] font-mono text-stone-400 dark:text-zinc-500">Peak IOPS: {Math.max(...iopsVals)}</div>
            </div>
            {renderSparkline(iopsVals, '#8b5cf6', 'iops')}
          </div>

          {/* Database Connections */}
          <div className="p-3 bg-white dark:bg-[#18191f] rounded-lg border border-stone-200/90 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <div className="text-[10px] text-stone-500 dark:text-zinc-400 uppercase font-semibold font-mono flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                Active Sessions
              </div>
              <div className="text-lg font-bold font-mono text-stone-900 dark:text-white mt-1">
                {latest?.connections}
              </div>
              <div className="text-[10px] font-mono text-stone-400 dark:text-zinc-500">Max connections: {Math.max(...connVals)}</div>
            </div>
            {renderSparkline(connVals, '#f59e0b', 'conn')}
          </div>

        </div>
      )}
    </div>
  );
};
