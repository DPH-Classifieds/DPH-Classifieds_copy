const API_ORIGIN = 'https://api.dphclassifieds.com';
const SITE_ORIGIN = 'https://www.dphclassifieds.com';
const FALLBACK_IMAGE = `${SITE_ORIGIN}/hero.webp`;

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

const firstImage = (listing = {}) => {
  const image = Array.isArray(listing.images) ? listing.images[0] : null;
  return image?.display_url || image?.image_url || image?.url || listing.display_url || listing.image_url || FALLBACK_IMAGE;
};

module.exports = async function handler(req, res) {
  const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const userAgent = req.headers['user-agent'] || '';

  // The React app renders normal visitor traffic. Link crawlers need complete
  // HTML because they do not execute React and otherwise only see the generic
  // homepage card.
  if (!crawlerPattern.test(userAgent)) {
    const appShell = await fetch(`${SITE_ORIGIN}/`, { headers: { 'User-Agent': userAgent } });
    const html = await appShell.text();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
    return res.status(appShell.ok ? 200 : 503).send(html);
  }

  try {
    const response = await fetch(`${API_ORIGIN}/api/cars/${encodeURIComponent(slug)}`, {
      headers: { 'User-Agent': 'DPH-Link-Preview/1.0' },
    });
    if (!response.ok) return res.status(404).send('Listing not found');
    const car = await response.json();
    const canonical = `${SITE_ORIGIN}/cars/${encodeURIComponent(slug)}`;
    const title = [car.make_year, car.car_manufacturer, car.car_model, car.trim].filter(Boolean).join(' ') || car.listing_title || 'Car listing';
    const price = Number(car.expected_selling_price || car.price || 0);
    const priceText = price > 0 ? `AED ${price.toLocaleString('en-AE')}` : 'Price on request';
    const description = truncate(car.car_description || car.description || `${title} for sale on DPH Classifieds.`);
    const image = firstImage(car);
    const safeTitle = escapeHtml(`${title} | DPH Classifieds`);
    const safeDescription = escapeHtml(`${description} ${priceText}.`);
    const safeUrl = escapeHtml(canonical);
    const safeImage = escapeHtml(image);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(`<!doctype html><html lang="en"><head><title>${safeTitle}</title><meta name="description" content="${safeDescription}"><link rel="canonical" href="${safeUrl}"><meta property="og:type" content="product"><meta property="og:site_name" content="DPH Classifieds"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${safeDescription}"><meta property="og:url" content="${safeUrl}"><meta property="og:image" content="${safeImage}"><meta property="og:image:secure_url" content="${safeImage}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeTitle}"><meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${safeImage}"></head><body><h1>${safeTitle}</h1><p>${safeDescription}</p><img src="${safeImage}" alt="${safeTitle}"></body></html>`);
  } catch (error) {
    return res.status(502).send('Unable to generate listing preview');
  }
}
