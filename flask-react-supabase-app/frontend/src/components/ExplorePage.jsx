import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MarketplaceListingCard from './MarketplaceListingCard';
import ListingSkeleton from './ListingSkeleton';
import SeoMeta from './SeoMeta';
import SearchBar from './ui/search-bar';
import { resolveMediaUrl } from '../utils/media';
import { buildStaticSeo } from '../utils/seo';
import BrowseSellCta from './BrowseSellCta';
import './ExplorePage.css';
import { buildListingRouteState } from '../utils/listingRouteState';
import { buildCarPath } from '../utils/listingUrl';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PAGE_SIZE = 24;
const INVENTORY_CACHE_TTL_MS = 60 * 1000;
const inflightInventoryRequests = new Map();

const EXPLORE_MODE_TO_API_KEY = {
  cars: 'cars',
  bikes: 'bikes',
  'car-parts': 'parts',
  plates: 'plates',
  reddit: 'reddit',
};

const FALLBACK_KEYS = {
  cars: ['cars', 'data'],
  bikes: ['bikes', 'data'],
  parts: ['parts', 'car_parts', 'data'],
  plates: ['plates', 'license_plates', 'data'],
  reddit: ['cars', 'data'], // reddit imports are cars, served by /api/cars
};

const INIT_PAGES = {
  cars: { offset: 0, hasMore: true },
  bikes: { offset: 0, hasMore: true },
  parts: { offset: 0, hasMore: true },
  plates: { offset: 0, hasMore: true },
  reddit: { offset: 0, hasMore: true },
};

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
  { key: 'reddit', label: 'Reddit', description: 'Cars imported from r/DubaiPetrolHeads.' },
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

const PRICE_PRESETS = [
  { label: 'All', min: 0, max: 0 },
  { label: 'Under 50k', min: 0, max: 50000 },
  { label: '50k–100k', min: 50000, max: 100000 },
  { label: '100k–200k', min: 100000, max: 200000 },
  { label: '200k+', min: 200000, max: 0 },
];

const categoryMeta = {
  all: { heroTitle: 'Search the full UAE marketplace with one premium browse surface.' },
  cars: { heroTitle: 'Browse cars with make-aware filters and a cleaner path to detail.' },
  'car-parts': { heroTitle: 'Compare parts and accessories without losing the showroom feel.' },
  plates: { heroTitle: 'Surface premium UAE plates with focused city and code filters.' },
  bikes: { heroTitle: 'Explore motorcycles with the same premium rhythm as the car journey.' },
  reddit: { heroTitle: 'Cars imported from r/DubaiPetrolHeads, in one clean browse surface.' },
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

const getGalleryImages = (item) => {
  const rawImages = Array.isArray(item?.images) ? item.images : [];
  const urls = rawImages
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      return entry.display_url || entry.image_url || entry.url || null;
    })
    .filter(Boolean)
    .map(resolveMediaUrl)
    .filter(Boolean);

  if (urls.length) return urls;
  const primary = getPrimaryImage(item);
  return primary ? [primary] : [];
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
    sourcePlatform: car.source_platform || null,
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
    route: buildCarPath(car),
    routeState: buildListingRouteState(car),
    image: getPrimaryImage(car),
    images: getGalleryImages(car),
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
    sourcePlatform: bike.source_platform || null,
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
    images: getGalleryImages(bike),
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
    sourcePlatform: part.source_platform || null,
    title,
    subtitle: [category, location].filter(Boolean).join(' • '),
    description: normalizeText(part.description || 'Part listing ready to compare.'),
    location,
    priceLabel: formatPrice(price),
    numericPrice: toNumeric(price),
    route: `/car-parts/${part.id}`,
    routeState: buildListingRouteState(part),
    image: getPrimaryImage(part),
    images: getGalleryImages(part),
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
    sourcePlatform: plate.source_platform || null,
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
    images: getGalleryImages(plate),
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

const ExplorePage = ({ forcedCategory } = {}) => {
  const location = useLocation();
  const { user } = useAuth();
  // forcedCategory lets a dedicated route (e.g. /reddit) pin the mode without a
  // ?category= query param, so the URL stays clean.
  const initialCategory = forcedCategory || new URLSearchParams(location.search).get('category') || 'all';
  const [inventory, setInventory] = useState({
    cars: [],
    bikes: [],
    parts: [],
    plates: [],
    reddit: [],
  });
  const [pages, setPages] = useState(INIT_PAGES);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const sentinelRef = useRef(null);
  const isFetchingRef = useRef(false);
  const [activeMode, setActiveMode] = useState(
    exploreModes.some((mode) => mode.key === initialCategory) ? initialCategory : 'all'
  );
  const [globalQuery, setGlobalQuery] = useState('');
  const [carFilters, setCarFilters] = useState(carInitialFilters);
  const [partsFilters, setPartsFilters] = useState(partsInitialFilters);
  const [plateFilters, setPlateFilters] = useState(plateInitialFilters);
  const [bikeFilters, setBikeFilters] = useState(bikeInitialFilters);
  const [redditFilters, setRedditFilters] = useState(carInitialFilters);
  const [heroQuery, setHeroQuery] = useState('');
  const [savingSearch, setSavingSearch] = useState(false);
  const [savedSearchNotice, setSavedSearchNotice] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q') || '';
    const city = params.get('city') || '';
    const cat = forcedCategory || params.get('category') || 'all';

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
  }, [location.search, forcedCategory]);

  const seoData = buildStaticSeo({
    title: activeMode === 'all'
      ? 'Explore UAE Cars, Bikes, Parts & Plates | DPH Classifieds'
      : `${exploreModes.find((mode) => mode.key === activeMode)?.label || 'Explore'} Listings in UAE | DPH Classifieds`,
    description:
      activeMode === 'all'
        ? 'Browse the full UAE marketplace with a premium explore surface for cars, bikes, car parts, and plates.'
        : `Browse ${exploreModes.find((mode) => mode.key === activeMode)?.label?.toLowerCase() || 'listings'} in the UAE marketplace on DPH Classifieds.`,
    path: forcedCategory === 'reddit' ? '/reddit' : '/explore',
    keywords: [
      'UAE marketplace',
      'used cars UAE',
      'bikes for sale UAE',
      'car parts UAE',
      'plates Dubai',
    ],
  });

  // ── fetch one page for one API category ──────────────────────────────────
  const fetchPage = useCallback(async (apiKey, offset) => {
    const ttl = offset === 0 ? INVENTORY_CACHE_TTL_MS : 30_000;
    // Reddit tab aggregates every source_platform=reddit listing across all four
    // types into one feed, each row tagged so it can be normalized correctly.
    // ponytail: fetches up to 250/type in one page (curated import feed is small);
    // raise the cap if Reddit inventory ever grows past that.
    if (apiKey === 'reddit') {
      const types = [['cars', 'car'], ['bikes', 'bike'], ['parts', 'part'], ['plates', 'plate']];
      const chunks = await Promise.all(
        types.map(async ([ep, type]) => {
          const url = `${API_URL}/api/${ep}?limit=250&offset=0&order=created_at.desc&source_platform=reddit`;
          const data = await fetchJsonWithCache(url, ttl);
          return extractInventoryCollection(data, FALLBACK_KEYS[ep] || ['data']).map((row) => ({
            ...row,
            _redditType: type,
          }));
        })
      );
      return chunks.flat();
    }
    const url = `${API_URL}/api/${apiKey}?limit=${PAGE_SIZE}&offset=${offset}&order=created_at.desc`;
    const data = await fetchJsonWithCache(url, ttl);
    return extractInventoryCollection(data, FALLBACK_KEYS[apiKey] || ['data']);
  }, []);

  // ── initial load: only the active category unless "all" is selected ─────
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError('');
      const targets = activeMode === 'all'
        ? ['cars', 'bikes', 'parts', 'plates']
        : [EXPLORE_MODE_TO_API_KEY[activeMode]].filter(Boolean);
      const results = await Promise.allSettled(
        targets.map((apiKey) => fetchPage(apiKey, 0))
      );
      if (!mounted) return;
      const nextInventory = { cars: [], bikes: [], parts: [], plates: [], reddit: [] };
      const nextPages = { ...INIT_PAGES };
      const failed = [];

      targets.forEach((apiKey, index) => {
        const items = results[index].status === 'fulfilled' ? results[index].value : [];
        nextInventory[apiKey] = items;
        nextPages[apiKey] = { offset: 0, hasMore: items.length === PAGE_SIZE };
        if (results[index].status === 'rejected') {
          failed.push(apiKey === 'parts' ? 'car parts' : apiKey);
        }
      });

      setInventory(nextInventory);
      setPages(nextPages);
      setError(failed.length ? `Some inventory could not be loaded: ${failed.join(', ')}.` : '');
      setLoading(false);
    };
    load();
    return () => { mounted = false; };
  }, [activeMode, fetchPage]);

  // ── load more: append next page for the relevant categories ──────────────
  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || loading) return;

    // Which API keys to load more from
    const modeKey = EXPLORE_MODE_TO_API_KEY[activeMode];
    const targets = modeKey ? [modeKey] : ['cars', 'bikes', 'parts', 'plates'];
    const toLoad = targets.filter((k) => pages[k]?.hasMore);
    if (toLoad.length === 0) return;

    isFetchingRef.current = true;
    setLoadingMore(true);

    const results = await Promise.allSettled(
      toLoad.map((k) => fetchPage(k, pages[k].offset + PAGE_SIZE))
    );

    setInventory((prev) => {
      const next = { ...prev };
      toLoad.forEach((k, i) => {
        const items = results[i].status === 'fulfilled' ? results[i].value : [];
        next[k] = [...prev[k], ...items];
      });
      return next;
    });
    setPages((prev) => {
      const next = { ...prev };
      toLoad.forEach((k, i) => {
        const items = results[i].status === 'fulfilled' ? results[i].value : [];
        next[k] = { offset: prev[k].offset + PAGE_SIZE, hasMore: items.length === PAGE_SIZE };
      });
      return next;
    });

    isFetchingRef.current = false;
    setLoadingMore(false);
  }, [activeMode, fetchPage, loading, pages]);

  // Keep a ref so the IntersectionObserver always calls the latest loadMore
  const loadMoreRef = useRef(loadMore);
  useEffect(() => { loadMoreRef.current = loadMore; });

  // ── IntersectionObserver sentinel ─────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMoreRef.current(); },
      { rootMargin: '400px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, activeMode]);

  const normalizedInventory = useMemo(
    () => ({
      cars: inventory.cars.map(normalizeCar),
      bikes: inventory.bikes.map(normalizeBike),
      parts: inventory.parts.map(normalizePart),
      plates: inventory.plates.map(normalizePlate),
      reddit: inventory.reddit.map((row) => {
        if (row._redditType === 'bike') return normalizeBike(row);
        if (row._redditType === 'part') return normalizePart(row);
        if (row._redditType === 'plate') return normalizePlate(row);
        return normalizeCar(row);
      }),
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
      reddit: normalizedInventory.reddit.length,
    }),
    [allItems.length, normalizedInventory]
  );

  const redditMakes = useMemo(
    () => [...new Set(
      normalizedInventory.reddit.map((item) => normalizeText(item.raw?.car_manufacturer)).filter(Boolean)
    )].sort(),
    [normalizedInventory.reddit]
  );

  const redditPriceMax = useMemo(() => {
    const top = Math.max(0, ...normalizedInventory.reddit.map((item) => item.numericPrice || 0));
    return Math.max(50000, Math.ceil(top / 10000) * 10000);
  }, [normalizedInventory.reddit]);

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

    if (activeMode === 'reddit') {
      return normalizedInventory.reddit
        .filter((item) => {
          const raw = item.raw;
          const query = redditFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(redditFilters.priceMin);
          const maxPrice = toNumeric(redditFilters.priceMax);
          if (redditFilters.manufacturer && normalizeText(raw.car_manufacturer || raw.make) !== redditFilters.manufacturer) {
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
        .sort((left, right) => compareBySort(left, right, redditFilters.sortBy));
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
    redditFilters,
  ]);

  const resultsDescription =
    activeMode === 'all'
      ? globalQuery.trim()
        ? `${filteredItems.length} relevant result${filteredItems.length === 1 ? '' : 's'} across the full marketplace.`
        : `${filteredItems.length} live listings across cars, car parts, plates, and bikes.`
      : `${filteredItems.length} result${filteredItems.length === 1 ? '' : 's'} in ${exploreModes.find((mode) => mode.key === activeMode)?.label || 'this category'}.`;

  const activeSearchPayload = useMemo(() => {
    const filtersByMode = {
      all: { query: globalQuery },
      cars: carFilters,
      'car-parts': partsFilters,
      plates: plateFilters,
      bikes: bikeFilters,
      reddit: redditFilters,
    };
    const filters = filtersByMode[activeMode] || {};
    const query = filters.query || globalQuery || heroQuery || '';
    const hasSpecificSignal =
      activeMode !== 'all' ||
      Object.entries(filters).some(([key, value]) => key !== 'sortBy' && String(value || '').trim());
    return {
      category: activeMode,
      query,
      filters,
      result_count: filteredItems.length,
      hasSpecificSignal,
    };
  }, [
    activeMode,
    bikeFilters,
    carFilters,
    filteredItems.length,
    globalQuery,
    heroQuery,
    partsFilters,
    plateFilters,
    redditFilters,
  ]);

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

  const handleSaveSearch = async () => {
    if (!user) {
      setSavedSearchNotice('Log in to save this search.');
      return;
    }
    if (!activeSearchPayload.hasSpecificSignal) {
      setSavedSearchNotice('Add a query or choose a category first.');
      return;
    }

    setSavingSearch(true);
    setSavedSearchNotice('');
    try {
      const label = exploreModes.find((mode) => mode.key === activeMode)?.label || 'Marketplace';
      await apiClient.post('/api/user/saved-searches', {
        ...activeSearchPayload,
        route_path: `${window.location.pathname}${window.location.search}`,
        name: `${label}${activeSearchPayload.query ? `: ${activeSearchPayload.query}` : ''}`,
      });
      setSavedSearchNotice('Search saved.');
    } catch (saveError) {
      setSavedSearchNotice(saveError?.message || 'Could not save this search.');
    } finally {
      setSavingSearch(false);
      window.setTimeout(() => {
        setSavedSearchNotice('');
      }, 3000);
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
            <h1>{(categoryMeta[activeMode] || categoryMeta.all).heroTitle}</h1>
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
          <div className="explore-v2-results-meta">
            <p>{resultsDescription}</p>
            <button
              type="button"
              className="explore-v2-button explore-v2-button-secondary"
              onClick={handleSaveSearch}
              disabled={savingSearch || loading || !activeSearchPayload.hasSpecificSignal}
            >
              {savingSearch ? 'Saving...' : 'Save Search'}
            </button>
            <Link
              to="/my-listings?tab=searches"
              className="explore-v2-button explore-v2-button-secondary"
            >
              View Saved Searches
            </Link>
            {savedSearchNotice ? <span className="explore-v2-save-search-note">{savedSearchNotice}</span> : null}
          </div>
        </div>

        {activeMode === 'reddit' && (
          <div className="explore-v2-filter-panel">
            <div className="explore-v2-filter-grid">
              <label className="explore-v2-field">
                <span>Search</span>
                <input
                  className="explore-v2-input"
                  type="search"
                  value={redditFilters.query}
                  onChange={(e) => setRedditFilters((prev) => ({ ...prev, query: e.target.value }))}
                  placeholder="Make, model, keyword"
                />
              </label>
              <label className="explore-v2-field">
                <span>Make</span>
                <select
                  className="explore-v2-input"
                  value={redditFilters.manufacturer}
                  onChange={(e) => setRedditFilters((prev) => ({ ...prev, manufacturer: e.target.value }))}
                >
                  <option value="">All makes</option>
                  {redditMakes.map((make) => (
                    <option key={make} value={make}>{make}</option>
                  ))}
                </select>
              </label>
              <label className="explore-v2-field">
                <span>Sort</span>
                <select
                  className="explore-v2-input"
                  value={redditFilters.sortBy}
                  onChange={(e) => setRedditFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
                >
                  <option value="newest">Newest</option>
                  <option value="price-low">Price: low to high</option>
                  <option value="price-high">Price: high to low</option>
                </select>
              </label>
              <div className="explore-v2-field rp-price-field">
                <span>Price (AED)</span>
                <div className="rp-presets">
                  {PRICE_PRESETS.map((p) => {
                    const active =
                      redditFilters.priceMin === (p.min ? String(p.min) : '') &&
                      redditFilters.priceMax === (p.max ? String(p.max) : '');
                    return (
                      <button
                        key={p.label}
                        type="button"
                        className={`rp-preset ${active ? 'is-active' : ''}`}
                        onClick={() =>
                          setRedditFilters((prev) => ({
                            ...prev,
                            priceMin: p.min ? String(p.min) : '',
                            priceMax: p.max ? String(p.max) : '',
                          }))
                        }
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <input
                  className="rp-slider"
                  type="range"
                  min="0"
                  max={redditPriceMax}
                  step="5000"
                  value={redditFilters.priceMax ? Number(redditFilters.priceMax) : redditPriceMax}
                  onChange={(e) =>
                    setRedditFilters((prev) => ({
                      ...prev,
                      priceMax: Number(e.target.value) >= redditPriceMax ? '' : e.target.value,
                    }))
                  }
                />
                <div className="rp-slider-label">
                  {redditFilters.priceMax
                    ? `Up to AED ${Number(redditFilters.priceMax).toLocaleString()}`
                    : 'Any price'}
                </div>
              </div>
            </div>
          </div>
        )}

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
          <>
            <div className="explore-v2-horizontal-track">
              {filteredItems.map((item) => (
                <MarketplaceListingCard key={`${item.categoryKey}-${item.id}`} item={item} />
              ))}
            </div>

            {/* Sentinel triggers loadMore via IntersectionObserver */}
            {(() => {
              const modeKey = EXPLORE_MODE_TO_API_KEY[activeMode];
              const hasMore = modeKey
                ? pages[modeKey]?.hasMore
                : Object.values(pages).some((p) => p.hasMore);
              return hasMore ? (
                <div ref={sentinelRef} className="explore-v2-sentinel">
                  {loadingMore && <ListingSkeleton variant="grid" count={4} />}
                </div>
              ) : filteredItems.length > 0 ? (
                <p className="explore-v2-end-label">You've seen all listings.</p>
              ) : null;
            })()}
          </>
        )}

        {!loading && error ? <div className="explore-v2-inline-alert">{error}</div> : null}

        <BrowseSellCta category={mapExploreModeToSellCtaCategory(activeMode)} />
      </section>
      </div>
    </>
  );
};

export default ExplorePage;
