import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  MetricDataPoint,
  WAIT_CATEGORY_COLORS,
  categorizeWaitEvent,
} from '../types';
import {
  ZoomIn,
  RotateCcw,
  AlertTriangle,
  BarChart2,
  TrendingUp,
  Maximize2,
  Shield,
  Eye,
  EyeOff,
} from 'lucide-react';

interface AASChartProps {
  dataPoints: MetricDataPoint[];
  vcpus: number;
  periodInSeconds?: number;
  onZoomRange?: (startTime: Date, endTime: Date) => void;
  selectedWaitCategory?: string;
  selectedWaitCategories?: string[];
  onSelectWaitCategory?: (category?: string) => void;
  selectedSqlId?: string;
  selectedSqlIds?: string[];
  selectedHostIds?: string[];
  selectedUserIds?: string[];
  onResetSqlFilter?: () => void;
  onClearFilters?: () => void;
  theme?: 'dark' | 'light';
}

export const AASChart: React.FC<AASChartProps> = ({
  dataPoints,
  vcpus,
  periodInSeconds = 60,
  onZoomRange,
  selectedWaitCategory,
  selectedWaitCategories = [],
  onSelectWaitCategory,
  selectedSqlId,
  selectedSqlIds = [],
  selectedHostIds = [],
  selectedUserIds = [],
  onResetSqlFilter,
  onClearFilters,
  theme = 'dark',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isDark = theme === 'dark';

  const activeWaitCategories = selectedWaitCategories.length > 0
    ? selectedWaitCategories
    : (selectedWaitCategory ? [selectedWaitCategory] : []);

  const activeSqlIds = selectedSqlIds.length > 0
    ? selectedSqlIds
    : (selectedSqlId ? [selectedSqlId] : []);

  // View Controls
  const [chartType, setChartType] = useState<'bars' | 'area'>('bars'); // Default to Bars
  const [showMaxVcpu, setShowMaxVcpu] = useState<boolean>(true);

  // Hover & Brush selection state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushCurrent, setBrushCurrent] = useState<number | null>(null);
  const [isBrushing, setIsBrushing] = useState(false);

  // Group wait slices into standard categories
  const processedData = useMemo(() => {
    return dataPoints.map((dp) => {
      const catTotals: Record<string, number> = {
        CPU: 0,
        IO: 0,
        Lock: 0,
        Concurrency: 0,
        Network: 0,
        Other: 0,
      };

      for (const [waitName, val] of Object.entries(dp.slices)) {
        const cat = categorizeWaitEvent(waitName);
        catTotals[cat] = +(catTotals[cat] + val).toFixed(3);
      }

      const totalAAS = +(Object.values(catTotals).reduce((a, b) => a + b, 0)).toFixed(3);

      return {
        timestamp: dp.timestamp,
        date: new Date(dp.timestamp),
        totalAAS,
        categories: catTotals,
      };
    });
  }, [dataPoints]);

  // Compute max Y axis scale:
  // If showMaxVcpu is ON: clamp to at least vcpus * 1.25
  // If showMaxVcpu is OFF (Auto-fit/Enlarge mode): scale strictly to max(totalAAS) so small loads fill the chart!
  const maxY = useMemo(() => {
    let maxFound = 0;
    for (const d of processedData) {
      if (d.totalAAS > maxFound) maxFound = d.totalAAS;
    }

    if (!showMaxVcpu) {
      // Auto-enlarge to fit small loads (e.g. 0.005 -> 0.006)
      if (maxFound === 0) return 0.01;
      const autoFit = maxFound * 1.35;
      return +(autoFit.toFixed(autoFit < 0.01 ? 4 : autoFit < 0.1 ? 3 : 2));
    }

    // Capacity Mode (clamp with vCPUs)
    const baseline = Math.max(vcpus, maxFound);
    return Math.ceil(baseline * 1.25) || 2;
  }, [processedData, vcpus, showMaxVcpu]);

  // High-performance canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || processedData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    const padding = { top: 28, right: showMaxVcpu ? 95 : 50, bottom: 32, left: 55 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // 1. Drawing Board Paper / Blackboard Background
    const bgPaper = isDark ? '#14151a' : '#ffffff';
    ctx.fillStyle = bgPaper;
    ctx.fillRect(0, 0, width, height);

    // Helpers
    const getX = (i: number) => padding.left + (i / Math.max(processedData.length - 1, 1)) * chartW;
    const getY = (val: number) => padding.top + chartH - (val / maxY) * chartH;

    // 2. Blueprint Vertical Grid Lines
    const vGridCount = Math.min(10, Math.max(4, Math.floor(chartW / 90)));
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(28, 25, 23, 0.04)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= vGridCount; g++) {
      const gx = padding.left + (g / vGridCount) * chartW;
      ctx.beginPath();
      ctx.moveTo(gx, padding.top);
      ctx.lineTo(gx, padding.top + chartH);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Horizontal Y Grid Lines & Ruler Ticks
    const yTicks = 5;
    for (let t = 0; t <= yTicks; t++) {
      const val = (maxY / yTicks) * t;
      const y = getY(val);

      // Major grid line
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(28, 25, 23, 0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      // Minor grid guideline in between
      if (t < yTicks) {
        const midY = getY(val + (maxY / yTicks) * 0.5);
        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(28, 25, 23, 0.03)';
        ctx.beginPath();
        ctx.moveTo(padding.left, midY);
        ctx.lineTo(padding.left + chartW, midY);
        ctx.stroke();
        ctx.restore();
      }

      // Drawing board ruler tick mark
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(28, 25, 23, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left - 4, y);
      ctx.lineTo(padding.left, y);
      ctx.stroke();

      // Y-axis label in JetBrains Mono
      const valLabel = val < 0.01 ? val.toFixed(4) : val < 0.1 ? val.toFixed(3) : val.toFixed(2);
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillStyle = isDark ? '#94a3b8' : '#78716c';
      ctx.textAlign = 'right';
      ctx.fillText(valLabel, padding.left - 8, y + 3);
    }

    // 4. Architectural Coordinate Crosses (+) at major intersections
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(28, 25, 23, 0.12)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= vGridCount; g++) {
      const gx = padding.left + (g / vGridCount) * chartW;
      for (let t = 0; t <= yTicks; t++) {
        const gy = getY((maxY / yTicks) * t);
        ctx.beginPath();
        ctx.moveTo(gx - 2.5, gy);
        ctx.lineTo(gx + 2.5, gy);
        ctx.moveTo(gx, gy - 2.5);
        ctx.lineTo(gx, gy + 2.5);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 5. Time ticks on X-axis (Ruler style)
    const xTicks = Math.min(6, processedData.length);
    ctx.textAlign = 'center';
    const isHighRes = periodInSeconds === 1 || (processedData.length > 1 && (processedData[processedData.length - 1].date.getTime() - processedData[0].date.getTime()) <= 15 * 60 * 1000);

    for (let t = 0; t < xTicks; t++) {
      const idx = Math.floor((t / (xTicks - 1)) * (processedData.length - 1));
      if (processedData[idx]) {
        const x = getX(idx);
        // Ruler tick mark
        ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(28, 25, 23, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, padding.top + chartH);
        ctx.lineTo(x, padding.top + chartH + 4);
        ctx.stroke();

        const timeStr = processedData[idx].date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: isHighRes ? '2-digit' : undefined,
        });
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.fillStyle = isDark ? '#94a3b8' : '#78716c';
        ctx.fillText(timeStr, x, height - 12);
      }
    }

    // Stacked Order: Other -> Network -> Concurrency -> Lock -> I/O -> CPU
    const categoryOrder: (keyof typeof WAIT_CATEGORY_COLORS)[] = [
      'Other',
      'Network',
      'Concurrency',
      'Lock',
      'IO',
      'CPU',
    ];

    if (chartType === 'bars') {
      // ----------------------------------------------------
      // STACKED BARS MODE (Polished Architectural Bars)
      // ----------------------------------------------------
      const count = processedData.length;
      const availablePerBar = chartW / count;
      const barW = Math.max(2, Math.min(24, Math.floor(availablePerBar * 0.75)));

      for (let i = 0; i < count; i++) {
        const centerX = getX(i);
        const barLeft = centerX - barW / 2;
        let currentBottomY = padding.top + chartH;

        // Find which category is the summit (topmost non-zero slice) for rounded top
        let summitCat: string | null = null;
        for (let c = categoryOrder.length - 1; c >= 0; c--) {
          const cat = categoryOrder[c];
          if ((processedData[i].categories[cat] || 0) > 0) {
            summitCat = cat;
            break;
          }
        }

        for (const cat of categoryOrder) {
          const val = processedData[i].categories[cat] || 0;
          if (val <= 0) continue;

          const sliceHeight = Math.max(1, (val / maxY) * chartH);
          const sliceTopY = currentBottomY - sliceHeight;

          const isMuted = activeWaitCategories.length > 0 && !activeWaitCategories.includes(cat);
          const col = WAIT_CATEGORY_COLORS[cat];

          ctx.fillStyle = isMuted ? (isDark ? 'rgba(51, 65, 85, 0.25)' : 'rgba(203, 213, 225, 0.45)') : col.bg;

          // If this is the summit slice of the bar, round the top corners!
          const isSummit = cat === summitCat;
          if (isSummit && sliceHeight > 2 && barW > 3) {
            const r = Math.min(3, barW / 2, sliceHeight);
            ctx.beginPath();
            ctx.moveTo(barLeft, sliceTopY + sliceHeight);
            ctx.lineTo(barLeft, sliceTopY + r);
            ctx.arcTo(barLeft, sliceTopY, barLeft + r, sliceTopY, r);
            ctx.lineTo(barLeft + barW - r, sliceTopY);
            ctx.arcTo(barLeft + barW, sliceTopY, barLeft + barW, sliceTopY + r, r);
            ctx.lineTo(barLeft + barW, sliceTopY + sliceHeight);
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.fillRect(barLeft, sliceTopY, barW, sliceHeight);
          }

          currentBottomY = sliceTopY;
        }

        // Highlight hovered bar with subtle ring
        if (hoverIndex === i) {
          ctx.strokeStyle = isDark ? '#34d399' : '#ea580c';
          ctx.lineWidth = 1.75;
          const totalH = (processedData[i].totalAAS / maxY) * chartH;
          if (totalH > 0) {
            ctx.strokeRect(barLeft - 1, padding.top + chartH - totalH - 1, barW + 2, totalH + 2);
          }
        }
      }
    } else {
      // ----------------------------------------------------
      // STACKED AREA MODE (Architectural Gradient Slices)
      // ----------------------------------------------------
      const currentTops = new Float32Array(processedData.length).fill(0);

      for (const cat of categoryOrder) {
        const isMuted = activeWaitCategories.length > 0 && !activeWaitCategories.includes(cat);
        const col = WAIT_CATEGORY_COLORS[cat];

        ctx.beginPath();
        // Forward path along new top
        for (let i = 0; i < processedData.length; i++) {
          const val = processedData[i].categories[cat] || 0;
          const baseline = currentTops[i];
          const newTop = baseline + val;
          const x = getX(i);
          const y = getY(newTop);

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        // Backward path along previous baseline
        for (let i = processedData.length - 1; i >= 0; i--) {
          const baseline = currentTops[i];
          const x = getX(i);
          const y = getY(baseline);
          ctx.lineTo(x, y);
        }

        ctx.closePath();
        
        // Gradient fill for area
        const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
        grad.addColorStop(0, isMuted ? (isDark ? 'rgba(51, 65, 85, 0.2)' : 'rgba(203, 213, 225, 0.35)') : col.fill);
        grad.addColorStop(1, isMuted ? (isDark ? 'rgba(51, 65, 85, 0.05)' : 'rgba(203, 213, 225, 0.15)') : col.fill.replace(/0\.\d+\)/, '0.28)'));
        ctx.fillStyle = grad;
        ctx.fill();

        // Edge stroke
        ctx.beginPath();
        for (let i = 0; i < processedData.length; i++) {
          const val = processedData[i].categories[cat] || 0;
          const newTop = currentTops[i] + val;
          const x = getX(i);
          const y = getY(newTop);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = isMuted ? (isDark ? 'rgba(100, 116, 139, 0.35)' : 'rgba(148, 163, 184, 0.45)') : col.border;
        ctx.lineWidth = 1.75;
        ctx.stroke();

        // Update baseline
        for (let i = 0; i < processedData.length; i++) {
          currentTops[i] += processedData[i].categories[cat] || 0;
        }
      }
    }

    // 6. Max vCPU Reference Line (Drafting Capacity Threshold)
    if (showMaxVcpu) {
      const vcpuY = getY(vcpus);
      if (vcpuY >= padding.top && vcpuY <= padding.top + chartH) {
        // Red hatched danger zone above vCPU line if load exceeds
        const hasSpike = processedData.some((d) => d.totalAAS > vcpus);
        if (hasSpike) {
          ctx.save();
          ctx.fillStyle = isDark ? 'rgba(244, 63, 94, 0.05)' : 'rgba(239, 68, 68, 0.04)';
          ctx.fillRect(padding.left, padding.top, chartW, vcpuY - padding.top);
          ctx.restore();
        }

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = isDark ? '#fbbf24' : '#d97706';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(padding.left, vcpuY);
        ctx.lineTo(padding.left + chartW, vcpuY);
        ctx.stroke();
        ctx.restore();

        // Architectural drafting badge on right axis
        ctx.save();
        const tagText = `MAX vCPU (${vcpus})`;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        const tagW = ctx.measureText(tagText).width + 12;
        const tagH = 16;
        const tagX = padding.left + chartW + 6;
        const tagY = vcpuY - tagH / 2;

        ctx.fillStyle = isDark ? '#261e0e' : '#fef3c7';
        ctx.strokeStyle = isDark ? '#b45309' : '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const r = 3;
        ctx.moveTo(tagX + r, tagY);
        ctx.lineTo(tagX + tagW - r, tagY);
        ctx.arcTo(tagX + tagW, tagY, tagX + tagW, tagY + r, r);
        ctx.lineTo(tagX + tagW, tagY + tagH - r);
        ctx.arcTo(tagX + tagW, tagY + tagH, tagX + tagW - r, tagY + tagH, r);
        ctx.lineTo(tagX + r, tagY + tagH);
        ctx.arcTo(tagX, tagY + tagH, tagX, tagY + tagH - r, r);
        ctx.lineTo(tagX, tagY + r);
        ctx.arcTo(tagX, tagY, tagX + r, tagY, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDark ? '#fbbf24' : '#b45309';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2);
        ctx.restore();
      }
    }

    // 7. Interactive Drag-to-Brush Box
    if (isBrushing && brushStart !== null && brushCurrent !== null) {
      const x1 = Math.min(brushStart, brushCurrent);
      const x2 = Math.max(brushStart, brushCurrent);
      ctx.fillStyle = isDark ? 'rgba(45, 212, 191, 0.15)' : 'rgba(245, 158, 11, 0.15)';
      ctx.fillRect(x1, padding.top, x2 - x1, chartH);
      ctx.strokeStyle = isDark ? '#2dd4bf' : '#d97706';
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, padding.top, x2 - x1, chartH);
    }

    // 8. Hover Drafting Crosshair & Target Reticle
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < processedData.length) {
      const hoverX = getX(hoverIndex);
      const hoverData = processedData[hoverIndex];
      const hoverY = getY(hoverData.totalAAS);

      ctx.save();
      // Vertical Drafting Hairline
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(28, 25, 23, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, padding.top);
      ctx.lineTo(hoverX, padding.top + chartH);
      ctx.stroke();

      // Horizontal Drafting Hairline to Y-axis
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(28, 25, 23, 0.25)';
      ctx.beginPath();
      ctx.moveTo(padding.left, hoverY);
      ctx.lineTo(hoverX, hoverY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Drafting Target Reticle at (hoverX, hoverY)
      ctx.strokeStyle = isDark ? '#34d399' : '#ea580c';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(hoverX, hoverY, 5.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = isDark ? '#ffffff' : '#1c1917';
      ctx.beginPath();
      ctx.arc(hoverX, hoverY, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Timestamp Pill on X-axis
      const timeStr = hoverData.date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      const pillW = ctx.measureText(timeStr).width + 8;
      const pillX = Math.max(padding.left, Math.min(width - padding.right - pillW, hoverX - pillW / 2));
      const pillY = padding.top + chartH + 3;

      ctx.fillStyle = isDark ? '#1e293b' : '#292524';
      ctx.beginPath();
      const pr = 2;
      ctx.moveTo(pillX + pr, pillY);
      ctx.lineTo(pillX + pillW - pr, pillY);
      ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pr, pr);
      ctx.lineTo(pillX + pillW, pillY + 14 - pr);
      ctx.arcTo(pillX + pillW, pillY + 14, pillX + pillW - pr, pillY + 14, pr);
      ctx.lineTo(pillX + pr, pillY + 14);
      ctx.arcTo(pillX, pillY + 14, pillX, pillY + 14 - pr, pr);
      ctx.lineTo(pillX, pillY + pr);
      ctx.arcTo(pillX, pillY, pillX + pr, pillY, pr);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeStr, pillX + pillW / 2, pillY + 7);

      ctx.restore();
    }
  }, [processedData, maxY, vcpus, hoverIndex, isBrushing, brushStart, brushCurrent, selectedWaitCategory, selectedWaitCategories, activeWaitCategories, chartType, showMaxVcpu, isDark]);

  // Mouse handlers for scrubbing & brush zoom
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || processedData.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padding = { left: 55, right: showMaxVcpu ? 90 : 50 };
    const chartW = rect.width - padding.left - padding.right;

    const relativeX = Math.max(0, Math.min(x - padding.left, chartW));
    const idx = Math.round((relativeX / chartW) * (processedData.length - 1));
    setHoverIndex(idx);

    if (isBrushing) {
      setBrushCurrent(x);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setBrushStart(x);
    setBrushCurrent(x);
    setIsBrushing(true);
  };

  const handleMouseUp = () => {
    if (isBrushing && brushStart !== null && brushCurrent !== null && onZoomRange) {
      const canvas = canvasRef.current;
      if (canvas && Math.abs(brushCurrent - brushStart) > 15) {
        const rect = canvas.getBoundingClientRect();
        const padding = { left: 55, right: showMaxVcpu ? 90 : 50 };
        const chartW = rect.width - padding.left - padding.right;

        const x1 = Math.min(brushStart, brushCurrent);
        const x2 = Math.max(brushStart, brushCurrent);

        const rel1 = Math.max(0, Math.min(x1 - padding.left, chartW));
        const rel2 = Math.max(0, Math.min(x2 - padding.left, chartW));

        const idx1 = Math.floor((rel1 / chartW) * (processedData.length - 1));
        const idx2 = Math.ceil((rel2 / chartW) * (processedData.length - 1));

        if (idx2 > idx1 && processedData[idx1] && processedData[idx2]) {
          onZoomRange(processedData[idx1].date, processedData[idx2].date);
        }
      }
    }
    setIsBrushing(false);
    setBrushStart(null);
    setBrushCurrent(null);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    if (isBrushing) {
      setIsBrushing(false);
      setBrushStart(null);
      setBrushCurrent(null);
    }
  };

  const currentHover = hoverIndex !== null && processedData[hoverIndex] ? processedData[hoverIndex] : null;
  const isOvervCPU = currentHover ? currentHover.totalAAS > vcpus : false;

  return (
    <div className="relative bg-white dark:bg-[#14151a] border border-[#e5e1d8] dark:border-zinc-800/80 rounded-xl p-4 shadow-sm transition-colors" ref={containerRef}>
      
      {/* Chart Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
        
        {/* Title & Scoped Query Indicator */}
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-stone-900 dark:text-white tracking-tight flex items-center gap-2">
                <span>Database Load: Average Active Sessions (AAS)</span>
                <span className="text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-500/10 dark:bg-emerald-500/10 text-amber-800 dark:text-emerald-400 border border-amber-500/25 dark:border-emerald-500/25 font-bold">
                  CANVAS
                </span>
              </h3>
              
              {/* Scoped Indicators */}
              {activeSqlIds.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 text-xs animate-fadeIn">
                  <span className="text-[10px] font-mono">
                    {activeSqlIds.length === 1 ? `SQL: ${activeSqlIds[0].slice(0, 12)}...` : `SQL: ${activeSqlIds.length} queries scoped`}
                  </span>
                  {(onResetSqlFilter || onClearFilters) && (
                    <button
                      type="button"
                      onClick={onResetSqlFilter || onClearFilters}
                      title="Clear SQL filter"
                      className="hover:text-stone-950 dark:hover:text-white p-0.5 rounded text-amber-600 dark:text-amber-400 font-bold leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              {selectedHostIds.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-purple-500/15 text-purple-800 dark:text-purple-300 border border-purple-500/30 text-xs animate-fadeIn">
                  <span className="text-[10px] font-mono">
                    {selectedHostIds.length === 1 ? `Host: ${selectedHostIds[0].slice(0, 12)}...` : `${selectedHostIds.length} hosts scoped`}
                  </span>
                  {onClearFilters && (
                    <button
                      type="button"
                      onClick={onClearFilters}
                      title="Clear host filter"
                      className="hover:text-stone-950 dark:hover:text-white p-0.5 rounded text-purple-600 dark:text-purple-400 font-bold leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              {selectedUserIds.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30 text-xs animate-fadeIn">
                  <span className="text-[10px] font-mono">
                    {selectedUserIds.length === 1 ? `User: ${selectedUserIds[0]}` : `${selectedUserIds.length} users scoped`}
                  </span>
                  {onClearFilters && (
                    <button
                      type="button"
                      onClick={onClearFilters}
                      title="Clear user filter"
                      className="hover:text-stone-950 dark:hover:text-white p-0.5 rounded text-emerald-600 dark:text-emerald-400 font-bold leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              {activeWaitCategories.length > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/15 text-blue-800 dark:text-blue-300 border border-blue-500/30 text-xs animate-fadeIn">
                  <span className="text-[10px] font-mono">
                    Waits: {activeWaitCategories.join(', ')}
                  </span>
                  {onSelectWaitCategory && (
                    <button
                      type="button"
                      onClick={() => onSelectWaitCategory(undefined)}
                      title="Clear wait categories"
                      className="hover:text-stone-950 dark:hover:text-white p-0.5 rounded text-blue-600 dark:text-blue-400 font-bold leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              {!showMaxVcpu && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20 font-semibold">
                  ⚡ Auto-fit scale (Peak: {maxY} AAS)
                </span>
              )}

              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
                periodInSeconds === 1
                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/30 font-semibold'
                  : 'bg-stone-100 dark:bg-zinc-800/80 text-stone-600 dark:text-zinc-400 border-stone-300 dark:border-zinc-700'
              }`}>
                {periodInSeconds === 1 ? '⚡ 1s granularity' : `${periodInSeconds === 60 ? '1m' : periodInSeconds === 300 ? '5m' : '1h'} granularity`}
              </span>
            </div>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400">
              Drag on the timeline to zoom into a micro-incident. Click wait states below to filter queries.
            </p>
          </div>
        </div>

        {/* View Switchers: Bars vs Area & Max vCPU Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          
          {/* Bars vs Area Toggle */}
          <div className="flex items-center bg-stone-100 dark:bg-zinc-800/90 p-0.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs">
            <button
              type="button"
              onClick={() => setChartType('bars')}
              title="Switch to Stacked Bar Chart"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-all ${
                chartType === 'bars'
                  ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Bars</span>
            </button>
            <button
              type="button"
              onClick={() => setChartType('area')}
              title="Switch to Stacked Area Chart"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-all ${
                chartType === 'area'
                  ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Area</span>
            </button>
          </div>

          {/* Max vCPU Line Display & Auto-enlarge Toggle */}
          <button
            type="button"
            onClick={() => setShowMaxVcpu(!showMaxVcpu)}
            title={
              showMaxVcpu
                ? 'Max vCPU line is ON. Click to switch off and auto-enlarge subtle loads to fit canvas.'
                : 'Max vCPU line is OFF (Auto-fit mode). Click to display capacity line.'
            }
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
              showMaxVcpu
                ? 'bg-stone-100 dark:bg-zinc-800 border-amber-500/50 text-amber-800 dark:text-amber-300 font-semibold'
                : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20'
            }`}
          >
            {showMaxVcpu ? (
              <>
                <Shield className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                <span>Max vCPU ({vcpus})</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
                <span>Auto-Fit (Enlarge)</span>
              </>
            )}
          </button>

          {/* Legend Pills (Clickable to cross-filter) */}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            {Object.entries(WAIT_CATEGORY_COLORS).map(([key, col]) => {
              const isSelected = activeWaitCategories.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => onSelectWaitCategory && onSelectWaitCategory(key)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-all ${
                    isSelected
                      ? 'bg-white dark:bg-zinc-800 border-stone-900 dark:border-white text-stone-900 dark:text-white shadow-sm ring-1 ring-stone-900/30 dark:ring-white/50 font-semibold'
                      : 'bg-stone-100/80 dark:bg-zinc-800/60 border-stone-200 dark:border-zinc-700/80 text-stone-700 dark:text-zinc-300 hover:bg-stone-200/80 dark:hover:bg-zinc-800 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: col.bg }} />
                  <span>{col.label}</span>
                </button>
              );
            })}
          </div>

        </div>

      </div>

      {/* Main Canvas */}
      <div className="relative w-full h-64 select-none rounded-lg overflow-hidden border border-stone-200/80 dark:border-zinc-800/80">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          className="w-full h-full cursor-crosshair block"
        />

        {/* Hover Precision Tooltip Card (Drawing Board Technical Pin) */}
        {currentHover && (
          <div className="absolute top-2 right-24 pointer-events-none bg-white/95 dark:bg-[#181920]/95 border border-stone-200 dark:border-zinc-700/80 p-3 rounded-lg shadow-xl shadow-stone-900/10 dark:shadow-2xl backdrop-blur text-xs z-20 min-w-[220px] text-stone-900 dark:text-zinc-100">
            <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-1.5 mb-2">
              <span className="font-mono text-[11px] text-stone-500 dark:text-zinc-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-emerald-400" />
                {currentHover.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span
                className={`font-mono font-bold text-xs px-1.5 py-0.5 rounded ${
                  isOvervCPU ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300' : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {currentHover.totalAAS.toFixed(3)} AAS
              </span>
            </div>

            {/* Headroom / Capacity Mini-Gauge */}
            <div className="text-[10px] mb-2 font-medium">
              {showMaxVcpu ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    {isOvervCPU ? (
                      <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-semibold">
                        <AlertTriangle className="w-3 h-3" />
                        +{(currentHover.totalAAS - vcpus).toFixed(2)} AAS above Max vCPU ({vcpus})
                      </span>
                    ) : (
                      <span className="text-stone-500 dark:text-zinc-400">
                        Headroom: {(vcpus - currentHover.totalAAS).toFixed(2)} AAS ({(((vcpus - currentHover.totalAAS) / vcpus) * 100).toFixed(0)}% free)
                      </span>
                    )}
                  </div>
                  {/* Visual gauge bar */}
                  <div className="w-full h-1.5 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isOvervCPU ? 'bg-rose-500' : currentHover.totalAAS > vcpus * 0.75 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, (currentHover.totalAAS / vcpus) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <span className="text-blue-600 dark:text-blue-300 font-semibold">
                  Load Share: {((currentHover.totalAAS / (maxY || 1)) * 100).toFixed(0)}% of peak scale
                </span>
              )}
            </div>

            <div className="space-y-1.5 pt-1">
              {Object.entries(currentHover.categories)
                .filter(([_, val]) => val > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, val]) => {
                  const col = WAIT_CATEGORY_COLORS[cat];
                  const percentOfTotal = currentHover.totalAAS > 0 ? ((val / currentHover.totalAAS) * 100).toFixed(0) : '0';
                  return (
                    <div key={cat} className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: col.bg }} />
                        <span className="text-stone-700 dark:text-zinc-300 capitalize">{col.label}</span>
                        <span className="text-[10px] text-stone-400 dark:text-zinc-500 font-mono">({percentOfTotal}%)</span>
                      </div>
                      <span className="font-mono text-stone-900 dark:text-zinc-200 font-medium">{val.toFixed(3)}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
