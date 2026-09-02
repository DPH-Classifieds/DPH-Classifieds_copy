import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { BarChart3, Phone, MessageSquare, Eye } from 'lucide-react';
import apiClient from '../../utils/apiClient';

// Build a smooth SVG path from points using cubic bezier
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

const AreaChart = ({ data, accessor, height = 200 }) => {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const vals = data.map((d) => Number(accessor(d) || 0));
  const maxVal = Math.max(1, ...vals);
  const W = 600;
  const H = height;
  const PAD_X = 4;
  const PAD_Y = 18;

  const points = vals.map((v, i) => ({
    x: PAD_X + (i / Math.max(1, data.length - 1)) * (W - PAD_X * 2),
    y: PAD_Y + ((maxVal - v) / maxVal) * (H - PAD_Y * 2),
    raw: v,
    date: data[i]?.date || '',
  }));

  const linePath = smoothPath(points);
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x},${H - PAD_Y} L ${points[0].x},${H - PAD_Y} Z`
    : '';

  // 4 horizontal gridlines
  const gridLines = [0.25, 0.5, 0.75, 1].map((p) =>
    PAD_Y + (1 - p) * (H - PAD_Y * 2)
  );

  // 5 x-axis date ticks evenly spaced
  const tickIndices = data.length <= 1
    ? [0]
    : [0, 1, 2, 3, 4].map((i) => Math.round((i / 4) * (data.length - 1)));

  const handleMouseMove = useCallback(
    (e) => {
      if (!svgRef.current || !points.length) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * W;
      let closest = 0;
      let minDist = Infinity;
      points.forEach((p, i) => {
        const d = Math.abs(p.x - relX);
        if (d < minDist) { minDist = d; closest = i; }
      });
      setTooltip({ index: closest, x: points[closest].x, y: points[closest].y });
    },
    [points]
  );

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  const gradId = 'area-grad-' + Math.random().toString(36).slice(2, 7);

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
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ex-shell-accent)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--ex-shell-accent)" stopOpacity="0.00" />
          </linearGradient>
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

        {/* Area fill */}
        {areaPath && (
          <path d={areaPath} fill={`url(#${gradId})`} />
        )}

        {/* Line */}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--ex-shell-accent)"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Tooltip vertical line */}
        {tooltip && (
          <>
            <line
              x1={tooltip.x}
              x2={tooltip.x}
              y1={PAD_Y}
              y2={H - PAD_Y}
              stroke="var(--ex-shell-line)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={tooltip.x} cy={tooltip.y} r={4} fill="var(--ex-shell-accent)" />
          </>
        )}
      </svg>

      {/* Tooltip box */}
      {tooltip && points[tooltip.index] && (
        <div
          className="pointer-events-none absolute top-2 bg-[color:var(--ex-shell-surface)] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white/80 shadow-xl"
          style={{
            left: `${(tooltip.x / W) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="text-[10px] text-white/40 mb-0.5">{points[tooltip.index].date}</p>
          <p className="font-semibold tabular-nums">{points[tooltip.index].raw.toLocaleString('en-AE')}</p>
        </div>
      )}

      {/* X-axis date ticks */}
      <div className="flex justify-between mt-1 px-1">
        {tickIndices.map((idx) => (
          <span key={idx} className="text-[10px] text-white/30 tabular-nums">
            {data[idx]?.date
              ? new Date(data[idx].date).toLocaleDateString('en-AE', { month: 'short', day: 'numeric' })
              : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

const SourceChip = ({ label, count, total, Icon }) => {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={11} className="text-white/40" />
        <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</span>
        <span className="ml-auto text-[11px] font-semibold tabular-nums text-white/70">{count}</span>
      </div>
      <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

const METRIC_KEYS = [
  { key: 'impressions', label: 'Impressions' },
  { key: 'leads',       label: 'Leads' },
];

const DealerTrends = ({ window: windowDays }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeMetric, setActiveMetric] = useState('impressions');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get(`/api/dealer/analytics/trends?window=${windowDays}`)
      .then((r) => { if (active) { setData(r); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message); setLoading(false); } });
    return () => { active = false; };
  }, [windowDays]);

  const allZero =
    !loading &&
    !error &&
    data &&
    data.daily?.every((d) => !d.impressions && !d.leads);

  const sources = data?.leads_by_source || {};
  const totalLeads = Object.values(sources).reduce((s, v) => s + v, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">
          Activity
        </p>
        <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-full p-1">
          {METRIC_KEYS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveMetric(key)}
              className={`text-xs rounded-full px-3 py-1 transition-colors ${
                activeMetric === key
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart body */}
      {loading && (
        <div className="animate-pulse bg-white/[0.04] rounded-xl h-[200px]" />
      )}

      {error && (
        <div className="text-rose-300 text-sm py-4">Failed to load trends.</div>
      )}

      {!loading && !error && allZero && (
        <div className="flex flex-col items-center justify-center h-[200px] gap-3">
          <BarChart3 size={48} className="text-white/20" />
          <p className="text-sm text-white/40">No activity yet in this window</p>
        </div>
      )}

      {!loading && !error && !allZero && data?.daily && (
        <AreaChart
          data={data.daily}
          accessor={(d) => d[activeMetric] || 0}
          height={200}
        />
      )}

      {/* Leads by source */}
      {!loading && !error && data && (
        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/30 font-medium mb-3">
            Leads by source
          </p>
          <div className="flex gap-4">
            <SourceChip
              label="Call"
              count={sources.call_click || 0}
              total={totalLeads}
              Icon={Phone}
            />
            <SourceChip
              label="WhatsApp"
              count={sources.whatsapp_click || 0}
              total={totalLeads}
              Icon={MessageSquare}
            />
            <SourceChip
              label="VIN reveal"
              count={sources.vin_open || 0}
              total={totalLeads}
              Icon={Eye}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default DealerTrends;
