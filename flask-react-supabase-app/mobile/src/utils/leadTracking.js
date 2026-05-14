import apiClient from './apiClient';

export const trackLeadEvent = async (listingType, listingId, eventType) => {
  try {
    await apiClient.post(`/api/listings/${listingType}/${listingId}/lead-events`, {
      event_type: eventType,
    });
  } catch (err) {
    // Silent fail
  }
};
