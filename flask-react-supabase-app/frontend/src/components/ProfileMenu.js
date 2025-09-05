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

  // Get user initials for avatar
  const getUserInitials = () => {
    if (user?.display_name || user?.displayName) {
      const name = user.display_name || user.displayName;
      return name[0].toUpperCase();
    }
    if (user?.username) {
      return user.username[0].toUpperCase();
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  // Get display name for user
  const getDisplayName = () => {
    if (user?.display_name || user?.displayName) {
      return user.display_name || user.displayName;
    }
    if (user?.username) {
      return user.username;
    }
    return user?.email || 'User';
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
          {(user?.profile_photo_url || user?.profilePhotoUrl) ? (
            <img 
              src={user.profile_photo_url || user.profilePhotoUrl} 
              alt="Profile" 
              className="avatar-image"
            />
          ) : (
            getUserInitials()
          )}
        </div>
      </button>
      
      {isOpen && (
        <div className="profile-dropdown">
          <div className="profile-header">
            <div className="avatar">
              {(user?.profile_photo_url || user?.profilePhotoUrl) ? (
                <img 
                  src={user.profile_photo_url || user.profilePhotoUrl} 
                  alt="Profile" 
                  className="avatar-image"
                />
              ) : (
                getUserInitials()
              )}
            </div>
            <div className="user-info">
              <span className="user-name">{getDisplayName()}</span>
              <span className="user-email">{user.email}</span>
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