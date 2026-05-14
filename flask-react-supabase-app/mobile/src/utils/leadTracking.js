import apiClient from './apiClient';

export const trackLeadEvent = async (listingType, listingId, action, source = 'detail') => {
  try {
    await apiClient.post(`/api/listings/${listingType}/${listingId}/lead-events`, {
      action,
      source: `${listingType}_${source}`,
      payload: { listing_id: listingId },
    });
  } catch (err) {
    // Silent fail
  }
};
