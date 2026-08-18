import React, { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import FeaturedBadge from './FeaturedBadge';

/**
 * FeaturedStrip — a horizontal row of currently-featured listings shown
 * above the regular grid on the Explore page and the per-category pages.
 *
 * Self-fetches from /api/featured-listings?type=<type> on mount. Renders
 * nothing if there are no featured listings, so it adds zero noise to
 * the page when no admin has featured anything yet.
 */
export default function FeaturedStrip({ listingType, limit = 8, buildHref, renderCard }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let active = true;
    const url = listingType
      ? `/api/featured-listings?type=${encodeURIComponent(listingType)}`
      : '/api/featured-listings';
    apiClient.get(url)
      .then((data) => { if (active) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setRows([]); });
    return () => { active = false; };
  }, [listingType]);

  if (rows === null || rows.length === 0) return null;
  const visible = rows.slice(0, limit);

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <FeaturedBadge size="lg" />
        <h2 className="text-lg font-semibold text-white">Hand-picked by the team</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visible.map((row) => renderCard(row))}
      </div>
    </section>
  );
}
