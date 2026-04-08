import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import { carMakes } from '../utils/carData';
import { Button } from './ui/button';
import { ArrowRight } from 'lucide-react';
import '../styles/HomePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const HeroBackground = lazy(() => import('./HeroBackground'));

const marketplaceInsights = [
  {
    id: 1,
    title: 'Verified marketplace flow',
    subtitle: 'Live listings, direct seller contact, and cleaner browsing across the UAE.',
    stat: '60k+'
  },
  {
    id: 2,
    title: 'Search with intent',
    subtitle: 'Move from hero search to the full explore experience when you want deeper filtering.',
    stat: '24/7'
  },
  {
    id: 3,
    title: 'Built for serious buyers',
    subtitle: 'Latest arrivals surface fast and route straight into the real car detail pages.',
    stat: 'Live'
  }
];

const heroImage = '/images/toplanding.jpg';

const exploreCards = [
  {
    id: 1,
    title: 'Explore Inventory',
    subtitle: 'Jump into the full explore page to filter by make, model, city, and price.',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDDLMfP5X_RpsA704FNI8cZ_r2KWBqLFDUzCu025KGFM2nsqZNmRz0mvfQauB-sgvcz28H_QwC-s1lEJUmfbYwDBnjAhNvOF7LNiy8wAAMnlw1peiem4p5EoK_-ruDbTyBMC3wJqgkW4NKO6ZjtE8NrJgBEJ2YZcUZp1Qna5JnBQWvAE4bvAW1xDQzX8KW03OQPc7KEkpI21wEWz_GrbVVKGGObtpmwQ0hDqwBncTAN5vvzElLKvRSiY55Sn_utGNWAfrTYbQnqVUU'
  },
  {
    id: 2,
    title: 'Trusted Seller Signals',
    subtitle: 'Use the explore flow to review seller context, verification, and listing quality faster.',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAeyXZozZXKzn4NaT7q6-x5OSe-p992f_I7jbIlhhnItf_5enq-KmPiTZOBaT1TIhGYQxHKsjf2_CspmREkqBsKh660gaX6d60Y1RpsVVLdHGMx6nY55koYnEVoC4-h6T47RNJuzrkVd_sTA2mnueThG-EhJnGfqc8wqmDh9yC1WWRfdaIJMkaG-KB69rBFdQJYGXQJLxESIS6nBK_DHNwp7-AuhGklz8ErT3fiweWgSzymEvTiK6vR9eqv5ZCII4OZvYyXRrF6uYI'
  },
  {
    id: 3,
    title: 'Broader Automotive Ecosystem',
    subtitle: 'Cars, parts, bikes, and plates stay connected inside the same browsing surface.',
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuA-8kUYFG7DoCoob11gxpkHleSv769FjAd2AYfFaNJaU8PgfVbZ1z5YD9L-PxzXVIZGtteNNaHlORwMlCZQ9PvgDmX0VhT4h1cSD2EUB7t438pIHfKErzELkYw4T0CPTWWEE4ErH4uJFW0sF5qBggRaytSHpba4KCWDPiUxYp1cGIqV2UMg3uXjWCqgiXsKxvoNQnvd7OYXx8OzIheXsSwB-9iLRKh3YU01JMkqmBTp9KrTacQI49KqOvKWzelDUQ5m1UOpqpLx2Jk'
  }
];

const listingShowcaseImages = [
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBoO8_PxzINvGKiSUa16wI9xy2HATXPR6JR98k8CIG8A4emnTCtp9NAxHapXFs-ZGsMn1w8BENk0HNyzd7T7V7bjiQPlj2LPMw4D2uDKwThkOu9Cs9dQXNKPJjdQFgkTdYtgDTCXF-SDBofKjLgVn8oTJ7B_qRTwz0h2VPXskXbocu70viqiaQwEee5wnTPNEuPX6fDU_VTNpEi2jc2MEhfA0M4GnubanUVKb81CyWLvLSZmvRALhYCwfWEhnuLPDZXoN4OdYCUmTo',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAS3n7h7CtWHxMABFewSRzZCa_xuq8ZxS9S7yOGJD2iat4bgMKi3bdvAcyJSQM5iuw4RMRR-90cNjTZA4uhsr-oqj_bo0j9T5Ua_lYK-lut1XXBgH-T9OcAzoZAIFGw9Rdln-1-1vLKoq9CKPeNMCZxTJ2AA9d2TFvOZp_0Q1fpMTCwkn7Q_Ui9M2KLhI1ZvCT-qbxJkArsGHtzkHeP3b96iYT-9A3P3nMxXa-W38dk_p0MdXvprm7XUAYFgBKs29zW3ZLcaIv3bog',
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDBQiSI7wmR5I14PnqYPyfc6ceaxddNMInsnoUP2x9MZqA8lzz5QukCIE8HtYXvjKw3cH3IfEbUAFcEfq3aN3DgJLfO394FRgf0ElyQ1VPwox69yD2AMtyljASs8Ed3gH8bL5TQxZ69-Rf8tFsyW-KwI9JOD8tL9HD5XIm1wJbYNrMuGJMYE5MmRpdFrfHMQKkEj5G2BxYYM_iEOp-MYSTCPqYB6E0-Qmsz9yyX5TSZq9A58FKpn1O7Rg7MSruZQ-ysGj7lbz2Yop4'
];

const ctaImage = '/images/bottom-landing.jpg';

const HomePage = () => {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchRecentCars();
  }, []);

  const fetchRecentCars = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`${API_URL}/api/cars?limit=6&order=created_at.desc`);
      let carsData = [];

      if (response.data && response.data.cars) {
        carsData = response.data.cars;
      } else if (Array.isArray(response.data)) {
        carsData = response.data;
      }

      setCars(carsData.slice(0, 6));
    } catch (err) {
      console.error('Error fetching cars:', err);
      setError('Failed to load listings');
      setCars([]);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price) => {
    const numericPrice = Number.parseInt(price, 10);
    if (!numericPrice) {
      return 'Price on request';
    }
    return `AED ${numericPrice.toLocaleString()}`;
  };

  const formatKilometers = (car) => {
    const rawKilometers = car.kilometer_driven || car.kilometer || car.mileage;
    const kilometers = Number.parseInt(rawKilometers, 10);

    if (!kilometers) {
      return 'Mileage on request';
    }

    if (kilometers >= 1000) {
      return `${(kilometers / 1000).toFixed(1)}k km`;
    }

    return `${kilometers} km`;
  };

  const getCarTitle = (car) => {
    const year = car.car_year || car.make_year || '';
    const make = car.car_manufacturer || car.make || '';
    const model = car.car_model || car.model || '';
    const trim = car.car_trim || car.trim || '';
    const fallbackTitle = car.listing_title || car.title || '';

    const composedTitle = `${year} ${make} ${model} ${trim}`.replace(/\s+/g, ' ').trim();
    return composedTitle || fallbackTitle || 'Untitled listing';
  };

  const getFuelType = (car) => car.fuel_type || car.fuel || 'Specs pending';

  const getLocation = (car) => car.car_city || car.city || 'UAE';

  const getListingImageUrl = (car, index) => {
    const firstImage = car.images?.[0];
    const imageUrl =
      firstImage?.image_url ||
      firstImage?.url ||
      car.image_url ||
      car.main_image_url ||
      listingShowcaseImages[index % listingShowcaseImages.length];

    if (imageUrl && imageUrl.startsWith('/')) {
      return `${API_URL}${imageUrl}`;
    }

    return imageUrl;
  };

  return (
    <div className="cn-home">
      <section className="cn-hero">
        <div className="cn-hero-media">
          <img src={heroImage} alt="Luxury performance car in a dark studio" className="cn-hero-image" />
          <Suspense fallback={null}>
            <HeroBackground />
          </Suspense>
          <div className="cn-hero-vignette" />
          <div className="cn-hero-glow" />
        </div>

        <div className="cn-shell cn-hero-content">
          <span className="cn-kicker">DPH Classifieds</span>
          <h1 className="cn-display-title">
            For PetrolHeads. By PetrolHeads.
          </h1>
          <div className="cn-hero-actions">
            <Button asChild className="group">
              <Link to="/explore">
                Explore Inventory
                <ArrowRight className="-me-1 ms-2 opacity-60 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="secondary" className="group">
              <Link to="/create-listing">
                List Your Vehicle
                <ArrowRight className="-me-1 ms-2 opacity-60 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="cn-insight-band">
        <div className="cn-shell cn-insight-grid">
          {marketplaceInsights.map((insight) => (
            <article key={insight.id} className="cn-insight-card">
              <span className="cn-insight-stat">{insight.stat}</span>
              <h2>{insight.title}</h2>
              <p>{insight.subtitle}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cn-explore-section">
        <div className="cn-shell">
          <div className="cn-section-heading cn-section-heading-dark">
            <div>
              <span className="cn-kicker">Explore Page</span>
              <h2>Browse the full marketplace from one surface.</h2>
            </div>
            <Link to="/explore" className="cn-button cn-button-dark">
              Go to Explore
            </Link>
          </div>

          <div className="cn-collection-grid">
            {exploreCards.map((card) => (
              <article key={card.id} className="cn-collection-card">
                <div className="cn-collection-image-wrap">
                  <img src={card.image} alt={card.title} className="cn-collection-image" />
                </div>
                <div className="cn-collection-copy">
                  <h3>{card.title}</h3>
                  <p>{card.subtitle}</p>
                  <Link to="/explore" className="cn-text-link">
                    Open Explore
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="cn-listings-section">
        <div className="cn-shell">
          <div className="cn-section-heading cn-section-heading-light">
            <div>
              <span className="cn-kicker">Latest Listings</span>
              <h2>Fresh arrivals that route into the real car pages.</h2>
            </div>
            <Link to="/cars" className="cn-text-link cn-text-link-green">
              View all inventory
            </Link>
          </div>

          {loading ? (
            <div className="cn-state-card">
              <LoadingSpinner message="Loading latest listings..." compact />
            </div>
          ) : error ? (
            <div className="cn-state-card cn-state-card-error">
              <p>{error}</p>
              <button type="button" className="cn-button cn-button-primary" onClick={fetchRecentCars}>
                Retry
              </button>
            </div>
          ) : cars.length === 0 ? (
            <div className="cn-state-card">
              <p>No listings available yet.</p>
              <Link to="/create-listing" className="cn-button cn-button-primary">
                Be the first to list
              </Link>
            </div>
          ) : (
            <div className="cn-listings-grid">
              {cars.map((car, index) => (
                <Link to={`/cars/${car.id}`} key={car.id || index} className="cn-listing-card">
                  <div className="cn-listing-image-wrap">
                    <img
                      src={getListingImageUrl(car, index)}
                      alt={getCarTitle(car)}
                      className="cn-listing-image"
                    />
                    {car.featured ? <span className="cn-badge">Featured</span> : null}
                  </div>
                  <div className="cn-listing-copy">
                    <div className="cn-listing-head">
                      <h3>{getCarTitle(car)}</h3>
                      <strong>{formatPrice(car.expected_selling_price || car.price)}</strong>
                    </div>
                    <p className="cn-listing-meta">
                      <span>{formatKilometers(car)}</span>
                      <span>•</span>
                      <span>{getFuelType(car)}</span>
                      <span>•</span>
                      <span>{getLocation(car)}</span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
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

      <section className="cn-cta-section">
        <div className="cn-cta-media">
          <img src={ctaImage} alt="Abstract performance silhouette" className="cn-cta-image" />
          <div className="cn-cta-overlay" />
        </div>
        <div className="cn-shell cn-cta-content">
          <span className="cn-kicker">Automotive Ecosystem</span>
          <h2>Every next click already exists in your app.</h2>
          <p>
            Explore inventory, open real listing pages, or create a fresh post without losing the current
            marketplace structure you already have in place.
          </p>
          <div className="cn-hero-actions">
            <Link to="/explore" className="cn-button cn-button-primary">
              Launch Explore
            </Link>
            <Link to="/cars" className="cn-button cn-button-secondary">
              Browse Cars
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
