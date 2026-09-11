import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Bike,
  CarFront,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  MapPin,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  Zap,
} from 'lucide-react';
import './MarketplaceNavMenus.css';

const RedditIcon = ({ className }) => (
  <img src="/redditlogo.png" alt="" aria-hidden="true" className={`marketplace-nav__reddit-icon ${className || ''}`} />
);

export const browseLinks = [
  {
    id: 'cars',
    title: 'Cars',
    description: 'All cars, new & used',
    href: '/cars',
    icon: CarFront,
  },
  {
    id: 'car-parts',
    title: 'Car Parts',
    description: 'Find parts & upgrades',
    href: '/car-parts',
    icon: Package,
  },
  {
    id: 'plates',
    title: 'Plates',
    description: 'UAE number plates',
    href: '/plates',
    icon: Tag,
  },
  {
    id: 'bikes',
    title: 'Bikes',
    description: 'Motorcycles & scooters',
    href: '/bikes',
    icon: Bike,
  },
  {
    id: 'reddit',
    title: 'Reddit Imports',
    description: 'Cars from r/DubaiPetrolHeads',
    href: '/reddit',
    icon: RedditIcon,
  },
  {
    id: 'buying-requests',
    title: 'Buying Requests',
    description: 'Post what you’re looking for',
    href: '/buying-requests',
    icon: Plus,
  },
];

const carPopularCategories = [
  { label: 'Sedan', href: '/cars?body_type=Sedan', icon: CarFront },
  { label: 'SUV', href: '/cars?body_type=SUV', icon: CarFront },
  { label: 'Luxury', href: '/cars', icon: CircleDollarSign },
  { label: 'Sports', href: '/cars?body_type=Coupe', icon: Gauge },
  { label: 'Pickup', href: '/cars?body_type=Truck', icon: Package },
  { label: 'Hatchback', href: '/cars?body_type=Hatchback', icon: CarFront },
  { label: 'Electric', href: '/cars?fuel_type=Electric', icon: Zap },
  { label: 'Classic', href: '/cars', icon: Sparkles },
];

export const browseContent = {
  cars: {
    eyebrow: 'CARS',
    headline: 'Find your next drive',
    description: 'From everyday cars to luxury and performance vehicles — all across the UAE.',
    // Keep this asset in the tracked public root. The previous optimized JPG
    // is locally present but ignored by the repository's media rules, which
    // made the deployed Browse menu render its alt text instead of the image.
    heroImage: '/hero.avif',
    heroAlt: 'Blue performance car available on DPH Classifieds',
    popularLabel: 'Popular Categories',
    popularAction: 'View All Cars',
    popularCategories: carPopularCategories,
  },
  'car-parts': {
    eyebrow: 'CAR PARTS',
    headline: 'The right part, sooner',
    description: 'Find replacement parts, upgrades, and useful gear from sellers across the UAE.',
    heroFallbackTitle: 'Parts that keep you moving',
    heroFallbackDescription: 'Find the next upgrade or replacement across the UAE.',
    popularLabel: 'Explore Car Parts',
    popularAction: 'View All Parts',
    popularCategories: [
      { label: 'Engines', href: '/car-parts', icon: Gauge },
      { label: 'Wheels', href: '/car-parts', icon: CircleDollarSign },
      { label: 'Body Parts', href: '/car-parts', icon: CarFront },
      { label: 'Accessories', href: '/car-parts', icon: Sparkles },
    ],
  },
  plates: {
    eyebrow: 'PLATES',
    headline: 'A plate with presence',
    description: 'Discover collectible and premium UAE number plates from sellers you can reach directly.',
    heroFallbackTitle: 'Numbers with presence',
    heroFallbackDescription: 'Discover standout UAE plates from trusted sellers.',
    popularLabel: 'Browse Plate Collections',
    popularAction: 'View All Plates',
    popularCategories: [
      { label: 'Dubai', href: '/plates', icon: Tag },
      { label: 'Abu Dhabi', href: '/plates', icon: Tag },
      { label: 'Sharjah', href: '/plates', icon: Tag },
      { label: 'All Emirates', href: '/plates', icon: MapPin },
    ],
  },
  bikes: {
    eyebrow: 'BIKES',
    headline: 'Make your next move',
    description: 'Explore motorcycles, scooters, and specialty bikes from riders across the UAE.',
    heroFallbackTitle: 'Your next ride awaits',
    heroFallbackDescription: 'Find motorcycles and scooters ready for the next adventure.',
    popularLabel: 'Popular Bike Types',
    popularAction: 'View All Bikes',
    popularCategories: [
      { label: 'Sport Bikes', href: '/bikes', icon: Bike },
      { label: 'Cruisers', href: '/bikes', icon: Bike },
      { label: 'Scooters', href: '/bikes', icon: Bike },
      { label: 'Off-road', href: '/bikes', icon: Bike },
    ],
  },
  reddit: {
    eyebrow: 'REDDIT IMPORTS',
    headline: 'Petrolhead finds, curated',
    description: 'Browse cars imported from the r/DubaiPetrolHeads community and discover the story behind each one.',
    heroFallbackTitle: 'Community cars, curated',
    heroFallbackDescription: 'Explore imports and stories from r/DubaiPetrolHeads.',
    popularLabel: 'Explore the Community',
    popularAction: 'View Reddit Imports',
    popularCategories: [
      { label: 'Performance', href: '/reddit', icon: Gauge },
      { label: 'JDM', href: '/reddit', icon: CarFront },
      { label: 'European', href: '/reddit', icon: CarFront },
      { label: 'Recently Added', href: '/reddit', icon: Sparkles },
    ],
  },
  'buying-requests': {
    eyebrow: 'BUYING REQUESTS',
    headline: 'Let the right seller find you',
    description: 'See what UAE buyers are looking for, or share the exact vehicle, part, or plate you need.',
    heroFallbackTitle: 'Tell sellers what you need',
    heroFallbackDescription: 'Post a request and let the right seller find you.',
    popularLabel: 'Browse Requests',
    popularAction: 'View All Requests',
    popularCategories: [
      { label: 'Cars Wanted', href: '/buying-requests', icon: CarFront },
      { label: 'Parts Wanted', href: '/buying-requests', icon: Package },
      { label: 'Plates Wanted', href: '/buying-requests', icon: Tag },
      { label: 'All Requests', href: '/buying-requests', icon: Search },
    ],
  },
};

export const sellLinkConfig = [
  {
    id: 'car',
    title: 'Post a Car',
    description: 'List your car in minutes',
    icon: CarFront,
    popular: true,
  },
  {
    id: 'car-part',
    title: 'Post a Car Part',
    description: 'Reach buyers across the UAE',
    icon: Package,
  },
  {
    id: 'plate',
    title: 'Post a Plate',
    description: 'List your UAE number plate',
    icon: Tag,
  },
  {
    id: 'bike',
    title: 'Post a Bike',
    description: 'Sell your motorcycle or scooter',
    icon: Bike,
  },
  {
    id: 'buying-request',
    title: 'Post a Buying Request',
    description: 'Tell sellers what you’re looking for',
    icon: Plus,
  },
];

const categoryIconClass = 'marketplace-nav__category-icon';

export const BrowseCategoryList = ({ selectedId, onSelect, mobile = false }) => (
  <div className={`marketplace-nav__category-list ${mobile ? 'is-mobile' : ''}`}>
    {browseLinks.map((item) => {
      const Icon = item.icon;
      const isSelected = selectedId === item.id;
      return (
        <Link
          key={item.id}
          to={item.href}
          className={`marketplace-nav__category ${isSelected ? 'is-selected' : ''}`}
          onMouseEnter={() => onSelect?.(item.id)}
          onFocus={() => onSelect?.(item.id)}
          onClick={() => onSelect?.(item.id)}
          aria-current={isSelected ? 'true' : undefined}
        >
          <span className={categoryIconClass}>
            <Icon aria-hidden="true" />
          </span>
          <span className="marketplace-nav__category-copy">
            <strong>{item.title}</strong>
            <small>{item.description}</small>
          </span>
          <ChevronRight aria-hidden="true" className="marketplace-nav__category-chevron" />
        </Link>
      );
    })}
  </div>
);

export const BrowseHero = ({ categoryId }) => {
  const category = browseContent[categoryId] || browseContent.cars;
  const SelectedIcon = browseLinks.find((item) => item.id === categoryId)?.icon || CarFront;
  const viewAllHref = browseLinks.find((item) => item.id === categoryId)?.href || '/cars';

  return (
    <div className="marketplace-nav__browse-detail">
      <div className="marketplace-nav__browse-copy">
        <span className="marketplace-nav__eyebrow">{category.eyebrow}</span>
        <h2>{category.headline}</h2>
        <p>{category.description}</p>
      </div>

      {category.heroImage ? (
        <Link to={viewAllHref} className="marketplace-nav__hero-media">
          <img src={category.heroImage} alt={category.heroAlt} />
          <span>Explore the UAE marketplace <ArrowRight aria-hidden="true" /></span>
        </Link>
      ) : (
        <Link to={viewAllHref} className={`marketplace-nav__hero-fallback is-${categoryId}`}>
          <span className="marketplace-nav__hero-fallback-icon"><SelectedIcon aria-hidden="true" /></span>
          <span>
            <strong>{category.heroFallbackTitle || 'Built for the UAE'}</strong>
            <small>{category.heroFallbackDescription || 'Discover listings from all seven Emirates'}</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </Link>
      )}

      <div className="marketplace-nav__popular-heading">
        <span>{category.popularLabel}</span>
        <Link to={viewAllHref}> {category.popularAction} <ArrowRight aria-hidden="true" /></Link>
      </div>
      <div className="marketplace-nav__popular-grid">
        {category.popularCategories.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.label} to={item.href} className="marketplace-nav__popular-card">
              <span><Icon aria-hidden="true" /></span>
              <strong>{item.label}</strong>
              <ChevronRight aria-hidden="true" />
            </Link>
          );
        })}
      </div>

      <div className="marketplace-nav__trust-strip" aria-label="Why use DPH Classifieds">
        <div><BadgeCheck aria-hidden="true" /><span><strong>Verified Listings</strong><small>Safer buying & selling</small></span></div>
        <div><MapPin aria-hidden="true" /><span><strong>UAE Wide</strong><small>Listings from all Emirates</small></span></div>
        <div><Users aria-hidden="true" /><span><strong>Active Community</strong><small>Real buyers, real sellers</small></span></div>
      </div>
    </div>
  );
};

export const BrowseMegaMenu = ({ selectedId, onSelect, onMouseEnter, onMouseLeave }) => (
  <div
    className="marketplace-nav__browse-menu"
    id="dph-browse-menu"
    role="menu"
    aria-label="Browse categories"
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    <div className="marketplace-nav__browse-sidebar">
      <div className="marketplace-nav__menu-heading">
        <span className="marketplace-nav__eyebrow">DISCOVER</span>
        <strong>Browse the marketplace</strong>
      </div>
      <BrowseCategoryList selectedId={selectedId} onSelect={onSelect} />
      <div className="marketplace-nav__location-card">
        <span className="marketplace-nav__location-icon"><MapPin aria-hidden="true" /></span>
        <span><small>Browse in</small><strong>UAE <ArrowRight aria-hidden="true" /></strong><em>Listings from all 7 Emirates</em></span>
      </div>
    </div>
    <BrowseHero categoryId={selectedId} />
  </div>
);

export const SellActionCard = ({ item, mobile = false }) => {
  const Icon = item.icon;
  return (
    <Link
      to={item.href}
      className={`marketplace-nav__sell-card ${item.popular ? 'is-popular' : ''} ${item.disabled ? 'is-disabled' : ''} ${mobile ? 'is-mobile' : ''}`}
      aria-disabled={item.disabled ? 'true' : undefined}
    >
      <span className="marketplace-nav__sell-icon"><Icon aria-hidden="true" /></span>
      <span className="marketplace-nav__sell-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
      {item.popular && <span className="marketplace-nav__popular-badge">Most Popular</span>}
      <ChevronRight aria-hidden="true" className="marketplace-nav__sell-chevron" />
    </Link>
  );
};

export const SellMenu = ({ postLinks, mobile = false, showVerificationNotice = false, onMouseEnter, onMouseLeave }) => (
  <div
    className={`marketplace-nav__sell-menu ${mobile ? 'is-mobile' : ''}`}
    id={mobile ? undefined : 'dph-sell-menu'}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {mobile && (
      <div className="marketplace-nav__sell-heading">
        <span className="marketplace-nav__eyebrow">SELL ON DPHCLASSIFIEDS</span>
        <h2>Reach buyers across the UAE.</h2>
      </div>
    )}
    {showVerificationNotice && (
      <div className="marketplace-nav__verification-note">
        <ShieldCheck aria-hidden="true" />
        <span>Admin verification required before you can post. <Link to="/settings">View status</Link></span>
      </div>
    )}
    <div className="marketplace-nav__sell-list">
      {postLinks.map((item) => <SellActionCard key={item.id} item={item} mobile={mobile} />)}
    </div>
    <div className="marketplace-nav__sell-promo">
      <span><Sparkles aria-hidden="true" /></span>
      <p><strong>{mobile ? 'Quick & free' : 'It’s quick & free'}</strong><small>Get in front of thousands of buyers across the UAE.</small></p>
      <Zap aria-hidden="true" />
    </div>
  </div>
);
