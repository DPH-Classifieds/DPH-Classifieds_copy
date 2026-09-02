import React, { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { getListingTitle } from '../../utils/listingTitle';
import { resolveMediaUrl } from '../../utils/media';

const PLURAL_TO_SINGULAR = { cars: 'car', bikes: 'bike', plates: 'plate', parts: 'part' };
const TYPE_LABELS = { car: 'Car', bike: 'Bike', plate: 'Plate', part: 'Part' };
const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

// Plates have no photo by design — every other type carries a real thumbnail.
const getThumbnail = (listing) => {
  const first = Array.isArray(listing.images) ? listing.images[0] : null;
  const raw = first?.display_url || first?.image_url || first?.url || null;
  return resolveMediaUrl(raw) || PLACEHOLDER_IMAGE;
};

/**
 * Search-as-you-type picker over existing, approved listings (cars/bikes/
 * plates/parts). Reuses the admin listings-search endpoint the Listings
 * page already relies on — no dedicated backend route needed.
 */
export default function ListingPicker({ onClose, onSelect }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    apiClient
      .get('/api/admin/listings-search?types=car,bike,plate,part&statuses=approved&limit=200')
      .then((data) => {
        if (!active) return;
        const rows = Array.isArray(data) ? data : data?.listings || [];
        setListings(rows);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.response?.data?.error || err.message || 'Failed to load listings');
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withTitle = listings.map((l) => ({ listing: l, title: getListingTitle(l) }));
    const matched = q
      ? withTitle.filter(({ listing, title }) =>
          title.toLowerCase().includes(q) || (listing.id || '').toLowerCase().includes(q))
      : withTitle;
    return matched.slice(0, 40);
  }, [listings, query]);

  const pick = (listing, title) => {
    const singularType = PLURAL_TO_SINGULAR[listing.listing_type] || listing.listing_type;
    onSelect({ listingType: singularType, listingId: listing.id, title });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[color:var(--ex-shell-surface)] border border-white/10 rounded-2xl p-6 w-full max-w-lg text-white space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Choose a listing to feature</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/80">
            <X size={18} />
          </button>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by make, model, plate number…"
            className="w-full rounded-lg bg-white/5 border border-white/10 pl-9 pr-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
          />
        </div>

        {loading && <p className="text-sm text-white/50">Loading listings…</p>}
        {error && <p className="text-sm text-red-300">{error}</p>}

        {!loading && !error && (
          <div className="max-h-80 overflow-y-auto space-y-1.5">
            {results.length === 0 && (
              <p className="text-sm text-white/40 py-6 text-center">No matching listings.</p>
            )}
            {results.map(({ listing, title }) => (
              <button
                key={`${listing.listing_type}-${listing.id}`}
                onClick={() => pick(listing, title)}
                className="w-full flex items-center gap-3 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 px-3 py-2 text-left transition-colors"
              >
                {listing.listing_type === 'plates' || listing.listing_type === 'plate' ? null : (
                  <img
                    src={getThumbnail(listing)}
                    alt=""
                    loading="lazy"
                    className="w-10 h-10 rounded-md object-cover border border-white/10 shrink-0 bg-white/5"
                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER_IMAGE; }}
                  />
                )}
                <span className="text-[10px] uppercase tracking-wider text-white/40 bg-white/[0.06] border border-white/10 rounded-full px-2 py-0.5 shrink-0">
                  {TYPE_LABELS[PLURAL_TO_SINGULAR[listing.listing_type] || listing.listing_type] || listing.listing_type}
                </span>
                <span className="text-sm text-white truncate flex-1">{title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
