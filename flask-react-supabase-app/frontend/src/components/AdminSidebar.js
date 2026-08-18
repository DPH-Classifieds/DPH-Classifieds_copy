import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Store,
  Building2,
  Users,
  MessageSquareWarning,
  BarChart3,
  Wrench,
  Rss,
  ExternalLink,
  LogOut,
  ChevronUp,
  ArrowUpCircle,
  Star,
} from 'lucide-react';

const menuItems = [
  { path: '/admin',            label: 'Dashboard',    icon: LayoutDashboard,      exact: true },
  { path: '/admin/listings',   label: 'Listings',     icon: FileText },
  { path: '/admin/featured-listings', label: 'Featured', icon: Star },
  { path: '/admin/reddit-verify', label: 'Reddit verify', icon: Rss },
  { path: '/admin/dealers',    label: 'Dealers',      icon: Store },
  { path: '/admin/dealer-upgrade-requests', label: 'Limit requests', icon: ArrowUpCircle },
  { path: '/admin/dealerships',label: 'Dealerships',  icon: Building2 },
  { path: '/admin/users',      label: 'Users',        icon: Users },
  { path: '/admin/reports',    label: 'Reports',      icon: MessageSquareWarning },
  { path: '/admin/metrics',    label: 'Metrics',      icon: BarChart3 },
  { path: '/admin/tools',      label: 'Tools',        icon: Wrench },
];

const AdminSidebar = ({ open, user, onLogout, isMobile }) => {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const displayName = useMemo(
    () =>
      user?.display_name ||
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      user?.username ||
      user?.email ||
      'Admin',
    [user]
  );

  const avatarLabel = useMemo(
    () => (displayName ? displayName.charAt(0).toUpperCase() : 'A'),
    [displayName]
  );

  useEffect(() => {
    if (!profileMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [profileMenuOpen]);

  const handleLogout = async () => {
    setProfileMenuOpen(false);
    if (onLogout) await onLogout();
  };

  // On mobile the sidebar slides in from left; on desktop it's always present if open.
  const sidebarBase =
    'flex-shrink-0 w-[240px] min-h-screen flex flex-col border-r border-white/[0.06] transition-transform duration-200';
  const mobileClass = isMobile
    ? `fixed top-0 left-0 h-full z-30 ${open ? 'translate-x-0' : '-translate-x-full'}`
    : open
    ? 'relative'
    : 'hidden';

  return (
    <aside
      className={`${sidebarBase} ${mobileClass}`}
      style={{ background: 'linear-gradient(180deg, #0a1410 0%, #070d10 100%)' }}
    >
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm select-none">
            DPH
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate leading-tight">
              DPH <span className="text-emerald-400">Admin</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-white/30 mt-0.5 font-medium">
              Control Panel
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pt-4 space-y-0.5">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 border-l-2 ${
                  isActive
                    ? 'bg-emerald-500/10 border-emerald-400 text-white shadow-[0_0_12px_rgba(16,185,129,0.06)]'
                    : 'border-transparent text-white/60 hover:bg-white/[0.04] hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={16}
                    className={isActive ? 'text-emerald-400' : 'text-white/40'}
                  />
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Profile / footer */}
      <div className="px-3 pb-5 pt-3 border-t border-white/[0.06]" ref={menuRef}>
        {/* Profile menu popup */}
        {profileMenuOpen && (
          <div
            className="mb-2 rounded-xl overflow-hidden border border-white/[0.08] bg-[#0d1a15] shadow-2xl shadow-black/40"
            role="menu"
            aria-label="Admin account menu"
          >
            <Link
              to="/"
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-white/60 hover:text-white hover:bg-white/[0.04] transition-all duration-150"
              onClick={() => setProfileMenuOpen(false)}
              role="menuitem"
            >
              <ExternalLink size={14} />
              View site
            </Link>
            <button
              type="button"
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/[0.06] transition-all duration-150"
              onClick={handleLogout}
              role="menuitem"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        )}

        {/* Profile trigger */}
        <button
          type="button"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.04] transition-all duration-150 group"
          onClick={() => setProfileMenuOpen((current) => !current)}
          aria-expanded={profileMenuOpen}
          aria-label="Profile menu"
        >
          {/* Avatar */}
          <span className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-xs font-bold flex-shrink-0 select-none">
            {avatarLabel}
          </span>
          <span className="flex flex-col min-w-0 text-left flex-1">
            <span className="text-xs font-medium text-white truncate leading-tight">
              {displayName}
            </span>
            {user?.email && (
              <span className="text-[10px] text-white/30 truncate leading-tight">
                {user.email}
              </span>
            )}
          </span>
          <ChevronUp
            size={14}
            className={`text-white/30 flex-shrink-0 transition-transform duration-200 ${
              profileMenuOpen ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </button>
      </div>
    </aside>
  );
};

export default AdminSidebar;
