import React, { useCallback, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';

// Build smooth SVG path from points using cubic bezier
const smoothPath = (points) => {
  if (points.length < 2) return '';
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
  }
  return d;
};

const PALETTE = [
  '#10b981', // emerald
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#ec4899', // pink
  '#3b82f6', // blue
];

const SVGChart = ({ series, height, visibleSeries }) => {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const W = 600;
  const H = height;
  const PAD_X = 4;
  const PAD_Y = 18;

  // Collect all visible data to compute global max
  const activeSeries = series.filter((s) => visibleSeries.has(s.label));
  const allVals = activeSeries.flatMap((s) => s.data.map((d) => Number(d.value || 0)));
  const maxVal = Math.max(1, ...allVals);

  // Compute points for each series (assume all same-length date axis)
  const firstSeries = activeSeries[0];
  const dateCount = firstSeries ? firstSeries.data.length : 0;

  const seriesPoints = activeSeries.map((s) =>
    s.data.map((d, i) => ({
      x: PAD_X + (i / Math.max(1, dateCount - 1)) * (W - PAD_X * 2),
      y: PAD_Y + ((maxVal - Number(d.value || 0)) / maxVal) * (H - PAD_Y * 2),
      raw: Number(d.value || 0),
      date: d.date || '',
    }))
  );

  const gridLines = [0.25, 0.5, 0.75, 1].map(
    (p) => PAD_Y + (1 - p) * (H - PAD_Y * 2)
  );

  const tickIndices =
    dateCount <= 1
      ? [0]
      : [0, 1, 2, 3, 4].map((i) => Math.round((i / 4) * (dateCount - 1)));

  const handleMouseMove = useCallback(
    (e) => {
      if (!svgRef.current || !seriesPoints.length || !seriesPoints[0]?.length) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * W;
      let closest = 0;
      let minDist = Infinity;
      seriesPoints[0].forEach((p, i) => {
        const d = Math.abs(p.x - relX);
        if (d < minDist) { minDist = d; closest = i; }
      });
      setTooltip({ index: closest });
    },
    [seriesPoints]
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const dates =
    firstSeries?.data.map((d) =>
      d.date
        ? new Date(d.date).toLocaleDateString('en-AE', { month: 'short', day: 'numeric' })
        : ''
    ) || [];

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        preserveAspectRatio="none"
      >
        <defs>
          {activeSeries.map((s, si) => {
            const color = s.color || PALETTE[si % PALETTE.length];
            const gradId = `trendchart-grad-${si}-${s.label.replace(/\s+/g, '')}`;
            return (
              <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.30" />
                <stop offset="100%" stopColor={color} stopOpacity="0.00" />
              </linearGradient>
            );
          })}
        </defs>

        {/* Dotted gridlines */}
        {gridLines.map((y, i) => (
          <line
            key={i}
            x1={PAD_X}
            x2={W - PAD_X}
            y1={y}
            y2={y}
            stroke="var(--ex-shell-line)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}

        {/* Area fills + lines per series */}
        {activeSeries.map((s, si) => {
          const pts = seriesPoints[si];
          if (!pts || pts.length < 2) return null;
          const color = s.color || PALETTE[si % PALETTE.length];
          const gradId = `trendchart-grad-${si}-${s.label.replace(/\s+/g, '')}`;
          const linePath = smoothPath(pts);
          const areaPath = `${linePath} L ${pts[pts.length - 1].x},${H - PAD_Y} L ${pts[0].x},${H - PAD_Y} Z`;

          return (
            <g key={s.label}>
              <path d={areaPath} fill={`url(#${gradId})`} />
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* Tooltip vertical line + dots */}
        {tooltip != null && seriesPoints.length > 0 && seriesPoints[0][tooltip.index] && (
          <>
            <line
              x1={seriesPoints[0][tooltip.index].x}
              x2={seriesPoints[0][tooltip.index].x}
              y1={PAD_Y}
              y2={H - PAD_Y}
              stroke="var(--ex-shell-line)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {activeSeries.map((s, si) => {
              const pt = seriesPoints[si]?.[tooltip.index];
              if (!pt) return null;
              const color = s.color || PALETTE[si % PALETTE.length];
              return (
                <circle key={s.label} cx={pt.x} cy={pt.y} r={4} fill={color} />
              );
            })}
          </>
        )}
      </svg>

      {/* Tooltip box */}
      {tooltip != null && seriesPoints.length > 0 && seriesPoints[0][tooltip.index] && (
        <div
          className="pointer-events-none absolute top-2 bg-[color:var(--ex-shell-surface)] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 shadow-xl"
          style={{
            left: `${(seriesPoints[0][tooltip.index].x / W) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-[10px] text-white/40 mb-0.5">
            {seriesPoints[0][tooltip.index].date
              ? new Date(seriesPoints[0][tooltip.index].date).toLocaleDateString('en-AE', {
                  month: 'short',
                  day: 'numeric',
                })
              : ''}
          </p>
          {activeSeries.map((s, si) => {
            const pt = seriesPoints[si]?.[tooltip.index];
            const color = s.color || PALETTE[si % PALETTE.length];
            return (
              <p key={s.label} className="font-semibold tabular-nums" style={{ color }}>
                {s.label}: {pt?.raw?.toLocaleString('en-AE') ?? '—'}
              </p>
            );
          })}
        </div>
      )}

      {/* X-axis date ticks */}
      <div className="flex justify-between mt-1 px-1">
        {tickIndices.map((idx) => (
          <span key={idx} className="text-[10px] text-white/40 tabular-nums">
            {dates[idx] || ''}
          </span>
        ))}
      </div>
    </div>
  );
};

export const TrendChart = ({
  series = [],
  height = 240,
  showLegend = true,
  emptyLabel = 'No activity yet',
}) => {
  const [visibleSeries, setVisibleSeries] = useState(
    () => new Set(series.map((s) => s.label))
  );

  const toggleSeries = (label) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        // Keep at least one visible
        if (next.size > 1) next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const isEmpty =
    !series.length ||
    series.every((s) => s.data.every((d) => !d.value));

  return (
    <div>
      {/* Legend */}
      {showLegend && series.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {series.map((s, si) => {
            const color = s.color || PALETTE[si % PALETTE.length];
            const active = visibleSeries.has(s.label);
            return (
              <button
                key={s.label}
                onClick={() => toggleSeries(s.label)}
                className={`flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 border transition-all duration-150 ${
                  active
                    ? 'bg-white/[0.06] border-white/10 text-white'
                    : 'bg-transparent border-white/[0.04] text-white/30'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: active ? color : 'color-mix(in srgb, var(--ex-shell-text) 15%, transparent)' }}
                />
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-3" style={{ height }}>
          <BarChart3 size={48} className="text-white/20" />
          <p className="text-sm text-white/40">{emptyLabel}</p>
        </div>
      ) : (
        <SVGChart series={series} height={height} visibleSeries={visibleSeries} />
      )}
    </div>
  );
};

export default TrendChart;
