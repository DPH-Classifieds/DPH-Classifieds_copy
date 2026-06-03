import React from 'react';
import { NavLink } from 'react-router-dom';
import { useDealer } from '../context/DealerContext';

const links = [
  { to: '/dealer/dashboard', label: 'Dashboard' },
  { to: '/dealer/listings', label: 'Listings' },
  { to: '/dealer/team', label: 'Team', ownerOnly: true },
  { to: '/dealer/settings', label: 'Settings', ownerOnly: true },
];

const DealerSidebar = () => {
  const { role, dealership } = useDealer();
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-brand">{dealership?.name || 'Dealer'}</div>
      <nav>
        {links.filter(l => !l.ownerOnly || role === 'owner').map(l => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) =>
            'admin-sidebar-link' + (isActive ? ' active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default DealerSidebar;
