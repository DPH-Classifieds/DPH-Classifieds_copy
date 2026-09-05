import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import MarketplaceListingCard from './MarketplaceListingCard';
import SeoMeta from './SeoMeta';
import { carMakes } from '../utils/carData';
import { resolveMediaUrl } from '../utils/media';
import { buildStaticSeo } from '../utils/seo';
import { buildListingRouteState } from '../utils/listingRouteState';
import { buildCarPath } from '../utils/listingUrl';
import { Button } from './ui/button';
import { ArrowRight } from 'lucide-react';
import useFeaturedPattern from '../hooks/useFeaturedPattern';
import { applyFeaturedPlacement } from '../utils/featuredPlacement';
import '../styles/HomePage.css';
import '../styles/shell-tokens.css';
import './ExplorePage.css';

const HeroBackground = lazy(() => import('./HeroBackground'));

const marketplaceInsights = [
  {
    id: 1,
    title: 'Community members',
    subtitle: '80k+ petrolheads connected through the broader DPH ecosystem.',
    stat: '80k+',
  },
  {
    id: 2,
    title: 'Viewers',
    subtitle: '25+ million viewers engaging with the platform and community reach.',
    stat: '25M+',
  },
  {
    id: 3,
    title: 'Built by PetrolHeads',
    subtitle: 'Created with a focus on the details that matter.',
    stat: 'DPHClassifieds',
  },
];

const heroImage = '/hero.avif';
const ctaImage = '/images/bottom-landing.avif';
const primaryHeroButtonClass =
  'group border-0 bg-gradient-to-r from-[color:var(--ex-primary)] via-[color:var(--ex-primary-strong)] to-[color:var(--ex-primary-strong)] text-[color:var(--ex-shell-on-accent)] shadow-[0_18px_40px_rgba(0,78,55,0.34)] hover:from-[color:var(--ex-primary-strong)] hover:via-[color:var(--ex-primary)] hover:to-[color:var(--ex-primary-strong)]';
const secondaryHeroButtonClass =
  'group border border-[color:var(--ex-line-strong)] bg-[color:var(--ex-surface-low)] text-[color:var(--ex-text)] hover:bg-[color:var(--ex-surface-high)] hover:text-[color:var(--ex-text)]';

const normalizeMarketplaceItem = (categoryKey, item) => {
  const image =
    resolveMediaUrl(
      item?.images?.[0]?.display_url ||
        item?.images?.[0]?.image_url ||
        item?.images?.[0]?.url ||
        item?.display_url ||
        item?.image_url ||
        item?.image ||
        item?.main_image_url ||
        null
    );

  if (categoryKey === 'cars') {
    const year = item.car_year || item.make_year || '';
    const make = item.car_manufacturer || item.make || '';
    const model = item.car_model || item.model || '';
    const trim = item.car_trim || item.trim || '';
    const mileage = item.kilometer_driven || item.kilometer || item.mileage;
    const location = item.area || item.car_location || item.car_city || item.city || 'UAE';
    const title =
      `${make} ${model} ${trim}`.replace(/\s+/g, ' ').trim() ||
      item.listing_title ||
      item.title ||
      'Untitled car';

    return {
      id: item.id,
      categoryKey: 'cars',
      categoryLabel: 'Car',
      route: buildCarPath(item),
      routeState: buildListingRouteState(item),
      title,
      year,
      kilometers: item.kilometer_driven || item.kilometer || item.mileage,
      priceLabel: formatPrice(item.expected_selling_price || item.price),
      subtitle: [
        year || null,
        mileage ? `${Number(mileage).toLocaleString()} km` : null,
        location,
      ]
        .filter(Boolean)
        .join(' • '),
      image,
      createdAt: item.created_at,
      description: item.description || item.price_insight || 'Vehicle listing in the UAE marketplace.',
      location,
    };
  }

  if (categoryKey === 'bikes') {
    const title =
      `${item.year || item.make_year || ''} ${item.make || item.manufacturer || item.bike_brand || ''} ${item.model || item.bike_model || ''}`
        .replace(/\s+/g, ' ')
        .trim() || 'Untitled bike';

    return {
      id: item.id,
      categoryKey: 'bikes',
      categoryLabel: 'Bike',
      route: `/bikes/${item.id}`,
      routeState: buildListingRouteState(item),
      title,
      priceLabel: formatPrice(item.price || item.expected_selling_price),
      subtitle: [item.location || 'UAE', item.bike_type || item.type || item.bike_category || 'Bike']
        .filter(Boolean)
        .join(' • '),
      image,
      createdAt: item.created_at,
      description: item.description || 'Motorcycle listing ready to view.',
      location: item.location || 'UAE',
    };
  }

  if (categoryKey === 'parts') {
    return {
      id: item.id,
      categoryKey: 'car-parts',
      categoryLabel: 'Car Part',
      route: `/car-parts/${item.id}`,
      routeState: buildListingRouteState(item),
      title: item.name || item.part_name || 'Untitled part',
      priceLabel: formatPrice(item.price),
      subtitle: [item.category || item.part_type || 'Parts', item.location || item.emirate || 'UAE']
        .filter(Boolean)
        .join(' • '),
      image,
      createdAt: item.created_at,
      description: item.description || 'Part listing ready to compare.',
      location: item.location || item.emirate || 'UAE',
    };
  }

    return {
      id: item.id,
      categoryKey: 'plates',
      categoryLabel: 'Plate',
      route: `/plates/${item.id}`,
      routeState: buildListingRouteState(item),
      title: `${item.city || 'UAE'} ${item.code || ''} ${item.number || ''}`.replace(/\s+/g, ' ').trim(),
    priceLabel: formatPrice(item.price),
    subtitle: [`${item.digits || String(item.number || '').length || 'N/A'} digits`, item.city || 'UAE']
      .filter(Boolean)
      .join(' • '),
    image,
    createdAt: item.created_at,
    description: item.description || 'Premium plate listing ready to view.',
    location: item.city || 'UAE',
  };
};

const formatPrice = (price) => {
  const numericPrice = Number.parseInt(price, 10);
  if (!numericPrice) {
    return 'Price on request';
  }
  return `AED ${numericPrice.toLocaleString()}`;
};

const HomePage = () => {
  const [marketplaceItems, setMarketplaceItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const featuredPattern = useFeaturedPattern();
  const seoData = buildStaticSeo({
    title: 'DPH Classifieds - Buy & Sell Cars, Bikes, Parts & Plates in UAE',
    description:
      "UAE's premier marketplace for petrolheads. Discover verified cars, bikes, parts, and premium license plates with rich search and local discovery.",
    path: '/',
    keywords: [
      'used cars UAE',
      'Dubai car marketplace',
      'motorcycles UAE',
      'car parts UAE',
      'license plates Dubai',
    ],
  });

  useEffect(() => {
    const fetchLatestCars = async () => {
      setLoading(true);
      setError(null);

      try {
        const [carsResponse, featuredResponse] = await Promise.all([
          axios.get(`${API_URL}/api/homepage/preview`),
          axios.get(`${API_URL}/api/featured-listings?type=car`).catch(() => ({ data: [] })),
        ]);
        const payload = carsResponse.data || [];
        const cars = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.cars)
            ? payload.cars
            : [];
        const normalCars = cars.map((item) => normalizeMarketplaceItem('cars', item));
        const featuredCars = (Array.isArray(featuredResponse.data) ? featuredResponse.data : [])
          .filter((row) => row.listing)
          .map((row) => ({
            ...normalizeMarketplaceItem('cars', row.listing),
            is_featured: true,
            featured_highlight: row.highlight !== false,
          }));

        const placed = applyFeaturedPlacement(normalCars, featuredCars, featuredPattern, (item) => item.id);
        setMarketplaceItems(placed.slice(0, 4));
      } catch (requestError) {
        console.error('Error fetching latest cars:', requestError);
        setError('We could not load the latest cars right now. Please refresh or contact support.');
        setMarketplaceItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLatestCars();
  }, [featuredPattern]);

  return (
    <>
      <SeoMeta {...seoData} />
    <div className="cn-home">
      <section className="cn-hero">
        <div className="cn-hero-media">
          <img 
            src={heroImage} 
            alt="Luxury performance car in a dark studio" 
            className="cn-hero-image"
            width="1600"
            height="1143"
            fetchPriority="high"
            decoding="async"
          />
          <Suspense fallback={null}>
            <HeroBackground />
          </Suspense>
          <div className="cn-hero-vignette" />
          <div className="cn-hero-glow" />
        </div>

        <div className="cn-shell cn-hero-content">
          <span className="cn-kicker"><span className="cn-kicker-dph">DPH</span> <span className="cn-kicker-classifieds">Classifieds</span></span>
          <h1 className="cn-display-title">For PetrolHeads. By PetrolHeads.</h1>
          <div className="cn-hero-actions">
            <Button asChild className={primaryHeroButtonClass}>
              <Link to="/explore">
                Explore Inventory
                <ArrowRight className="-me-1 ms-2 opacity-80 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" className={secondaryHeroButtonClass}>
              <Link to="/post-car">
                List Your Vehicle
                <ArrowRight className="-me-1 ms-2 opacity-80 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="cn-brand-strip">
        <div className="cn-brand-marquee">
          <div className="cn-brand-track">
            {[...carMakes, ...carMakes].map((make, index) => (
              <span key={`${make}-${index}`} className="cn-brand-mark">
                {make}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="cn-explore-section">
        <div className="cn-shell">
          <div className="cn-section-heading cn-section-heading-dark">
            <div>
              <span className="cn-kicker">Marketplace</span>
              <h2>Recent Listings</h2>
            </div>
            <Link to="/explore" className="cn-button cn-button-primary-dark">
              View more
            </Link>
          </div>

          {loading ? (
            <div className="cn-state-card cn-state-card-light">
              <LoadingSpinner message="Loading latest cars..." compact />
            </div>
          ) : error ? (
            <div className="cn-state-card cn-state-card-light cn-state-card-error-light">
              <p>{error}</p>
            </div>
          ) : (
            <div className="cn-market-grid">
              {marketplaceItems.map((item) => (
                <MarketplaceListingCard
                  key={`${item.categoryLabel}-${item.id}`}
                  item={item}
                  showMoreLink={false}
                />
              ))}
            </div>
          )}
        </div>
        <div className="cn-marketplace-cta-bar" aria-label="List your car call to action">
          <div className="cn-shell cn-marketplace-cta-bar-inner">
            <span>Want to list your car? Posting is free.</span>
            <Link to="/post-car" className="cn-marketplace-cta-button">
              Click here
            </Link>
          </div>
        </div>
      </section>

      <section className="cn-cta-section">
        <div className="cn-cta-media">
          <img src={ctaImage} alt="Abstract performance silhouette" className="cn-cta-image" loading="lazy" decoding="async" width="1600" height="1066" />
          <div className="cn-cta-overlay" />
        </div>
        <div className="cn-shell cn-cta-content">
          <span className="cn-kicker">Automotive Ecosystem</span>
          <h2>Browse the full market or launch your next listing.</h2>
          <p>
            The landing page now routes directly into the same marketplace logic as Explore, so every
            next click stays inside one coherent DPH flow.
          </p>
          <div className="cn-hero-actions">
            <Button asChild className={primaryHeroButtonClass}>
              <Link to="/explore">
                Launch Explore
                <ArrowRight className="-me-1 ms-2 opacity-80 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" className={secondaryHeroButtonClass}>
              <Link to="/post-car">
                Start Selling
                <ArrowRight className="-me-1 ms-2 opacity-80 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </Button>
          </div>
          <div className="cn-cta-stats">
            {marketplaceInsights.map((insight) => (
              <article key={insight.id} className="cn-cta-stat-card">
                <span className="cn-cta-stat-number">{insight.stat}</span>
                <span className="cn-cta-stat-title">{insight.title}</span>
                <span className="cn-cta-stat-desc">{insight.subtitle}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
    </>
  );
};

export default HomePage;
