import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  MenuIcon,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import useIsAdmin from '../hooks/useIsAdmin';
import { accentText, line } from '../lib/themeClasses';
import './ExplorePage.css';
import '../styles/shell-tokens.css';
import '../styles/Header.css';
import ProfileMenu from './ProfileMenu';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import {
  BrowseCategoryList,
  BrowseMegaMenu,
  browseLinks,
  SellMenu,
  sellLinkConfig,
} from './navigation/MarketplaceNavMenus';

// SellMenu displays this verification guard before posting:
// Admin verification required before you can post

const resourceLinks = [{ title: 'About', href: '/about' }];

const Header = () => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const isAdmin = useIsAdmin(user);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopMenu, setDesktopMenu] = useState(null);
  const [browseCategory, setBrowseCategory] = useState('cars');
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const desktopNavRef = useRef(null);
  const browseTriggerRef = useRef(null);
  const sellTriggerRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 24);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
    setDesktopMenu(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!desktopMenu) return undefined;

    const handleOutsidePointer = (event) => {
      if (!desktopNavRef.current?.contains(event.target)) {
        setDesktopMenu(null);
      }
    };
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      setDesktopMenu(null);
      const trigger = desktopMenu === 'browse' ? browseTriggerRef.current : sellTriggerRef.current;
      trigger?.focus();
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [desktopMenu]);

  useEffect(() => {
    document.body.classList.toggle('menu-open', mobileMenuOpen);
    return () => document.body.classList.remove('menu-open');
  }, [mobileMenuOpen]);

  const dealerCanPost = !user?.is_dealer || user?.dealer_verified;

  const postLinks = useMemo(
    () => {
      const routes = {
        car: '/post-car',
        'car-part': '/post-car-parts',
        plate: '/post-plate',
        bike: '/post-bike',
        'buying-request': '/post-buying-request',
      };
      const base = sellLinkConfig.map((item) => ({
        ...item,
        href: user ? routes[item.id] : `/login?redirect=${routes[item.id]}`,
      }));
      if (user && !dealerCanPost) {
        return base.map((item) => ({ ...item, href: '/settings', disabled: true }));
      }
      return base;
    },
    [user, dealerCanPost]
  );

  const isBrowseActive = browseLinks.some((item) => location.pathname.startsWith(item.href));
  const isResourcesActive = resourceLinks.some((item) => location.pathname.startsWith(item.href));
  const isPostActive = postLinks.some((item) => location.pathname.startsWith(item.href.replace('/login?redirect=', '')));
  const isExploreActive = location.pathname.startsWith('/explore');

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

  // Keep the navigation chrome opaque so Browse/Sell menus never blend with
  // the page behind them. This is especially important on light pages where a
  // translucent header made the menu look mint-tinted instead of white.
  const headerSurfaceStyle = {
    backgroundColor: 'var(--dph-header-surface)',
  };

  const headerTone = scrolled
    ? `border-b ${line} shadow-[0_18px_48px_rgba(0,0,0,0.3)]`
    : `border-b border-[color:var(--ex-line)]`;

  return (
    <header
      // The public chrome is intentionally solid. Avoiding backdrop blur keeps
      // this fixed shell fast on weaker devices and prevents page content from
      // bleeding through Browse/Sell surfaces.
      className={`site-header fixed inset-x-0 top-0 z-50 transition-all duration-300 ${headerTone}`}
      style={headerSurfaceStyle}
    >
      <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-3.5 sm:px-8">
        {/* Logo */}
        <Link to="/" onClick={handleHomeNavigation} className="flex items-center text-[color:var(--ex-text)] transition-opacity hover:opacity-80">
          <span className="text-[1.3rem] font-bold tracking-[-0.03em] text-[color:var(--ex-text)]">
            DPH<span className={`site-header__brand-accent ${accentText}`}>Classifieds</span>
          </span>
        </Link>

        {/* Desktop Navigation - centered marketplace menus stay in the header layer */}
        <nav ref={desktopNavRef} className="site-header__navigation hidden lg:flex lg:absolute lg:left-1/2 lg:-translate-x-1/2" aria-label="Primary navigation">
          <div className="site-header__desktop-nav-list">
            <Link
              to="/explore"
              className={`site-header__nav-link ${isExploreActive ? 'is-active' : ''}`}
            >
              Explore
            </Link>

            <div
              className="site-header__desktop-menu-anchor"
              onMouseEnter={() => setDesktopMenu('browse')}
            >
              <button
                ref={browseTriggerRef}
                type="button"
                className={`site-header__nav-link site-header__menu-trigger site-header__menu-trigger--browse ${isBrowseActive ? 'is-active' : ''} ${desktopMenu === 'browse' ? 'is-open' : ''}`}
                aria-expanded={desktopMenu === 'browse'}
                aria-controls="dph-browse-menu"
                onClick={() => setDesktopMenu((current) => current === 'browse' ? null : 'browse')}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDesktopMenu('browse');
                  }
                }}
              >
                Browse <ChevronDown aria-hidden="true" />
              </button>
              {desktopMenu === 'browse' && (
                <BrowseMegaMenu selectedId={browseCategory} onSelect={setBrowseCategory} />
              )}
            </div>

            <div
              className="site-header__desktop-menu-anchor"
              onMouseEnter={() => setDesktopMenu('sell')}
            >
              <button
                ref={sellTriggerRef}
                type="button"
                className={`site-header__nav-link site-header__menu-trigger site-header__menu-trigger--sell ${isPostActive ? 'is-active' : ''} ${desktopMenu === 'sell' ? 'is-open' : ''}`}
                aria-expanded={desktopMenu === 'sell'}
                aria-controls="dph-sell-menu"
                onClick={() => setDesktopMenu((current) => current === 'sell' ? null : 'sell')}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setDesktopMenu('sell');
                  }
                }}
              >
                Sell <ChevronDown aria-hidden="true" />
              </button>
              {desktopMenu === 'sell' && (
                <SellMenu postLinks={postLinks} showVerificationNotice={Boolean(user && !dealerCanPost)} />
              )}
            </div>

            <Link to="/about" className={`site-header__nav-link ${isResourcesActive ? 'is-active' : ''}`}>
              About
            </Link>

            {user && (user?.is_dealer && user?.dealer_verified ? (
              <Link to="/dealer/dashboard" className={`site-header__nav-link ${location.pathname.startsWith('/dealer') ? 'is-active' : ''}`}>
                Dealer Panel
              </Link>
            ) : (
              <Link to="/my-listings" className={`site-header__nav-link ${location.pathname === '/my-listings' ? 'is-active' : ''}`}>
                My Listings
              </Link>
            ))}
          </div>
        </nav>

        {/* Theme toggle — desktop only; on mobile it lives inside the hamburger menu below */}
        <div className="hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="site-header__icon-button flex size-9 items-center justify-center rounded-full bg-transparent transition-all duration-200"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* Auth Buttons / Profile Menu */}
          <div className="flex items-center gap-2.5">
          {user ? (
            <ProfileMenu user={user} onLogout={handleLogout} />
          ) : (
            <>
              <Button
                asChild
                variant="ghost"
                className="rounded-full border border-[color:var(--ex-line)] bg-transparent px-5 py-2 text-[14px] font-medium text-[color:var(--ex-text-muted)] transition-all duration-200 hover:border-[color:var(--ex-line)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]"
              >
                <Link to="/login">Log In</Link>
              </Button>
              <Button
                asChild
                className="site-header__primary-button rounded-full px-5 py-2 text-[14px] font-semibold transition-all duration-200"
              >
                <Link to="/signup">Sign Up</Link>
              </Button>
            </>
          )}
          </div>
        </div>

        {/* Mobile Menu Button */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild className="lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="dph-mobile-navigation"
              className="site-header__icon-button rounded-full bg-transparent"
            >
              <MenuIcon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="top"
            id="dph-mobile-navigation"
            className="site-header__mobile-panel max-h-screen overflow-auto border-b text-[color:var(--ex-text)]"
            // Use the dedicated opaque shell token so the mobile menu stays
            // legible over every page and theme.
            style={{ background: 'var(--dph-header-mobile-surface)' }}
          >
            <SheetHeader>
              <SheetTitle>
                <Link to="/" onClick={handleHomeNavigation} className="flex items-center gap-3 text-left text-[color:var(--ex-text)]">
                  <span className="text-[1.2rem] font-bold tracking-[-0.03em] text-[color:var(--ex-text)]">
            DPH<span className={`site-header__brand-accent ${accentText}`}>Classifieds</span>
                  </span>
                </Link>
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-1 py-4">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="browse" className="border-[color:var(--ex-line)]">
                  <AccordionTrigger className="text-base font-medium text-[color:var(--ex-text)] hover:no-underline">
                    Browse
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="site-header__mobile-market-panel">
                      <div className="site-header__mobile-market-intro">
                        <span className="marketplace-nav__eyebrow">DISCOVER</span>
                        <h2>Browse listings across the UAE</h2>
                      </div>
                      <BrowseCategoryList selectedId={browseCategory} onSelect={setBrowseCategory} mobile />
                      <div className="site-header__mobile-market-feature">
                        <span className="marketplace-nav__eyebrow">FEATURED</span>
                        <strong>Find your next drive</strong>
                        <span>Cars, luxury, and performance vehicles.</span>
                        <Link to="/cars">Browse cars <span aria-hidden="true">→</span></Link>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="sell" className="border-[color:var(--ex-line)]">
                  <AccordionTrigger className="text-base font-medium text-[color:var(--ex-text)] hover:no-underline">
                    Sell
                  </AccordionTrigger>
                  <AccordionContent>
                    <SellMenu postLinks={postLinks} mobile showVerificationNotice={Boolean(user && !dealerCanPost)} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-base font-medium text-[color:var(--ex-text-muted)] transition-colors hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]"
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </button>
                <Link to="/" className="rounded-xl px-3 py-2.5 text-base font-medium text-[color:var(--ex-text-muted)] transition-colors hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                  Home
                </Link>
                <Link to="/explore" className="rounded-xl px-3 py-2.5 text-base font-medium text-[color:var(--ex-text-muted)] transition-colors hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                  Explore
                </Link>
                <Link to="/about" className="rounded-xl px-3 py-2.5 text-base font-medium text-[color:var(--ex-text-muted)] transition-colors hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                  About
                </Link>
                {user && (
                  user?.is_dealer && user?.dealer_verified ? (
                    <Link to="/dealer/dashboard" className="rounded-xl px-3 py-2.5 text-base font-medium text-[color:var(--ex-text-muted)] transition-colors hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                      Dealer Panel
                    </Link>
                  ) : (
                    <Link to="/my-listings" className="rounded-xl px-3 py-2.5 text-base font-medium text-[color:var(--ex-text-muted)] transition-colors hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                      My Listings
                    </Link>
                  )
                )}
                {isAdmin && (
                  <Link to="/admin" className="rounded-xl px-3 py-2.5 text-base font-medium text-[color:var(--ex-text-muted)] transition-colors hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                    Admin Panel
                  </Link>
                )}
              </div>

              <div className="flex flex-col gap-2.5 border-t border-[color:var(--ex-line)] pt-4">
                {user ? (
                  <>
                    <div className="rounded-2xl border border-[color:var(--ex-line)] bg-[color:var(--ex-surface-high)] p-4">
                      <p className="text-[11px] uppercase tracking-[0.15em] text-[color:var(--ex-text-muted)]">Signed in as</p>
                      <p className="mt-1.5 truncate text-[14px] font-medium text-[color:var(--ex-text)]">{user.email}</p>
                    </div>
                    <Button asChild variant="ghost" className="w-full justify-start rounded-xl border border-[color:var(--ex-line)] bg-transparent px-4 py-3 text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                      <Link to="/profile">Profile</Link>
                    </Button>
                    <Button asChild variant="ghost" className="w-full justify-start rounded-xl border border-[color:var(--ex-line)] bg-transparent px-4 py-3 text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                      <Link to="/settings">Settings</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start rounded-xl border border-red-400/20 bg-transparent px-4 py-3 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300/80 dark:hover:text-red-200"
                      onClick={handleLogout}
                    >
                      Log Out
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild variant="ghost" className="w-full justify-center rounded-full border border-[color:var(--ex-line)] bg-transparent py-3 text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]">
                      <Link to="/login">Log In</Link>
                    </Button>
                    <Button
                      asChild
                      className="site-header__primary-button w-full justify-center rounded-full py-3 text-[14px] font-semibold"
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
