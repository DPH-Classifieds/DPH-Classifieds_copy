import React, { useState } from 'react';
import { BarChart3, Search, Database } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { GlassCard, KpiTile } from '../ui/dashboard';

const money = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return 'N/A';
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0,
  }).format(Number(value));
};

const number = (value) => (value == null ? 'N/A' : Number(value).toLocaleString('en-AE'));

const AdminMarketTracker = ({ days }) => {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [data, setData] = useState(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const searchMarket = async (event) => {
    event.preventDefault();
    if (!make.trim() || !model.trim() || !year) {
      setError('Enter a make, model, and model year.');
      return;
    }
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const params = new URLSearchParams({
        days: String(days),
        market_make: make.trim(),
        market_model: model.trim(),
        market_year: String(year),
      });
      const response = await apiClient.get(`/api/admin/metrics/overview?${params.toString()}`);
      setData(response.market_tracker || null);
    } catch (requestError) {
      setData(null);
      setError(requestError.message || 'Failed to load market data.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-[color:var(--ex-shell-text-muted)] mb-3">
          Search the exact make, model, and year cohort using approved car listings currently on the platform.
        </p>
        <form onSubmit={searchMarket} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_9rem_auto] gap-3 items-end">
          <label className="text-xs text-[color:var(--ex-shell-text-muted)]">
            Make
            <input
              value={make}
              onChange={(event) => setMake(event.target.value)}
              placeholder="Toyota"
              className="mt-1 w-full rounded-xl bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] px-3 py-2.5 text-sm text-[color:var(--ex-shell-text)] placeholder:text-[color:var(--ex-shell-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            />
          </label>
          <label className="text-xs text-[color:var(--ex-shell-text-muted)]">
            Model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Camry"
              className="mt-1 w-full rounded-xl bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] px-3 py-2.5 text-sm text-[color:var(--ex-shell-text)] placeholder:text-[color:var(--ex-shell-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            />
          </label>
          <label className="text-xs text-[color:var(--ex-shell-text-muted)]">
            Model year
            <input
              type="number"
              min="1900"
              max="2100"
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="2019"
              className="mt-1 w-full rounded-xl bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] px-3 py-2.5 text-sm text-[color:var(--ex-shell-text)] placeholder:text-[color:var(--ex-shell-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50 transition-colors"
          >
            <Search size={15} />
            {loading ? 'Loading…' : 'Track market'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      </div>

      {!searched && !loading && (
        <GlassCard className="text-center py-12">
          <BarChart3 size={30} className="mx-auto text-white/30 mb-3" />
          <p className="text-sm text-[color:var(--ex-shell-text-muted)]">Choose a vehicle cohort to see its real platform market.</p>
        </GlassCard>
      )}

      {data && (
        <>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold text-[color:var(--ex-shell-text)]">
                {data.cohort.make} {data.cohort.model} · {data.cohort.year}
              </h2>
              <p className="text-xs text-[color:var(--ex-shell-text-muted)] mt-1">
                Current asking prices from approved platform car listings · window: {days}d history
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
              <Database size={13} /> Source: platform cars
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <KpiTile label="Average asking" value={money(data.average_price)} icon={BarChart3} accent="emerald" />
            <KpiTile label="Median asking" value={money(data.median_price)} icon={BarChart3} />
            <KpiTile label="Lowest listing" value={money(data.min_price)} icon={BarChart3} />
            <KpiTile label="Highest listing" value={money(data.max_price)} icon={BarChart3} />
            <KpiTile label="Listings" value={number(data.listing_count)} icon={Database} />
            <KpiTile label="Sample quality" value={data.sample_quality || 'N/A'} icon={Database} />
          </div>

          {data.listing_count < data.min_sample_size && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              Only {number(data.listing_count)} matching listing{data.listing_count === 1 ? '' : 's'} found. The average is real, but the sample is below the {data.min_sample_size}-listing reliability threshold.
            </div>
          )}

          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-3">Daily market history</p>
            {data.history.length === 0 ? (
              <p className="text-sm text-[color:var(--ex-shell-text-muted)]">
                {data.history_note || 'History will appear after the daily market snapshot worker records its first run.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[color:var(--ex-shell-line)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[color:var(--ex-shell-text-muted)] border-b border-[color:var(--ex-shell-line)]">
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-right px-4 py-3">Average</th>
                      <th className="text-right px-4 py-3">Median</th>
                      <th className="text-right px-4 py-3">Listings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => (
                      <tr key={row.snapshot_date} className="border-b border-[color:var(--ex-shell-line)] last:border-0">
                        <td className="px-4 py-3 text-[color:var(--ex-shell-text-muted)]">{row.snapshot_date}</td>
                        <td className="px-4 py-3 text-right font-medium text-[color:var(--ex-shell-text)]">{money(row.average_price)}</td>
                        <td className="px-4 py-3 text-right text-[color:var(--ex-shell-text)]">{money(row.median_price)}</td>
                        <td className="px-4 py-3 text-right text-[color:var(--ex-shell-text-muted)]">{number(row.listing_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminMarketTracker;
