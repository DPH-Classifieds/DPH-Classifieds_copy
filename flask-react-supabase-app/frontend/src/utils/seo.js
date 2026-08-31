const DEFAULT_SITE_URL = (process.env.REACT_APP_SITE_URL || 'https://www.dphclassifieds.com').replace(/\/+$/, '');
const DEFAULT_SITE_NAME = 'DPH Classifieds';
const DEFAULT_SEO_IMAGE = `${DEFAULT_SITE_URL}/hero.avif`;

export const absoluteUrl = (path = '/') => {
  const value = String(path || '/');
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const normalizedPath = value.startsWith('/') ? value : `/${value}`;
  return new URL(normalizedPath, `${DEFAULT_SITE_URL}/`).toString();
};

export const stripHtml = (value = '') =>
  String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const truncateText = (value = '', maxLength = 160) => {
  const text = stripHtml(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

export const formatMoney = (value, currency = 'AED') => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(numeric);
};

const titleFromParts = (...parts) =>
  parts
    .flat()
    .map((part) => stripHtml(part))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

export const buildBreadcrumbSchema = (items = []) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items
    .filter((item) => item && item.name && item.url)
    .map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
});

export const buildStaticSeo = ({
  title,
  description,
  path = '/',
  image = DEFAULT_SEO_IMAGE,
  type = 'website',
  keywords = [],
  noindex = false,
  schema = [],
  siteName = DEFAULT_SITE_NAME,
} = {}) => ({
  title: title ? `${title} | ${siteName}` : siteName,
  description: description || `Browse ${siteName} listings across cars, bikes, car parts, and premium UAE license plates.`,
  canonical: absoluteUrl(path),
  image,
  type,
  keywords: Array.isArray(keywords) ? keywords.filter(Boolean).join(', ') : String(keywords || ''),
  noindex,
  schema: Array.isArray(schema) ? schema : [schema].filter(Boolean),
  siteName,
});

const buildCarSchema = (listing, canonical) => {
  const price = Number(listing?.expected_selling_price || 0);
  const mileage = Number(listing?.kilometer_driven || listing?.kilometer || listing?.mileage || 0);
  const image = listing?.images?.[0]?.display_url || listing?.images?.[0]?.image_url || listing?.images?.[0]?.url || listing?.image_url || listing?.url || DEFAULT_SEO_IMAGE;

  return {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: titleFromParts(listing?.make_year, listing?.car_manufacturer, listing?.car_model, listing?.trim) || listing?.listing_title || 'UAE car listing',
    description: truncateText(listing?.car_description || listing?.description || '', 260),
    url: canonical,
    image: [image],
    brand: listing?.car_manufacturer || listing?.make || undefined,
    model: listing?.car_model || listing?.model || undefined,
    vehicleModelDate: listing?.make_year ? String(listing.make_year) : undefined,
    mileageFromOdometer: mileage
      ? {
          '@type': 'QuantitativeValue',
          value: mileage,
          unitText: 'KM',
        }
      : undefined,
    vehicleConfiguration: [listing?.body_type, listing?.fuel_type, listing?.transmission_type].filter(Boolean).join(' • ') || undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'AED',
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      availability: 'https://schema.org/InStock',
      url: canonical,
      seller: listing?.seller_name
        ? {
            '@type': 'Person',
            name: listing.seller_name,
          }
        : undefined,
    },
  };
};

const buildBikeSchema = (listing, canonical) => {
  const price = Number(listing?.price || listing?.expected_selling_price || 0);
  const image = listing?.images?.[0]?.display_url || listing?.images?.[0]?.image_url || listing?.images?.[0]?.url || listing?.image_url || listing?.url || DEFAULT_SEO_IMAGE;

  return {
    '@context': 'https://schema.org',
    '@type': 'Motorcycle',
    name: titleFromParts(listing?.make_year, listing?.make || listing?.bike_brand, listing?.model || listing?.bike_model) || listing?.listing_title || 'UAE bike listing',
    description: truncateText(listing?.description || '', 260),
    url: canonical,
    image: [image],
    brand: listing?.make || listing?.bike_brand || undefined,
    model: listing?.model || listing?.bike_model || undefined,
    vehicleModelDate: listing?.make_year ? String(listing.make_year) : undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'AED',
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      availability: 'https://schema.org/InStock',
      url: canonical,
      seller: listing?.seller_name
        ? {
            '@type': 'Person',
            name: listing.seller_name,
          }
        : undefined,
    },
  };
};

const buildPlateSchema = (listing, canonical) => {
  const price = Number(listing?.price || 0);
  const image = listing?.images?.[0]?.display_url || listing?.images?.[0]?.image_url || listing?.images?.[0]?.url || listing?.image_url || listing?.url || DEFAULT_SEO_IMAGE;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: titleFromParts(listing?.city, listing?.code, listing?.number) || listing?.listing_title || 'UAE plate listing',
    description: truncateText(listing?.description || '', 260),
    url: canonical,
    image: [image],
    category: 'License plate',
    offers: {
      '@type': 'Offer',
      priceCurrency: 'AED',
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      availability: 'https://schema.org/InStock',
      url: canonical,
      seller: listing?.seller_name
        ? {
            '@type': 'Person',
            name: listing.seller_name,
          }
        : undefined,
    },
  };
};

const buildPartSchema = (listing, canonical) => {
  const price = Number(listing?.price || 0);
  const image = listing?.images?.[0]?.display_url || listing?.images?.[0]?.image_url || listing?.images?.[0]?.url || listing?.image_url || listing?.url || DEFAULT_SEO_IMAGE;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: titleFromParts(listing?.name, listing?.part_name, listing?.listing_title) || 'UAE car part listing',
    description: truncateText(listing?.description || '', 260),
    url: canonical,
    image: [image],
    category: 'Car part',
    brand: listing?.brand || listing?.manufacturer || undefined,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'AED',
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      availability: 'https://schema.org/InStock',
      url: canonical,
      seller: listing?.seller_name
        ? {
            '@type': 'Person',
            name: listing.seller_name,
          }
        : undefined,
    },
  };
};

export const buildListingSeo = (kind, listing = {}, options = {}) => {
  const canonicalPath = options.canonicalPath || listing?.canonicalPath || '/';
  const canonical = absoluteUrl(canonicalPath);
  const location = stripHtml(
    options.location ||
      listing?.car_city ||
      listing?.city ||
      listing?.location ||
      listing?.emirate ||
      'UAE'
  );
  const image =
    options.image ||
    listing?.images?.[0]?.display_url ||
    listing?.images?.[0]?.image_url ||
    listing?.images?.[0]?.url ||
    listing?.image_url ||
    listing?.url ||
    DEFAULT_SEO_IMAGE;
  const priceLabel = options.priceLabel || formatMoney(listing?.expected_selling_price || listing?.price);
  const summary = truncateText(
    options.description ||
      listing?.car_description ||
      listing?.description ||
      `Browse this verified ${kind} listing on DPH Classifieds.`,
    170
  );
  const title = options.title || (() => {
    if (kind === 'car') {
      return (
        titleFromParts(listing?.make_year, listing?.car_manufacturer, listing?.car_model, listing?.trim) ||
        listing?.listing_title ||
        'UAE car listing'
      );
    }
    if (kind === 'bike') {
      return (
        titleFromParts(listing?.make_year, listing?.make || listing?.bike_brand, listing?.model || listing?.bike_model) ||
        listing?.listing_title ||
        'UAE bike listing'
      );
    }
    if (kind === 'plate') {
      return (
        titleFromParts(listing?.city, listing?.code, listing?.number) ||
        listing?.listing_title ||
        'UAE plate listing'
      );
    }
    return titleFromParts(listing?.name, listing?.part_name, listing?.listing_title) || 'UAE car part listing';
  })();

  const keywords = Array.from(
    new Set(
      [
        `${kind} for sale UAE`,
        location,
        listing?.car_manufacturer || listing?.make || listing?.brand || listing?.manufacturer,
        listing?.car_model || listing?.model || listing?.part_name,
        listing?.body_type,
        listing?.fuel_type,
        listing?.transmission_type,
        listing?.city,
        listing?.code,
        listing?.number,
        listing?.seller_name,
        listing?.listing_title,
      ]
        .map((item) => stripHtml(item))
        .filter(Boolean)
    )
  ).join(', ');

  const typeMap = {
    car: buildCarSchema,
    bike: buildBikeSchema,
    plate: buildPlateSchema,
    part: buildPartSchema,
  };

  const schemaBuilder = typeMap[kind];
  const schema = schemaBuilder ? schemaBuilder(listing, canonical) : null;

  return {
    title: `${title} | DPH Classifieds`,
    description: `${summary}${priceLabel ? ` ${priceLabel}.` : ''} ${location ? `Located in ${location}.` : ''}`.replace(/\s+/g, ' ').trim(),
    canonical,
    image,
    type: kind === 'plate' ? 'product' : 'product',
    keywords,
    schema: [
      buildBreadcrumbSchema([
        { name: 'Home', url: absoluteUrl('/') },
        { name: kind === 'car' ? 'Cars' : kind === 'bike' ? 'Bikes' : kind === 'plate' ? 'Plates' : 'Car Parts', url: absoluteUrl(kind === 'car' ? '/cars' : kind === 'bike' ? '/bikes' : kind === 'plate' ? '/plates' : '/car-parts') },
        { name: title, url: canonical },
      ]),
      schema,
    ].filter(Boolean),
  };
};

export const SITE_URL = DEFAULT_SITE_URL;
export const SITE_NAME = DEFAULT_SITE_NAME;
export const DEFAULT_SEO_IMAGE_URL = DEFAULT_SEO_IMAGE;
