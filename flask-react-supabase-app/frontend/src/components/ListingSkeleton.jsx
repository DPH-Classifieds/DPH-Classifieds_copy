import React from 'react';
import './ListingSkeleton.css';

const CardSkeleton = () => (
  <article className="listing-skeleton-card" aria-hidden="true">
    <div className="listing-skeleton-media listing-skeleton-shimmer" />
    <div className="listing-skeleton-copy">
      <div className="listing-skeleton-row listing-skeleton-badge listing-skeleton-shimmer" />
      <div className="listing-skeleton-row listing-skeleton-title listing-skeleton-shimmer" />
      <div className="listing-skeleton-row listing-skeleton-title listing-skeleton-shimmer short" />
      <div className="listing-skeleton-row listing-skeleton-meta listing-skeleton-shimmer" />
      <div className="listing-skeleton-footer">
        <div className="listing-skeleton-price listing-skeleton-shimmer" />
        <div className="listing-skeleton-button listing-skeleton-shimmer" />
      </div>
    </div>
  </article>
);

const DetailSkeleton = () => (
  <div className="listing-skeleton-detail" aria-hidden="true">
    <div className="listing-skeleton-detail-media listing-skeleton-shimmer" />
    <div className="listing-skeleton-detail-content">
      <div className="listing-skeleton-row listing-skeleton-breadcrumb listing-skeleton-shimmer" />
      <div className="listing-skeleton-row listing-skeleton-heading listing-skeleton-shimmer" />
      <div className="listing-skeleton-row listing-skeleton-subheading listing-skeleton-shimmer short" />
      <div className="listing-skeleton-strip">
        <span className="listing-skeleton-chip listing-skeleton-shimmer" />
        <span className="listing-skeleton-chip listing-skeleton-shimmer" />
        <span className="listing-skeleton-chip listing-skeleton-shimmer" />
      </div>
      <div className="listing-skeleton-detail-grid">
        <div className="listing-skeleton-panel listing-skeleton-shimmer" />
        <div className="listing-skeleton-panel listing-skeleton-shimmer" />
      </div>
      <div className="listing-skeleton-detail-grid">
        <div className="listing-skeleton-panel listing-skeleton-shimmer" />
        <div className="listing-skeleton-panel listing-skeleton-shimmer" />
      </div>
    </div>
  </div>
);

const ListingSkeleton = ({
  variant = 'grid',
  count = 6,
  className = '',
  showFilters = false,
  showHeader = false,
  showHero = false,
}) => {
  const rootClasses = ['listing-skeleton'];
  if (className) {
    rootClasses.push(className);
  }

  if (variant === 'detail') {
    return (
      <div className={rootClasses.join(' ')}>
        {showHero ? <div className="listing-skeleton-hero listing-skeleton-shimmer" /> : null}
        <DetailSkeleton />
      </div>
    );
  }

  return (
    <div className={rootClasses.join(' ')}>
      {showHero ? <div className="listing-skeleton-hero listing-skeleton-shimmer" /> : null}
      {showHeader ? (
        <div className="listing-skeleton-header">
          <div className="listing-skeleton-row listing-skeleton-heading listing-skeleton-shimmer" />
          <div className="listing-skeleton-row listing-skeleton-subheading listing-skeleton-shimmer short" />
        </div>
      ) : null}
      {showFilters ? (
        <div className="listing-skeleton-filters">
          <div className="listing-skeleton-filter listing-skeleton-shimmer" />
          <div className="listing-skeleton-filter listing-skeleton-shimmer" />
          <div className="listing-skeleton-filter listing-skeleton-shimmer" />
          <div className="listing-skeleton-filter listing-skeleton-shimmer" />
        </div>
      ) : null}
      <div className="listing-skeleton-grid">
        {Array.from({ length: count }).map((_, index) => (
          <CardSkeleton key={`listing-skeleton-${index}`} />
        ))}
      </div>
    </div>
  );
};

export default ListingSkeleton;
