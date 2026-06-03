import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Trophy, Car, AlertTriangle } from 'lucide-react';
import apiClient from '../../utils/apiClient';

const LISTING_TYPE_LABELS = {
  car: 'Car',
  bike: 'Bike',
  plate: 'Plate',
  part: 'Part',
};

const PerformerRow = ({ row, link, valueDisplay }) => (
  <Link
    to={link(row)}
    className="flex items-center gap-3 py-2.5 px-3 -mx-3 rounded-xl hover:bg-white/[0.04] transition-colors group"
  >
    <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
      <Car size={13} className="text-white/30" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-medium text-white/70 group-hover:text-white transition-colors truncate">
        {LISTING_TYPE_LABELS[row.listing_type] || row.listing_type}
        <span className="text-white/30 ml-1.5 font-mono text-[10px]">
          #{String(row.listing_id).slice(0, 8)}
        </span>
      </p>
    </div>
    <span className="text-xs tabular-nums font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 flex-shrink-0">
      {valueDisplay(row)}
    </span>
  </Link>
);

const SectionCard = ({
  title,
  rows,
  valueDisplay,
  link,
  emptyIcon: EmptyIcon = Trophy,
  index = 0,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay: 0.2 + index * 0.06 }}
    className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
  >
    <div className="flex items-center gap-2 mb-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium flex-1">
        {title}
      </p>
      {rows && rows.length > 0 && (
        <span className="text-[10px] font-semibold text-white/30 bg-white/[0.06] rounded-full px-1.5 py-0.5">
          {rows.length}
        </span>
      )}
    </div>

    {!rows && (
      <div className="space-y-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse bg-white/[0.04] rounded-lg h-10" />
        ))}
      </div>
    )}

    {rows && rows.length === 0 && (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <EmptyIcon size={32} className="text-white/20" />
        <p className="text-xs text-white/30 text-center">
          No listings have data yet in this window.
        </p>
      </div>
    )}

    {rows && rows.length > 0 && (
      <div className="divide-y divide-white/[0.04]">
        {rows.map((r) => (
          <PerformerRow
            key={`${r.listing_type}-${r.listing_id}`}
            row={r}
            link={link}
            valueDisplay={valueDisplay}
          />
        ))}
      </div>
    )}
  </motion.div>
);

const DealerPerformers = ({ window: windowDays }) => {
  const [top, setTop] = useState(null);
  const [under, setUnder] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      apiClient.get(`/api/dealer/analytics/top-performers?window=${windowDays}`),
      apiClient.get(`/api/dealer/analytics/underperformers?window=${windowDays}`),
    ]).then(([topResult, underResult]) => {
      if (!active) return;
      if (topResult.status === 'fulfilled') setTop(topResult.value);
      else setTop({ top_by_impressions: [], top_by_conversion: [] });
      if (underResult.status === 'fulfilled') setUnder(underResult.value);
      else setUnder({ worst_by_impressions: [], views_no_leads: [] });
    });
    return () => { active = false; };
  }, [windowDays]);

  const linkAnalytics = (r) =>
    `/dealer/listings/${r.listing_type}/${r.listing_id}/analytics`;
  const linkDiag = (r) =>
    `/dealer/listings/${r.listing_type}/${r.listing_id}/diagnostic`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Left column: top performers */}
      <div className="space-y-4">
        <SectionCard
          title="Top by impressions"
          rows={top?.top_by_impressions}
          valueDisplay={(r) => r.impressions?.toLocaleString('en-AE') || '0'}
          link={linkAnalytics}
          emptyIcon={Trophy}
          index={0}
        />
        <SectionCard
          title="Top by conversion"
          rows={top?.top_by_conversion}
          valueDisplay={(r) =>
            r.conv_pct != null ? `${Number(r.conv_pct).toFixed(1)}%` : '0%'
          }
          link={linkAnalytics}
          emptyIcon={Trophy}
          index={1}
        />
      </div>

      {/* Right column: underperformers */}
      <div className="space-y-4">
        <SectionCard
          title="Worst by impressions"
          rows={under?.worst_by_impressions}
          valueDisplay={(r) => r.impressions?.toLocaleString('en-AE') || '0'}
          link={linkDiag}
          emptyIcon={AlertTriangle}
          index={2}
        />
        <SectionCard
          title="Views but zero leads"
          rows={under?.views_no_leads}
          valueDisplay={(r) => r.impressions?.toLocaleString('en-AE') || '0'}
          link={linkDiag}
          emptyIcon={AlertTriangle}
          index={3}
        />
      </div>
    </div>
  );
};

export default DealerPerformers;
