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
        <Link to="/" onClick={handleHomeNavigation} className="flex items-center text-white transition-opacity hover:opacity-80 shrink-0">
          <span className="text-[1.3rem] font-bold tracking-[-0.03em] text-white">
            DPH<span className="text-[#8bd6b4]">Classifieds</span>
          </span>
        </Link>

        <div className="hidden lg:flex items-center gap-2 flex-1 justify-center max-w-[680px] mx-6">
          <SearchBar
            value={searchValue}
            onChange={setSearchValue}
            onSubmit={handleSearchSubmit}
            placeholder="Search cars, parts, plates, bikes..."
          />
          <LocationPicker value={locationValue} onChange={handleLocationChange} />
        </div>

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
