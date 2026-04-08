import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import { carMakes, carModels } from '../utils/carData';
import { resolveMediaUrl } from '../utils/media';
import './ExplorePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

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
    item?.images?.[0]?.image_url ||
    item?.images?.[0]?.url ||
    item?.image_url ||
    item?.image ||
    item?.main_image_url ||
    item?.url ||
    null;

  return resolveMediaUrl(candidate);
};

const getSellerName = (item) =>
  normalizeText(
    item.seller_name ||
      item.display_name ||
      item.user_name ||
      item.username ||
      item.dealer_name ||
      item.email
  ) || 'Marketplace Seller';

const getSellerPhoto = (item) =>
  resolveMediaUrl(item.seller_profile_photo || item.profile_photo_url || item.user_profile_photo);

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
  const title = [year, make, model, trim].filter(Boolean).join(' ').trim() || car.listing_title || car.title || 'Untitled car';
  const mileage = car.kilometer_driven || car.kilometer || car.mileage;
  const fuelType = car.fuel_type || car.fuel;
  const location = car.car_city || car.city || car.location || 'UAE';
  const price = car.expected_selling_price || car.price;

  return {
    id: car.id,
    categoryKey: 'cars',
    categoryLabel: 'Car',
    title,
    subtitle: [mileage ? `${Number(mileage).toLocaleString()} km` : null, fuelType, location]
      .filter(Boolean)
      .join(' • '),
    description: normalizeText(car.description || car.price_insight || 'Freshly listed vehicle in the UAE marketplace.'),
    location,
    priceLabel: formatPrice(price),
    numericPrice: toNumeric(price),
    route: `/cars/${car.id}`,
    image: getPrimaryImage(car),
    sellerName: getSellerName(car),
    sellerPhoto: getSellerPhoto(car),
    createdAt: car.created_at,
    searchableText: buildSearchableText([
      title,
      make,
      model,
      trim,
      car.description,
      location,
      car.seller_name,
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
    image: getPrimaryImage(bike),
    sellerName: getSellerName(bike),
    sellerPhoto: getSellerPhoto(bike),
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
    image: getPrimaryImage(part),
    sellerName: getSellerName(part),
    sellerPhoto: getSellerPhoto(part),
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
    image: getPrimaryImage(plate),
    sellerName: getSellerName(plate),
    sellerPhoto: getSellerPhoto(plate),
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

  useEffect(() => {
    let isMounted = true;

    const fetchInventory = async () => {
      setLoading(true);
      setError('');

      const requests = await Promise.allSettled([
        fetch(`${API_URL}/api/cars`).then((response) => response.json()),
        fetch(`${API_URL}/api/bikes`).then((response) => response.json()),
        fetch(`${API_URL}/api/parts`).then((response) => response.json()),
        fetch(`${API_URL}/api/plates`).then((response) => response.json()),
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

  const availableCarModels = useMemo(
    () => (carFilters.manufacturer ? carModels[carFilters.manufacturer] || [] : []),
    [carFilters.manufacturer]
  );

  const availablePartCategories = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedInventory.parts
            .map((item) => normalizeText(item.raw.category || item.raw.part_type))
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [normalizedInventory.parts]
  );

  const availablePlateCities = useMemo(
    () =>
      Array.from(new Set(normalizedInventory.plates.map((item) => item.location).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [normalizedInventory.plates]
  );

  const availablePlateCodes = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedInventory.plates
            .map((item) => normalizeText(item.raw.code))
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [normalizedInventory.plates]
  );

  const availableBikeBrands = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedInventory.bikes
            .map((item) => normalizeText(item.raw.make || item.raw.manufacturer || item.raw.bike_brand))
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [normalizedInventory.bikes]
  );

  const availableBikeTypes = useMemo(
    () =>
      Array.from(
        new Set(
          normalizedInventory.bikes
            .map((item) => normalizeText(item.raw.bike_type || item.raw.type || item.raw.bike_category))
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [normalizedInventory.bikes]
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

  const renderCardVisual = (item) => {
    if (item.image) {
      return <img src={item.image} alt={item.title} />;
    }

    return (
      <div className="explore-v2-card-fallback">
        <span>{item.categoryLabel}</span>
        <strong>{item.title}</strong>
      </div>
    );
  };

  const renderSellerIdentity = (item) => {
    if (item.sellerPhoto) {
      return (
        <span className="explore-v2-seller-avatar">
          <img src={item.sellerPhoto} alt={`${item.sellerName} profile`} className="explore-v2-seller-avatar-image" />
        </span>
      );
    }

    return (
      <span className="explore-v2-seller-avatar">
        {item.sellerName.charAt(0).toUpperCase()}
      </span>
    );
  };

  const renderModeFilters = () => {
    if (activeMode === 'all') {
      return (
        <div className="explore-v2-search-only">
          <label className="explore-v2-field explore-v2-field-full">
            <span>Search Everything</span>
            <input
              type="search"
              value={globalQuery}
              onChange={(event) => setGlobalQuery(event.target.value)}
              placeholder="Search cars, parts, plates, bikes, brands, cities, and more..."
            />
          </label>
          <p className="explore-v2-filter-note">
            All mode ranks results by relevance first, then freshness.
          </p>
        </div>
      );
    }

    if (activeMode === 'cars') {
      return (
        <>
          <div className="explore-v2-filter-grid">
            <label className="explore-v2-field">
              <span>Search</span>
              <input
                type="search"
                value={carFilters.query}
                onChange={(event) => setCarFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Search make, model, trim, or spec..."
              />
            </label>
            <label className="explore-v2-field">
              <span>Make</span>
              <select
                value={carFilters.manufacturer}
                onChange={(event) =>
                  setCarFilters((current) => ({
                    ...current,
                    manufacturer: event.target.value,
                    model: '',
                  }))
                }
              >
                <option value="">All Makes</option>
                {carMakes.map((make) => (
                  <option key={make} value={make}>
                    {make}
                  </option>
                ))}
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Model</span>
              <select
                value={carFilters.model}
                disabled={!carFilters.manufacturer}
                onChange={(event) => setCarFilters((current) => ({ ...current, model: event.target.value }))}
              >
                <option value="">All Models</option>
                {availableCarModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Emirate</span>
              <input
                type="text"
                value={carFilters.city}
                onChange={(event) => setCarFilters((current) => ({ ...current, city: event.target.value }))}
                placeholder="Dubai, Abu Dhabi..."
              />
            </label>
            <label className="explore-v2-field">
              <span>Sort</span>
              <select
                value={carFilters.sortBy}
                onChange={(event) => setCarFilters((current) => ({ ...current, sortBy: event.target.value }))}
              >
                <option value="newest">Newest First</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Price From</span>
              <input
                type="number"
                min="0"
                value={carFilters.priceMin}
                onChange={(event) => setCarFilters((current) => ({ ...current, priceMin: event.target.value }))}
                placeholder="Min AED"
              />
            </label>
            <label className="explore-v2-field">
              <span>Price To</span>
              <input
                type="number"
                min="0"
                value={carFilters.priceMax}
                onChange={(event) => setCarFilters((current) => ({ ...current, priceMax: event.target.value }))}
                placeholder="Max AED"
              />
            </label>
          </div>
          <div className="explore-v2-filter-actions">
            <button type="button" className="explore-v2-button explore-v2-button-secondary" onClick={() => setCarFilters(carInitialFilters)}>
              Reset Car Filters
            </button>
          </div>
        </>
      );
    }

    if (activeMode === 'car-parts') {
      return (
        <>
          <div className="explore-v2-filter-grid">
            <label className="explore-v2-field">
              <span>Search</span>
              <input
                type="search"
                value={partsFilters.query}
                onChange={(event) => setPartsFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Search parts, brands, and fitment..."
              />
            </label>
            <label className="explore-v2-field">
              <span>Category</span>
              <select
                value={partsFilters.category}
                onChange={(event) => setPartsFilters((current) => ({ ...current, category: event.target.value }))}
              >
                <option value="">All Categories</option>
                {availablePartCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Sort</span>
              <select
                value={partsFilters.sortBy}
                onChange={(event) => setPartsFilters((current) => ({ ...current, sortBy: event.target.value }))}
              >
                <option value="newest">Newest First</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Price From</span>
              <input
                type="number"
                min="0"
                value={partsFilters.priceMin}
                onChange={(event) => setPartsFilters((current) => ({ ...current, priceMin: event.target.value }))}
                placeholder="Min AED"
              />
            </label>
            <label className="explore-v2-field">
              <span>Price To</span>
              <input
                type="number"
                min="0"
                value={partsFilters.priceMax}
                onChange={(event) => setPartsFilters((current) => ({ ...current, priceMax: event.target.value }))}
                placeholder="Max AED"
              />
            </label>
          </div>
          <div className="explore-v2-filter-actions">
            <button type="button" className="explore-v2-button explore-v2-button-secondary" onClick={() => setPartsFilters(partsInitialFilters)}>
              Reset Parts Filters
            </button>
          </div>
        </>
      );
    }

    if (activeMode === 'plates') {
      return (
        <>
          <div className="explore-v2-filter-grid">
            <label className="explore-v2-field">
              <span>Search</span>
              <input
                type="search"
                value={plateFilters.query}
                onChange={(event) => setPlateFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Search number, code, city..."
              />
            </label>
            <label className="explore-v2-field">
              <span>City</span>
              <select
                value={plateFilters.city}
                onChange={(event) => setPlateFilters((current) => ({ ...current, city: event.target.value }))}
              >
                <option value="">All Cities</option>
                {availablePlateCities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Code</span>
              <select
                value={plateFilters.code}
                onChange={(event) => setPlateFilters((current) => ({ ...current, code: event.target.value }))}
              >
                <option value="">All Codes</option>
                {availablePlateCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Digits</span>
              <input
                type="number"
                min="1"
                value={plateFilters.digits}
                onChange={(event) => setPlateFilters((current) => ({ ...current, digits: event.target.value }))}
                placeholder="3, 4, 5..."
              />
            </label>
            <label className="explore-v2-field">
              <span>Sort</span>
              <select
                value={plateFilters.sortBy}
                onChange={(event) => setPlateFilters((current) => ({ ...current, sortBy: event.target.value }))}
              >
                <option value="newest">Newest First</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
              </select>
            </label>
            <label className="explore-v2-field">
              <span>Price From</span>
              <input
                type="number"
                min="0"
                value={plateFilters.priceMin}
                onChange={(event) => setPlateFilters((current) => ({ ...current, priceMin: event.target.value }))}
                placeholder="Min AED"
              />
            </label>
            <label className="explore-v2-field">
              <span>Price To</span>
              <input
                type="number"
                min="0"
                value={plateFilters.priceMax}
                onChange={(event) => setPlateFilters((current) => ({ ...current, priceMax: event.target.value }))}
                placeholder="Max AED"
              />
            </label>
          </div>
          <div className="explore-v2-filter-actions">
            <button type="button" className="explore-v2-button explore-v2-button-secondary" onClick={() => setPlateFilters(plateInitialFilters)}>
              Reset Plate Filters
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="explore-v2-filter-grid">
          <label className="explore-v2-field">
            <span>Search</span>
            <input
              type="search"
              value={bikeFilters.query}
              onChange={(event) => setBikeFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search bikes, brands, and styles..."
            />
          </label>
          <label className="explore-v2-field">
            <span>Type</span>
            <select
              value={bikeFilters.type}
              onChange={(event) => setBikeFilters((current) => ({ ...current, type: event.target.value }))}
            >
              <option value="">All Types</option>
              {availableBikeTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="explore-v2-field">
            <span>Brand</span>
            <select
              value={bikeFilters.brand}
              onChange={(event) => setBikeFilters((current) => ({ ...current, brand: event.target.value }))}
            >
              <option value="">All Brands</option>
              {availableBikeBrands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </label>
          <label className="explore-v2-field">
            <span>Year From</span>
            <input
              type="number"
              min="1900"
              value={bikeFilters.yearMin}
              onChange={(event) => setBikeFilters((current) => ({ ...current, yearMin: event.target.value }))}
              placeholder="Min Year"
            />
          </label>
          <label className="explore-v2-field">
            <span>Year To</span>
            <input
              type="number"
              min="1900"
              value={bikeFilters.yearMax}
              onChange={(event) => setBikeFilters((current) => ({ ...current, yearMax: event.target.value }))}
              placeholder="Max Year"
            />
          </label>
          <label className="explore-v2-field">
            <span>Sort</span>
            <select
              value={bikeFilters.sortBy}
              onChange={(event) => setBikeFilters((current) => ({ ...current, sortBy: event.target.value }))}
            >
              <option value="newest">Newest First</option>
              <option value="price-low">Price: Low to High</option>
              <option value="price-high">Price: High to Low</option>
            </select>
          </label>
          <label className="explore-v2-field">
            <span>Price From</span>
            <input
              type="number"
              min="0"
              value={bikeFilters.priceMin}
              onChange={(event) => setBikeFilters((current) => ({ ...current, priceMin: event.target.value }))}
              placeholder="Min AED"
            />
          </label>
          <label className="explore-v2-field">
            <span>Price To</span>
            <input
              type="number"
              min="0"
              value={bikeFilters.priceMax}
              onChange={(event) => setBikeFilters((current) => ({ ...current, priceMax: event.target.value }))}
              placeholder="Max AED"
            />
          </label>
        </div>
        <div className="explore-v2-filter-actions">
          <button type="button" className="explore-v2-button explore-v2-button-secondary" onClick={() => setBikeFilters(bikeInitialFilters)}>
            Reset Bike Filters
          </button>
        </div>
      </>
    );
  };

  return (
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

          <div className="explore-v2-hero-stats">
            {exploreModes.map((mode) => (
              <button
                key={mode.key}
                type="button"
                className={`explore-v2-stat ${activeMode === mode.key ? 'is-active' : ''}`}
                onClick={() => handleModeChange(mode.key)}
              >
                <strong>{featuredCounts[mode.key]}</strong>
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="explore-v2-shell explore-v2-filter-section">
        <div className="explore-v2-filter-header">
          <div>
            <span className="explore-v2-kicker">Adaptive Filters</span>
            <h2>{activeMode === 'all' ? 'Search the whole marketplace.' : `Refine ${exploreModes.find((mode) => mode.key === activeMode)?.label}.`}</h2>
          </div>
          <p>
            {activeMode === 'all'
              ? 'All mode stays intentionally simple: one search bar with relevance-based ranking across every live category.'
              : 'Focused modes swap in category-aware controls so the filter UI only shows fields that make sense for the listings you are exploring.'}
          </p>
        </div>

        <div className="explore-v2-filter-panel">{renderModeFilters()}</div>
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
            <LoadingSpinner message="Loading marketplace inventory..." compact />
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
          <div className="explore-v2-grid">
            {filteredItems.map((item) => (
              <article key={`${item.categoryKey}-${item.id}`} className="explore-v2-card">
                <Link to={item.route} className="explore-v2-card-media">
                  {renderCardVisual(item)}
                  <span className="explore-v2-card-badge">{item.categoryLabel}</span>
                </Link>

                <div className="explore-v2-card-copy">
                  <div className="explore-v2-card-head">
                    <div>
                      <p className="explore-v2-card-price">{item.priceLabel}</p>
                      <h3>
                        <Link to={item.route}>{item.title}</Link>
                      </h3>
                    </div>
                  </div>

                  <p className="explore-v2-card-meta">{item.subtitle}</p>
                  <p className="explore-v2-card-description">{item.description}</p>

                  <div className="explore-v2-seller-row">
                    <div className="explore-v2-seller">
                      {renderSellerIdentity(item)}
                      <div>
                        <strong>{item.sellerName}</strong>
                        <span>{item.location || 'UAE'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="explore-v2-card-actions">
                    <Link to={item.route} className="explore-v2-button explore-v2-button-primary">
                      View Listing
                    </Link>
                    <Link
                      to={
                        item.categoryKey === 'cars'
                          ? '/cars'
                          : item.categoryKey === 'car-parts'
                            ? '/car-parts'
                            : item.categoryKey === 'plates'
                              ? '/plates'
                              : '/bikes'
                      }
                      className="explore-v2-card-link"
                    >
                      More {item.categoryLabel}s
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {!loading && error ? <div className="explore-v2-inline-alert">{error}</div> : null}
      </section>
    </div>
  );
};

export default ExplorePage;
