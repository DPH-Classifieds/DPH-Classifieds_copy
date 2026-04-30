import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import MarketplaceListingCard from './MarketplaceListingCard';
import SeoMeta from './SeoMeta';
import { carMakes } from '../utils/carData';
import { resolveMediaUrl } from '../utils/media';
import { buildStaticSeo } from '../utils/seo';
import { Button } from './ui/button';
import { ArrowRight } from 'lucide-react';
import '../styles/HomePage.css';
import './ExplorePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const HeroBackground = lazy(() => import('./HeroBackground'));

const marketplaceInsights = [
  {
    id: 1,
    title: 'Community members',
    subtitle: '70k+ petrolheads connected through the broader DPH ecosystem.',
    stat: '70k+',
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
    stat: 'DPH-Classifieds',
  },
];

const heroImage = '/images/toplanding.webp';
const ctaImage = '/images/bottom-landing.jpg';
const primaryHeroButtonClass =
  'group border-0 bg-gradient-to-r from-[#0b6b4c] via-[#0a5f47] to-[#004e37] text-white shadow-[0_18px_40px_rgba(0,78,55,0.34)] hover:from-[#0d7d58] hover:via-[#0b6b4c] hover:to-[#0a5f47]';
const secondaryHeroButtonClass =
  'group border border-white/15 bg-[rgba(255,255,255,0.06)] text-white hover:bg-[rgba(255,255,255,0.12)] hover:text-white';

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
    const title =
      `${year} ${make} ${model} ${trim}`.replace(/\s+/g, ' ').trim() ||
      item.listing_title ||
      item.title ||
      'Untitled car';

    return {
      id: item.id,
      categoryKey: 'cars',
      categoryLabel: 'Car',
      route: `/cars/${item.id}`,
      title,
      priceLabel: formatPrice(item.expected_selling_price || item.price),
      subtitle: [
        item.kilometer_driven || item.kilometer || item.mileage ? `${Number(item.kilometer_driven || item.kilometer || item.mileage).toLocaleString()} km` : null,
        item.fuel_type || item.fuel || 'Specs pending',
        item.car_city || item.city || 'UAE',
      ]
        .filter(Boolean)
        .join(' • '),
      image,
      createdAt: item.created_at,
      description: item.description || item.price_insight || 'Freshly listed vehicle in the UAE marketplace.',
      sellerName: getSellerName(item),
      sellerPhoto: getSellerPhoto(item),
      location: item.car_city || item.city || 'UAE',
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
      title,
      priceLabel: formatPrice(item.price || item.expected_selling_price),
      subtitle: [item.location || 'UAE', item.bike_type || item.type || item.bike_category || 'Bike']
        .filter(Boolean)
        .join(' • '),
      image,
      createdAt: item.created_at,
      description: item.description || 'Motorcycle listing ready to view.',
      sellerName: getSellerName(item),
      sellerPhoto: getSellerPhoto(item),
      location: item.location || 'UAE',
    };
  }

  if (categoryKey === 'parts') {
    return {
      id: item.id,
      categoryKey: 'car-parts',
      categoryLabel: 'Car Part',
      route: `/car-parts/${item.id}`,
      title: item.name || item.part_name || 'Untitled part',
      priceLabel: formatPrice(item.price),
      subtitle: [item.category || item.part_type || 'Parts', item.location || item.emirate || 'UAE']
        .filter(Boolean)
        .join(' • '),
      image,
      createdAt: item.created_at,
      description: item.description || 'Part listing ready to compare.',
      sellerName: getSellerName(item),
      sellerPhoto: getSellerPhoto(item),
      location: item.location || item.emirate || 'UAE',
    };
  }

  return {
    id: item.id,
    categoryKey: 'plates',
    categoryLabel: 'Plate',
    route: `/plates/${item.id}`,
    title: `${item.city || 'UAE'} ${item.code || ''} ${item.number || ''}`.replace(/\s+/g, ' ').trim(),
    priceLabel: formatPrice(item.price),
    subtitle: [`${item.digits || String(item.number || '').length || 'N/A'} digits`, item.city || 'UAE']
      .filter(Boolean)
      .join(' • '),
    image,
    createdAt: item.created_at,
    description: item.description || 'Premium plate listing ready to view.',
    sellerName: getSellerName(item),
    sellerPhoto: getSellerPhoto(item),
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

const getSellerName = (item) =>
  [item.seller_name, item.display_name, item.user_name, item.username, item.dealer_name, item.email]
    .map((value) => (value ? String(value).trim() : ''))
    .find(Boolean) || 'Marketplace Seller';

const getSellerPhoto = (item) =>
  resolveMediaUrl(item.seller_profile_photo || item.profile_photo_url || item.user_profile_photo);

const HomePage = () => {
  const [marketplaceItems, setMarketplaceItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
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
    const fetchMarketplacePreview = async () => {
      setLoading(true);
      setError(null);

      try {
        const results = await Promise.allSettled([
          axios.get(`${API_URL}/api/cars?limit=4&order=created_at.desc`),
          axios.get(`${API_URL}/api/bikes?limit=3&order=created_at.desc`),
          axios.get(`${API_URL}/api/parts?limit=3&order=created_at.desc`),
          axios.get(`${API_URL}/api/plates?limit=3&order=created_at.desc`),
        ]);

        const nextItems = [];
        const categoryMap = [
          { key: 'cars', result: results[0] },
          { key: 'bikes', result: results[1] },
          { key: 'parts', result: results[2] },
          { key: 'plates', result: results[3] },
        ];

        categoryMap.forEach(({ key, result }) => {
          if (result.status !== 'fulfilled') {
            return;
          }

          const payload = result.value.data;
          const items = Array.isArray(payload)
            ? payload
            : Array.isArray(payload?.cars)
              ? payload.cars
              : [];

          items.forEach((item) => {
            nextItems.push(normalizeMarketplaceItem(key, item));
          });
        });

        nextItems.sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
        setMarketplaceItems(nextItems.slice(0, 8));
      } catch (requestError) {
        console.error('Error fetching marketplace preview:', requestError);
        setError('Failed to load marketplace preview');
        setMarketplaceItems([]);
      } finally {
        setLoading(false);
      }
    };

    fetchMarketplacePreview();
  }, []);

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
            width="1920"
            height="1080"
            fetchpriority="high"
            decoding="async"
          />
          <Suspense fallback={null}>
            <HeroBackground />
          </Suspense>
          <div className="cn-hero-vignette" />
          <div className="cn-hero-glow" />
        </div>

        <div className="cn-shell cn-hero-content">
          <span className="cn-kicker">DPH Classifieds</span>
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
              <span className="cn-kicker">Explore Marketplace</span>
              <h2>Live inventory across cars, bikes, parts, and plates.</h2>
            </div>
            <Link to="/explore" className="cn-button cn-button-primary-dark">
              View all
            </Link>
          </div>

          {loading ? (
            <div className="cn-state-card cn-state-card-light">
              <LoadingSpinner message="Loading marketplace preview..." compact />
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
      </section>

      <section className="cn-cta-section">
        <div className="cn-cta-media">
          <img src={ctaImage} alt="Abstract performance silhouette" className="cn-cta-image" loading="lazy" decoding="async" width="1920" height="600" />
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
