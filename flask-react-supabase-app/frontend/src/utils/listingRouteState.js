export const buildListingRouteState = (listing, extra = {}) => {
  if (!listing || typeof listing !== 'object') {
    return extra;
  }

  return {
    listing,
    ...extra,
  };
};
