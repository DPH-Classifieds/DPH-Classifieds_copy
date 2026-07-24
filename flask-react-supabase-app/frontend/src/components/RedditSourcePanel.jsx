import React from 'react';

// A car is a safely-renderable Reddit import only when it declares reddit as its
// source AND its source_url resolves to reddit's own host. Never trust an
// arbitrary source_url to be reddit.
export function isRedditSourced(car) {
  if (!car || car.source_platform !== 'reddit' || !car.source_url) return false;
  try {
    const host = new URL(car.source_url).hostname;
    return host === 'www.reddit.com' || host === 'reddit.com';
  } catch (e) {
    return false;
  }
}

// Source attribution + the single canonical outbound CTA. The global
// PlatformAnalyticsTracker click handler reads the data-* attributes and emits
// exactly one `reddit_post_open` event — no onClick network call here.
// `car` is any imported listing (car/bike/plate/part); listingType/listingId
// tag the analytics event to the right category.
export default function RedditSourcePanel({ car, listingType = 'car', listingId }) {
  if (!isRedditSourced(car)) return null;
  const id = listingId != null ? listingId : car.id;
  return (
    <div className="cd-reddit-source">
      <div className="cd-reddit-source-head">
        <span className="cd-badge cd-badge-reddit">Reddit</span>
        <span className="cd-reddit-source-attr">Posted by DPH Classifieds · imported from r/DubaiPetrolHeads</span>
      </div>
      <p className="cd-reddit-source-disclaimer">
        Listing details are supplied by the original Reddit post; see the linked post for full details.
      </p>
      <a
        href={car.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="cd-button cd-button-primary cd-reddit-cta"
        data-analytics-event="reddit_post_open"
        data-analytics-intent="view_original_reddit_post"
        data-listing-type={listingType}
        data-listing-id={id}
        data-analytics-label="View original Reddit post"
      >
        View original Reddit post
      </a>
    </div>
  );
}
