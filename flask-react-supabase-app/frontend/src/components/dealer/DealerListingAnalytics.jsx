import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, useMotionValue, animate } from 'motion/react';
import {
  Eye,
  FileText,
  Phone,
  MessageSquare,
  Fingerprint,
  MousePointerClick,
  Target,
  ChevronLeft,
  ExternalLink,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import DealerListingMarket, { NavTabs } from './DealerListingMarket';

// ── Helpers ───────────────────────────────────────────────────────────────────

const WINDOWS = [
  { value: 7,  label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

const TYPE_PUBLIC_PATH = {
  car:   'cars',
  bike:  'bikes',
  plate: 'plates',
  part:  'car-parts',
};

const TYPE_BADGE = {
  car:  'bg-blue-500/10 text-blue-300 border-blue-500/20',
  bike: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
  plate:'bg-purple-500/10 text-purple-300 border-purple-500/20',
  part: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
};

// ── Animated counter ──────────────────────────────────────────────────────────

const AnimatedNumber = ({ value, suffix = '' }) => {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState('0');
  useEffect(() => {
    const ctrl = animate(mv, value, {
      duration: 0.55,
      ease: 'easeOut',
      onUpdate: (v) => {
        setDisplay(suffix === '%' ? v.toFixed(1) : Math.round(v).toLocaleString('en-AE'));
      },
    });
    return ctrl.stop;
  }, [value, suffix, mv]);
  return <motion.span>{display}{suffix}</motion.span>;
};

// ── Window selector ───────────────────────────────────────────────────────────

const WindowSelector = ({ value, onChange }) => (
  <div className="flex bg-white/[0.04] border border-white/[0.06] rounded-full p-1">
    {WINDOWS.map((w) => (
      <button
        key={w.value}
        onClick={() => onChange(w.value)}
        className={`rounded-full px-3 py-1 text-xs transition-colors ${
          value === w.value ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'
        }`}
      >
        {w.label}
      </button>
    ))}
  </div>
);

// ── KPI tile ─────────────────────────────────────────────────────────────────

const TILE_CONFIG = [
  { key: 'impressions',          label: 'Impressions',         Icon: Eye,              suffix: '' },
  { key: 'detail_views',         label: 'Detail views',        Icon: FileText,         suffix: '' },
  { key: 'call_clicks',          label: 'Call clicks',         Icon: Phone,            suffix: '' },
  { key: 'whatsapp_clicks',      label: 'WhatsApp',            Icon: MessageSquare,    suffix: '' },
  { key: 'vin_reveals',          label: 'VIN reveals',         Icon: Fingerprint,      suffix: '' },
  { key: 'engagement_no_contact',label: 'Engaged, no contact', Icon: MousePointerClick,suffix: '' },
  { key: 'conversion_pct',       label: 'Conversion',          Icon: Target,           suffix: '%' },
];

const KpiTile = ({ label, value, Icon, suffix, index }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay: index * 0.04, ease: 'easeOut' }}
    className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5 relative overflow-hidden"
  >
    <div className="absolute top-4 right-4">
      <Icon size={16} className="text-white/25" />
    </div>
    <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3">{label}</p>
    <p className="text-3xl font-semibold tabular-nums text-white">
      <AnimatedNumber value={value} suffix={suffix} />
    </p>
  </motion.div>
);

// ── SVG multi-series chart ────────────────────────────────────────────────────

const smoothPath = (pts) => {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cx = (prev.x + curr.x) / 2;
    d += ` C ${cx},${prev.y} ${cx},${curr.y} ${curr.x},${curr.y}`;
  }
  return d;
};

const SERIES_CFG = [
  { key: 'impressions',   label: 'Impressions',   color: 'var(--ex-shell-accent)' },
  { key: 'detail_views',  label: 'Detail views',  color: '#3b82f6' },
  { key: 'leads',         label: 'Leads',          color: '#a78bfa' },
];

const MultiSeriesChart = ({ data, activeKeys }) => {
  const svgRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const W = 600;
  const H = 200;
  const PAD_X = 4;
  const PAD_Y = 18;

  const maxVal = Math.max(
    1,
    ...data.flatMap((d) =>
      SERIES_CFG.filter((s) => activeKeys.has(s.key)).map((s) => Number(d[s.key] || 0))
    )
  );

  const getPoints = (key) =>
    data.map((d, i) => ({
      x: PAD_X + (i / Math.max(1, data.length - 1)) * (W - PAD_X * 2),
      y: PAD_Y + ((maxVal - Number(d[key] || 0)) / maxVal) * (H - PAD_Y * 2),
      raw: Number(d[key] || 0),
      date: d.date || '',
    }));

  const gridLines = [0.25, 0.5, 0.75, 1].map((p) => PAD_Y + (1 - p) * (H - PAD_Y * 2));
  const tickIndices =
    data.length <= 1
      ? [0]
      : [0, 1, 2, 3, 4].map((i) => Math.round((i / 4) * (data.length - 1)));

  const handleMouseMove = useCallback(
    (e) => {
      if (!svgRef.current || !data.length) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * W;
      const base = getPoints(SERIES_CFG[0].key);
      let closest = 0;
      let minDist = Infinity;
      base.forEach((p, i) => {
        const d = Math.abs(p.x - relX);
        if (d < minDist) { minDist = d; closest = i; }
      });
      setTooltip({ index: closest, x: base[closest].x });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data]
  );
  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: H }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        preserveAspectRatio="none"
      >
        <defs>
          {SERIES_CFG.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.20" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.00" />
            </linearGradient>
          ))}
        </defs>

        {gridLines.map((y, i) => (
          <line
            key={i}
            x1={PAD_X} x2={W - PAD_X} y1={y} y2={y}
            stroke="var(--ex-shell-line)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}

        {SERIES_CFG.filter((s) => activeKeys.has(s.key)).map((s) => {
          const pts = getPoints(s.key);
          const line = smoothPath(pts);
          const area = pts.length
            ? `${line} L ${pts[pts.length - 1].x},${H - PAD_Y} L ${pts[0].x},${H - PAD_Y} Z`
            : '';
          return (
            <g key={s.key}>
              {area && <path d={area} fill={`url(#grad-${s.key})`} />}
              {line && (
                <path
                  d={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {tooltip &&
                (() => {
                  const p = pts[tooltip.index];
                  return p ? <circle key={`dot-${s.key}`} cx={p.x} cy={p.y} r={3.5} fill={s.color} /> : null;
                })()}
            </g>
          );
        })}

        {tooltip && (
          <line
            x1={tooltip.x} x2={tooltip.x} y1={PAD_Y} y2={H - PAD_Y}
            stroke="var(--ex-shell-line)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
      </svg>

      {tooltip && (
        <div
          className="pointer-events-none absolute top-2 bg-[color:var(--ex-shell-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 shadow-xl z-10"
          style={{ left: `${(tooltip.x / W) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <p className="text-[10px] text-white/40 mb-1">{data[tooltip.index]?.date}</p>
          {SERIES_CFG.filter((s) => activeKeys.has(s.key)).map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
              <span className="text-white/60">{s.label}</span>
              <span className="ml-auto font-semibold tabular-nums">
                {Number(data[tooltip.index]?.[s.key] || 0).toLocaleString('en-AE')}
              </span>
            </div>
          ))}
        </div>
      )}

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

// ── Main component ────────────────────────────────────────────────────────────

const DealerListingAnalytics = () => {
  const { listing_type, listing_id } = useParams();
  const [windowDays, setWindowDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeKeys, setActiveKeys] = useState(new Set(['impressions', 'detail_views', 'leads']));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get(`/api/dealer/listings/${listing_type}/${listing_id}/analytics?window=${windowDays}`)
      .then((r) => { if (active) { setData(r); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message || 'Failed'); setLoading(false); } });
    return () => { active = false; };
  }, [listing_type, listing_id, windowDays]);

  const tiles = data?.tiles || {};
  const series = data?.series || [];

  const isEmpty =
    !loading && !error && tiles.impressions === 0 && tiles.detail_views === 0;

  const publicPath = TYPE_PUBLIC_PATH[listing_type] || listing_type;
  const shortId = String(listing_id).slice(0, 8);

  const toggleKey = (k) =>
    setActiveKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        if (next.size > 1) next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Link
          to="/dealer/listings"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition"
        >
          <ChevronLeft size={14} />
          Back to Inventory
        </Link>
      </motion.div>

      {/* Header card */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.04 }}
        className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${
              TYPE_BADGE[listing_type] || 'bg-white/[0.06] text-white/40 border-white/10'
            }`}
          >
            {listing_type}
          </span>
          <span className="font-mono text-sm text-white/70">#{shortId}</span>
          <a
            href={`/${publicPath}/${listing_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition ml-auto"
          >
            Open public page
            <ExternalLink size={11} />
          </a>
        </div>
      </motion.div>

      {/* Nav tabs + window selector */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <NavTabs listing_type={listing_type} listing_id={listing_id} active="analytics" />
        <WindowSelector value={windowDays} onChange={setWindowDays} />
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-white/[0.04] rounded-2xl h-28" />
            ))}
          </div>
          <div className="animate-pulse bg-white/[0.04] rounded-2xl h-56" />
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-rose-300 text-sm">
          Failed to load analytics — {error}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-16 flex flex-col items-center gap-4">
          <Eye size={48} className="text-white/20" />
          <p className="text-sm text-white/40">This listing hasn't been viewed yet in this window.</p>
        </div>
      )}

      {/* KPI tiles */}
      {!loading && !error && !isEmpty && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
          {TILE_CONFIG.map(({ key, label, Icon, suffix }, i) => (
            <KpiTile
              key={key}
              index={i}
              label={label}
              value={tiles[key] ?? 0}
              Icon={Icon}
              suffix={suffix}
            />
          ))}
        </div>
      )}

      {/* Time-series chart */}
      {!loading && !error && !isEmpty && series.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
        >
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">
              Activity over time
            </p>
            <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-full p-1">
              {SERIES_CFG.map((s) => (
                <button
                  key={s.key}
                  onClick={() => toggleKey(s.key)}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    activeKeys.has(s.key) ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'
                  }`}
                  style={activeKeys.has(s.key) ? { color: s.color } : {}}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <MultiSeriesChart data={series} activeKeys={activeKeys} />
        </motion.div>
      )}

      {/* Inline market section */}
      {!loading && !error && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.22 }}
        >
          <DealerListingMarket listing_type={listing_type} listing_id={listing_id} />
        </motion.div>
      )}
    </div>
  );
};

export default DealerListingAnalytics;
