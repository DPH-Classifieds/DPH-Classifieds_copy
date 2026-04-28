import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import '../styles/AdminLayout.css';

const AdminSidebar = ({ open, user, onLogout }) => {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const menuItems = [
    {
      path: '/admin',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      ),
      label: 'Dashboard',
      exact: true,
    },
    {
      path: '/admin/listings',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      ),
      label: 'Listings',
    },
    {
      path: '/admin/dealers',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      ),
      label: 'Dealers',
    },
    {
      path: '/admin/users',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      label: 'Users',
    },
    {
      path: '/admin/reports',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      ),
      label: 'Reports',
    },
    {
      path: '/admin/metrics',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 14l3-3 3 2 4-6" />
          <path d="M17 7h3v3" />
        </svg>
      ),
      label: 'Metrics',
    },
  ];

  const displayName = useMemo(
    () =>
      user?.display_name ||
      [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
      user?.username ||
      user?.email ||
      'Admin',
    [user]
  );

  const avatarLabel = useMemo(() => (displayName ? displayName.charAt(0).toUpperCase() : 'A'), [displayName]);

  useEffect(() => {
    if (!profileMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false);
      }
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
    if (onLogout) {
      await onLogout();
    }
  };

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
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer" ref={menuRef}>
        <button
          type="button"
          className="sidebar-profile-trigger"
          onClick={() => setProfileMenuOpen((current) => !current)}
          aria-expanded={profileMenuOpen}
          aria-label="Profile menu"
        >
          <span className="sidebar-profile-avatar" aria-hidden="true">
            {avatarLabel}
          </span>
          <span className="sidebar-profile-copy">
            <span className="sidebar-profile-label">Profile</span>
            <span className="sidebar-profile-name">{displayName}</span>
          </span>
          <span className={`sidebar-profile-caret ${profileMenuOpen ? 'open' : ''}`} aria-hidden="true">
            ▾
          </span>
        </button>

        {profileMenuOpen && (
          <div className="sidebar-profile-menu" role="menu" aria-label="Admin account menu">
            <Link
              to="/"
              className="sidebar-profile-action"
              onClick={() => setProfileMenuOpen(false)}
              role="menuitem"
            >
              Back to Site
            </Link>
            <button
              type="button"
              className="sidebar-profile-action logout-action"
              onClick={handleLogout}
              role="menuitem"
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

export default AdminSidebar;
