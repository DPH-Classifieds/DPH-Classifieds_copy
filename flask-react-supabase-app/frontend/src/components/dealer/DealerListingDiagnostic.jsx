import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, Trophy } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { NavTabs } from './DealerListingMarket';

// ── Verdict config ────────────────────────────────────────────────────────────

const VERDICT_CFG = {
  not_enough_data: {
    label: 'Not enough data yet',
    desc: 'Listing needs more time to gather impressions.',
    stripe: 'bg-slate-500',
    glow: 'border-slate-500/30 bg-slate-500/5',
    text: 'text-slate-300',
  },
  underperforming_visibility: {
    label: 'Underperforming on visibility',
    desc: "Buyers aren't seeing this listing in search results.",
    stripe: 'bg-rose-500',
    glow: 'border-rose-500/30 bg-rose-500/5',
    text: 'text-rose-300',
  },
  visibility_ok_not_converting: {
    label: 'Visibility OK, not converting',
    desc: 'Buyers are clicking but not contacting.',
    stripe: 'bg-orange-500',
    glow: 'border-orange-500/30 bg-orange-500/5',
    text: 'text-orange-300',
  },
  performing_par: {
    label: 'Performing at par with the market',
    desc: 'On track. Small tweaks could push this into top tier.',
    stripe: 'bg-cyan-500',
    glow: 'border-cyan-500/30 bg-cyan-500/5',
    text: 'text-cyan-300',
  },
  top_performer: {
    label: 'Top performer',
    desc: 'Outperforming similar listings on every metric.',
    stripe: 'bg-emerald-500',
    glow: 'border-emerald-500/30 bg-emerald-500/5',
    text: 'text-emerald-300',
  },
};

const severityColor = (sev) => {
  if (sev >= 0.7) return 'bg-red-500';
  if (sev >= 0.4) return 'bg-orange-500';
  return 'bg-yellow-500';
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

const Skeleton = () => (
  <div className="space-y-4">
    <div className="animate-pulse bg-white/[0.04] rounded-2xl h-28" />
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-20" />
      ))}
    </div>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const DealerListingDiagnostic = () => {
  const { listing_type, listing_id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get(`/api/dealer/listings/${listing_type}/${listing_id}/diagnostic`)
      .then((r) => { if (active) { setData(r); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message || 'Failed'); setLoading(false); } });
    return () => { active = false; };
  }, [listing_type, listing_id]);

  const v = VERDICT_CFG[data?.verdict] || VERDICT_CFG.not_enough_data;
  const findings = data?.findings || [];
  const meta = data?.cohort_meta;

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

      {/* Page title */}
      <motion.h1
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.03 }}
        className="text-3xl font-semibold text-white"
      >
        Why isn't this listing selling?
      </motion.h1>

      {/* Nav tabs */}
      <NavTabs listing_type={listing_type} listing_id={listing_id} active="diagnostic" />

      {loading && <Skeleton />}

      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-rose-300 text-sm">
          Failed to load diagnostic — {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Verdict card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.06 }}
            className={`relative overflow-hidden border rounded-2xl shadow-2xl shadow-black/20 p-5 ${v.glow}`}
          >
            {/* Left stripe */}
            <div className={`absolute left-0 top-0 h-full w-1.5 ${v.stripe}`} />
            <div className="pl-4">
              <p className={`text-xl font-semibold mb-1 ${v.text}`}>{v.label}</p>
              <p className="text-sm text-white/50">{v.desc}</p>
            </div>
          </motion.div>

          {/* Findings */}
          {findings.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-8 flex flex-col items-center gap-4"
            >
              <Trophy size={40} className="text-emerald-400" />
              <p className="text-sm text-emerald-300 font-medium text-center">
                No issues detected. Keep doing what you're doing.
              </p>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {findings.map((f, idx) => (
                <motion.div
                  key={f.code}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.1 + idx * 0.06 }}
                  className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
                >
                  <div className="flex items-start gap-3">
                    {/* Severity dot */}
                    <div
                      className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${severityColor(f.severity)}`}
                    />
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Number + problem */}
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] tabular-nums font-semibold text-white/20 flex-shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <p className="text-sm font-semibold text-white/85">{f.problem}</p>
                      </div>
                      {/* Evidence */}
                      {f.evidence && (
                        <p className="text-xs text-white/50 italic pl-5">{f.evidence}</p>
                      )}
                      {/* Action */}
                      {f.action && (
                        <div className="ml-5 mt-2 bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-3 py-2">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-emerald-500/60 font-medium mb-0.5">
                            Suggested action
                          </p>
                          <p className="text-xs text-emerald-300/80">{f.action}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Cohort footer */}
          {meta && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.3 }}
              className="text-[11px] text-white/25 text-center"
            >
              Compared against {meta.comp_count} similar listings · Median AED{' '}
              {Number(meta.median_price).toLocaleString('en-AE')} · Fair band AED{' '}
              {Number(meta.p25_price).toLocaleString('en-AE')}–
              {Number(meta.p75_price).toLocaleString('en-AE')}
            </motion.p>
          )}
        </>
      )}
    </div>
  );
};

export default DealerListingDiagnostic;
