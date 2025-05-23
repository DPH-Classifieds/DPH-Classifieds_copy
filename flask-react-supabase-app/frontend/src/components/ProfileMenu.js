import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import '../styles/ProfileMenu.css';

const ProfileMenu = ({ user, onLogout, closeMenu }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const handleLogout = () => {
    setIsOpen(false);
    if (closeMenu) closeMenu();
    onLogout();
  };

  const handleLinkClick = () => {
    setIsOpen(false);
    if (closeMenu) closeMenu();
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Get first letter of email for avatar
  const getInitial = () => {
    return user?.email?.[0]?.toUpperCase() || 'U';
  };

  return (
    <div className="profile-menu-wrapper" ref={menuRef}>
      <button 
        className="profile-menu-button" 
        onClick={toggleMenu}
        aria-expanded={isOpen}
        aria-label="User profile menu"
      >
        <div className="avatar">
          {getInitial()}
        </div>
      </button>
      
      {isOpen && (
        <div className="profile-dropdown">
          <div className="profile-header">
            <div className="avatar">{getInitial()}</div>
            <div className="user-info">
              <span className="user-email">{user.email}</span>
              <span className="user-role">{user.is_admin ? 'Admin' : 'Member'}</span>
            </div>
          </div>
          
          <div className="profile-menu-items">
            <Link 
              to="/profile" 
              className="profile-menu-item"
              onClick={handleLinkClick}
            >
              <span className="profile-icon user-icon">👤</span>
              Profile
            </Link>
            
            <Link 
              to="/my-listings" 
              className="profile-menu-item"
              onClick={handleLinkClick}
            >
              <span className="profile-icon listings-icon">📋</span>
              My Listings
            </Link>
            
            <Link 
              to="/settings" 
              className="profile-menu-item"
              onClick={handleLinkClick}
            >
              <span className="profile-icon settings-icon">⚙️</span>
              Settings
            </Link>
            
            {user.is_admin && (
              <>
                <div className="profile-menu-divider"></div>
                <Link 
                  to="/admin" 
                  className="profile-menu-item"
                  onClick={handleLinkClick}
                >
                  <span className="profile-icon admin-icon">🔐</span>
                  Admin Dashboard
                </Link>
                <Link 
                  to="/admin/users" 
                  className="profile-menu-item"
                  onClick={handleLinkClick}
                >
                  <span className="profile-icon users-icon">👥</span>
                  Manage Users
                </Link>
              </>
            )}
            
            <Link 
              to="/admin/tools" 
              className="profile-menu-item"
              onClick={handleLinkClick}
            >
              <span className="profile-icon tools-icon">🛠️</span>
              Admin Tools
            </Link>
            
            <div className="profile-menu-divider"></div>
            
            <button 
              className="profile-menu-item logout-button"
              onClick={handleLogout}
            >
              <span className="profile-icon logout-icon">🚪</span>
              Log Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileMenu; 