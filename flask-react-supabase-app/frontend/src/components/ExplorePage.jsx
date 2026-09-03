import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, SlidersHorizontal, X } from 'lucide-react';
import { VirtuosoGrid } from 'react-virtuoso';
import MarketplaceListingCard from './MarketplaceListingCard';
import ListingSkeleton from './ListingSkeleton';
import SeoMeta from './SeoMeta';
import SearchBar from './ui/search-bar';
import { resolveMediaUrl } from '../utils/media';
import { buildStaticSeo } from '../utils/seo';
import { UAE_EMIRATES } from '../utils/listingConstants';
import BrowseSellCta from './BrowseSellCta';
import useFeaturedPattern from '../hooks/useFeaturedPattern';
import useDebouncedValue from '../hooks/useDebouncedValue';
import { applyFeaturedPlacement } from '../utils/featuredPlacement';
import './ExplorePage.css';
import { buildListingRouteState } from '../utils/listingRouteState';
import { mergeRedditRows } from '../utils/redditPagination';
import { buildCarPath } from '../utils/listingUrl';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import useListingCounts from '../hooks/useListingCounts';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PAGE_SIZE = 24;
// Keep the client-side inventory buffer bounded as feeds grow. DOM node count
// no longer scales with this (VirtuosoGrid virtualizes the render), but this
// still caps how many parsed listing objects stay resident in memory.
const MAX_LOADED_ITEMS_PER_CATEGORY = 240;
const INVENTORY_CACHE_TTL_MS = 60 * 1000;
const inflightInventoryRequests = new Map();

const EXPLORE_MODE_TO_API_KEY = {
  cars: 'cars',
  bikes: 'bikes',
  'car-parts': 'parts',
  plates: 'plates',
  reddit: 'reddit',
  'buying-requests': 'buying_requests',
};

const FALLBACK_KEYS = {
  cars: ['cars', 'data'],
  bikes: ['bikes', 'data'],
  parts: ['parts', 'car_parts', 'data'],
  plates: ['plates', 'license_plates', 'data'],
  reddit: ['cars', 'data'], // reddit imports are cars, served by /api/cars
  buying_requests: ['data'],
};

// Per-category filter-param builders. Each one returns [urlParam, value]
// pairs to append to the request URL. Keep these in sync with the
// _collect_listing_filter_pairs() whitelist in backend/app.py for the
// matching /api/<category> route — the data route ignores anything not
// in its whitelist, so sending the wrong key just costs bandwidth.
const CATEGORY_FILTER_PARAM_BUILDERS = {
  cars: (filters) => {
    const params = [];
    if (filters.manufacturer) params.push(['car_manufacturer', filters.manufacturer]);
    if (filters.model) params.push(['car_model', filters.model]);
    if (filters.priceMin) params.push(['price_from', filters.priceMin]);
    if (filters.priceMax) params.push(['price_to', filters.priceMax]);
    return params;
  },
  bikes: (filters) => {
    const params = [];
    if (filters.brand) params.push(['bike_brand', filters.brand]);
    if (filters.type) params.push(['bike_type', filters.type]);
    if (filters.area) params.push(['area', filters.area]);
    if (filters.engineSize) params.push(['engine_size', filters.engineSize]);
    if (filters.condition) params.push(['condition', filters.condition]);
    if (filters.priceMin) params.push(['price_from', filters.priceMin]);
    if (filters.priceMax) params.push(['price_to', filters.priceMax]);
    if (filters.yearMin) params.push(['year_from', filters.yearMin]);
    if (filters.yearMax) params.push(['year_to', filters.yearMax]);
    return params;
  },
  // Keyed by API key ('parts'), not the mode key ('car-parts') — fetchPage
  // looks this up via apiKey, which is EXPLORE_MODE_TO_API_KEY['car-parts'].
  parts: (filters) => {
    const params = [];
    if (filters.category) params.push(['part_type', filters.category]);
    if (filters.area) params.push(['area', filters.area]);
    if (filters.condition) params.push(['condition', filters.condition]);
    if (filters.priceMin) params.push(['price_from', filters.priceMin]);
    if (filters.priceMax) params.push(['price_to', filters.priceMax]);
    return params;
  },
  plates: (filters) => {
    const params = [];
    if (filters.code) params.push(['code', filters.code]);
    if (filters.digits) params.push(['digits', filters.digits]);
    if (filters.area) params.push(['area', filters.area]);
    if (filters.priceMin) params.push(['price_from', filters.priceMin]);
    if (filters.priceMax) params.push(['price_to', filters.priceMax]);
    return params;
  },
};

const buildFilteredUrl = (baseUrl, params, locationFilter) => {
  const search = new URLSearchParams();
  params.forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      search.append(key, String(value));
    }
  });
  if (locationFilter) search.append('area', locationFilter);
  const qs = search.toString();
  if (!qs) return baseUrl;
  return baseUrl.includes('?') ? `${baseUrl}&${qs}` : `${baseUrl}?${qs}`;
};

const INIT_PAGES = {
  cars: { offset: 0, hasMore: true },
  bikes: { offset: 0, hasMore: true },
  parts: { offset: 0, hasMore: true },
  plates: { offset: 0, hasMore: true },
  // Reddit merges 4 endpoints into one date-sorted feed; it pages by cursor
  // (the created_at of the last merged row) instead of a numeric offset —
  // see fetchPage's 'reddit' branch for why.
  reddit: { cursor: null, hasMore: true },
  // /api/buying-requests has no pagination — it always returns the full
  // active list in one shot, so this mode never has a "next page".
  buying_requests: { offset: 0, hasMore: false },
};

const BUYING_REQUEST_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'car', label: 'Cars' },
  { value: 'plate', label: 'Plates' },
  { value: 'part', label: 'Parts' },
  { value: 'bike', label: 'Bikes' },
];

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
  { key: 'all', label: 'All', description: 'Search everything in one place.' },
  { key: 'cars', label: 'Cars', description: 'Luxury, commuter, and enthusiast cars.' },
  { key: 'car-parts', label: 'Car Parts', description: 'Parts, upgrades, and accessories.' },
  { key: 'plates', label: 'Plates', description: 'Premium UAE number plates.' },
  { key: 'bikes', label: 'Bikes', description: 'Sport, cruiser, and specialty bikes.' },
  { key: 'reddit', label: 'Reddit', description: 'Cars imported from r/DubaiPetrolHeads.' },
  { key: 'buying-requests', label: 'WTB', description: 'Want-to-buy requests from other members.' },
];

const carInitialFilters = {
  query: '',
  manufacturer: '',
  model: '',
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

const mapExploreModeToSellCtaCategory = (modeKey) => {
  if (modeKey === 'car-parts') return 'parts';
  if (modeKey === 'all') return 'cars';
  return modeKey;
};

const POST_HREF_BY_CATEGORY = {
  cars: '/post-car',
  parts: '/post-car-parts',
  plates: '/post-plate',
  bikes: '/post-bike',
  'buying-requests': '/post-buying-request',
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

const priceRangeLabel = (filters) => {
  const min = filters.priceMin ? Number(filters.priceMin).toLocaleString() : null;
  const max = filters.priceMax ? Number(filters.priceMax).toLocaleString() : null;
  if (min && max) return `AED ${min}–${max}`;
  if (min) return `AED ${min}+`;
  return `Up to AED ${max}`;
};

const normalizeText = (value) => (value ? String(value).trim() : '');

const distinctValues = (items, getter) =>
  [...new Set(items.map((item) => normalizeText(getter(item))).filter(Boolean))].sort();

const getPrimaryImage = (item) => {
  const candidate =
    item?.primary_image_url ||
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

  if (sortBy === 'oldest') {
    return Date.parse(left.createdAt || '') - Date.parse(right.createdAt || '');
  }

  return Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '');
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
    sellerDealerVerified: Boolean(car.seller_dealer_verified),
    sellerName: car.seller_name || null,
    manufacturer: make,
    model,
    city: location,
    searchableText: buildSearchableText([
      title,
      year,
      make,
      model,
      trim,
      car.description,
      location,
    ]),
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
    sellerDealerVerified: Boolean(bike.seller_dealer_verified),
    sellerName: bike.seller_name || null,
    brand,
    bikeType,
    yearValue: toNumeric(year),
    searchableText: buildSearchableText([
      title,
      brand,
      model,
      bikeType,
      bike.description,
    ]),
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
    sellerDealerVerified: Boolean(part.seller_dealer_verified),
    sellerName: part.seller_name || null,
    partCategory: category,
    searchableText: buildSearchableText([
      title,
      category,
      part.description,
      location,
    ]),
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
    sellerDealerVerified: Boolean(plate.seller_dealer_verified),
    sellerName: plate.seller_name || null,
    numberValue: plateNumber,
    cityValue: location,
    codeValue: plateCode,
    digitsValue: digits,
    searchableText: buildSearchableText([
      title,
      plateCode,
      plateNumber,
      digits,
      location,
      plate.description,
    ]),
  };
};

const normalizeBuyingRequest = (row) => {
  const itemType = normalizeText(row.item_type).toLowerCase();
  const title = normalizeText(row.item_name) || 'Buying request';
  const budget = row.budget;

  return {
    id: row.id,
    categoryKey: 'buying-requests',
    categoryLabel: 'WTB',
    itemType,
    title,
    subtitle: [itemType ? itemType.toUpperCase() : null, row.regional_spec]
      .filter(Boolean)
      .join(' • '),
    description: normalizeText(row.reference_notes || row.mileage_preference || 'Want-to-buy request from a DPH member.'),
    location: 'UAE',
    priceLabel: budget ? formatPrice(budget) : 'Budget on request',
    numericPrice: toNumeric(budget),
    route: `/buying-requests/${row.id}`,
    image: getPrimaryImage(row),
    images: getGalleryImages(row),
    createdAt: row.created_at,
    searchableText: buildSearchableText([
      title,
      itemType,
      row.car_manufacturer,
      row.car_model,
      row.trim,
      row.regional_spec,
      row.reference_notes,
    ]),
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

// Mirrors the card markup in BuyingRequestsPage.jsx — WTB requests don't fit
// MarketplaceListingCard's price/mileage/km shape, so they get their own
// lightweight card instead of stretching the shared component.
const BuyingRequestCard = ({ item }) => (
  <Link to={item.route} className="explore-v2-wtb-card">
    <div className="explore-v2-wtb-card-image">
      {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : <span>WTB</span>}
    </div>
    <div className="explore-v2-wtb-card-body">
      <span className="explore-v2-wtb-card-kicker">Want to buy</span>
      <h3>{item.title}</h3>
      {item.subtitle ? <p>{item.subtitle}</p> : null}
      <span className="explore-v2-wtb-card-budget">{item.priceLabel}</span>
    </div>
  </Link>
);

const ExplorePage = ({ forcedCategory } = {}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const featuredPattern = useFeaturedPattern();
  const [featuredByCategory, setFeaturedByCategory] = useState({ cars: [], bikes: [], parts: [], plates: [] });
  // forcedCategory lets a dedicated route (e.g. /reddit) pin the mode without a
  // ?category= query param, so the URL stays clean.
  const initialCategory = forcedCategory || searchParams.get('category') || 'all';
  const [inventory, setInventory] = useState({
    cars: [],
    bikes: [],
    parts: [],
    plates: [],
    reddit: [],
    buying_requests: [],
  });
  const [pages, setPages] = useState(INIT_PAGES);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const isFetchingRef = useRef(false);
  // Last-loaded count per category. Used as the tab-count placeholder so the
  // user never sees an em-dash while /api/listings/counts is in flight, and
  // as the ONLY source for reddit/buying-requests (that endpoint has no total
  // for either — see /api/listings/counts). Must be real state, not a ref:
  // it's read during render, and a ref mutation alone doesn't trigger the
  // re-render needed to show an updated count immediately.
  const [knownCounts, setKnownCounts] = useState({});
  const [activeMode, setActiveMode] = useState(
    exploreModes.some((mode) => mode.key === initialCategory) ? initialCategory : 'all'
  );
  const [globalQuery, setGlobalQuery] = useState('');
  const [carFilters, setCarFilters] = useState(carInitialFilters);
  const [partsFilters, setPartsFilters] = useState(partsInitialFilters);
  const [plateFilters, setPlateFilters] = useState(plateInitialFilters);
  const [bikeFilters, setBikeFilters] = useState(bikeInitialFilters);
  const [redditFilters, setRedditFilters] = useState(carInitialFilters);
  const [buyingRequestFilters, setBuyingRequestFilters] = useState({ query: '', itemType: 'all' });
  const [locationFilter, setLocationFilter] = useState('');
  // All three default on. toggleSource() below refuses to leave all off.
  const [sourceFilter, setSourceFilter] = useState({ private: true, dealer: true, reddit: true });

  // Counts are scoped to the active mode's filter spec; each /api/<category>
  // route ignores params outside its whitelist, so passing the full bag is
  // safe and keeps counts in lockstep with the data route the user is on.
  // Strip query/sortBy — those aren't in any backend spec.
  const activeFiltersByMode = {
    cars: carFilters,
    bikes: bikeFilters,
    'car-parts': partsFilters,
    plates: plateFilters,
    reddit: redditFilters,
  };
  const activeFilterBase = activeFiltersByMode[activeMode] || {};
  const { query: _q, sortBy: _s, ...activeFilterPayload } = activeFilterBase;
  const totalCounts = useListingCounts(activeFilterPayload);
  const [allSortBy, setAllSortBy] = useState('newest');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [heroQuery, setHeroQuery] = useState('');
  const [savingSearch, setSavingSearch] = useState(false);
  const [savedSearchNotice, setSavedSearchNotice] = useState('');

  // Debounced views of every filter object: inputs stay instantly responsive
  // (they're controlled by the raw state above), but the expensive filter+sort
  // recompute below only re-runs once typing pauses for 300ms, instead of on
  // every keystroke in a price/year/search field.
  const debouncedGlobalQuery = useDebouncedValue(globalQuery, 300);
  const debouncedCarFilters = useDebouncedValue(carFilters, 300);
  const debouncedPartsFilters = useDebouncedValue(partsFilters, 300);
  const debouncedPlateFilters = useDebouncedValue(plateFilters, 300);
  const debouncedBikeFilters = useDebouncedValue(bikeFilters, 300);
  const debouncedRedditFilters = useDebouncedValue(redditFilters, 300);
  const debouncedBuyingRequestFilters = useDebouncedValue(buyingRequestFilters, 300);

  // ── one-way-ish read from the URL: applies on mount, and again if the URL
  // changes from outside this page (back/forward, a saved-search link) ─────
  useEffect(() => {
    const q = searchParams.get('q') || '';
    const city = searchParams.get('city') || '';
    const source = searchParams.get('source') || '';
    const sort = searchParams.get('sort') || '';
    const cat = forcedCategory || searchParams.get('category') || 'all';

    if (q) {
      setGlobalQuery(q);
      setHeroQuery(q);
      setCarFilters((prev) => ({ ...prev, query: q }));
      setPartsFilters((prev) => ({ ...prev, query: q }));
      setPlateFilters((prev) => ({ ...prev, query: q }));
      setBikeFilters((prev) => ({ ...prev, query: q }));
    }
    if (city) {
      setLocationFilter(city);
    }
    if (source) {
      const included = new Set(source.split(','));
      if (included.size > 0) {
        setSourceFilter({
          private: included.has('private'),
          dealer: included.has('dealer'),
          reddit: included.has('reddit'),
        });
      }
    }
    if (sort) {
      setCarFilters((prev) => ({ ...prev, sortBy: sort }));
      setPartsFilters((prev) => ({ ...prev, sortBy: sort }));
      setPlateFilters((prev) => ({ ...prev, sortBy: sort }));
      setBikeFilters((prev) => ({ ...prev, sortBy: sort }));
      setRedditFilters((prev) => ({ ...prev, sortBy: sort }));
      setAllSortBy(sort);
    }
    if (cat && exploreModes.some((m) => m.key === cat)) {
      setActiveMode(cat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, forcedCategory]);

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
    // Reddit's "offset" arg is a cursor string; null means page one there too.
    const ttl = (offset === 0 || offset === null || offset === undefined) ? INVENTORY_CACHE_TTL_MS : 30_000;
    // Reddit tab merges 4 endpoints into one date-sorted feed. `offset` here is
    // actually a cursor string (or null for page one) — the created_at of the
    // last row returned by the previous merged page. Each of the 4 endpoints is
    // paged with that SAME cursor and a flat PAGE_SIZE limit (not a growing
    // "offset+PAGE_SIZE+1" prefix that re-downloads more with every page), then
    // merge-sorted and the top PAGE_SIZE kept — the standard k-way-merge
    // pattern for paginating several independently-sorted sources as one feed.
    if (apiKey === 'reddit') {
      const cursor = offset || null;
      const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const types = [['cars', 'car'], ['bikes', 'bike'], ['parts', 'part'], ['plates', 'plate']];
      const chunks = await Promise.all(
        types.map(async ([ep, type]) => {
          const url = `${API_URL}/api/${ep}?limit=${PAGE_SIZE}&order=created_at.desc&source_platform=reddit${cursorParam}`;
          const data = await fetchJsonWithCache(url, ttl);
          return extractInventoryCollection(data, FALLBACK_KEYS[ep] || ['data']).map((row) => ({
            ...row,
            _redditType: type,
          }));
        })
      );
      const merged = mergeRedditRows(chunks);
      const items = merged.slice(0, PAGE_SIZE);
      const lastItem = items[items.length - 1];
      const nextCursor = lastItem ? (lastItem.created_at || lastItem.source_created_at || null) : cursor;
      return {
        items,
        hasMore: chunks.some((chunk) => chunk.length === PAGE_SIZE),
        nextCursor,
      };
    }
    // /api/buying-requests ignores limit/offset — it always returns the full
    // active list, so fetch it once regardless of the requested offset.
    if (apiKey === 'buying_requests') {
      const url = `${API_URL}/api/buying-requests`;
      const data = await fetchJsonWithCache(url, ttl);
      return {
        items: extractInventoryCollection(data, FALLBACK_KEYS.buying_requests),
        hasMore: false,
      };
    }
    // Source filter has 3 independent toggles (private/dealer/reddit), but the
    // backend only knows how to include-or-exclude Reddit rows — private vs
    // dealer is decided client-side afterwards via sellerDealerVerified (see
    // matchesSource in filteredItems). Every browse route EXCLUDES Reddit rows
    // by default (confirmed: /api/cars with no params returns 0 reddit rows
    // locally) — it only returns them when source_platform=reddit is passed
    // explicitly. So when the user wants BOTH DPH and Reddit (the default
    // state), a single request can never surface both; two parallel requests
    // are required and merged client-side.
    const wantsDph = sourceFilter.private || sourceFilter.dealer;
    const wantsReddit = sourceFilter.reddit;
    const baseUrl = `${API_URL}/api/${apiKey}?limit=${PAGE_SIZE}&offset=${offset}&order=created_at.desc`;
    const fallbackKeys = FALLBACK_KEYS[apiKey] || ['data'];

    // Debounced filters, not raw state: fetchPage's identity feeds the
    // initial-load effect below, so reading raw (per-keystroke) filters here
    // would re-hit the network on every keystroke instead of after typing
    // pauses — the exact problem debouncing exists to avoid.
    const filtersByMode = {
      cars: debouncedCarFilters,
      bikes: debouncedBikeFilters,
      parts: debouncedPartsFilters,
      plates: debouncedPlateFilters,
      reddit: debouncedRedditFilters,
    };
    const builder = CATEGORY_FILTER_PARAM_BUILDERS[apiKey];
    const filterParams = builder ? builder(filtersByMode[apiKey] || {}) : [];

    if (wantsDph && wantsReddit) {
      const [dphData, redditData] = await Promise.all([
        fetchJsonWithCache(buildFilteredUrl(`${baseUrl}&exclude_reddit=true`, filterParams, locationFilter), ttl),
        fetchJsonWithCache(buildFilteredUrl(`${baseUrl}&source_platform=reddit`, filterParams, locationFilter), ttl),
      ]);
      const dphItems = extractInventoryCollection(dphData, fallbackKeys);
      const redditItems = extractInventoryCollection(redditData, fallbackKeys);
      return {
        items: [...dphItems, ...redditItems],
        hasMore: dphItems.length === PAGE_SIZE || redditItems.length === PAGE_SIZE,
      };
    }

    const sourceParam = !wantsReddit ? '&exclude_reddit=true' : '&source_platform=reddit';
    const data = await fetchJsonWithCache(
      buildFilteredUrl(`${baseUrl}${sourceParam}`, filterParams, locationFilter),
      ttl
    );
    const items = extractInventoryCollection(data, fallbackKeys);
    return { items, hasMore: items.length === PAGE_SIZE };
  }, [sourceFilter, locationFilter, debouncedCarFilters, debouncedBikeFilters, debouncedPartsFilters, debouncedPlateFilters, debouncedRedditFilters]);

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
      const nextInventory = { cars: [], bikes: [], parts: [], plates: [], reddit: [], buying_requests: [] };
      const nextPages = { ...INIT_PAGES };
      const failed = [];

      targets.forEach((apiKey, index) => {
        const page = results[index].status === 'fulfilled'
          ? results[index].value
          : { items: [], hasMore: false };
        const items = (page.items || []).slice(0, MAX_LOADED_ITEMS_PER_CATEGORY);
        nextInventory[apiKey] = items;
        nextPages[apiKey] = apiKey === 'reddit'
          ? { cursor: page.nextCursor || null, hasMore: page.hasMore === true }
          : { offset: 0, hasMore: page.hasMore === true };
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

  // ── featured listings for placement — plain fetch(), not apiClient, since
  // apiClient throws for anyone not logged in and this is a public read ────
  useEffect(() => {
    const targets = activeMode === 'all'
      ? ['cars', 'bikes', 'parts', 'plates']
      : [EXPLORE_MODE_TO_API_KEY[activeMode]].filter((k) => ['cars', 'bikes', 'parts', 'plates'].includes(k));
    if (!targets.length) return undefined;
    const singular = { cars: 'car', bikes: 'bike', parts: 'part', plates: 'plate' };
    let mounted = true;
    Promise.allSettled(
      targets.map((apiKey) => fetchJsonWithCache(`${API_URL}/api/featured-listings?type=${singular[apiKey]}`))
    ).then((results) => {
      if (!mounted) return;
      setFeaturedByCategory((prev) => {
        const next = { ...prev };
        targets.forEach((apiKey, index) => {
          next[apiKey] = results[index].status === 'fulfilled' && Array.isArray(results[index].value)
            ? results[index].value
            : [];
        });
        return next;
      });
    });
    return () => { mounted = false; };
  }, [activeMode]);

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
      toLoad.map((k) => fetchPage(k, k === 'reddit' ? pages.reddit.cursor : pages[k].offset + PAGE_SIZE))
    );

    setInventory((prev) => {
      const next = { ...prev };
      toLoad.forEach((k, i) => {
        const page = results[i].status === 'fulfilled'
          ? results[i].value
          : { items: [], hasMore: false };
        const items = page.items || [];
        next[k] = [...prev[k], ...items].slice(0, MAX_LOADED_ITEMS_PER_CATEGORY);
      });
      return next;
    });
    setPages((prev) => {
      const next = { ...prev };
      toLoad.forEach((k, i) => {
        const page = results[i].status === 'fulfilled'
          ? results[i].value
          : { items: [], hasMore: false };
        next[k] = k === 'reddit'
          ? { cursor: page.nextCursor || prev.reddit.cursor, hasMore: page.hasMore === true }
          : { offset: prev[k].offset + PAGE_SIZE, hasMore: page.hasMore === true };
      });
      return next;
    });

    isFetchingRef.current = false;
    setLoadingMore(false);
  }, [activeMode, fetchPage, loading, pages]);

  // Escape closes the filter drawer regardless of where focus landed inside it.
  useEffect(() => {
    if (!filterDrawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setFilterDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [filterDrawerOpen]);

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
      buying_requests: inventory.buying_requests.map(normalizeBuyingRequest),
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
      'buying-requests': normalizedInventory.buying_requests.length,
    }),
    [allItems.length, normalizedInventory]
  );

  // Learn the count for whichever category the fetch that just completed
  // actually targeted. Switching category replaces `inventory` wholesale
  // (see the initial-load effect above), which zeroes out every OTHER
  // category's normalizedInventory — so only merge in the key(s) actually
  // targeted here, or a previously-learned Reddit/WTB count would get
  // clobbered back to 0 the moment the user switches to Cars.
  useEffect(() => {
    if (loading) return;
    const targets = activeMode === 'all'
      ? ['all', 'cars', 'car-parts', 'plates', 'bikes']
      : [activeMode];
    setKnownCounts((prev) => {
      let changed = false;
      const next = { ...prev };
      targets.forEach((key) => {
        if (featuredCounts[key] !== undefined && prev[key] !== featuredCounts[key]) {
          next[key] = featuredCounts[key];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [loading, featuredCounts, activeMode]);

  const redditMakes = useMemo(
    () => distinctValues(normalizedInventory.reddit, (item) => item.manufacturer || item.brand),
    [normalizedInventory.reddit]
  );

  const redditPriceMax = useMemo(() => {
    const top = Math.max(0, ...normalizedInventory.reddit.map((item) => item.numericPrice || 0));
    return Math.max(50000, Math.ceil(top / 10000) * 10000);
  }, [normalizedInventory.reddit]);

  const carMakes = useMemo(
    () => distinctValues(normalizedInventory.cars, (item) => item.manufacturer),
    [normalizedInventory.cars]
  );
  const carModels = useMemo(() => {
    const pool = carFilters.manufacturer
      ? normalizedInventory.cars.filter((item) => normalizeText(item.manufacturer) === carFilters.manufacturer)
      : normalizedInventory.cars;
    return distinctValues(pool, (item) => item.model);
  }, [normalizedInventory.cars, carFilters.manufacturer]);
  const partCategories = useMemo(
    () => distinctValues(normalizedInventory.parts, (item) => item.partCategory),
    [normalizedInventory.parts]
  );
  const bikeTypes = useMemo(
    () => distinctValues(normalizedInventory.bikes, (item) => item.bikeType),
    [normalizedInventory.bikes]
  );
  const bikeBrands = useMemo(
    () => distinctValues(normalizedInventory.bikes, (item) => item.brand),
    [normalizedInventory.bikes]
  );
  const plateDigitOptions = useMemo(
    () => distinctValues(normalizedInventory.plates, (item) => item.digitsValue),
    [normalizedInventory.plates]
  );

  const filteredItems = useMemo(() => {
    const matchesLocation = (item) => !locationFilter || item.location === locationFilter;
    // Reddit rows are always Reddit; everything else is a DPHClassifieds
    // listing, split into private-seller vs dealer via sellerDealerVerified.
    const matchesSource = (item) => {
      if (item.sourcePlatform === 'reddit') return sourceFilter.reddit;
      return item.sellerDealerVerified ? sourceFilter.dealer : sourceFilter.private;
    };
    const matchesLocationAndSource = (item) => matchesLocation(item) && matchesSource(item);

    if (activeMode === 'all') {
      const query = debouncedGlobalQuery.trim().toLowerCase();
      const ranked = allItems
        .filter(matchesLocationAndSource)
        .map((item) => ({
          ...item,
          relevanceScore: scoreAllMatch(item, query),
        }))
        .filter((item) => !query || item.relevanceScore > 0);

      return ranked.sort((left, right) => {
        if (query && right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }
        return compareBySort(left, right, allSortBy);
      });
    }

    if (activeMode === 'reddit') {
      return normalizedInventory.reddit
        .filter(matchesLocation)
        .filter((item) => {
          const query = debouncedRedditFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(debouncedRedditFilters.priceMin);
          const maxPrice = toNumeric(debouncedRedditFilters.priceMax);
          if (debouncedRedditFilters.manufacturer && normalizeText(item.manufacturer || item.brand) !== debouncedRedditFilters.manufacturer) {
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
        .sort((left, right) => compareBySort(left, right, debouncedRedditFilters.sortBy));
    }

    if (activeMode === 'cars') {
      return normalizedInventory.cars
        .filter(matchesLocationAndSource)
        .filter((item) => {
          const query = debouncedCarFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(debouncedCarFilters.priceMin);
          const maxPrice = toNumeric(debouncedCarFilters.priceMax);

          if (debouncedCarFilters.manufacturer && normalizeText(item.manufacturer) !== debouncedCarFilters.manufacturer) {
            return false;
          }
          if (debouncedCarFilters.model && normalizeText(item.model) !== debouncedCarFilters.model) {
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
        .sort((left, right) => compareBySort(left, right, debouncedCarFilters.sortBy));
    }

    if (activeMode === 'car-parts') {
      return normalizedInventory.parts
        .filter(matchesLocationAndSource)
        .filter((item) => {
          const query = debouncedPartsFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(debouncedPartsFilters.priceMin);
          const maxPrice = toNumeric(debouncedPartsFilters.priceMax);
          const partCategory = normalizeText(item.partCategory);

          if (debouncedPartsFilters.category && partCategory !== debouncedPartsFilters.category) {
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
        .sort((left, right) => compareBySort(left, right, debouncedPartsFilters.sortBy));
    }

    if (activeMode === 'plates') {
      return normalizedInventory.plates
        .filter(matchesLocationAndSource)
        .filter((item) => {
          const query = debouncedPlateFilters.query.trim().toLowerCase();
          const minPrice = toNumeric(debouncedPlateFilters.priceMin);
          const maxPrice = toNumeric(debouncedPlateFilters.priceMax);
          const digits = normalizeText(item.digitsValue);

          if (debouncedPlateFilters.code && normalizeText(item.codeValue) !== debouncedPlateFilters.code) {
            return false;
          }
          if (debouncedPlateFilters.digits && digits !== debouncedPlateFilters.digits) {
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
        .sort((left, right) => compareBySort(left, right, debouncedPlateFilters.sortBy));
    }

    if (activeMode === 'buying-requests') {
      return normalizedInventory.buying_requests
        .filter((item) => {
          const query = debouncedBuyingRequestFilters.query.trim().toLowerCase();
          if (debouncedBuyingRequestFilters.itemType !== 'all' && item.itemType !== debouncedBuyingRequestFilters.itemType) {
            return false;
          }
          if (query && !item.searchableText.includes(query)) {
            return false;
          }
          return true;
        })
        .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''));
    }

    return normalizedInventory.bikes
      .filter(matchesLocationAndSource)
      .filter((item) => {
        const query = debouncedBikeFilters.query.trim().toLowerCase();
        const minPrice = toNumeric(debouncedBikeFilters.priceMin);
        const maxPrice = toNumeric(debouncedBikeFilters.priceMax);
        const minYear = toNumeric(debouncedBikeFilters.yearMin);
        const maxYear = toNumeric(debouncedBikeFilters.yearMax);
        const bikeType = normalizeText(item.bikeType);
        const brand = normalizeText(item.brand);
        const year = item.yearValue;

        if (debouncedBikeFilters.type && bikeType !== debouncedBikeFilters.type) {
          return false;
        }
        if (debouncedBikeFilters.brand && brand !== debouncedBikeFilters.brand) {
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
      .sort((left, right) => compareBySort(left, right, debouncedBikeFilters.sortBy));
  }, [
    activeMode,
    allItems,
    allSortBy,
    debouncedBikeFilters,
    debouncedBuyingRequestFilters,
    debouncedCarFilters,
    debouncedGlobalQuery,
    locationFilter,
    normalizedInventory,
    debouncedPartsFilters,
    debouncedPlateFilters,
    debouncedRedditFilters,
    sourceFilter,
  ]);

  const normalizedFeatured = useMemo(() => {
    const rowsToItems = (rows, normalize) =>
      (rows || [])
        .filter((row) => row.listing)
        .map((row) => ({ ...normalize(row.listing), is_featured: true, featured_highlight: row.highlight !== false }));
    return {
      cars: rowsToItems(featuredByCategory.cars, normalizeCar),
      bikes: rowsToItems(featuredByCategory.bikes, normalizeBike),
      parts: rowsToItems(featuredByCategory.parts, normalizePart),
      plates: rowsToItems(featuredByCategory.plates, normalizePlate),
    };
  }, [featuredByCategory]);

  // Featured placement only reorders the default, unfiltered/unsorted view —
  // once someone searches, filters, or explicitly re-sorts, they get plain
  // relevance/price order, not promotional interleaving.
  const isDefaultOrder = useMemo(() => {
    const sourceIsDefault = sourceFilter.private && sourceFilter.dealer && sourceFilter.reddit;
    if (!sourceIsDefault || locationFilter) return false;
    if (activeMode === 'all') return !debouncedGlobalQuery.trim() && allSortBy === 'newest';
    if (activeMode === 'cars') {
      return !debouncedCarFilters.query.trim() && debouncedCarFilters.sortBy === 'newest' && !debouncedCarFilters.manufacturer
        && !debouncedCarFilters.model && !debouncedCarFilters.priceMin && !debouncedCarFilters.priceMax;
    }
    if (activeMode === 'car-parts') {
      return !debouncedPartsFilters.query.trim() && debouncedPartsFilters.sortBy === 'newest' && !debouncedPartsFilters.category
        && !debouncedPartsFilters.priceMin && !debouncedPartsFilters.priceMax;
    }
    if (activeMode === 'plates') {
      return !debouncedPlateFilters.query.trim() && debouncedPlateFilters.sortBy === 'newest'
        && !debouncedPlateFilters.code && !debouncedPlateFilters.digits && !debouncedPlateFilters.priceMin && !debouncedPlateFilters.priceMax;
    }
    if (activeMode === 'bikes') {
      return !debouncedBikeFilters.query.trim() && debouncedBikeFilters.sortBy === 'newest' && !debouncedBikeFilters.type
        && !debouncedBikeFilters.brand && !debouncedBikeFilters.priceMin && !debouncedBikeFilters.priceMax
        && !debouncedBikeFilters.yearMin && !debouncedBikeFilters.yearMax;
    }
    return false; // reddit, buying-requests: no featured placement
  }, [activeMode, debouncedGlobalQuery, allSortBy, debouncedCarFilters, debouncedPartsFilters, debouncedPlateFilters, debouncedBikeFilters, locationFilter, sourceFilter]);

  const displayedItems = useMemo(() => {
    if (!isDefaultOrder) return filteredItems;
    const featuredPool = activeMode === 'all'
      ? [...normalizedFeatured.cars, ...normalizedFeatured.parts, ...normalizedFeatured.plates, ...normalizedFeatured.bikes]
      : normalizedFeatured[EXPLORE_MODE_TO_API_KEY[activeMode]] || [];
    return applyFeaturedPlacement(filteredItems, featuredPool, featuredPattern, (item) => `${item.categoryKey}-${item.id}`);
  }, [filteredItems, normalizedFeatured, featuredPattern, isDefaultOrder, activeMode]);

  const activeTotalKey = activeMode === 'all' ? 'all' : EXPLORE_MODE_TO_API_KEY[activeMode];
  const activeTotal = totalCounts && activeTotalKey && totalCounts[activeTotalKey] !== undefined
    ? totalCounts[activeTotalKey]
    : null;

  const resultsDescription =
    activeMode === 'all'
      ? globalQuery.trim()
        ? `${filteredItems.length} relevant result${filteredItems.length === 1 ? '' : 's'} across the full marketplace.`
        : `${(activeTotal ?? filteredItems.length).toLocaleString()} live listings across cars, car parts, plates, and bikes.`
      : `${(activeTotal ?? filteredItems.length).toLocaleString()} total result${(activeTotal ?? filteredItems.length) === 1 ? '' : 's'} in ${exploreModes.find((mode) => mode.key === activeMode)?.label || 'this category'}${filteredItems.length < (activeTotal ?? filteredItems.length) ? ` — ${filteredItems.length.toLocaleString()} loaded` : ''}.`;

  const activeSearchPayload = useMemo(() => {
    const filtersByMode = {
      all: { query: globalQuery },
      cars: carFilters,
      'car-parts': partsFilters,
      plates: plateFilters,
      bikes: bikeFilters,
      reddit: redditFilters,
      'buying-requests': buyingRequestFilters,
    };
    const filters = { ...(filtersByMode[activeMode] || {}), location: locationFilter, source: sourceFilter };
    const query = filters.query || globalQuery || heroQuery || '';
    const hasSpecificSignal =
      activeMode !== 'all' ||
      Boolean(locationFilter) ||
      !sourceFilter.private || !sourceFilter.dealer || !sourceFilter.reddit ||
      Object.entries(filters).some(([key, value]) => !['sortBy', 'location', 'source'].includes(key) && String(value || '').trim());
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
    buyingRequestFilters,
    carFilters,
    filteredItems.length,
    globalQuery,
    heroQuery,
    locationFilter,
    partsFilters,
    plateFilters,
    redditFilters,
    sourceFilter,
  ]);

  // ── keep the URL in sync with the visible filter state (shareable,
  // survives refresh/back-forward) — replace, not push, so every keystroke
  // doesn't spam browser history ────────────────────────────────────────────
  const activeSortBy = activeMode === 'all' ? allSortBy
    : activeMode === 'cars' ? carFilters.sortBy
    : activeMode === 'car-parts' ? partsFilters.sortBy
    : activeMode === 'plates' ? plateFilters.sortBy
    : activeMode === 'bikes' ? bikeFilters.sortBy
    : activeMode === 'reddit' ? redditFilters.sortBy
    : 'newest';

  useEffect(() => {
    if (forcedCategory) return; // /reddit keeps a clean URL
    const params = new URLSearchParams();
    if (activeMode !== 'all') params.set('category', activeMode);
    if (locationFilter) params.set('city', locationFilter);
    if (!sourceFilter.private || !sourceFilter.dealer || !sourceFilter.reddit) {
      const included = ['private', 'dealer', 'reddit'].filter((key) => sourceFilter[key]);
      params.set('source', included.join(','));
    }
    if (activeSortBy && activeSortBy !== 'newest') params.set('sort', activeSortBy);
    const q = globalQuery.trim();
    if (q) params.set('q', q);
    setSearchParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMode, locationFilter, sourceFilter, activeSortBy, globalQuery, forcedCategory]);

  const handleModeChange = (modeKey) => {
    setActiveMode(modeKey);
  };

  const handleSortChange = (value) => {
    if (activeMode === 'all') setAllSortBy(value);
    else if (activeMode === 'cars') setCarFilters((prev) => ({ ...prev, sortBy: value }));
    else if (activeMode === 'car-parts') setPartsFilters((prev) => ({ ...prev, sortBy: value }));
    else if (activeMode === 'plates') setPlateFilters((prev) => ({ ...prev, sortBy: value }));
    else if (activeMode === 'bikes') setBikeFilters((prev) => ({ ...prev, sortBy: value }));
    else if (activeMode === 'reddit') setRedditFilters((prev) => ({ ...prev, sortBy: value }));
  };

  const toggleSource = (key) => {
    setSourceFilter((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next.private && !next.dealer && !next.reddit) return prev; // require at least one source
      return next;
    });
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

  const handleClearAll = () => {
    setLocationFilter('');
    setSourceFilter({ private: true, dealer: true, reddit: true });
    setGlobalQuery('');
    setHeroQuery('');
    setCarFilters(carInitialFilters);
    setPartsFilters(partsInitialFilters);
    setPlateFilters(plateInitialFilters);
    setBikeFilters(bikeInitialFilters);
    setRedditFilters(carInitialFilters);
    setBuyingRequestFilters({ query: '', itemType: 'all' });
    setAllSortBy('newest');
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

  const activePills = useMemo(() => {
    const pills = [];
    if (locationFilter) {
      pills.push({ id: 'location', label: locationFilter, onRemove: () => setLocationFilter('') });
    }
    if (!sourceFilter.private) {
      pills.push({ id: 'source-private', label: 'No Private Sellers', onRemove: () => setSourceFilter((prev) => ({ ...prev, private: true })) });
    }
    if (!sourceFilter.dealer) {
      pills.push({ id: 'source-dealer', label: 'No Dealers', onRemove: () => setSourceFilter((prev) => ({ ...prev, dealer: true })) });
    }
    if (!sourceFilter.reddit) {
      pills.push({ id: 'source-reddit', label: 'No Reddit', onRemove: () => setSourceFilter((prev) => ({ ...prev, reddit: true })) });
    }
    if (activeMode === 'cars') {
      if (carFilters.manufacturer) {
        pills.push({ id: 'make', label: carFilters.manufacturer, onRemove: () => setCarFilters((prev) => ({ ...prev, manufacturer: '', model: '' })) });
      }
      if (carFilters.model) {
        pills.push({ id: 'model', label: carFilters.model, onRemove: () => setCarFilters((prev) => ({ ...prev, model: '' })) });
      }
      if (carFilters.priceMin || carFilters.priceMax) {
        pills.push({ id: 'price', label: priceRangeLabel(carFilters), onRemove: () => setCarFilters((prev) => ({ ...prev, priceMin: '', priceMax: '' })) });
      }
    }
    if (activeMode === 'car-parts') {
      if (partsFilters.category) {
        pills.push({ id: 'category', label: partsFilters.category, onRemove: () => setPartsFilters((prev) => ({ ...prev, category: '' })) });
      }
      if (partsFilters.priceMin || partsFilters.priceMax) {
        pills.push({ id: 'price', label: priceRangeLabel(partsFilters), onRemove: () => setPartsFilters((prev) => ({ ...prev, priceMin: '', priceMax: '' })) });
      }
    }
    if (activeMode === 'plates') {
      if (plateFilters.code) {
        pills.push({ id: 'code', label: `Code ${plateFilters.code}`, onRemove: () => setPlateFilters((prev) => ({ ...prev, code: '' })) });
      }
      if (plateFilters.digits) {
        pills.push({ id: 'digits', label: `${plateFilters.digits} digits`, onRemove: () => setPlateFilters((prev) => ({ ...prev, digits: '' })) });
      }
      if (plateFilters.priceMin || plateFilters.priceMax) {
        pills.push({ id: 'price', label: priceRangeLabel(plateFilters), onRemove: () => setPlateFilters((prev) => ({ ...prev, priceMin: '', priceMax: '' })) });
      }
    }
    if (activeMode === 'bikes') {
      if (bikeFilters.brand) {
        pills.push({ id: 'brand', label: bikeFilters.brand, onRemove: () => setBikeFilters((prev) => ({ ...prev, brand: '' })) });
      }
      if (bikeFilters.type) {
        pills.push({ id: 'type', label: bikeFilters.type, onRemove: () => setBikeFilters((prev) => ({ ...prev, type: '' })) });
      }
      if (bikeFilters.yearMin || bikeFilters.yearMax) {
        pills.push({ id: 'year', label: `${bikeFilters.yearMin || 'Any'}–${bikeFilters.yearMax || 'Any'}`, onRemove: () => setBikeFilters((prev) => ({ ...prev, yearMin: '', yearMax: '' })) });
      }
      if (bikeFilters.priceMin || bikeFilters.priceMax) {
        pills.push({ id: 'price', label: priceRangeLabel(bikeFilters), onRemove: () => setBikeFilters((prev) => ({ ...prev, priceMin: '', priceMax: '' })) });
      }
    }
    return pills;
  }, [activeMode, locationFilter, sourceFilter, carFilters, partsFilters, plateFilters, bikeFilters]);

  const priceFiltersByMode = {
    cars: [carFilters, setCarFilters],
    'car-parts': [partsFilters, setPartsFilters],
    plates: [plateFilters, setPlateFilters],
    bikes: [bikeFilters, setBikeFilters],
  };
  const [activePriceFilters, setActivePriceFilters] = priceFiltersByMode[activeMode] || [null, null];

  const postCategory = mapExploreModeToSellCtaCategory(activeMode);
  const postHref = POST_HREF_BY_CATEGORY[postCategory] || '/post-car';
  const postAdHref = user ? postHref : `/login?redirect=${encodeURIComponent(postHref)}`;

  const showSourceSection = activeMode !== 'reddit' && activeMode !== 'buying-requests';
  const showSortControl = activeMode !== 'buying-requests';
  const emptyStateMessage = (!sourceFilter.private && !sourceFilter.dealer)
    ? 'No Reddit-imported listings match these filters.'
    : 'No listings found. Try changing your filters or searching for something else.';

  return (
    <>
      <SeoMeta {...seoData} />
      <div className="explore-v2">
        <div className="explore-v2-shell">
          <div className="explore-v2-pageheader">
            <div>
              <h1>Explore</h1>
              <p>Browse listings across the UAE.</p>
            </div>
            <Link to={postAdHref} className="explore-v2-postad">
              <Plus className="h-4 w-4" />
              Post Ad
            </Link>
          </div>

          <div className="explore-v2-searchrow">
            <SearchBar
              value={heroQuery}
              onChange={setHeroQuery}
              onSubmit={handleHeroSearch}
              placeholder="Search cars, parts, plates, bikes..."
            />
          </div>

          <div className="explore-v2-primary-controls">
            <select
              className="explore-v2-select"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              aria-label="Filter by location"
            >
              <option value="">All UAE</option>
              {UAE_EMIRATES.map((emirate) => (
                <option key={emirate} value={emirate}>{emirate}</option>
              ))}
            </select>

            <select
              className="explore-v2-select"
              value={activeMode}
              onChange={(e) => handleModeChange(e.target.value)}
              aria-label="Filter by category"
            >
              {exploreModes.map((mode) => (
                <option key={mode.key} value={mode.key}>{mode.label}</option>
              ))}
            </select>

            <button
              type="button"
              className="explore-v2-filters-btn"
              onClick={() => setFilterDrawerOpen(true)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activePills.length > 0 ? (
                <span className="explore-v2-filter-count">{activePills.length}</span>
              ) : null}
            </button>
          </div>

          <div className="explore-v2-chips" role="tablist" aria-label="Category">
            {exploreModes.map((mode) => {
              // Priority order:
              //   1. Server total from /api/listings/counts — the authoritative count.
              //      (Has no entry for reddit/buying-requests — those fall through.)
              //   2. Last-loaded count for that category — the only source at all for
              //      reddit/buying-requests, a brief placeholder for everything else.
              //   3. Em-dash if neither is available yet.
              const totalKey = mode.key === 'all' ? 'all' : EXPLORE_MODE_TO_API_KEY[mode.key];
              const hasServerTotal = Boolean(totalCounts) && totalKey != null && totalCounts[totalKey] !== undefined;
              let displayCount;
              if (hasServerTotal) {
                displayCount = totalCounts[totalKey];
              } else if (knownCounts[mode.key] != null) {
                displayCount = knownCounts[mode.key];
              } else {
                displayCount = null;
              }
              return (
                <button
                  key={mode.key}
                  type="button"
                  role="tab"
                  aria-selected={activeMode === mode.key}
                  className={`explore-v2-chip ${activeMode === mode.key ? 'is-active' : ''}`}
                  onClick={() => handleModeChange(mode.key)}
                >
                  {mode.label}
                  <small>{displayCount === null ? '—' : displayCount.toLocaleString()}</small>
                </button>
              );
            })}
          </div>

          {activePills.length > 0 ? (
            <div className="explore-v2-pills">
              {activePills.map((pill) => (
                <span key={`${pill.id}-${pill.label}`} className="explore-v2-pill">
                  {pill.label}
                  <button type="button" onClick={pill.onRemove} aria-label={`Remove ${pill.label} filter`}>×</button>
                </span>
              ))}
              <button type="button" className="explore-v2-clear-all" onClick={handleClearAll}>Clear All</button>
            </div>
          ) : null}

          <div className="explore-v2-resultsbar">
            <p>{resultsDescription}</p>
            <div className="explore-v2-resultsbar-actions">
              {showSortControl ? (
                <select
                  className="explore-v2-select"
                  value={activeSortBy}
                  onChange={(e) => handleSortChange(e.target.value)}
                  aria-label="Sort listings"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                </select>
              ) : null}
              <button
                type="button"
                className="explore-v2-button explore-v2-button-secondary"
                onClick={handleSaveSearch}
                disabled={savingSearch || loading || !activeSearchPayload.hasSpecificSignal}
              >
                {savingSearch ? 'Saving...' : 'Save Search'}
              </button>
              <Link to="/my-listings?tab=searches" className="explore-v2-button explore-v2-button-secondary">
                Saved Searches
              </Link>
              {savedSearchNotice ? <span className="explore-v2-save-search-note">{savedSearchNotice}</span> : null}
            </div>
          </div>

          {loading ? (
            <div className="explore-v2-state-card">
              <ListingSkeleton variant="grid" count={8} />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="explore-v2-state-card">
              <p>{emptyStateMessage}</p>
              <button type="button" className="explore-v2-button explore-v2-button-primary" onClick={handleClearAll}>
                Clear Filters
              </button>
            </div>
          ) : (
            <VirtuosoGrid
              useWindowScroll
              data={displayedItems}
              listClassName="explore-v2-listing-grid"
              computeItemKey={(_index, item) => `${item.categoryKey}-${item.id}`}
              itemContent={(_index, item) => (
                item.categoryKey === 'buying-requests'
                  ? <BuyingRequestCard item={item} />
                  : <MarketplaceListingCard item={item} />
              )}
              endReached={() => {
                const modeKey = EXPLORE_MODE_TO_API_KEY[activeMode];
                const hasMore = modeKey
                  ? pages[modeKey]?.hasMore
                  : Object.values(pages).some((p) => p.hasMore);
                if (hasMore) loadMore();
              }}
              components={{
                Footer: () => {
                  const modeKey = EXPLORE_MODE_TO_API_KEY[activeMode];
                  const hasMore = modeKey
                    ? pages[modeKey]?.hasMore
                    : Object.values(pages).some((p) => p.hasMore);
                  if (loadingMore) return <ListingSkeleton variant="grid" count={4} />;
                  if (!hasMore && filteredItems.length > 0) {
                    return <p className="explore-v2-end-label">You've seen all listings.</p>;
                  }
                  return null;
                },
              }}
            />
          )}

          {!loading && error ? <div className="explore-v2-inline-alert">{error}</div> : null}

          <BrowseSellCta category={postCategory} />
        </div>

        {filterDrawerOpen ? (
          <>
            <div className="explore-v2-drawer-backdrop" onClick={() => setFilterDrawerOpen(false)} />
            <div className="explore-v2-drawer" role="dialog" aria-modal="true" aria-label="Filters">
              <div className="explore-v2-drawer-header">
                <h2>Filters</h2>
                <button
                  type="button"
                  className="explore-v2-drawer-close"
                  onClick={() => setFilterDrawerOpen(false)}
                  aria-label="Close filters"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="explore-v2-drawer-body">
                {showSourceSection ? (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Listing Source</span>
                    <label className="explore-v2-checkrow">
                      <input type="checkbox" checked={sourceFilter.private} onChange={() => toggleSource('private')} />
                      Private Sellers
                    </label>
                    <label className="explore-v2-checkrow">
                      <input type="checkbox" checked={sourceFilter.dealer} onChange={() => toggleSource('dealer')} />
                      Dealers
                    </label>
                    <label className="explore-v2-checkrow">
                      <input type="checkbox" checked={sourceFilter.reddit} onChange={() => toggleSource('reddit')} />
                      Reddit
                    </label>
                  </div>
                ) : null}

                {activeMode === 'cars' && (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Car Filters</span>
                    <div className="explore-v2-drawer-grid">
                      <label className="explore-v2-field">
                        <span>Make</span>
                        <select
                          className="explore-v2-input"
                          value={carFilters.manufacturer}
                          onChange={(e) => setCarFilters((prev) => ({ ...prev, manufacturer: e.target.value, model: '' }))}
                        >
                          <option value="">All makes</option>
                          {carMakes.map((make) => <option key={make} value={make}>{make}</option>)}
                        </select>
                      </label>
                      <label className="explore-v2-field">
                        <span>Model</span>
                        <select
                          className="explore-v2-input"
                          value={carFilters.model}
                          onChange={(e) => setCarFilters((prev) => ({ ...prev, model: e.target.value }))}
                        >
                          <option value="">All models</option>
                          {carModels.map((model) => <option key={model} value={model}>{model}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                {activeMode === 'car-parts' && (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Part Filters</span>
                    <label className="explore-v2-field is-full">
                      <span>Category</span>
                      <select
                        className="explore-v2-input"
                        value={partsFilters.category}
                        onChange={(e) => setPartsFilters((prev) => ({ ...prev, category: e.target.value }))}
                      >
                        <option value="">All categories</option>
                        {partCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                      </select>
                    </label>
                  </div>
                )}

                {activeMode === 'plates' && (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Plate Filters</span>
                    <div className="explore-v2-drawer-grid">
                      <label className="explore-v2-field">
                        <span>Code</span>
                        <input
                          className="explore-v2-input"
                          type="text"
                          value={plateFilters.code}
                          onChange={(e) => setPlateFilters((prev) => ({ ...prev, code: e.target.value }))}
                          placeholder="e.g. A"
                        />
                      </label>
                      <label className="explore-v2-field">
                        <span>Digits</span>
                        <select
                          className="explore-v2-input"
                          value={plateFilters.digits}
                          onChange={(e) => setPlateFilters((prev) => ({ ...prev, digits: e.target.value }))}
                        >
                          <option value="">Any length</option>
                          {plateDigitOptions.map((digits) => <option key={digits} value={digits}>{digits} digits</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                {activeMode === 'bikes' && (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Bike Filters</span>
                    <div className="explore-v2-drawer-grid">
                      <label className="explore-v2-field">
                        <span>Brand</span>
                        <select
                          className="explore-v2-input"
                          value={bikeFilters.brand}
                          onChange={(e) => setBikeFilters((prev) => ({ ...prev, brand: e.target.value }))}
                        >
                          <option value="">All brands</option>
                          {bikeBrands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                        </select>
                      </label>
                      <label className="explore-v2-field">
                        <span>Type</span>
                        <select
                          className="explore-v2-input"
                          value={bikeFilters.type}
                          onChange={(e) => setBikeFilters((prev) => ({ ...prev, type: e.target.value }))}
                        >
                          <option value="">All types</option>
                          {bikeTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </label>
                      <label className="explore-v2-field">
                        <span>Year from</span>
                        <input
                          className="explore-v2-input"
                          type="number"
                          value={bikeFilters.yearMin}
                          onChange={(e) => setBikeFilters((prev) => ({ ...prev, yearMin: e.target.value }))}
                          placeholder="e.g. 2015"
                        />
                      </label>
                      <label className="explore-v2-field">
                        <span>Year to</span>
                        <input
                          className="explore-v2-input"
                          type="number"
                          value={bikeFilters.yearMax}
                          onChange={(e) => setBikeFilters((prev) => ({ ...prev, yearMax: e.target.value }))}
                          placeholder="e.g. 2024"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {activePriceFilters ? (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Price (AED)</span>
                    <div className="explore-v2-drawer-grid">
                      <label className="explore-v2-field">
                        <span>Minimum</span>
                        <input
                          className="explore-v2-input"
                          type="number"
                          min="0"
                          value={activePriceFilters.priceMin}
                          onChange={(e) => setActivePriceFilters((prev) => ({ ...prev, priceMin: e.target.value }))}
                          placeholder="0"
                        />
                      </label>
                      <label className="explore-v2-field">
                        <span>Maximum</span>
                        <input
                          className="explore-v2-input"
                          type="number"
                          min="0"
                          value={activePriceFilters.priceMax}
                          onChange={(e) => setActivePriceFilters((prev) => ({ ...prev, priceMax: e.target.value }))}
                          placeholder="Any"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {activeMode === 'reddit' && (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Reddit Filters</span>
                    <label className="explore-v2-field is-full">
                      <span>Make</span>
                      <select
                        className="explore-v2-input"
                        value={redditFilters.manufacturer}
                        onChange={(e) => setRedditFilters((prev) => ({ ...prev, manufacturer: e.target.value }))}
                      >
                        <option value="">All makes</option>
                        {redditMakes.map((make) => <option key={make} value={make}>{make}</option>)}
                      </select>
                    </label>
                    <div className="explore-v2-field is-full" style={{ marginTop: 12 }}>
                      <span>Price (AED)</span>
                      <div className="rp-presets">
                        {PRICE_PRESETS.map((preset) => {
                          const active =
                            redditFilters.priceMin === (preset.min ? String(preset.min) : '') &&
                            redditFilters.priceMax === (preset.max ? String(preset.max) : '');
                          return (
                            <button
                              key={preset.label}
                              type="button"
                              className={`rp-preset ${active ? 'is-active' : ''}`}
                              onClick={() =>
                                setRedditFilters((prev) => ({
                                  ...prev,
                                  priceMin: preset.min ? String(preset.min) : '',
                                  priceMax: preset.max ? String(preset.max) : '',
                                }))
                              }
                            >
                              {preset.label}
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
                )}

                {activeMode === 'buying-requests' && (
                  <div className="explore-v2-drawer-section">
                    <span className="explore-v2-drawer-section-title">Request Type</span>
                    <div className="rp-presets">
                      {BUYING_REQUEST_TYPES.map((type) => (
                        <button
                          key={type.value}
                          type="button"
                          className={`rp-preset ${buyingRequestFilters.itemType === type.value ? 'is-active' : ''}`}
                          onClick={() => setBuyingRequestFilters((prev) => ({ ...prev, itemType: type.value }))}
                        >
                          {type.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="explore-v2-drawer-footer">
                <button type="button" className="explore-v2-button explore-v2-button-secondary" onClick={handleClearAll}>
                  Reset
                </button>
                <button
                  type="button"
                  className="explore-v2-button explore-v2-button-primary"
                  onClick={() => setFilterDrawerOpen(false)}
                >
                  Show {filteredItems.length.toLocaleString()} Results
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
};

export default ExplorePage;
