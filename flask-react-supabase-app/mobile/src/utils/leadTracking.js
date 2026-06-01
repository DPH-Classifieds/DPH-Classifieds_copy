import apiClient from './apiClient';
import { trackEvent as trackGa4Event } from './analytics';

const GA4_EVENT_NAMES = {
  call_click: 'contact_click_call',
  whatsapp_click: 'contact_click_whatsapp',
  vin_open: 'vin_open',
  vin_reveal: 'vin_reveal',
};

export const trackLeadEvent = async (listingType, listingId, action, source = 'detail') => {
  // First-party: powers the in-app KPI dashboard. Survives ad-blockers.
  try {
    await apiClient.post(`/api/listings/${listingType}/${listingId}/lead-events`, {
      action,
      source: `${listingType}_${source}`,
      payload: { listing_id: listingId },
    });
  } catch (err) {
    // Silent fail — analytics never blocks UI.
  }

  // GA4: powers external dashboards + conversion goals.
  const ga4Event = GA4_EVENT_NAMES[action];
  if (ga4Event) {
    trackGa4Event(ga4Event, {
      listing_type: listingType,
      listing_id: String(listingId),
      source,
    });
  }
};
