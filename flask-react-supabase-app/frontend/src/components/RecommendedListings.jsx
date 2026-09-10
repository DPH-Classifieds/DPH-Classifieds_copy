import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getBehaviorProfile, getPreferenceProfile } from '../utils/userBehavior';
import MarketplaceListingCard from './MarketplaceListingCard';
// MarketplaceListingCard uses the shared Explore card classes. A direct detail
// visit does not load ExplorePage, so import its stylesheet at this boundary.
import './ExplorePage.css';


// Two modes: pass listingType + listingId for "similar to this listing"
// (used on every detail page); otherwise this is the personalized
// viewed-history feed, falling back to newest-across-categories with no
// history yet.
const RecommendedListings = ({ limit = 8, className = '', listingType, listingId }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const isSimilar = Boolean(listingType && listingId);

  useEffect(() => {
    let active = true;

    const fetchRecommendations = async () => {
      let body;
      if (isSimilar) {
        body = { listing_type: listingType, listing_id: listingId, limit };
      } else {
        const profile = getBehaviorProfile();
        const prefs = getPreferenceProfile();
        body = prefs.totalViews > 0
          ? {
              viewed: profile.viewed.map((v) => ({ type: v.type, id: v.id })),
              preferredTypes: prefs.preferredTypes,
              avgPrice: prefs.avgPrice,
              limit,
            }
          : { limit };
      }

      try {
        const res = await fetch(`${API_URL}/api/recommendations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (active) setRecommendations(data.recommendations || []);
      } catch (err) {
        console.warn('Failed to fetch recommendations:', err);
        if (active) setRecommendations([]);
      }
      if (active) setLoading(false);
    };

    fetchRecommendations();
    return () => { active = false; };
  }, [limit, isSimilar, listingType, listingId]);

  if (loading || recommendations.length === 0) return null;

  return (
    <section className={`cd-recommended cn-recommended ${className}`}>
      <div className="cn-shell">
        <div className="cn-section-heading cn-section-heading-dark">
          <div>
            <span className="cn-kicker" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} /> {isSimilar ? 'Similar Listings' : 'Recommended for you'}
            </span>
            <h2>{isSimilar ? 'You might also like' : 'Based on what you have been looking at'}</h2>
          </div>
        </div>
        <div className="cn-similar-grid">
          {recommendations.map((item) => (
            <MarketplaceListingCard
              key={`${item.listingType || item.type}-${item.id}`}
              item={{
                id: item.id,
                categoryLabel: item.categoryLabel || item.type,
                title: item.title,
                subtitle: item.subtitle,
                priceLabel: item.priceLabel,
                location: item.location,
                image: item.image,
                images: item.images,
                route: item.route,
                listingType: item.listingType || item.type,
              }}
              showMoreLink={false}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default RecommendedListings;
