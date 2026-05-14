const WHATSAPP_LISTING_URL_TOKEN = '{{LISTING_URL}}';

const SITE_URL = 'https://www.dphclassifieds.com';

const normalizeText = (value = '') =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const getWhatsAppListingUrl = (path = '/') => {
  const normalizedPath = String(path || '/').startsWith('/') ? String(path) : `/${String(path)}`;
  return new URL(normalizedPath, `${SITE_URL}/`).toString();
};

const getWhatsappPrefillTemplate = (listingLabel = 'listing') =>
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

export const formatWhatsappNumber = (item, listingType = 'car') => {
  let stored = '';
  if (listingType === 'car') {
    stored = item?.whatsapp_number || item?.car_owner_phone_number || item?.contact_phone || '';
  } else if (listingType === 'bike') {
    stored = item?.whatsapp_number || item?.contact_phone || item?.car_owner_phone_number || '';
  } else if (listingType === 'plate') {
    stored = item?.whatsapp_number || item?.contact_phone || item?.phone || '';
  } else if (listingType === 'part') {
    stored = item?.whatsapp_number || item?.contact_number || item?.contact_phone || '';
  }

  const digits = String(stored).replace(/\D/g, '');
  if (!digits || digits.length < 6) return '';

  if (digits.startsWith('0')) {
    return `971${digits.replace(/^0+/, '')}`;
  }
  if (digits.length >= 11) return digits;
  return `971${digits}`;
};

export const openWhatsapp = (item, listingType = 'car') => {
  const phone = formatWhatsappNumber(item, listingType);
  if (!phone || phone.length < 6) return;

  let listingUrlPath = '';
  const id = item?.id;
  if (listingType === 'car') listingUrlPath = `/cars/${id}`;
  else if (listingType === 'bike') listingUrlPath = `/bikes/${id}`;
  else if (listingType === 'plate') listingUrlPath = `/plates/${id}`;
  else if (listingType === 'part') listingUrlPath = `/car-parts/${id}`;

  const message = buildWhatsappMessage({
    template: item?.whatsapp_prefill_text,
    listingUrl: getWhatsAppListingUrl(listingUrlPath),
    listingLabel: listingType === 'part' ? 'part' : listingType,
  });

  const encoded = encodeURIComponent(message);
  return `https://wa.me/${phone}?text=${encoded}`;
};
