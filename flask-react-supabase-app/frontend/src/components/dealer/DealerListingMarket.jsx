import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Compass, ChevronLeft } from 'lucide-react';
import apiClient from '../../utils/apiClient';

// ── Band visualisation ────────────────────────────────────────────────────────

const PriceBand = ({ p25, median, p75 }) => {
  // Compute display range: widen by 15% each side
  const bandMin = p25 * 0.85;
  const bandMax = p75 * 1.15;
  const range = bandMax - bandMin || 1;

  const pct = (v) => `${Math.max(0, Math.min(100, ((v - bandMin) / range) * 100)).toFixed(1)}%`;

  const p25Pct   = ((p25    - bandMin) / range) * 100;
  const p75Pct   = ((p75    - bandMin) / range) * 100;
  const bandW    = p75Pct - p25Pct;

  return (
    <div className="relative h-6 rounded-full bg-white/[0.04] overflow-visible mt-4 mb-6">
      {/* Fair band fill */}
      <div
        className="absolute top-0 h-full bg-emerald-500/20 border-x border-emerald-500/40 rounded-full"
        style={{ left: `${p25Pct}%`, width: `${bandW}%` }}
      />
      {/* Median line */}
      <div
        className="absolute top-0 h-full w-0.5 bg-emerald-400"
        style={{ left: pct(median) }}
      />
      {/* Labels */}
      <div
        className="absolute -bottom-5 text-[10px] text-white/40 tabular-nums -translate-x-1/2"
        style={{ left: pct(p25) }}
      >
        {Number(p25).toLocaleString('en-AE')}
      </div>
      <div
        className="absolute -bottom-5 text-[10px] text-emerald-400 font-medium tabular-nums -translate-x-1/2"
        style={{ left: pct(median) }}
      >
        {Number(median).toLocaleString('en-AE')}
      </div>
      <div
        className="absolute -bottom-5 text-[10px] text-white/40 tabular-nums -translate-x-1/2"
        style={{ left: pct(p75) }}
      >
        {Number(p75).toLocaleString('en-AE')}
      </div>
    </div>
  );
};

// ── Stat mini-tile ────────────────────────────────────────────────────────────

const StatMini = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] uppercase tracking-[0.12em] text-white/30 font-medium">{label}</span>
    <span className="text-sm font-semibold tabular-nums text-white/80">{value}</span>
  </div>
);

// ── Inner content (shared between section + route mode) ───────────────────────

const MarketContent = ({ listing_type, listing_id }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!listing_type || !listing_id) return;
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get(`/api/dealer/listings/${listing_type}/${listing_id}/market`)
      .then((r) => { if (active) { setData(r); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message || 'Failed'); setLoading(false); } });
    return () => { active = false; };
  }, [listing_type, listing_id]);

  if (loading) {
    return (
      <div className="space-y-3 p-1">
        <div className="animate-pulse bg-white/[0.04] rounded-xl h-16" />
        <div className="animate-pulse bg-white/[0.04] rounded-xl h-8 w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-rose-300 text-sm py-2">Failed to load market data — {error}</div>
    );
  }

  if (!data) return null;

  const s = data.snapshot;

  if (!s) {
    const need = 5;
    const found = data.comp_count ?? 0;
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Compass size={36} className="text-white/20" />
        <p className="text-sm text-white/50">
          Not enough comparable listings yet ({found} found, need ≥{need})
        </p>
        <p className="text-[11px] text-white/30 max-w-xs">
          Market position will appear once more similar listings are available in the same
          make, model, year range, and emirate.
        </p>
      </div>
    );
  }

  const percentilePct = Math.round((s.percentile_rank ?? 0) * 100);

  return (
    <div className="space-y-5">
      {/* Big number */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-1">
          Price position
        </p>
        <p className="text-2xl font-semibold text-white">
          Priced higher than{' '}
          <span className="text-emerald-400">{percentilePct}%</span> of comps
        </p>
      </div>

      {/* Band */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/30 font-medium mb-1">
          Fair price band (AED)
        </p>
        <PriceBand
          p25={s.p25_price}
          median={s.median_price}
          p75={s.p75_price}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-2 border-t border-white/[0.06]">
        <StatMini label="Median" value={`AED ${Number(s.median_price).toLocaleString('en-AE')}`} />
        <StatMini label="P25" value={`AED ${Number(s.p25_price).toLocaleString('en-AE')}`} />
        <StatMini label="P75" value={`AED ${Number(s.p75_price).toLocaleString('en-AE')}`} />
        <StatMini label="Comp count" value={s.comp_count ?? '—'} />
        <StatMini
          label="Median DOM"
          value={s.median_days_on_market != null ? `${s.median_days_on_market}d` : '—'}
        />
      </div>
    </div>
  );
};

// ── Route-mode wrapper ────────────────────────────────────────────────────────

const DealerListingMarketRoute = () => {
  const { listing_type, listing_id } = useParams();
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
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition mb-1"
        >
          <ChevronLeft size={14} />
          Back to Inventory
        </Link>
      </motion.div>

      {/* Nav tabs */}
      <NavTabs listing_type={listing_type} listing_id={listing_id} active="market" />

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
      >
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-4">
          Market position
        </p>
        <MarketContent listing_type={listing_type} listing_id={listing_id} />
      </motion.div>
    </div>
  );
};

// ── Tab nav (shared with Analytics / Diagnostic) ──────────────────────────────

export const NavTabs = ({ listing_type, listing_id, active }) => {
  const tabs = [
    { key: 'analytics',  label: 'Analytics',        path: 'analytics' },
    { key: 'diagnostic', label: 'Diagnostic',        path: 'diagnostic' },
    { key: 'market',     label: 'Market position',   path: 'market' },
  ];
  return (
    <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-full p-1 self-start">
      {tabs.map((t) => (
        <Link
          key={t.key}
          to={`/dealer/listings/${listing_type}/${listing_id}/${t.path}`}
          className={`rounded-full px-4 py-1.5 text-xs transition-colors ${
            active === t.key
              ? 'bg-white/10 text-white'
              : 'text-white/50 hover:text-white'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
};

// ── Section-mode (used inline by Analytics page) ─────────────────────────────

const DealerListingMarket = ({ listing_type, listing_id }) => {
  // If called without props but inside a route, fall back to useParams
  const params = useParams();
  const lt = listing_type || params.listing_type;
  const lid = listing_id || params.listing_id;

  // Section mode: no breadcrumb, no tabs — just the card content
  if (listing_type && listing_id) {
    return (
      <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-4">
          Market position
        </p>
        <MarketContent listing_type={lt} listing_id={lid} />
      </div>
    );
  }

  // Route mode
  return <DealerListingMarketRoute />;
};

export default DealerListingMarket;
