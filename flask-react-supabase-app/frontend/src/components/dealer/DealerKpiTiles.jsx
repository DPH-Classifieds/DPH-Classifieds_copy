import React, { useEffect, useState } from 'react';
import { motion, useMotionValue, animate } from 'motion/react';
import {
  Layers,
  Eye,
  FileText,
  Phone,
  Target,
  Trophy,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';

// Animated counter that counts up from 0 to target
const AnimatedNumber = ({ value, suffix = '' }) => {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.6,
      ease: 'easeOut',
      onUpdate: (v) => {
        setDisplay(
          suffix === '%'
            ? v.toFixed(1)
            : Math.round(v).toLocaleString('en-AE')
        );
      },
    });
    return controls.stop;
  }, [value, suffix, mv]);

  return (
    <motion.span>
      {display}{suffix}
    </motion.span>
  );
};

const DeltaPill = ({ delta }) => {
  if (delta == null) return null;
  const positive = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border ${
        positive
          ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
          : 'text-rose-300 bg-rose-500/10 border-rose-500/20'
      }`}
    >
      {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {positive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
};

const TILE_CONFIG = [
  { key: 'active_listings',     label: 'Active listings',  Icon: Layers,    suffix: '',  accent: false },
  { key: 'impressions',         label: 'Impressions',      Icon: Eye,       suffix: '',  accent: false },
  { key: 'detail_views',        label: 'Detail views',     Icon: FileText,  suffix: '',  accent: false },
  { key: 'leads',               label: 'Leads',            Icon: Phone,     suffix: '',  accent: false },
  { key: 'lead_conversion_pct', label: 'Lead conv %',      Icon: Target,    suffix: '%', accent: false },
  { key: 'sold_on_platform',    label: 'Sold',             Icon: Trophy,    suffix: '',  accent: true  },
];

const KpiTile = ({ label, value, delta, Icon, suffix, accent, index }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35, delay: index * 0.05, ease: 'easeOut' }}
    className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5 relative overflow-hidden"
  >
    {/* Icon top-right */}
    <div className="absolute top-4 right-4">
      <Icon size={16} className="text-white/30" />
    </div>

    {/* Label */}
    <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3">
      {label}
    </p>

    {/* Value */}
    <p className={`text-3xl font-semibold tabular-nums ${accent ? 'text-emerald-400' : 'text-white'}`}>
      <AnimatedNumber value={value} suffix={suffix} />
    </p>

    {/* Delta */}
    <div className="mt-2 h-5">
      <DeltaPill delta={delta} />
    </div>
  </motion.div>
);

const DealerKpiTiles = ({ window: windowDays }) => {
  const [tiles, setTiles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get(`/api/dealer/analytics/kpis?window=${windowDays}`)
      .then((r) => {
        if (active) {
          setTiles(r.tiles || null);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message || 'Failed to load KPIs');
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [windowDays]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse bg-white/[0.04] rounded-2xl h-32" />
        ))}
      </div>
    );
  }

  if (error || !tiles) {
    return (
      <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-rose-300 text-sm">
        Could not load KPIs — {error || 'unknown error'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {TILE_CONFIG.map(({ key, label, Icon, suffix, accent }, i) => {
        const tile = tiles[key] || {};
        const rawVal = tile.value ?? 0;
        return (
          <KpiTile
            key={key}
            index={i}
            label={label}
            value={rawVal}
            delta={tile.delta_pct ?? null}
            Icon={Icon}
            suffix={suffix}
            accent={accent}
          />
        );
      })}
    </div>
  );
};

export default DealerKpiTiles;
