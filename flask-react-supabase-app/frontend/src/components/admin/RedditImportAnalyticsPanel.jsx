import React from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Rss } from 'lucide-react';
import { GlassCard, KpiTile, EmptyState } from '../ui/dashboard';

const STATUS_TONE = {
  succeeded: 'text-emerald-300',
  running: 'text-sky-300',
  partial: 'text-amber-300',
  failed: 'text-rose-300',
};

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return '—';
  }
}

// Takes the /api/admin/reddit-import-analytics response as `data`. Renders
// nothing-but-an-empty-state when no listing has been imported yet — an empty
// import is not an error.
export default function RedditImportAnalyticsPanel({ data }) {
  const listings = data?.listings || {};
  const opens = data?.opens || {};
  const run = data?.latest_run || null;
  const daily = Array.isArray(data?.daily_opens) ? data.daily_opens : [];
  const top = Array.isArray(data?.top_listings) ? data.top_listings : [];
  const views = Number(listings.views || 0);
  const openRate = views > 0 ? `${((Number(opens.total || 0) / views) * 100).toFixed(1)}%` : '—';
  const maxDaily = daily.reduce((m, d) => Math.max(m, Number(d.count || 0)), 0) || 1;

  const isEmpty = !data || Number(listings.total || 0) === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.16 }}
      className="mb-8"
    >
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3 flex items-center gap-2">
        <Rss size={13} className="text-[#ff4500]" /> Reddit imported listings
      </p>

      {isEmpty ? (
        <GlassCard>
          <EmptyState
            icon={Rss}
            title="No imported listings yet"
            description="Eligible for-sale posts from r/DubaiPetrolHeads appear here once the importer runs. This is not an error."
          />
          {run && (
            <p className="text-center text-xs text-white/40 pb-4">
              Last run {formatDateTime(run.started_at)} ·{' '}
              <span className={STATUS_TONE[run.status] || 'text-white/60'}>{run.status}</span>
            </p>
          )}
        </GlassCard>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Live imported listings" value={Number(listings.live || 0)} accent="emerald" />
            <KpiTile label="Reddit post opens" value={Number(opens.total || 0)} />
            <KpiTile label="Unique visitors opening Reddit" value={Number(opens.unique_visitors || 0)} />
            <KpiTile label="Open rate (opens / DPH views)" value={openRate} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Latest run health */}
            <GlassCard className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white text-sm font-semibold">Latest import run</h3>
                {run && (
                  <span className={`text-xs font-semibold ${STATUS_TONE[run.status] || 'text-white/60'}`}>
                    {run.status}
                  </span>
                )}
              </div>
              {run ? (
                <>
                  <p className="text-xs text-white/40 mb-3">{formatDateTime(run.started_at)}</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Fetched', run.fetched_count],
                      ['Eligible', run.eligible_count],
                      ['Created', run.created_count],
                      ['Updated', run.updated_count],
                      ['Skipped', run.skipped_count],
                      ['Failed', run.failed_count],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-white/[0.03] rounded-lg py-2">
                        <div className="text-white text-base font-semibold">{Number(value || 0)}</div>
                        <div className="text-white/40 text-[10px] uppercase tracking-wide">{label}</div>
                      </div>
                    ))}
                  </div>
                  {run.error_summary && (
                    <p className="mt-3 text-xs text-rose-300/80 break-words">{run.error_summary}</p>
                  )}
                </>
              ) : (
                <p className="text-white/40 text-sm">No run recorded yet.</p>
              )}
            </GlassCard>

            {/* Daily opens sparkline */}
            <GlassCard className="p-5">
              <h3 className="text-white text-sm font-semibold mb-4">Daily Reddit opens</h3>
              {daily.length === 0 ? (
                <p className="text-white/40 text-sm">No opens in this window yet.</p>
              ) : (
                <div className="flex items-end gap-1 h-24">
                  {daily.map((d) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end" title={`${d.date}: ${d.count}`}>
                      <div
                        className="w-full rounded-t bg-[#ff4500]/70"
                        style={{ height: `${Math.max(4, (Number(d.count || 0) / maxDaily) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

          {/* Top imported listings */}
          {top.length > 0 && (
            <GlassCard className="p-5">
              <h3 className="text-white text-sm font-semibold mb-3">Top imported listings by opens</h3>
              <div className="divide-y divide-white/[0.06]">
                {top.map((item) => (
                  <div key={item.listing_id} className="flex items-center justify-between py-2.5 gap-3">
                    <span className="text-white/80 text-sm truncate">{item.title}</span>
                    <div className="flex items-center gap-4 shrink-0 text-xs">
                      <span className="text-white/40">{Number(item.views || 0)} views</span>
                      <span className="text-white font-semibold">{Number(item.opens || 0)} opens</span>
                      {item.source_url && (
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#ff4500] hover:text-[#ff6a33]"
                          aria-label="Open original Reddit post"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      )}
    </motion.div>
  );
}
