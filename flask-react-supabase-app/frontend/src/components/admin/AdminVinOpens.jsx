import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Fingerprint } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { EmptyState, SegmentedControl } from '../ui/dashboard';
import {
  adminListingDetailHref,
  getEventActorLabel,
  formatDateTime,
} from './adminUtils';

const WINDOW_OPTIONS = [
  { label: '24h', value: 1 },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
];

const AdminVinOpens = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiClient
      .get(`/api/admin/vin-opens?days=${days}`)
      .then((res) => {
        if (!active) return;
        setData(res || null);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(e.message || 'Failed to load VIN opens');
        setLoading(false);
      });
    return () => { active = false; };
  }, [days]);

  const events = Array.isArray(data?.events) ? data.events : [];

  return (
    <div className="text-white space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">VIN opens</h1>
            {data && (
              <span className="text-[11px] font-semibold text-white/50 bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-1">
                {data.count}
              </span>
            )}
          </div>
          <p className="text-sm text-white/40 mt-1">
            Who opened the VIN on which car, over the selected window.
          </p>
        </div>
        <SegmentedControl options={WINDOW_OPTIONS} value={days} onChange={setDays} />
      </motion.div>

      {/* Table card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 overflow-hidden"
      >
        {loading && (
            <div className="space-y-2 p-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-12" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="px-5 py-4 text-rose-300 text-sm">{error}</div>
          )}

          {!loading && !error && events.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={Fingerprint}
                title="No VIN opens"
                description="No VIN-open events in this window."
              />
            </div>
          )}

          {!loading && !error && events.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Listing', 'VIN', 'Opened by', 'Platform', 'When'].map((h) => (
                      <th
                        key={h}
                        className="text-left text-[10px] uppercase tracking-[0.14em] text-white/30 font-medium px-5 py-3"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {events.map((ev, idx) => {
                    const href = adminListingDetailHref(ev.listing_type, ev.listing_id);
                    const title = ev.listing_title || 'Untitled car';
                    return (
                      <motion.tr
                        key={ev.id || idx}
                        initial={{ opacity: 0, x: -4 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: idx * 0.02 }}
                        className="hover:bg-white/[0.03] transition-colors"
                      >
                        <td className="px-5 py-3">
                          {href ? (
                            <Link
                              to={href}
                              className="font-medium text-white/80 hover:text-emerald-400 transition-colors"
                            >
                              {title}
                            </Link>
                          ) : (
                            <span className="font-medium text-white/80">{title}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-mono text-[11px] text-white/50">
                            {ev.vin || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <div className="text-white/70">{getEventActorLabel(ev)}</div>
                          {ev.actor_email && (
                            <div className="text-[11px] text-white/30">{ev.actor_email}</div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-white/50 text-xs capitalize">
                          {ev.platform || '—'}
                        </td>
                        <td className="px-5 py-3 text-white/40 text-xs tabular-nums whitespace-nowrap">
                          {formatDateTime(ev.occurred_at)}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
        )}
      </motion.div>
    </div>
  );
};

export default AdminVinOpens;
