export function getListingTitle(listing) {
  if (!listing) return 'Unknown';
  if (listing.display_title) return listing.display_title;
  if (listing.listing_title) return listing.listing_title;
  if (listing.title) return listing.title;
  if (listing.item_name) return listing.item_name;
  if (listing.draft_payload) {
    const payload = listing.draft_payload || {};
    return payload.listing_title || payload.title || payload.name || payload.item_name || `Draft #${listing.id ? listing.id.slice(0, 8) : 'Unknown'}`;
  }
  return `#${listing.id ? listing.id.slice(0, 8) : 'Unknown'}`;
}
