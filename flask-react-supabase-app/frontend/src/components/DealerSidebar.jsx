import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Car,
  Users,
  Settings,
  Upload,
  Plug,
  ArrowLeft,
} from 'lucide-react';
import { useDealer } from '../context/DealerContext';

const NAV_ITEMS = [
  { to: '/dealer/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/dealer/listings', label: 'Listings', icon: Car },
  { to: '/dealer/inventory', label: 'Inventory', icon: Upload },
  { to: '/dealer/integrations', label: 'Integrations', icon: Plug },
  { to: '/dealer/team', label: 'Team', icon: Users, ownerOnly: true },
  { to: '/dealer/settings', label: 'Settings', icon: Settings, ownerOnly: true },
];

const RolePill = ({ role }) => {
  const labels = { owner: 'Owner', manager: 'Manager', sales_rep: 'Sales Rep' };
  return (
    <span className="text-[10px] uppercase tracking-[0.12em] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      {labels[role] || role || 'Member'}
    </span>
  );
};

const DealerSidebar = () => {
  const { dealership, role } = useDealer();

  const initials = dealership?.name
    ? dealership.name.slice(0, 2).toUpperCase()
    : 'D';

  return (
    <aside
      className="flex-shrink-0 w-[240px] min-h-screen flex flex-col"
      style={{ background: 'linear-gradient(180deg, #0a1410 0%, #070d10 100%)' }}
    >
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          {dealership?.logo_url ? (
            <img
              src={dealership.logo_url}
              alt={dealership.name}
              className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold text-sm">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate leading-tight">
              {dealership?.name || 'Dealership'}
            </p>
            <div className="mt-1">
              <RolePill role={role} />
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pt-4 space-y-0.5">
        {NAV_ITEMS.filter((item) => !item.ownerOnly || role === 'owner').map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
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
                  <Icon size={16} className={isActive ? 'text-emerald-400' : 'text-white/40'} />
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-5 pt-3 border-t border-white/[0.06]">
        <Link
          to="/"
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-all duration-150"
        >
          <ArrowLeft size={15} />
          Back to site
        </Link>
      </div>
    </aside>
  );
};

export default DealerSidebar;
