import React from 'react';
import { NavLink } from 'react-router-dom';
import '../styles/AdminLayout.css';

const AdminSidebar = ({ open }) => {
  const menuItems = [
    { path: '/admin', icon: '📊', label: 'Dashboard', exact: true },
    { path: '/admin/listings', icon: '📝', label: 'Listings' },
    { path: '/admin/dealers', icon: '🏪', label: 'Dealers' },
    { path: '/admin/users', icon: '👥', label: 'Users' },
    { path: '/admin/reports', icon: '📋', label: 'Reports' },
  ];

  return (
    <aside className={`admin-sidebar ${open ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <h2>Admin Panel</h2>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.exact}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default AdminSidebar;
