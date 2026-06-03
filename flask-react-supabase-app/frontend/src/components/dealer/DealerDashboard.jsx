import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useDealer } from '../../context/DealerContext';
import DealerKpiTiles from './DealerKpiTiles';
import DealerTrends from './DealerTrends';
import DealerFunnel from './DealerFunnel';
import DealerPerformers from './DealerPerformers';

const WINDOWS = [
  { value: 7,  label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

const WindowSelector = ({ value, onChange }) => (
  <div className="flex bg-white/[0.04] border border-white/[0.06] rounded-full p-1">
    {WINDOWS.map((w) => (
      <button
        key={w.value}
        onClick={() => onChange(w.value)}
        className={`rounded-full px-3 py-1 text-xs transition-colors ${
          value === w.value
            ? 'bg-white/10 text-white'
            : 'text-white/50 hover:text-white'
        }`}
      >
        {w.label}
      </button>
    ))}
  </div>
);

const DealerDashboard = () => {
  const { dealership } = useDealer();
  const [windowDays, setWindowDays] = useState(30);

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold text-white">
            {dealership?.name || 'Dashboard'}
          </h1>
          {dealership?.status === 'verified' && (
            <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1 uppercase tracking-[0.10em]">
              Verified Dealer
            </span>
          )}
        </div>
        <WindowSelector value={windowDays} onChange={setWindowDays} />
      </motion.div>

      {/* KPI Tiles */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <DealerKpiTiles window={windowDays} />
      </motion.div>

      {/* Trends + Funnel */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4">
        <DealerTrends window={windowDays} />
        <DealerFunnel window={windowDays} />
      </div>

      {/* Performers */}
      <DealerPerformers window={windowDays} />
    </div>
  );
};

export default DealerDashboard;
