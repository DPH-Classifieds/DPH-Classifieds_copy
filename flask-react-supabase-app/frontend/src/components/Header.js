import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bike,
  CarFront,
  ChevronRight,
  MenuIcon,
  Package,
  Plus,
  Tag,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
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

const browseLinks = [
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
];

const resourceLinks = [{ title: 'About', href: '/about' }];

const Header = () => {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 24);
    };

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

  const postLinks = useMemo(
    () => [
      { title: 'Post Car', href: user ? '/post-car' : '/login?redirect=/post-car' },
      { title: 'Post Car Part', href: user ? '/post-car-parts' : '/login?redirect=/post-car-parts' },
      { title: 'Post Plate', href: user ? '/post-plate' : '/login?redirect=/post-plate' },
      { title: 'Post Bike', href: user ? '/post-bike' : '/login?redirect=/post-bike' },
    ],
    [user]
  );

  const isBrowseActive = browseLinks.some((item) => location.pathname.startsWith(item.href));
  const isResourcesActive = resourceLinks.some((item) => location.pathname.startsWith(item.href));
  const isPostActive = postLinks.some((item) => location.pathname.startsWith(item.href.replace('/login?redirect=', '')));
  const isExploreActive = location.pathname.startsWith('/explore');

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const headerTone = scrolled
    ? 'border-b border-white/10 bg-[rgba(4,16,8,0.92)] shadow-[0_18px_48px_rgba(0,0,0,0.28)]'
    : 'border-b border-white/5 bg-[rgba(4,16,8,0.78)]';

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 backdrop-blur-xl backdrop-saturate-150 transition-all duration-300 ${headerTone}`}
    >
      <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-4 py-4 sm:px-7">
        <Link to="/" className="flex items-center gap-3 text-white">
          <span className="text-[1.35rem] font-semibold tracking-[-0.04em] text-white">
            DPHClassifieds
          </span>
        </Link>

        <NavigationMenu className="hidden lg:flex">
          <NavigationMenuList className="gap-1">
            <NavigationMenuItem>
              <NavigationMenuLink
                asChild
                className={`${isExploreActive ? 'bg-white/10 text-white' : ''} ${navigationMenuTriggerStyle()} bg-transparent text-white/80 hover:bg-white/8 hover:text-white focus:bg-white/8`}
              >
                <Link to="/explore">Explore</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuTrigger
                className={`${isBrowseActive ? 'bg-white/10 text-white' : ''} bg-transparent text-white/80 hover:bg-white/8 hover:text-white focus:bg-white/8`}
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
                          className="flex rounded-xl border border-white/5 bg-[rgba(6,24,12,0.92)] p-4 transition-colors hover:border-emerald-300/25 hover:bg-[rgba(11,35,18,0.96)]"
                        >
                          <div className="mr-3 mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="mb-1 font-semibold text-white">{item.title}</p>
                            <p className="text-sm leading-6 text-white/60">{item.description}</p>
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
                className={`${isPostActive ? 'bg-white/10 text-white' : ''} bg-transparent text-white/80 hover:bg-white/8 hover:text-white focus:bg-white/8`}
              >
                Sell
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="grid w-[420px] gap-2 p-3">
                  {postLinks.map((item) => (
                    <NavigationMenuLink key={item.href} asChild className="rounded-xl p-0">
                      <Link
                        to={item.href}
                        className="flex items-center justify-between rounded-xl border border-white/5 bg-[rgba(6,24,12,0.92)] px-4 py-3 text-white/80 transition-colors hover:border-emerald-300/25 hover:bg-[rgba(11,35,18,0.96)] hover:text-white"
                      >
                        <span className="font-medium">{item.title}</span>
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </NavigationMenuLink>
                  ))}
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>

            <NavigationMenuItem>
              <NavigationMenuLink
                asChild
                className={`${isResourcesActive ? 'bg-white/10 text-white' : ''} ${navigationMenuTriggerStyle()} bg-transparent text-white/80 hover:bg-white/8 hover:text-white focus:bg-white/8`}
              >
                <Link to="/about">About</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>

            {user && (
              <NavigationMenuItem>
                <NavigationMenuLink
                  asChild
                  className={`${location.pathname === '/my-listings' ? 'bg-white/10 text-white' : ''} ${navigationMenuTriggerStyle()} bg-transparent text-white/80 hover:bg-white/8 hover:text-white focus:bg-white/8`}
                >
                  <Link to="/my-listings">My Listings</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            )}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="hidden items-center gap-3 lg:flex">
          {user ? (
            <ProfileMenu user={user} onLogout={handleLogout} />
          ) : (
            <>
              <Button asChild variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/8 hover:text-white">
                <Link to="/login">Log In</Link>
              </Button>
              <Button
                asChild
                className="bg-gradient-to-r from-[#0b6b4c] to-[#004e37] text-white hover:from-[#0d7d58] hover:to-[#0a5f47]"
              >
                <Link to="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </div>

        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild className="lg:hidden">
            <Button variant="outline" size="icon" className="border-white/15 bg-transparent text-white hover:bg-white/8 hover:text-white">
              <MenuIcon className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="top"
            className="max-h-screen overflow-auto border-b border-white/10 bg-[rgba(4,16,8,0.98)] text-white"
          >
            <SheetHeader>
              <SheetTitle>
                <Link to="/" className="flex items-center gap-3 text-left text-white">
                  <span className="text-[1.2rem] font-semibold tracking-[-0.04em] text-white">
                    DPHClassifieds
                  </span>
                </Link>
              </SheetTitle>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-1 py-4">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="browse" className="border-white/10">
                  <AccordionTrigger className="text-base font-medium text-white hover:no-underline">
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
                            className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/4 px-4 py-3 transition-colors hover:bg-white/8"
                          >
                            <div className="mt-0.5 rounded-lg bg-emerald-400/15 p-2 text-emerald-300">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="font-medium text-white">{item.title}</p>
                              <p className="text-sm text-white/60">{item.description}</p>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="sell" className="border-white/10">
                  <AccordionTrigger className="text-base font-medium text-white hover:no-underline">
                    Post a listing
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-2 pt-2">
                      {postLinks.map((item) => (
                        <Link
                          key={item.href}
                          to={item.href}
                          className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-4 py-3 text-white/80 transition-colors hover:bg-white/8 hover:text-white"
                        >
                          <span>{item.title}</span>
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="flex flex-col gap-2">
                <Link to="/" className="rounded-xl px-2 py-2 text-base font-medium text-white/80 transition-colors hover:bg-white/6 hover:text-white">
                  Home
                </Link>
                <Link to="/explore" className="rounded-xl px-2 py-2 text-base font-medium text-white/80 transition-colors hover:bg-white/6 hover:text-white">
                  Explore
                </Link>
                <Link to="/about" className="rounded-xl px-2 py-2 text-base font-medium text-white/80 transition-colors hover:bg-white/6 hover:text-white">
                  About
                </Link>
                {user && (
                  <Link to="/my-listings" className="rounded-xl px-2 py-2 text-base font-medium text-white/80 transition-colors hover:bg-white/6 hover:text-white">
                    My Listings
                  </Link>
                )}
              </div>

              <div className="flex flex-col gap-3 border-t border-white/10 pt-4">
                {user ? (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm uppercase tracking-[0.2em] text-white/40">Signed in</p>
                      <p className="mt-2 truncate text-base font-medium text-white">{user.email}</p>
                    </div>
                    <Button asChild variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/8 hover:text-white">
                      <Link to="/profile">Profile</Link>
                    </Button>
                    <Button asChild variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/8 hover:text-white">
                      <Link to="/settings">Settings</Link>
                    </Button>
                    <Button variant="outline" className="border-red-400/25 bg-transparent text-red-200 hover:bg-red-500/10 hover:text-red-100" onClick={handleLogout}>
                      Log Out
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild variant="outline" className="border-white/15 bg-transparent text-white hover:bg-white/8 hover:text-white">
                      <Link to="/login">Log In</Link>
                    </Button>
                    <Button
                      asChild
                      className="bg-gradient-to-r from-[#0b6b4c] to-[#004e37] text-white hover:from-[#0d7d58] hover:to-[#0a5f47]"
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
