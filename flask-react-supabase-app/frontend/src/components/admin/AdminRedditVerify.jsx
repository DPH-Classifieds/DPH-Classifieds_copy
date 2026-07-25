import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Rss, ExternalLink, ImageOff, CheckCircle2, AlertTriangle } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { GlassCard, EmptyState } from '../ui/dashboard';

const FIELD_LABELS = {
  car_manufacturer: 'Make', car_model: 'Model', make_year: 'Year',
  expected_selling_price: 'Price', regional_spec: 'Regional spec', fuel_type: 'Fuel',
  transmission_type: 'Transmission', horsepower: 'Horsepower', steering_side: 'Steering',
  body_type: 'Body type',
  bike_brand: 'Make', bike_model: 'Model', year: 'Year', price: 'Price',
  condition: 'Condition', bike_type: 'Type', location: 'Location',
  name: 'Name', part_type: 'Part type', number: 'Plate number', code: 'Code', city: 'City',
};

const TYPE_LABEL = { car: 'Car', bike: 'Bike', part: 'Part', plate: 'Plate' };

const fmtValue = (key, value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'expected_selling_price' || key === 'price') {
    const n = Number(value);
    return Number.isFinite(n) ? `AED ${n.toLocaleString()}` : String(value);
  }
  return String(value);
};

const AdminRedditVerify = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiClient
      .get('/api/admin/reddit-listings')
      .then((res) => { if (active) { setData(res || null); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message || 'Failed to load'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const summary = data?.summary || { total: 0, hidden: 0, incomplete: 0, with_vin: 0 };
  const listings = useMemo(() => {
    const rows = Array.isArray(data?.listings) ? data.listings : [];
    return onlyIncomplete ? rows.filter((l) => (l.missing_fields || []).length > 0) : rows;
  }, [data, onlyIncomplete]);

  const kpis = [
    { label: 'Total imported', value: summary.total },
    { label: 'Hidden from site', value: summary.hidden },
    { label: 'Incomplete fields', value: summary.incomplete },
    { label: 'Has VIN', value: summary.with_vin },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Rss size={22} className="text-orange-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Reddit import verification</h1>
          <p className="text-sm text-white/50">Review every Reddit-pulled listing and its data before going live. Hidden listings are included.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <GlassCard key={k.label} className="py-4">
            <p className="text-2xl font-semibold text-white">{k.value}</p>
            <p className="text-xs text-white/50 mt-1">{k.label}</p>
          </GlassCard>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOnlyIncomplete((v) => !v)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            onlyIncomplete
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
              : 'bg-white/[0.04] text-white/60 border-white/10 hover:text-white/80'
          }`}
        >
          {onlyIncomplete ? 'Showing incomplete only' : 'Show incomplete only'}
        </button>
        <span className="text-xs text-white/40">{listings.length} shown</span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-64 rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="Couldn't load Reddit listings" description={error} />
      ) : listings.length === 0 ? (
        <EmptyState title="No Reddit listings" description="Nothing to verify in this view." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {listings.map((l, idx) => {
            const missing = new Set(l.missing_fields || []);
            const entries = Object.entries(l.fields || {});
            return (
              <motion.div
                key={`${l.listing_type}-${l.id}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.02, 0.3) }}
              >
                <GlassCard className="flex flex-col gap-3 h-full">
                  <div className="flex gap-3">
                    <div className="relative w-28 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-white/[0.04]">
                      {l.images?.[0] ? (
                        <img src={l.images[0]} alt={l.title} className="w-full h-full object-cover"
                          onError={(e) => { e.target.style.display = 'none'; }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/25"><ImageOff size={20} /></div>
                      )}
                      {l.images?.length > 1 && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{l.images.length} photos</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase text-white/60">{TYPE_LABEL[l.listing_type] || l.listing_type}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${l.is_approved ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-white/50'}`}>
                          {l.is_approved ? 'Shown' : 'Hidden'}
                        </span>
                        {missing.size > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300"><AlertTriangle size={10} />{missing.size} missing</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300"><CheckCircle2 size={10} />Complete</span>
                        )}
                      </div>
                      <p className="text-white font-medium truncate mt-1">{l.title}</p>
                      <p className="text-sm text-orange-300 font-semibold">{fmtValue('price', l.price)}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {entries.map(([key, value]) => (
                      <div key={key} className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] pb-1">
                        <span className="text-[11px] text-white/40">{FIELD_LABELS[key] || key}</span>
                        <span className={`text-xs text-right ${missing.has(key) ? 'text-amber-400' : 'text-white/80'}`}>
                          {missing.has(key) ? 'Missing' : fmtValue(key, value)}
                        </span>
                      </div>
                    ))}
                    {l.listing_type === 'car' && (
                      <div className="flex items-baseline justify-between gap-2 border-b border-white/[0.04] pb-1 col-span-2">
                        <span className="text-[11px] text-white/40">VIN</span>
                        <span className={`text-xs text-right font-mono ${l.vin_number ? 'text-white/80' : 'text-white/30'}`}>
                          {l.vin_number || 'Not decoded yet'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-auto pt-1">
                    {l.source_url && (
                      <a href={l.source_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-orange-300 hover:text-orange-200">
                        <ExternalLink size={12} /> Reddit post
                      </a>
                    )}
                    <Link to={`/admin/listings/${l.listing_type}s/${l.id}`}
                      className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white/90">
                      Admin detail
                    </Link>
                    <a href={l.public_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-white/60 hover:text-white/90">
                      <ExternalLink size={12} /> Public page
                    </a>
                    {l.source_author && <span className="ml-auto text-[11px] text-white/30">u/{l.source_author}</span>}
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminRedditVerify;
