# Header Simplification, Search + Location, and Personalized Recommendations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered header with a clean search-first layout, add location filtering for UAE cities, and build a personalized recommendation engine that learns from user interactions.

**Architecture:** The header collapses to Logo | Search Bar + Location | Auth. The hero section becomes a focused search surface. A new `UserBehaviorTracker` records listing views/clicks into localStorage + backend. A recommendation endpoint returns similar listings based on viewed items. The homepage and detail pages surface "Recommended for you" sections.

**Tech Stack:** React (existing), Tailwind CSS (existing), Supabase (existing), Flask backend (existing), localStorage for behavior tracking, new `/api/recommendations` endpoint.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `frontend/src/components/Header.js` | Simplified header: logo, search bar, location dropdown, auth |
| `frontend/src/components/LocationPicker.jsx` | New — reusable location dropdown (UAE cities) |
| `frontend/src/components/ui/search-bar.jsx` | New — reusable search input with icon |
| `frontend/src/components/HomePage.js` | Hero section with integrated search + location |
| `frontend/src/components/ExplorePage.jsx` | Wire up search bar + location filter to existing filters |
| `frontend/src/components/UserBehaviorTracker.jsx` | New — invisible component that tracks listing views/clicks |
| `frontend/src/components/RecommendedListings.jsx` | New — "Recommended for you" section |
| `frontend/src/components/MarketplaceListingCard.jsx` | Add `data-listing-*` attributes for tracking |
| `frontend/src/components/CarDetail.jsx` | Add recommended listings section |
| `frontend/src/components/BikeDetailRedesigned.jsx` | Add recommended listings section |
| `frontend/src/components/PartDetailRedesigned.jsx` | Add recommended listings section |
| `frontend/src/components/PlateDetailRedesigned.jsx` | Add recommended listings section |
| `frontend/src/utils/userBehavior.js` | New — localStorage read/write for behavior profile |
| `frontend/src/styles/Header.css` | New search bar styles |
| `frontend/src/styles/HomePage.css` | Hero search integration styles |
| `backend/app.py` | New `/api/recommendations` endpoint |
| `frontend/src/App.js` | Add UserBehaviorTracker to global render |

---

## Task 1: LocationPicker Component

**Files:**
- Create: `frontend/src/components/LocationPicker.jsx`
- Create: `frontend/src/components/LocationPicker.css`

- [ ] **Step 1: Create LocationPicker component**

```jsx
// frontend/src/components/LocationPicker.jsx
import React, { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown } from 'lucide-react';
import './LocationPicker.css';

const UAE_CITIES = [
  { value: '', label: 'All UAE' },
  { value: 'Dubai', label: 'Dubai' },
  { value: 'Abu Dhabi', label: 'Abu Dhabi' },
  { value: 'Sharjah', label: 'Sharjah' },
  { value: 'Ajman', label: 'Ajman' },
  { value: 'Ras Al Khaimah', label: 'Ras Al Khaimah' },
  { value: 'Fujairah', label: 'Fujairah' },
  { value: 'Umm Al Quwain', label: 'Umm Al Quwain' },
];

const STORAGE_KEY = 'dph_selected_city';

const LocationPicker = ({ value, onChange, className = '' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const selected = UAE_CITIES.find((c) => c.value === (value || '')) || UAE_CITIES[0];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (city) => {
    onChange(city.value);
    localStorage.setItem(STORAGE_KEY, city.value);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`lp-root ${className}`}>
      <button type="button" className="lp-trigger" onClick={() => setOpen(!open)}>
        <MapPin className="lp-icon" size={15} />
        <span className="lp-label">{selected.label}</span>
        <ChevronDown className={`lp-chevron ${open ? 'lp-chevron-open' : ''}`} size={14} />
      </button>
      {open && (
        <div className="lp-dropdown">
          {UAE_CITIES.map((city) => (
            <button
              key={city.value}
              type="button"
              className={`lp-option ${city.value === selected.value ? 'lp-option-active' : ''}`}
              onClick={() => handleSelect(city)}>
              {city.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const getSavedCity = () => localStorage.getItem(STORAGE_KEY) || '';
export default LocationPicker;
```

- [ ] **Step 2: Create LocationPicker CSS**

```css
/* frontend/src/components/LocationPicker.css */
.lp-root {
  position: relative;
}

.lp-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.lp-trigger:hover {
  border-color: rgba(139, 214, 180, 0.2);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.lp-icon {
  color: #8bd6b4;
  flex-shrink: 0;
}

.lp-label {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lp-chevron {
  opacity: 0.5;
  transition: transform 0.15s;
}

.lp-chevron-open {
  transform: rotate(180deg);
}

.lp-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 180px;
  background: rgba(8, 24, 14, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  z-index: 100;
  backdrop-filter: blur(20px);
}

.lp-option {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: all 0.12s;
}

.lp-option:hover {
  background: rgba(139, 214, 180, 0.1);
  color: #fff;
}

.lp-option-active {
  color: #8bd6b4;
  font-weight: 600;
}
```

- [ ] **Step 3: Verify component renders**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LocationPicker.jsx frontend/src/components/LocationPicker.css
git commit -m "feat: add LocationPicker component with UAE cities"
```

---

## Task 2: SearchBar Component

**Files:**
- Create: `frontend/src/components/ui/search-bar.jsx`
- Create: `frontend/src/styles/SearchBar.css`

- [ ] **Step 1: Create SearchBar component**

```jsx
// frontend/src/components/ui/search-bar.jsx
import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import '../../styles/SearchBar.css';

const SearchBar = ({
  value = '',
  onChange,
  onSubmit,
  placeholder = 'Search cars, parts, plates, bikes...',
  className = '',
  autoFocus = false,
  size = 'default',
}) => {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onSubmit) onSubmit(value);
  };

  const handleClear = () => {
    onChange('');
    inputRef.current?.focus();
  };

  return (
    <form
      className={`search-bar ${size === 'large' ? 'search-bar--large' : ''} ${focused ? 'search-bar--focused' : ''} ${className}`}
      onSubmit={handleSubmit}
      role="search">
      <Search className="search-bar__icon" size={size === 'large' ? 20 : 16} />
      <input
        ref={inputRef}
        type="text"
        className="search-bar__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        aria-label="Search listings"
      />
      {value && (
        <button type="button" className="search-bar__clear" onClick={handleClear} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </form>
  );
};

export default SearchBar;
```

- [ ] **Step 2: Create SearchBar CSS**

```css
/* frontend/src/styles/SearchBar.css */
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  transition: all 0.2s;
  flex: 1;
  max-width: 480px;
}

.search-bar--focused {
  border-color: rgba(139, 214, 180, 0.3);
  background: rgba(255, 255, 255, 0.06);
  box-shadow: 0 0 0 3px rgba(139, 214, 180, 0.08);
}

.search-bar--large {
  padding: 12px 18px;
  border-radius: 14px;
  max-width: 600px;
}

.search-bar__icon {
  color: rgba(255, 255, 255, 0.35);
  flex-shrink: 0;
  transition: color 0.15s;
}

.search-bar--focused .search-bar__icon {
  color: #8bd6b4;
}

.search-bar__input {
  flex: 1;
  border: none;
  background: transparent;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  min-width: 0;
}

.search-bar--large .search-bar__input {
  font-size: 16px;
}

.search-bar__input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.search-bar__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}

.search-bar__clear:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/search-bar.jsx frontend/src/styles/SearchBar.css
git commit -m "feat: add SearchBar component"
```

---

## Task 3: Simplify Header — Desktop

**Files:**
- Modify: `frontend/src/components/Header.js`

- [ ] **Step 1: Rewrite Header.js with search-first layout**

Replace the entire file. The new layout:
- **Left:** Logo
- **Center:** SearchBar + LocationPicker (visible on all pages)
- **Right:** Auth buttons / ProfileMenu
- **Mobile:** Hamburger opens Sheet with search, location, and nav links

Key changes:
- Remove `NavigationMenu` with Browse/Sell/About dropdowns
- Add `SearchBar` + `LocationPicker` in center
- Keep auth section unchanged
- Mobile Sheet includes search bar, location, and flat nav links

```jsx
// frontend/src/components/Header.js
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MenuIcon, Plus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ProfileMenu from './ProfileMenu';
import LocationPicker, { getSavedCity } from './LocationPicker';
import SearchBar from './ui/search-bar';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

const Header = () => {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [locationValue, setLocationValue] = useState(getSavedCity);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 24);
    handleScroll();
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('menu-open', mobileMenuOpen);
    return () => document.body.classList.remove('menu-open');
  }, [mobileMenuOpen]);

  const dealerCanPost = !user?.is_dealer || user?.dealer_verified;

  const handleSearchSubmit = (query) => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (locationValue) params.set('city', locationValue);
    navigate(`/explore?${params.toString()}`);
    setMobileMenuOpen(false);
  };

  const handleLocationChange = (city) => {
    setLocationValue(city);
  };

  const handleHomeNavigation = (e) => {
    if (location.pathname === '/') {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const headerTone = scrolled
    ? 'border-b border-white/10 bg-[rgba(4,16,8,0.95)] shadow-[0_18px_48px_rgba(0,0,0,0.3)]'
    : 'border-b border-white/5 bg-[rgba(4,16,8,0.85)]';

  const navLinks = [
    { label: 'Explore', href: '/explore' },
    { label: 'Cars', href: '/cars' },
    { label: 'Parts', href: '/car-parts' },
    { label: 'Plates', href: '/plates' },
    { label: 'Bikes', href: '/bikes' },
    { label: 'Sell', href: user ? '/post-car' : '/login?redirect=/post-car' },
  ];

  if (user) {
    navLinks.push({ label: 'My Listings', href: '/my-listings' });
  }

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 backdrop-blur-xl backdrop-saturate-150 transition-all duration-300 ${headerTone}`}
    >
      <div className="mx-auto flex max-w-[1480px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link to="/" onClick={handleHomeNavigation} className="flex items-center text-white transition-opacity hover:opacity-80 shrink-0">
          <span className="text-[1.3rem] font-bold tracking-[-0.03em] text-white">
            DPH<span className="text-[#8bd6b4]">Classifieds</span>
          </span>
        </Link>

        {/* Desktop: Search + Location */}
        <div className="hidden lg:flex items-center gap-2 flex-1 justify-center max-w-[680px] mx-6">
          <SearchBar
            value={searchValue}
            onChange={setSearchValue}
            onSubmit={handleSearchSubmit}
            placeholder="Search cars, parts, plates, bikes..."
          />
          <LocationPicker value={locationValue} onChange={handleLocationChange} />
        </div>

        {/* Auth Buttons / Profile Menu */}
        <div className="hidden items-center gap-2.5 lg:flex shrink-0">
          {user ? (
            <ProfileMenu user={user} onLogout={handleLogout} />
          ) : (
            <>
              <Button
                asChild
                variant="ghost"
                className="rounded-full border border-white/10 bg-transparent px-5 py-2 text-[14px] font-medium text-white/80 transition-all duration-200 hover:border-white/20 hover:bg-white/5 hover:text-white"
              >
                <Link to="/login">Log In</Link>
              </Button>
              <Button
                asChild
                className="rounded-full bg-gradient-to-r from-[#8bd6b4] to-[#004e37] px-5 py-2 text-[14px] font-semibold text-white shadow-[0_4px_16px_rgba(139,214,180,0.2)] transition-all duration-200 hover:from-[#9fe0c4] hover:to-[#005a41] hover:shadow-[0_6px_24px_rgba(139,214,180,0.3)]"
              >
                <Link to="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile Menu */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild className="lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full border border-white/10 bg-transparent text-white hover:bg-white/8 hover:text-white"
            >
              <MenuIcon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="top"
            className="max-h-screen overflow-auto border-b border-white/10 bg-[rgba(4,16,8,0.98)] text-white"
          >
            <SheetHeader>
              <SheetTitle>
                <Link to="/" onClick={handleHomeNavigation} className="flex items-center gap-3 text-left text-white">
                  <span className="text-[1.2rem] font-bold tracking-[-0.03em] text-white">
                    DPH<span className="text-[#8bd6b4]">Classifieds</span>
                  </span>
                </Link>
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-1 py-4">
              {/* Mobile Search + Location */}
              <div className="flex flex-col gap-2">
                <SearchBar
                  value={searchValue}
                  onChange={setSearchValue}
                  onSubmit={handleSearchSubmit}
                  placeholder="Search anything..."
                  size="large"
                />
                <LocationPicker value={locationValue} onChange={handleLocationChange} />
              </div>

              {/* Nav Links */}
              <div className="flex flex-col gap-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    to={link.href}
                    className={`rounded-xl px-3 py-2.5 text-base font-medium transition-colors ${
                      location.pathname === link.href || location.pathname.startsWith(link.href + '/')
                        ? 'bg-white/10 text-white'
                        : 'text-white/80 hover:bg-white/6 hover:text-white'
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
                <Link to="/about" className="rounded-xl px-3 py-2.5 text-base font-medium text-white/80 transition-colors hover:bg-white/6 hover:text-white">
                  About
                </Link>
              </div>

              {/* Auth Section */}
              <div className="flex flex-col gap-2.5 border-t border-white/10 pt-4">
                {user ? (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.15em] text-white/40">Signed in as</p>
                      <p className="mt-1.5 truncate text-[14px] font-medium text-white">{user.email}</p>
                    </div>
                    <Button asChild variant="ghost" className="w-full justify-start rounded-xl border border-white/10 bg-transparent px-4 py-3 text-white/80 hover:bg-white/8 hover:text-white">
                      <Link to="/profile">Profile</Link>
                    </Button>
                    <Button asChild variant="ghost" className="w-full justify-start rounded-xl border border-white/10 bg-transparent px-4 py-3 text-white/80 hover:bg-white/8 hover:text-white">
                      <Link to="/settings">Settings</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start rounded-xl border border-red-400/20 bg-transparent px-4 py-3 text-red-300/80 hover:bg-red-500/10 hover:text-red-200"
                      onClick={handleLogout}
                    >
                      Log Out
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild variant="ghost" className="w-full justify-center rounded-full border border-white/10 bg-transparent py-3 text-white/80 hover:bg-white/8 hover:text-white">
                      <Link to="/login">Log In</Link>
                    </Button>
                    <Button
                      asChild
                      className="w-full justify-center rounded-full bg-gradient-to-r from-[#8bd6b4] to-[#004e37] py-3 text-[14px] font-semibold text-white shadow-[0_4px_16px_rgba(139,214,180,0.2)] hover:from-[#9fe0c4] hover:to-[#005a41]"
                    >
                      <Link to="/signup">
                        <Plus className="mr-2 h-4 w-4" />
                        Create account
                      </Link>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
};

export default Header;
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds. Header shows search bar + location in center on desktop.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Header.js
git commit -m "feat: simplify header with search bar and location picker"
```

---

## Task 4: Hero Section with Search

**Files:**
- Modify: `frontend/src/components/HomePage.js`
- Modify: `frontend/src/styles/HomePage.css`

- [ ] **Step 1: Update HomePage.js hero section**

Replace the hero content block (lines 265-282) to include a search bar + location below the title. Import the new components.

At the top of HomePage.js, add imports:
```jsx
import SearchBar from './ui/search-bar';
import LocationPicker, { getSavedCity } from './LocationPicker';
```

Replace the hero content div:
```jsx
<div className="cn-shell cn-hero-content">
  <span className="cn-kicker"><span className="cn-kicker-dph">DPH</span> <span className="cn-kicker-classifieds">Classifieds</span></span>
  <h1 className="cn-display-title">For PetrolHeads. By PetrolHeads.</h1>
  <p className="cn-hero-subtitle">Buy and sell cars, bikes, parts, and plates across the UAE.</p>
  <div className="cn-hero-search">
    <SearchBar
      value={heroSearch}
      onChange={setHeroSearch}
      onSubmit={handleHeroSearch}
      placeholder="Search cars, parts, plates, bikes..."
      size="large"
    />
    <LocationPicker value={heroLocation} onChange={setHeroLocation} />
  </div>
  <div className="cn-hero-actions">
    <Button asChild className={primaryHeroButtonClass}>
      <Link to="/explore">
        Browse All
        <ArrowRight className="-me-1 ms-2 opacity-80 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
      </Link>
    </Button>
    <Button asChild variant="outline" className={secondaryHeroButtonClass}>
      <Link to="/post-car">
        List Your Vehicle
        <ArrowRight className="-me-1 ms-2 opacity-80 transition-transform group-hover:translate-x-0.5" size={16} strokeWidth={2} aria-hidden="true" />
      </Link>
    </Button>
  </div>
</div>
```

Add state and handler in the component:
```jsx
const [heroSearch, setHeroSearch] = useState('');
const [heroLocation, setHeroLocation] = useState(getSavedCity);

const handleHeroSearch = (query) => {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (heroLocation) params.set('city', heroLocation);
  navigate(`/explore?${params.toString()}`);
};
```

- [ ] **Step 2: Add hero search CSS**

Add to `HomePage.css`:
```css
.cn-hero-subtitle {
  font-size: 1.1rem;
  color: rgba(255, 255, 255, 0.55);
  max-width: 520px;
  line-height: 1.6;
  margin-bottom: 28px;
}

.cn-hero-search {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 640px;
  margin-bottom: 28px;
}

.cn-hero-search .search-bar {
  flex: 1;
}

@media (max-width: 640px) {
  .cn-hero-search {
    flex-direction: column;
    align-items: stretch;
  }
}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/HomePage.js frontend/src/styles/HomePage.css
git commit -m "feat: add search bar and location to homepage hero"
```

---

## Task 5: Wire ExplorePage Search + Location Filters

**Files:**
- Modify: `frontend/src/components/ExplorePage.jsx`

- [ ] **Step 1: Read URL params and connect to filter state**

In ExplorePage.jsx, after the existing filter state declarations (~line 436), add URL param reading:

```jsx
// Read URL params from header/hero search
useEffect(() => {
  const params = new URLSearchParams(location.search);
  const q = params.get('q') || '';
  const city = params.get('city') || '';
  const cat = params.get('category') || 'all';

  if (q || city) {
    setCarFilters((prev) => ({ ...prev, query: q, city }));
    setPartsFilters((prev) => ({ ...prev, query: q }));
    setPlateFilters((prev) => ({ ...prev, query: q, city }));
    setBikeFilters((prev) => ({ ...prev, query: q }));
  }
  if (cat && exploreModes.some((m) => m.key === cat)) {
    setActiveMode(cat);
  }
}, [location.search]);
```

Make sure `location` is imported from react-router-dom at the top:
```jsx
import { useLocation, useNavigate } from 'react-router-dom';
```

And destructure it in the component:
```jsx
const location = useLocation();
const navigate = useNavigate();
```

- [ ] **Step 2: Expose filter setters in the useMemo section**

The existing code at lines 432-436 destructures filter state but drops the setters. Fix by capturing them:

```jsx
const [carFilters, setCarFilters] = useState(carInitialFilters);
const [partsFilters, setPartsFilters] = useState(partsInitialFilters);
const [plateFilters, setPlateFilters] = useState(plateInitialFilters);
const [bikeFilters, setBikeFilters] = useState(bikeInitialFilters);
```

- [ ] **Step 3: Verify search works end-to-end**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds. Navigating to `/explore?q=Toyota&city=Dubai` pre-fills filters.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ExplorePage.jsx
git commit -m "feat: wire ExplorePage to accept search/location URL params"
```

---

## Task 6: User Behavior Tracking (Frontend)

**Files:**
- Create: `frontend/src/utils/userBehavior.js`
- Create: `frontend/src/components/UserBehaviorTracker.jsx`
- Modify: `frontend/src/App.js`

- [ ] **Step 1: Create behavior tracking utility**

```jsx
// frontend/src/utils/userBehavior.js
const STORAGE_KEY = 'dph_user_behavior';
const MAX_VIEWS = 50;

export const getBehaviorProfile = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { viewed: [], clicked: [], searches: [] };
  } catch {
    return { viewed: [], clicked: [], searches: [] };
  }
};

export const trackView = (listingType, listingId, metadata = {}) => {
  const profile = getBehaviorProfile();
  const entry = {
    type: listingType,
    id: listingId,
    ts: Date.now(),
    ...metadata,
  };
  // Remove duplicate if exists
  profile.viewed = profile.viewed.filter(
    (v) => !(v.type === listingType && v.id === listingId)
  );
  // Add to front
  profile.viewed.unshift(entry);
  // Cap at MAX_VIEWS
  profile.viewed = profile.viewed.slice(0, MAX_VIEWS);
  saveProfile(profile);
};

export const trackClick = (listingType, listingId, metadata = {}) => {
  const profile = getBehaviorProfile();
  profile.clicked.unshift({
    type: listingType,
    id: listingId,
    ts: Date.now(),
    ...metadata,
  });
  profile.clicked = profile.clicked.slice(0, MAX_VIEWS);
  saveProfile(profile);
};

export const trackSearch = (query) => {
  if (!query.trim()) return;
  const profile = getBehaviorProfile();
  profile.searches.unshift({ query: query.trim(), ts: Date.now() });
  profile.searches = profile.searches.slice(0, 20);
  saveProfile(profile);
};

export const getPreferenceProfile = () => {
  const profile = getBehaviorProfile();
  const types = {};
  const priceRanges = [];
  const locations = {};

  profile.viewed.forEach((v) => {
    types[v.type] = (types[v.type] || 0) + 1;
    if (v.price) priceRanges.push(v.price);
    if (v.location) locations[v.location] = (locations[v.location] || 0) + 1;
  });

  const preferredTypes = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);

  const avgPrice = priceRanges.length
    ? priceRanges.reduce((a, b) => a + b, 0) / priceRanges.length
    : null;

  const preferredLocations = Object.entries(locations)
    .sort((a, b) => b[1] - a[1])
    .map(([loc]) => loc);

  return { preferredTypes, avgPrice, preferredLocations, totalViews: profile.viewed.length };
};

const saveProfile = (profile) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage full, silently fail
  }
};
```

- [ ] **Step 2: Create UserBehaviorTracker component**

```jsx
// frontend/src/components/UserBehaviorTracker.jsx
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackView, trackSearch } from '../utils/userBehavior';

const LISTING_PATH_RE = /^\/(cars|car-parts|plates|bikes)\/([^/]+)/;
const SEARCH_PARAM_RE = /[?&]q=([^&]+)/;

const UserBehaviorTracker = () => {
  const location = useLocation();
  const lastPathRef = useRef('');

  useEffect(() => {
    const path = `${location.pathname}${location.search}`;

    if (path === lastPathRef.current) return;
    lastPathRef.current = path;

    // Track listing detail views
    const listingMatch = path.match(LISTING_PATH_RE);
    if (listingMatch) {
      const typeMap = { cars: 'car', 'car-parts': 'part', plates: 'plate', bikes: 'bike' };
      const type = typeMap[listingMatch[1]] || listingMatch[1];
      const id = listingMatch[2];

      // Extract price from URL or page if available
      trackView(type, id, { path });
    }

    // Track search queries
    const searchMatch = path.match(SEARCH_PARAM_RE);
    if (searchMatch) {
      const query = decodeURIComponent(searchMatch[1]);
      trackSearch(query);
    }
  }, [location]);

  return null;
};

export default UserBehaviorTracker;
```

- [ ] **Step 3: Add data attributes to MarketplaceListingCard for click tracking**

In `frontend/src/components/MarketplaceListingCard.jsx`, add to the card wrapper element:

```jsx
data-listing-type={item.categoryLabel?.toLowerCase()}
data-listing-id={item.id}
data-analytics-event="listing_click"
```

- [ ] **Step 4: Register UserBehaviorTracker in App.js**

In `frontend/src/App.js`, import and render inside `<Router>`:

```jsx
import UserBehaviorTracker from './components/UserBehaviorTracker';

// Inside <Router>, near ScrollToTop:
<UserBehaviorTracker />
```

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/userBehavior.js frontend/src/components/UserBehaviorTracker.jsx frontend/src/components/MarketplaceListingCard.jsx frontend/src/App.js
git commit -m "feat: add user behavior tracking for views, clicks, and searches"
```

---

## Task 7: Backend Recommendations Endpoint

**Files:**
- Modify: `backend/app.py`

- [ ] **Step 1: Add /api/recommendations endpoint**

Add this endpoint near the other listing endpoints in app.py:

```python
@app.route("/api/recommendations", methods=["POST"])
def get_recommendations():
    """Return personalized listing recommendations based on user behavior."""
    try:
        data = request.json or {}
        viewed = data.get("viewed", [])  # [{type, id}, ...]
        preferred_types = data.get("preferredTypes", [])
        avg_price = data.get("avgPrice")
        limit = min(int(data.get("limit", 8)), 20)

        if not viewed and not preferred_types:
            # Cold start: return newest listings
            return _get_newest_recommendations(limit)

        # Build a set of viewed IDs to exclude
        viewed_ids = {v["id"] for v in viewed if v.get("id")}
        viewed_types = [v["type"] for v in viewed if v.get("type")]

        # Determine which types to recommend (prefer viewed types, fallback to all)
        target_types = preferred_types or list(set(viewed_types))
        type_map = {
            "car": ("cars", "car_manufacturer", "expected_selling_price"),
            "bike": ("bikes", "bike_brand", None),
            "part": ("car_parts", "category", "price"),
            "plate": ("plates", "plate_code", "price"),
        }

        results = []
        for t in target_types:
            if t not in type_map:
                continue
            table, name_col, price_col = type_map[t]

            query = supabase.table(table).select("*").eq("is_approved", True)

            # Price band: within +/- 40% of average viewed price
            if avg_price and price_col:
                low = avg_price * 0.6
                high = avg_price * 1.4
                query = query.gte(price_col, low).lte(price_col, high)

            # Exclude already viewed
            # (Supabase doesn't support NOT IN well, filter after)

            items = query.order("created_at", desc=True).limit(limit).execute().data or []
            for item in items:
                item_id = str(item.get("id", ""))
                if item_id in viewed_ids:
                    continue
                results.append(_normalize_recommendation(item, t))

        # Sort by recency and cap
        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return jsonify({"recommendations": results[:limit]})

    except Exception as e:
        print(f"Recommendations error: {e}")
        return jsonify({"recommendations": [], "error": str(e)}), 500


def _get_newest_recommendations(limit):
    """Cold start: return newest listings across all types."""
    results = []
    queries = [
        ("car", "cars"),
        ("bike", "bikes"),
        ("part", "car_parts"),
        ("plate", "plates"),
    ]
    for type_key, table in queries:
        items = (
            supabase.table(table)
            .select("*")
            .eq("is_approved", True)
            .order("created_at", desc=True)
            .limit(limit // len(queries) + 1)
            .execute()
            .data or []
        )
        for item in items:
            results.append(_normalize_recommendation(item, type_key))

    results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return jsonify({"recommendations": results[:limit]})


def _normalize_recommendation(item, item_type):
    """Normalize a listing into a consistent recommendation shape."""
    base = {
        "id": str(item.get("id", "")),
        "type": item_type,
        "created_at": item.get("created_at", ""),
    }

    if item_type == "car":
        base["title"] = f"{item.get('car_manufacturer', '')} {item.get('car_model', '')}".strip()
        base["subtitle"] = item.get("car_trim", "")
        base["price"] = item.get("expected_selling_price")
        base["location"] = item.get("car_city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/cars/{item.get('id')}"
    elif item_type == "bike":
        base["title"] = f"{item.get('bike_brand', '')} {item.get('bike_model', '')}".strip()
        base["subtitle"] = item.get("bike_type", "")
        base["price"] = item.get("expected_price")
        base["location"] = item.get("city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/bikes/{item.get('id')}"
    elif item_type == "part":
        base["title"] = item.get("part_name", item.get("title", ""))
        base["subtitle"] = item.get("category", "")
        base["price"] = item.get("price")
        base["location"] = item.get("city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/car-parts/{item.get('id')}"
    elif item_type == "plate":
        base["title"] = f"{item.get('plate_code', '')} {item.get('plate_number', '')}".strip()
        base["subtitle"] = item.get("plate_type", "")
        base["price"] = item.get("price")
        base["location"] = item.get("city", "")
        base["image"] = (item.get("photos") or [None])[0]
        base["route"] = f"/plates/{item.get('id')}"

    return base
```

- [ ] **Step 2: Verify backend starts**

Run: `cd backend && python -c "from app import app; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat: add /api/recommendations endpoint with behavior-based suggestions"
```

---

## Task 8: RecommendedListings Component

**Files:**
- Create: `frontend/src/components/RecommendedListings.jsx`

- [ ] **Step 1: Create the component**

```jsx
// frontend/src/components/RecommendedListings.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { getBehaviorProfile, getPreferenceProfile } from '../utils/userBehavior';
import MarketplaceListingCard from './MarketplaceListingCard';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const RecommendedListings = ({ limit = 8, className = '' }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchRecommendations = async () => {
      const profile = getBehaviorProfile();
      const prefs = getPreferenceProfile();

      if (prefs.totalViews === 0) {
        // Cold start: fetch newest
        try {
          const res = await fetch(`${API_URL}/api/recommendations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit }),
          });
          const data = await res.json();
          setRecommendations(data.recommendations || []);
        } catch (err) {
          console.warn('Failed to fetch recommendations:', err);
        }
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/recommendations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            viewed: profile.viewed.map((v) => ({ type: v.type, id: v.id })),
            preferredTypes: prefs.preferredTypes,
            avgPrice: prefs.avgPrice,
            limit,
          }),
        });
        const data = await res.json();
        setRecommendations(data.recommendations || []);
      } catch (err) {
        console.warn('Failed to fetch recommendations:', err);
      }
      setLoading(false);
    };

    fetchRecommendations();
  }, [limit]);

  if (loading || recommendations.length === 0) return null;

  return (
    <section className={`cn-recommended ${className}`}>
      <div className="cn-shell">
        <div className="cn-section-heading cn-section-heading-dark">
          <div>
            <span className="cn-kicker" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} /> Recommended for you
            </span>
            <h2>Based on what you have been looking at</h2>
          </div>
        </div>
        <div className="cn-market-grid">
          {recommendations.map((item) => (
            <MarketplaceListingCard
              key={`${item.type}-${item.id}`}
              item={{
                id: item.id,
                categoryLabel: item.type,
                title: item.title,
                subtitle: item.subtitle,
                price: item.price,
                location: item.location,
                image: item.image,
                route: item.route,
              }}
              showMoreLink={false}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default RecommendedListings;
```

- [ ] **Step 2: Add recommended section CSS**

Add to `HomePage.css`:
```css
.cn-recommended {
  padding: 60px 0;
}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RecommendedListings.jsx frontend/src/styles/HomePage.css
git commit -m "feat: add RecommendedListings component"
```

---

## Task 9: Add Recommendations to Pages

**Files:**
- Modify: `frontend/src/components/HomePage.js`
- Modify: `frontend/src/components/CarDetail.jsx`
- Modify: `frontend/src/components/BikeDetailRedesigned.jsx`
- Modify: `frontend/src/components/PartDetailRedesigned.jsx`
- Modify: `frontend/src/components/PlateDetailRedesigned.jsx`

- [ ] **Step 1: Add to HomePage**

After the marketplace preview section (around line 329), add:

```jsx
<RecommendedListings limit={8} />
```

Import at top:
```jsx
import RecommendedListings from './RecommendedListings';
```

- [ ] **Step 2: Add to CarDetail.jsx**

Before the closing `</div>` of the detail page, add:

```jsx
<RecommendedListings limit={4} />
```

Import at top:
```jsx
import RecommendedListings from './RecommendedListings';
```

- [ ] **Step 3: Add to BikeDetailRedesigned.jsx, PartDetailRedesigned.jsx, PlateDetailRedesigned.jsx**

Same pattern — import and add `<RecommendedListings limit={4} />` near the bottom of each component.

- [ ] **Step 4: Verify build**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HomePage.js frontend/src/components/CarDetail.jsx frontend/src/components/BikeDetailRedesigned.jsx frontend/src/components/PartDetailRedesigned.jsx frontend/src/components/PlateDetailRedesigned.jsx
git commit -m "feat: add recommended listings to homepage and detail pages"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Run full build**

```bash
cd frontend && npx react-scripts build 2>&1 | tail -10
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Start dev server and verify manually**

```bash
cd frontend && npm start
```

Check:
- Header shows search bar + location on desktop
- Mobile menu shows search + location at top
- Hero section has search bar + location
- Navigating to `/explore?q=Toyota` pre-filters results
- Homepage shows "Recommended for you" section after listings
- Detail pages show "Recommended for you" at bottom
- localStorage has `dph_user_behavior` after viewing listings

- [ ] **Step 3: Commit all**

```bash
git add -A
git commit -m "feat: complete header simplification, search, location, and recommendations"
```
