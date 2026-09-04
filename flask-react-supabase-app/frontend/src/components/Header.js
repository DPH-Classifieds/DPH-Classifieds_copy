import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bike,
  CarFront,
  ChevronRight,
  MenuIcon,
  Moon,
  Package,
  Plus,
  Sun,
  Tag,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { accentText, line } from '../lib/themeClasses';
import './ExplorePage.css';
import ProfileMenu from './ProfileMenu';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Button } from './ui/button';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from './ui/navigation-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

// Reddit brand mark used in the Browse menu (replaces the generic fire icon).
// Renders as a component so it drops into the same `item.icon` render sites.
const RedditIcon = ({ className }) => (
  <img src="/reddit-logo.png" alt="Reddit" className={className} style={{ objectFit: 'contain' }} />
);

const browseLinks = [
  {
    title: 'Buying Requests',
    description: 'Browse anonymous buying requests.',
    href: '/buying-requests',
    icon: Plus,
  },
  {
    title: 'Cars',
    description: 'Browse used, luxury, and performance cars.',
    href: '/cars',
    icon: CarFront,
  },
  {
    title: 'Car Parts',
    description: 'Find replacement parts and upgrades fast.',
    href: '/car-parts',
    icon: Package,
  },
  {
    title: 'Plates',
    description: 'Shop collectible and premium UAE plates.',
    href: '/plates',
    icon: Tag,
  },
  {
    title: 'Bikes',
    description: 'Discover motorcycles and specialty bikes.',
    href: '/bikes',
    icon: Bike,
  },
  {
    title: 'Reddit',
    description: 'Cars imported from r/DubaiPetrolHeads.',
    href: '/reddit',
    icon: RedditIcon,
  },
];

const resourceLinks = [{ title: 'About', href: '/about' }];

const Header = () => {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

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
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.toggle('menu-open', mobileMenuOpen);
    return () => document.body.classList.remove('menu-open');
  }, [mobileMenuOpen]);

  const dealerCanPost = !user?.is_dealer || user?.dealer_verified;

  const postLinks = useMemo(
    () => {
      const base = [
        { title: 'Post Car', href: user ? '/post-car' : '/login?redirect=/post-car' },
        { title: 'Post Car Part', href: user ? '/post-car-parts' : '/login?redirect=/post-car-parts' },
        { title: 'Post Plate', href: user ? '/post-plate' : '/login?redirect=/post-plate' },
        { title: 'Post Bike', href: user ? '/post-bike' : '/login?redirect=/post-bike' },
        { title: 'Post a Buying Request', href: user ? '/post-buying-request' : '/login?redirect=/post-buying-request' },
      ];
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

  // Translucent surface so backdrop-blur has something visible to blur. The
  // theme-aware surface tint comes from --ex-surface (white in light, near-
  // black in dark); color-mix is used here because Tailwind's `/85` opacity
  // modifier does not apply to bg-[color:var(--ex-surface)] — color-mix is
  // the portable way to get theme-aware translucency. Inline style is
  // required because Tailwind's arbitrary-value syntax does not accept
  // color-mix() function expressions in the bg-[...] shorthand.
  const headerSurfaceStyle = {
    backgroundColor: 'color-mix(in srgb, var(--ex-surface) 85%, transparent)',
  };

  const headerTone = scrolled
    ? `border-b ${line} shadow-[0_18px_48px_rgba(0,0,0,0.3)]`
    : `border-b border-[color:var(--ex-line)]`;

  return (
    <header
      // backdrop-blur forces the browser to continuously sample+blur whatever
      // scrolls beneath this fixed header — a real per-frame cost on weaker
      // devices. Lighter on mobile, full blur restored from md: up.
      className={`fixed inset-x-0 top-0 z-50 backdrop-blur-sm md:backdrop-blur-xl backdrop-saturate-150 transition-all duration-300 ${headerTone}`}
      style={headerSurfaceStyle}
    >
      <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-3.5 sm:px-8">
        {/* Logo */}
        <Link to="/" onClick={handleHomeNavigation} className="flex items-center text-[color:var(--ex-text)] transition-opacity hover:opacity-80">
          <span className="text-[1.3rem] font-bold tracking-[-0.03em] text-[color:var(--ex-text)]">
            DPH<span className={accentText}>Classifieds</span>
          </span>
        </Link>

        {/* Desktop Navigation - Centered */}
        <NavigationMenu className="hidden lg:flex lg:absolute lg:left-1/2 lg:-translate-x-1/2">
          <NavigationMenuList className="gap-0.5">
            <NavigationMenuItem>
              <NavigationMenuLink
                asChild
                className={`${isExploreActive ? 'bg-[color:var(--ex-brand-accent)]/15 text-[color:var(--ex-text)]' : ''} ${navigationMenuTriggerStyle()} rounded-full bg-transparent px-4 py-2 text-[14px] text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)] focus:bg-[color:var(--ex-brand-accent)]/10`}
              >
                <Link to="/explore">Explore</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={`${isBrowseActive ? 'bg-[color:var(--ex-brand-accent)]/15 text-[color:var(--ex-text)]' : ''} rounded-full bg-transparent px-4 py-2 text-[14px] text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)] focus:bg-[color:var(--ex-brand-accent)]/10`}
              >
                Browse
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="grid w-[640px] grid-cols-2 gap-2 p-3">
                  {browseLinks.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavigationMenuLink
                        key={item.href}
                        asChild
                        className="rounded-xl border border-transparent p-0"
                      >
                        <Link
                          to={item.href}
                          className="flex rounded-xl border border-[color:var(--ex-line)] bg-[color:var(--ex-surface)] p-4 transition-all duration-200 hover:border-[color:var(--ex-brand-accent)]/40 hover:bg-[color:var(--ex-surface-high)]"
                        >
                          <div className="mr-3.5 mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--ex-brand-accent)]/15 text-[color:var(--ex-brand-accent)]">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="mb-0.5 text-[14px] font-semibold text-[color:var(--ex-text)]">{item.title}</p>
                            <p className="text-[13px] leading-5 text-[color:var(--ex-text-muted)]">{item.description}</p>
                          </div>
                        </Link>
                      </NavigationMenuLink>
                    );
                  })}
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={`${isPostActive ? 'bg-[color:var(--ex-brand-accent)]/15 text-[color:var(--ex-text)]' : ''} rounded-full bg-transparent px-4 py-2 text-[14px] text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)] focus:bg-[color:var(--ex-brand-accent)]/10`}
              >
                Sell
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="grid w-[420px] gap-1.5 p-3">
                  {user && !dealerCanPost && (
                    <div className="mb-1 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-200">
                      Admin verification required before you can post.{' '}
                      <Link to="/settings" className="underline">View status</Link>
                    </div>
                  )}
                  {postLinks.map((item) => (
                    <NavigationMenuLink key={item.href} asChild className="rounded-xl p-0">
                      <Link
                        to={item.href}
                        className={`flex items-center justify-between rounded-xl border border-[color:var(--ex-line)] bg-[color:var(--ex-surface)] px-4 py-3 transition-all duration-200 ${
                          item.disabled
                            ? 'cursor-not-allowed text-[color:var(--ex-text-muted)] hover:border-[color:var(--ex-line)] hover:bg-[color:var(--ex-surface)]'
                            : 'text-[color:var(--ex-text-muted)] hover:border-[color:var(--ex-brand-accent)]/40 hover:bg-[color:var(--ex-surface-high)] hover:text-[color:var(--ex-text)]'
                        }`}
                      >
                        <span className="text-[14px] font-medium">{item.title}</span>
                        <ChevronRight className="h-4 w-4 opacity-50" />
                      </Link>
                    </NavigationMenuLink>
                  ))}
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                asChild
                className={`${isResourcesActive ? 'bg-[color:var(--ex-brand-accent)]/15 text-[color:var(--ex-text)]' : ''} ${navigationMenuTriggerStyle()} rounded-full bg-transparent px-4 py-2 text-[14px] text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)] focus:bg-[color:var(--ex-brand-accent)]/10`}
              >
                <Link to="/about">About</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {user && (
              <NavigationMenuItem>
                {user?.is_dealer && user?.dealer_verified ? (
                  <NavigationMenuLink
                    asChild
                    className={`${location.pathname.startsWith('/dealer') ? 'bg-[color:var(--ex-brand-accent)]/15 text-[color:var(--ex-text)]' : ''} ${navigationMenuTriggerStyle()} rounded-full bg-transparent px-4 py-2 text-[14px] text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)] focus:bg-[color:var(--ex-brand-accent)]/10`}
                  >
                    <Link to="/dealer/dashboard">Dealer Panel</Link>
                  </NavigationMenuLink>
                ) : (
                  <NavigationMenuLink
                    asChild
                    className={`${location.pathname === '/my-listings' ? 'bg-[color:var(--ex-brand-accent)]/15 text-[color:var(--ex-text)]' : ''} ${navigationMenuTriggerStyle()} rounded-full bg-transparent px-4 py-2 text-[14px] text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)] focus:bg-[color:var(--ex-brand-accent)]/10`}
                  >
                    <Link to="/my-listings">My Listings</Link>
                  </NavigationMenuLink>
                )}
              </NavigationMenuItem>
            )}
          </NavigationMenuList>
        </NavigationMenu>

        {/* Theme toggle — desktop only; on mobile it lives inside the hamburger menu below */}
        <div className="hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex size-9 items-center justify-center rounded-full border border-[color:var(--ex-line)] bg-transparent text-[color:var(--ex-text-muted)] transition-all duration-200 hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]"
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
                className="rounded-full bg-gradient-to-r from-[color:var(--ex-brand-accent)] to-[color:var(--ex-primary-strong)] px-5 py-2 text-[14px] font-semibold text-white shadow-[0_4px_16px_rgba(139,214,180,0.2)] transition-all duration-200 hover:from-[color:var(--ex-brand-accent)]/90 hover:to-[color:var(--ex-primary-strong)]/95 hover:shadow-[0_6px_24px_rgba(139,214,180,0.3)]"
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
              className="rounded-full border border-[color:var(--ex-line)] bg-transparent text-[color:var(--ex-text)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]"
            >
              <MenuIcon className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="top"
            className="max-h-screen overflow-auto border-b border-[color:var(--ex-line)] text-[color:var(--ex-text)]"
            // bg-[color:var(--ex-page-bg)]/98 compiled to nothing (same
            // opacity-modifier-on-CSS-var limitation as headerSurfaceStyle
            // above) leaving the mobile menu fully transparent over the
            // page content. --ex-page-bg is a gradient in dark mode, so
            // unlike headerSurfaceStyle this can't use color-mix() either
            // (that only accepts single colors) — plain `background`
            // shorthand is the one form that accepts both the light theme's
            // solid color and the dark theme's gradient.
            style={{ background: 'var(--ex-page-bg)' }}
          >
            <SheetHeader>
              <SheetTitle>
                <Link to="/" onClick={handleHomeNavigation} className="flex items-center gap-3 text-left text-[color:var(--ex-text)]">
                  <span className="text-[1.2rem] font-bold tracking-[-0.03em] text-[color:var(--ex-text)]">
            DPH<span className={accentText}>Classifieds</span>
                  </span>
                </Link>
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-1 py-4">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="browse" className="border-[color:var(--ex-line)]">
                  <AccordionTrigger className="text-base font-medium text-[color:var(--ex-text)] hover:no-underline">
                    Browse listings
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-2 pt-2">
                      {browseLinks.map((item) => {
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            to={item.href}
                            className="flex items-start gap-3 rounded-xl border border-[color:var(--ex-line)] bg-[color:var(--ex-brand-accent)]/10 px-4 py-3 transition-colors hover:bg-[color:var(--ex-brand-accent)]/10"
                          >
                            <div className="mt-0.5 rounded-lg bg-[color:var(--ex-brand-accent)]/15 p-2 text-[color:var(--ex-brand-accent)]">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="font-medium text-[color:var(--ex-text)]">{item.title}</p>
                              <p className="text-sm text-[color:var(--ex-text-muted)]">{item.description}</p>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="sell" className="border-[color:var(--ex-line)]">
                  <AccordionTrigger className="text-base font-medium text-[color:var(--ex-text)] hover:no-underline">
                    Post a listing
                  </AccordionTrigger>
                  <AccordionContent>
                    {user && !dealerCanPost && (
                      <div className="mb-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-200">
                        Admin verification required before you can post.{' '}
                        <Link to="/settings" className="underline">View status</Link>
                      </div>
                    )}
                    <div className="grid gap-2 pt-2">
                      {postLinks.map((item) => (
                        <Link
                          key={item.href}
                          to={item.href}
                          className={`flex items-center justify-between rounded-xl border border-[color:var(--ex-line)] bg-[color:var(--ex-brand-accent)]/10 px-4 py-3 transition-colors ${
                            item.disabled
                              ? 'cursor-not-allowed text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10'
                              : 'text-[color:var(--ex-text-muted)] hover:bg-[color:var(--ex-brand-accent)]/10 hover:text-[color:var(--ex-text)]'
                          }`}
                        >
                          <span>{item.title}</span>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      ))}
                    </div>
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
                      className="w-full justify-start rounded-xl border border-red-400/20 bg-transparent px-4 py-3 text-red-300/80 hover:bg-red-500/10 hover:text-red-200"
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
                      className="w-full justify-center rounded-full bg-gradient-to-r from-[color:var(--ex-brand-accent)] to-[color:var(--ex-primary-strong)] py-3 text-[14px] font-semibold text-white shadow-[0_4px_16px_rgba(139,214,180,0.2)] hover:from-[color:var(--ex-brand-accent)]/90 hover:to-[color:var(--ex-primary-strong)]/95"
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
