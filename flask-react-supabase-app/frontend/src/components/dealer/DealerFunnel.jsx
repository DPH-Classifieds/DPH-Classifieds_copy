import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3 } from 'lucide-react';
import apiClient from '../../utils/apiClient';

const STEP_COLORS = [
  { from: 'from-emerald-500', to: 'to-emerald-600' },
  { from: 'from-emerald-500', to: 'to-emerald-600' },
  { from: 'from-emerald-500', to: 'to-emerald-600' },
  { from: 'from-emerald-500', to: 'to-emerald-600' },
];

const DealerFunnel = ({ window: windowDays }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get(`/api/dealer/analytics/funnel?window=${windowDays}`)
      .then((r) => { if (active) { setData(r); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message); setLoading(false); } });
    return () => { active = false; };
  }, [windowDays]);

  const steps = data?.steps || [];
  const maxVal = Math.max(1, ...steps.map((s) => s.value));
  const allZero = steps.every((s) => !s.value);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5 h-full"
    >
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-4">
        Conversion funnel
      </p>

      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-12" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-rose-300 text-sm py-4">Failed to load funnel.</div>
      )}

      {!loading && !error && allZero && (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <BarChart3 size={48} className="text-white/20" />
          <p className="text-sm text-white/40">No funnel data yet in this window</p>
        </div>
      )}

      {!loading && !error && !allZero && (
        <div className="space-y-1">
          {steps.map((step, i) => {
            const prev = i > 0 ? steps[i - 1].value : null;
            const conv =
              prev != null && prev > 0
                ? ((step.value / prev) * 100).toFixed(1)
                : null;
            const widthPct = (step.value / maxVal) * 100;
            const color = STEP_COLORS[i] || STEP_COLORS[0];

            return (
              <div key={step.label}>
                {/* Drop-through badge between steps */}
                {conv !== null && (
                  <div className="flex items-center gap-2 py-0.5 pl-1">
                    <div className="w-3 h-px bg-white/[0.08]" />
                    <span className="text-[10px] text-white/30 tabular-nums">↓ {conv}%</span>
                  </div>
                )}

                {/* Step row */}
                <div className="group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-white/60 font-medium">{step.label}</span>
                    <span className="text-xs tabular-nums text-white/60 font-semibold">
                      {step.value.toLocaleString('en-AE')}
                    </span>
                  </div>
                  <div className="h-7 bg-white/[0.04] rounded-lg overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPct}%` }}
                      transition={{ duration: 0.7, delay: 0.2 + i * 0.08, ease: 'easeOut' }}
                      className={`h-full bg-gradient-to-r ${color.from} ${color.to} rounded-lg opacity-80 group-hover:opacity-100 transition-opacity`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};

export default DealerFunnel;
