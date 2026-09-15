const API_ORIGIN = 'https://api.dphclassifieds.com';
const SITE_ORIGIN = 'https://www.dphclassifieds.com';
const FALLBACK_IMAGE = `${SITE_ORIGIN}/hero.avif`;

const crawlerPattern = /(facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|googlebot|bingbot|applebot|pinterest|embedly|quora link preview)/i;

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const cleanText = (value = '') => String(value)
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const truncate = (value, max = 180) => {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
};

const absoluteMediaUrl = (value) => {
  if (!value) return null;
  try {
    return new URL(String(value), `${SITE_ORIGIN}/`).toString();
  } catch (_error) {
    return null;
  }
};

const firstImage = (listing = {}) => {
  const collections = [
    listing.images,
    listing.car_images,
    listing.bike_images,
    listing.part_images,
    listing.plate_images,
  ];

  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      const candidate = typeof entry === 'string'
        ? entry
        : entry?.display_url || entry?.image_url || entry?.url;
      const resolved = absoluteMediaUrl(candidate);
      if (resolved) return resolved;
    }
  }

  return absoluteMediaUrl(
    listing.primary_image_url || listing.display_url || listing.image_url || listing.main_image_url
  ) || FALLBACK_IMAGE;
};

const titleFor = (type, listing = {}) => {
  const fields = {
    cars: [listing.make_year, listing.car_manufacturer, listing.car_model, listing.trim],
    bikes: [listing.make_year || listing.year, listing.make || listing.bike_brand, listing.model || listing.bike_model],
    parts: [listing.name, listing.part_type, listing.listing_title],
    plates: [listing.city, listing.code, listing.number, listing.listing_title],
  }[type] || [listing.listing_title, listing.name];
  return fields.filter(Boolean).join(' ').trim() || 'DPH Classifieds listing';
};

const createListingPreviewHandler = (type, queryKey = 'id') => async (req, res) => {
  const identifier = Array.isArray(req.query?.[queryKey]) ? req.query[queryKey][0] : req.query?.[queryKey];
  const userAgent = req.headers?.['user-agent'] || '';

  // Normal visitors need the React app shell. Link crawlers need metadata in
  // the initial HTML because they do not execute the React SEO effect.
  if (!crawlerPattern.test(userAgent)) {
    const appShell = await fetch(`${SITE_ORIGIN}/`, { headers: { 'User-Agent': userAgent } });
    const html = await appShell.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(appShell.ok ? 200 : 503).send(html);
  }

  try {
    const apiPath = type === 'cars' ? 'cars' : type === 'bikes' ? 'bikes' : type === 'parts' ? 'parts' : 'plates';
    const response = await fetch(`${API_ORIGIN}/api/${apiPath}/${encodeURIComponent(identifier || '')}`, {
      headers: { 'User-Agent': 'DPH-Link-Preview/1.0' },
    });
    if (!response.ok) return res.status(404).send('Listing not found');

    const listing = await response.json();
    const title = titleFor(type, listing);
    const price = Number(listing.expected_selling_price || listing.price || 0);
    const priceText = price > 0 ? `AED ${price.toLocaleString('en-AE')}` : 'Price on request';
    const description = truncate(listing.car_description || listing.description || `${title} for sale on DPH Classifieds.`);
    const image = firstImage(listing);
    const canonical = `${SITE_ORIGIN}/${type === 'parts' ? 'car-parts' : type}/${encodeURIComponent(identifier || listing.id || '')}`;
    const safeTitle = escapeHtml(`${title} | DPH Classifieds`);
    const safeDescription = escapeHtml(`${description} ${priceText}.`);
    const safeUrl = escapeHtml(canonical);
    const safeImage = escapeHtml(image);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(`<!doctype html><html lang="en"><head><title>${safeTitle}</title><meta name="description" content="${safeDescription}"><link rel="canonical" href="${safeUrl}"><meta property="og:type" content="product"><meta property="og:site_name" content="DPH Classifieds"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}"><meta property="og:url" content="${safeUrl}"><meta property="og:image" content="${safeImage}"><meta property="og:image:secure_url" content="${safeImage}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeTitle}"><meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${safeImage}"></head><body><h1>${safeTitle}</h1><p>${safeDescription}</p><img src="${safeImage}" alt="${safeTitle}"></body></html>`);
  } catch (_error) {
    return res.status(502).send('Unable to generate listing preview');
  }
};

module.exports = createListingPreviewHandler;
module.exports.firstImage = firstImage;
module.exports.titleFor = titleFor;
