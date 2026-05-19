import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import MarketplaceListingCard from './MarketplaceListingCard';
import ListingSkeleton from './ListingSkeleton';
import SeoMeta from './SeoMeta';
import SearchBar from './ui/search-bar';
import { resolveMediaUrl } from '../utils/media';
import { buildStaticSeo } from '../utils/seo';
import BrowseSellCta from './BrowseSellCta';
import './ExplorePage.css';
import { buildListingRouteState } from '../utils/listingRouteState';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const INVENTORY_CACHE_TTL_MS = 60 * 1000;
const inflightInventoryRequests = new Map();

const fetchJsonWithCache = async (url, ttlMs = INVENTORY_CACHE_TTL_MS) => {
  const cacheKey = `explore-cache:${url}`;
  const now = Date.now();

  try {
    const cachedRaw = sessionStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached?.expiresAt > now && cached?.data !== undefined) {
        return cached.data;
      }
    }
  } catch (error) {
    console.warn('Failed to read cached inventory response', error);
  }

  if (inflightInventoryRequests.has(url)) {
    return inflightInventoryRequests.get(url);
  }

  const fetchPromise = fetch(url)
    .then((response) => response.json())
    .then((data) => {
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            expiresAt: now + ttlMs,
            data,
          })
        );
      } catch (error) {
        console.warn('Failed to store cached inventory response', error);
      }
      return data;
    })
    .finally(() => {
      inflightInventoryRequests.delete(url);
    });

  inflightInventoryRequests.set(url, fetchPromise);
  return fetchPromise;
};

const exploreModes = [
  { key: 'all', label: 'Explore All', description: 'Search everything in one place.' },
  { key: 'cars', label: 'Cars', description: 'Luxury, commuter, and enthusiast cars.' },
  { key: 'car-parts', label: 'Car Parts', description: 'Parts, upgrades, and accessories.' },
  { key: 'plates', label: 'Plates', description: 'Premium UAE number plates.' },
  { key: 'bikes', label: 'Bikes', description: 'Sport, cruiser, and specialty bikes.' },
];

const carInitialFilters = {
  query: '',
  manufacturer: '',
  model: '',
  city: '',
  priceMin: '',
  priceMax: '',
  sortBy: 'newest',
};

const partsInitialFilters = {
  query: '',
  category: '',
  priceMin: '',
  priceMax: '',
  sortBy: 'newest',
};

const plateInitialFilters = {
  query: '',
  city: '',
  code: '',
  digits: '',
  priceMin: '',
  priceMax: '',
  sortBy: 'newest',
};

const bikeInitialFilters = {
  query: '',
  type: '',
  brand: '',
  priceMin: '',
  priceMax: '',
  yearMin: '',
  yearMax: '',
  sortBy: 'newest',
};

const categoryMeta = {
  all: { heroTitle: 'Search the full UAE marketplace with one premium browse surface.' },
  cars: { heroTitle: 'Browse cars with make-aware filters and a cleaner path to detail.' },
  'car-parts': { heroTitle: 'Compare parts and accessories without losing the showroom feel.' },
  plates: { heroTitle: 'Surface premium UAE plates with focused city and code filters.' },
  bikes: { heroTitle: 'Explore motorcycles with the same premium rhythm as the car journey.' },
};

const mapExploreModeToSellCtaCategory = (modeKey) => {
  if (modeKey === 'car-parts') return 'parts';
  if (modeKey === 'all') return 'cars';
  return modeKey;
};

const formatPrice = (value) => {
  const numericValue = Number(value);
  if (!numericValue) {
    return 'Price on request';
  }

  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0,
  }).format(numericValue);
};

const normalizeText = (value) => (value ? String(value).trim() : '');

const getPrimaryImage = (item) => {
  const candidate =
    item?.images?.[0]?.display_url ||
    item?.images?.[0]?.image_url ||
    item?.images?.[0]?.url ||
    item?.display_url ||
    item?.image_url ||
    item?.image ||
    item?.main_image_url ||
    item?.url ||
    null;

  return resolveMediaUrl(candidate);
};

const toNumeric = (value) => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractInventoryCollection = (payload, fallbackKeys = []) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  for (const key of fallbackKeys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }

  const firstArray = Object.values(payload).find((value) => Array.isArray(value));
  return Array.isArray(firstArray) ? firstArray : [];
};

const compareBySort = (left, right, sortBy) => {
  if (sortBy === 'price-low') {
    return (left.numericPrice || Number.MAX_SAFE_INTEGER) - (right.numericPrice || Number.MAX_SAFE_INTEGER);
  }

  if (sortBy === 'price-high') {
    return (right.numericPrice || 0) - (left.numericPrice || 0);
  }

  return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
};

const buildSearchableText = (parts) =>
  parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const normalizeCar = (car) => {
  const year = car.make_year || car.car_year;
  const make = car.car_manufacturer || car.make;
  const model = car.car_model || car.model;
  const trim = car.car_trim || car.trim;
  const title =
    [make, model, trim].filter(Boolean).join(' ').trim() ||
    car.listing_title ||
    car.title ||
    'Untitled car';
  const mileage = car.kilometer_driven || car.kilometer || car.mileage;
  const location = car.car_city || car.city || car.location || 'UAE';
  const price = car.expected_selling_price || car.price;

  return {
    id: car.id,
    categoryKey: 'cars',
    categoryLabel: 'Car',
    title,
    year,
    kilometers: mileage,
    subtitle: [year, mileage ? `${Number(mileage).toLocaleString()} km` : null, location]
      .filter(Boolean)
      .join(' • '),
    description: normalizeText(car.description || car.price_insight || 'Vehicle listing in the UAE marketplace.'),
    location,
    priceLabel: formatPrice(price),
    numericPrice: toNumeric(price),
    route: `/cars/${car.id}`,
    routeState: buildListingRouteState(car),
    image: getPrimaryImage(car),
    createdAt: car.created_at,
    searchableText: buildSearchableText([
      title,
      year,
      make,
      model,
      trim,
      car.description,
      location,
    ]),
    raw: car,
  };
};

const normalizeBike = (bike) => {
  const brand = bike.make || bike.manufacturer || bike.bike_brand;
  const model = bike.model || bike.bike_model;
  const year = bike.year || bike.make_year;
  const bikeType = bike.bike_type || bike.type || bike.bike_category;
  const location = bike.location || bike.city || 'UAE';
  const price = bike.price || bike.expected_selling_price;
  const title = [year, brand, model].filter(Boolean).join(' ').trim() || bike.listing_title || 'Untitled bike';

  return {
    id: bike.id,
    categoryKey: 'bikes',
    categoryLabel: 'Bike',
    title,
    subtitle: [bikeType, bike.engine_size || bike.engine_capacity ? `${bike.engine_size || bike.engine_capacity} cc` : null, location]
      .filter(Boolean)
      .join(' • '),
    description: normalizeText(bike.description || 'Motorcycle listing ready to view.'),
    location,
    priceLabel: formatPrice(price),
    numericPrice: toNumeric(price),
    route: `/bikes/${bike.id}`,
    routeState: buildListingRouteState(bike),
    image: getPrimaryImage(bike),
    createdAt: bike.created_at,
    searchableText: buildSearchableText([
      title,
      brand,
      model,
      bikeType,
      bike.description,
      location,
    ]),
    raw: bike,
  };
};

const normalizePart = (part) => {
  const title = normalizeText(part.name || part.part_name || part.title) || 'Untitled part';
  const category = normalizeText(part.category || part.part_type) || 'Car Part';
  const location = normalizeText(part.location || part.city) || 'UAE';
  const price = part.price;

  return {
    id: part.id,
    categoryKey: 'car-parts',
    categoryLabel: 'Car Part',
    title,
    subtitle: [category, location].filter(Boolean).join(' • '),
    description: normalizeText(part.description || 'Part listing ready to compare.'),
    location,
    priceLabel: formatPrice(price),
    numericPrice: toNumeric(price),
    route: `/car-parts/${part.id}`,
    routeState: buildListingRouteState(part),
    image: getPrimaryImage(part),
    createdAt: part.created_at,
    searchableText: buildSearchableText([
      title,
      category,
      part.description,
      location,
    ]),
    raw: part,
  };
};

const normalizePlate = (plate) => {
  const location = normalizeText(plate.city) || 'UAE';
  const plateCode = normalizeText(plate.code);
  const plateNumber = normalizeText(plate.number);
  const digits = normalizeText(plate.digits);
  const title = [location, plateCode, plateNumber].filter(Boolean).join(' ').trim() || 'Premium Plate';
  const price = plate.price;

  return {
    id: plate.id,
    categoryKey: 'plates',
    categoryLabel: 'Plate',
    title,
    subtitle: [`${digits || plateNumber.length || 'N/A'} digits`, plateCode ? `Code ${plateCode}` : null, location]
      .filter(Boolean)
      .join(' • '),
    description: normalizeText(plate.description || 'Exclusive plate listing available now.'),
    location,
    priceLabel: formatPrice(price),
    numericPrice: toNumeric(price),
    route: `/plates/${plate.id}`,
    routeState: buildListingRouteState(plate),
    image: getPrimaryImage(plate),
    createdAt: plate.created_at,
    searchableText: buildSearchableText([
      title,
      plateCode,
      plateNumber,
      digits,
      location,
      plate.description,
    ]),
    raw: plate,
  };
};

const scoreAllMatch = (item, query) => {
  if (!query) {
    return 0;
  }

  const normalizedQuery = query.toLowerCase().trim();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    return 0;
  }

  const title = item.title.toLowerCase();
  const text = item.searchableText;
  let score = 0;

  tokens.forEach((token) => {
    if (title === token) {
      score += 14;
    } else if (title.startsWith(token)) {
      score += 10;
    } else if (title.includes(token)) {
      score += 7;
    }

    if (text.includes(token)) {
      score += 3;
    }

    if (item.categoryLabel.toLowerCase().includes(token)) {
      score += 2;
    }
  });

  return score;
};

const ExplorePage = () => {
  const location = useLocation();
  const [inventory, setInventory] = useState({
    cars: [],
    bikes: [],
    parts: [],
    plates: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeMode, setActiveMode] = useState('all');
  const [globalQuery, setGlobalQuery] = useState('');
  const [carFilters, setCarFilters] = useState(carInitialFilters);
  const [partsFilters, setPartsFilters] = useState(partsInitialFilters);
  const [plateFilters, setPlateFilters] = useState(plateInitialFilters);
  const [bikeFilters, setBikeFilters] = useState(bikeInitialFilters);
  const [heroQuery, setHeroQuery] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') || '';
    const city = params.get('city') || '';
    const cat = params.get('category') || 'all';

    if (q) {
      setGlobalQuery(q);
      setHeroQuery(q);
      setCarFilters((prev) => ({ ...prev, query: q }));
      setPartsFilters((prev) => ({ ...prev, query: q }));
      setPlateFilters((prev) => ({ ...prev, query: q }));
      setBikeFilters((prev) => ({ ...prev, query: q }));
    }
    if (city) {
      setCarFilters((prev) => ({ ...prev, city }));
      setPlateFilters((prev) => ({ ...prev, city }));
    }
    if (cat && exploreModes.some((m) => m.key === cat)) {
      setActiveMode(cat);
    }
  }, [location.search]);

  const seoData = buildStaticSeo({
    title: activeMode === 'all'
      ? 'Explore UAE Cars, Bikes, Parts & Plates | DPH Classifieds'
      : `${exploreModes.find((mode) => mode.key === activeMode)?.label || 'Explore'} Listings in UAE | DPH Classifieds`,
    description:
      activeMode === 'all'
        ? 'Browse the full UAE marketplace with a premium explore surface for cars, bikes, car parts, and plates.'
        : `Browse ${exploreModes.find((mode) => mode.key === activeMode)?.label?.toLowerCase() || 'listings'} in the UAE marketplace on DPH Classifieds.`,
    path: '/explore',
    keywords: [
      'UAE marketplace',
      'used cars UAE',
      'bikes for sale UAE',
      'car parts UAE',
      'plates Dubai',
    ],
  });

  useEffect(() => {
    let isMounted = true;

    const fetchInventory = async () => {
      setLoading(true);
      setError('');

      const requests = await Promise.allSettled([
        fetchJsonWithCache(`${API_URL}/api/cars?limit=60&order=created_at.desc`),
        fetchJsonWithCache(`${API_URL}/api/bikes?limit=60&order=created_at.desc`),
        fetchJsonWithCache(`${API_URL}/api/parts?limit=60&order=created_at.desc`),
        fetchJsonWithCache(`${API_URL}/api/plates?limit=60&order=created_at.desc`),
      ]);

      if (!isMounted) {
        return;
      }

      const [carsResult, bikesResult, partsResult, platesResult] = requests;
      const nextInventory = {
        cars: carsResult.status === 'fulfilled' ? extractInventoryCollection(carsResult.value, ['cars', 'data']) : [],
        bikes: bikesResult.status === 'fulfilled' ? extractInventoryCollection(bikesResult.value, ['bikes', 'data']) : [],
        parts: partsResult.status === 'fulfilled' ? extractInventoryCollection(partsResult.value, ['parts', 'car_parts', 'data']) : [],
        plates: platesResult.status === 'fulfilled' ? extractInventoryCollection(platesResult.value, ['plates', 'license_plates', 'data']) : [],
      };

      const failedCategories = [];
      if (carsResult.status === 'rejected') failedCategories.push('cars');
      if (bikesResult.status === 'rejected') failedCategories.push('bikes');
      if (partsResult.status === 'rejected') failedCategories.push('car parts');
      if (platesResult.status === 'rejected') failedCategories.push('plates');

      setInventory(nextInventory);
      setError(
        failedCategories.length
          ? `Some inventory could not be loaded right now: ${failedCategories.join(', ')}.`
          : ''
      );
      setLoading(false);
    };

    fetchInventory();

    return () => {
      isMounted = false;
    };
  }, []);

  const normalizedInventory = useMemo(
    () => ({
      cars: inventory.cars.map(normalizeCar),
      bikes: inventory.bikes.map(normalizeBike),
      parts: inventory.parts.map(normalizePart),
      plates: inventory.plates.map(normalizePlate),
    }),
    [inventory]
  );

  const allItems = useMemo(
    () => [
      ...normalizedInventory.cars,
      ...normalizedInventory.parts,
      ...normalizedInventory.plates,
      ...normalizedInventory.bikes,
    ],
    [normalizedInventory]
  );

  const featuredCounts = useMemo(
    () => ({
      all: allItems.length,
      cars: normalizedInventory.cars.length,
      'car-parts': normalizedInventory.parts.length,
      plates: normalizedInventory.plates.length,
      bikes: normalizedInventory.bikes.length,
    }),
    [allItems.length, normalizedInventory]
  );

  const filteredItems = useMemo(() => {
    if (activeMode === 'all') {
      const query = globalQuery.trim().toLowerCase();
      const ranked = allItems
        .map((item) => ({
          ...item,
          relevanceScore: scoreAllMatch(item, query),
        }))
        .filter((item) => !query || item.relevanceScore > 0);

      return ranked.sort((left, right) => {
        if (right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }

        return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
      });
    }

    if (activeMode === 'cars') {
      return normalizedInventory.cars
        .filter((item) => {
          const raw = item.raw;
          const query = carFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(carFilters.priceMin);
          const maxPrice = toNumeric(carFilters.priceMax);

          if (carFilters.manufacturer && normalizeText(raw.car_manufacturer || raw.make) !== carFilters.manufacturer) {
            return false;
          }
          if (carFilters.model && normalizeText(raw.car_model || raw.model) !== carFilters.model) {
            return false;
          }
          if (carFilters.city && normalizeText(raw.car_city || raw.city || raw.location) !== carFilters.city) {
            return false;
          }
          if (minPrice !== null && (item.numericPrice === null || item.numericPrice < minPrice)) {
            return false;
          }
          if (maxPrice !== null && (item.numericPrice === null || item.numericPrice > maxPrice)) {
            return false;
          }
          if (query && !item.searchableText.includes(query)) {
            return false;
          }
          return true;
        })
        .sort((left, right) => compareBySort(left, right, carFilters.sortBy));
    }

    if (activeMode === 'car-parts') {
      return normalizedInventory.parts
        .filter((item) => {
          const raw = item.raw;
          const query = partsFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(partsFilters.priceMin);
          const maxPrice = toNumeric(partsFilters.priceMax);
          const partCategory = normalizeText(raw.category || raw.part_type);

          if (partsFilters.category && partCategory !== partsFilters.category) {
            return false;
          }
          if (minPrice !== null && (item.numericPrice === null || item.numericPrice < minPrice)) {
            return false;
          }
          if (maxPrice !== null && (item.numericPrice === null || item.numericPrice > maxPrice)) {
            return false;
          }
          if (query && !item.searchableText.includes(query)) {
            return false;
          }
          return true;
        })
        .sort((left, right) => compareBySort(left, right, partsFilters.sortBy));
    }

    if (activeMode === 'plates') {
      return normalizedInventory.plates
        .filter((item) => {
          const raw = item.raw;
          const query = plateFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(plateFilters.priceMin);
          const maxPrice = toNumeric(plateFilters.priceMax);
          const digits = normalizeText(raw.digits);

          if (plateFilters.city && item.location !== plateFilters.city) {
            return false;
          }
          if (plateFilters.code && normalizeText(raw.code) !== plateFilters.code) {
            return false;
          }
          if (plateFilters.digits && digits !== plateFilters.digits) {
            return false;
          }
          if (minPrice !== null && (item.numericPrice === null || item.numericPrice < minPrice)) {
            return false;
          }
          if (maxPrice !== null && (item.numericPrice === null || item.numericPrice > maxPrice)) {
            return false;
          }
          if (query && !item.searchableText.includes(query)) {
            return false;
          }
          return true;
        })
        .sort((left, right) => compareBySort(left, right, plateFilters.sortBy));
    }

    return normalizedInventory.bikes
      .filter((item) => {
        const raw = item.raw;
        const query = bikeFilters.query.trim().toLowerCase();
        const minPrice = toNumeric(bikeFilters.priceMin);
        const maxPrice = toNumeric(bikeFilters.priceMax);
        const minYear = toNumeric(bikeFilters.yearMin);
        const maxYear = toNumeric(bikeFilters.yearMax);
        const bikeType = normalizeText(raw.bike_type || raw.type || raw.bike_category);
        const brand = normalizeText(raw.make || raw.manufacturer || raw.bike_brand);
        const year = toNumeric(raw.year || raw.make_year);

        if (bikeFilters.type && bikeType !== bikeFilters.type) {
          return false;
        }
        if (bikeFilters.brand && brand !== bikeFilters.brand) {
          return false;
        }
        if (minPrice !== null && (item.numericPrice === null || item.numericPrice < minPrice)) {
          return false;
        }
        if (maxPrice !== null && (item.numericPrice === null || item.numericPrice > maxPrice)) {
          return false;
        }
        if (minYear !== null && (year === null || year < minYear)) {
          return false;
        }
        if (maxYear !== null && (year === null || year > maxYear)) {
          return false;
        }
        if (query && !item.searchableText.includes(query)) {
          return false;
        }
        return true;
      })
      .sort((left, right) => compareBySort(left, right, bikeFilters.sortBy));
  }, [
    activeMode,
    allItems,
    bikeFilters,
    carFilters,
    globalQuery,
    normalizedInventory,
    partsFilters,
    plateFilters,
  ]);

  const resultsDescription =
    activeMode === 'all'
      ? globalQuery.trim()
        ? `${filteredItems.length} relevant result${filteredItems.length === 1 ? '' : 's'} across the full marketplace.`
        : `${filteredItems.length} live listings across cars, car parts, plates, and bikes.`
      : `${filteredItems.length} result${filteredItems.length === 1 ? '' : 's'} in ${exploreModes.find((mode) => mode.key === activeMode)?.label || 'this category'}.`;

  const handleModeChange = (modeKey) => {
    setActiveMode(modeKey);
  };

  const handleHeroSearch = (query) => {
    const nextQuery = query.trim();
    setHeroQuery(nextQuery);
    setGlobalQuery(nextQuery);
    setCarFilters((prev) => ({ ...prev, query: nextQuery }));
    setPartsFilters((prev) => ({ ...prev, query: nextQuery }));
    setPlateFilters((prev) => ({ ...prev, query: nextQuery }));
    setBikeFilters((prev) => ({ ...prev, query: nextQuery }));
    if (!nextQuery) {
      setActiveMode('all');
    }
  };



  return (
    <>
      <SeoMeta {...seoData} />
      <div className="explore-v2">
      <section className="explore-v2-hero">
        <div className="explore-v2-shell">
          <div className="explore-v2-hero-copy">
            <span className="explore-v2-kicker">Marketplace Hub</span>
            <h1>{categoryMeta[activeMode].heroTitle}</h1>
            <p>
              Explore is now the dedicated marketplace layer on the navbar. Browse everything at once,
              or switch into a category and let the filters adapt around the inventory that actually
              exists there.
            </p>
          </div>

          <div className="explore-v2-hero-search">
            <SearchBar
              value={heroQuery}
              onChange={setHeroQuery}
              onSubmit={handleHeroSearch}
              placeholder="Search cars, parts, plates, bikes..."
              size="large"
              className="explore-v2-hero-searchbar"
            />
          </div>

          <div className="explore-v2-hero-stats">
            {exploreModes.map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`explore-v2-stat ${activeMode === mode.key ? 'is-active' : ''}`}
                onClick={() => handleModeChange(mode.key)}
              >
                <span>{mode.label}</span>
                <small>{featuredCounts[mode.key]}</small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="explore-v2-shell explore-v2-results-section">
        <div className="explore-v2-results-header">
          <div>
            <span className="explore-v2-kicker">Live Inventory</span>
            <h2>{exploreModes.find((mode) => mode.key === activeMode)?.label}</h2>
          </div>
          <p>{resultsDescription}</p>
        </div>

        {loading ? (
          <div className="explore-v2-state-card">
            <ListingSkeleton variant="grid" count={8} />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="explore-v2-state-card">
            <p>No listings matched the current explore settings.</p>
            <div className="explore-v2-filter-actions">
              <button type="button" className="explore-v2-button explore-v2-button-primary" onClick={() => handleModeChange('all')}>
                Back to Explore All
              </button>
            </div>
          </div>
        ) : (
          <div className="explore-v2-horizontal-track">
            {filteredItems.map((item) => (
              <MarketplaceListingCard key={`${item.categoryKey}-${item.id}`} item={item} />
            ))}
          </div>
        )}

        {!loading && error ? <div className="explore-v2-inline-alert">{error}</div> : null}

        <BrowseSellCta category={mapExploreModeToSellCtaCategory(activeMode)} />
      </section>
      </div>
    </>
  );
};

export default ExplorePage;
