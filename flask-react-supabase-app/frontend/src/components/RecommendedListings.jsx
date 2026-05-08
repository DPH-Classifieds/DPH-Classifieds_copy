import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getBehaviorProfile, getPreferenceProfile } from '../utils/userBehavior';
import MarketplaceListingCard from './MarketplaceListingCard';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const RecommendedListings = ({ limit = 8, className = '' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRecommendations = async () => {
      const profile = getBehaviorProfile();
      const prefs = getPreferenceProfile();

      try {
        const body = prefs.totalViews > 0
          ? {
              viewed: profile.viewed.map((v) => ({ type: v.type, id: v.id })),
              preferredTypes: prefs.preferredTypes,
              avgPrice: prefs.avgPrice,
              limit,
            }
          : { limit };

        const res = await fetch(`${API_URL}/api/recommendations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        setRecommendations(data.recommendations || []);
      } catch (err) {
        console.warn('Failed to fetch recommendations:', err);
      }
      setLoading(false);
    };

    fetchRecommendations();
  }, [limit]);

  if (loading || recommendations.length === 0) return null;

  return (
    <section className={`cn-recommended ${className}`}>
      <div className="cn-shell">
        <div className="cn-section-heading cn-section-heading-dark">
          <div>
            <span className="cn-kicker" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} /> Recommended for you
            </span>
            <h2>Based on what you have been looking at</h2>
          </div>
        </div>
        <div className="cn-market-grid">
          {recommendations.map((item) => (
            <MarketplaceListingCard
              key={`${item.type}-${item.id}`}
              item={{
                id: item.id,
                categoryLabel: item.type,
                title: item.title,
                subtitle: item.subtitle,
                price: item.price,
                location: item.location,
                image: item.image,
                route: item.route,
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
