export const WHATSAPP_LISTING_URL_TOKEN = '{{LISTING_URL}}';

const normalizeText = (value = '') =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const getWhatsAppListingUrl = (path = '/', siteUrl = 'https://www.dphclassifieds.com') => {
  const normalizedSiteUrl = String(siteUrl || 'https://www.dphclassifieds.com').replace(/\/+$/, '');
  const normalizedPath = String(path || '/').startsWith('/') ? String(path || '/') : `/${String(path || '/')}`;
  return new URL(normalizedPath, `${normalizedSiteUrl}/`).toString();
};

export const getWhatsappPrefillTemplate = (listingLabel = 'listing') =>
  `Hi, I saw your ${listingLabel} on dphclassifieds.com and I am interested. Listing: ${WHATSAPP_LISTING_URL_TOKEN}`;

export const buildWhatsappMessage = ({
  template = '',
  listingUrl = '',
  listingLabel = 'listing',
} = {}) => {
  const normalizedTemplate = normalizeText(template);
  const normalizedListingUrl = normalizeText(listingUrl);
  const baseMessage = normalizedTemplate || getWhatsappPrefillTemplate(listingLabel);

  if (!normalizedListingUrl) {
    return normalizeText(baseMessage.split(WHATSAPP_LISTING_URL_TOKEN).join(''));
  }

  const messageWithTokenResolved = baseMessage.includes(WHATSAPP_LISTING_URL_TOKEN)
    ? baseMessage.split(WHATSAPP_LISTING_URL_TOKEN).join(normalizedListingUrl)
    : baseMessage;

  if (messageWithTokenResolved.includes(normalizedListingUrl)) {
    return normalizeText(messageWithTokenResolved);
  }

  return normalizeText(`${messageWithTokenResolved}\n\nListing: ${normalizedListingUrl}`);
};
