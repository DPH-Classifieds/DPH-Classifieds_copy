import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Settings, SquareUserRound } from 'lucide-react';
import { resolveMediaUrl } from '../utils/media';
import '../styles/ProfileMenu.css';

const ProfileMenu = ({ user, onLogout, closeMenu }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const menuRef = useRef(null);

  const avatarSrc = resolveMediaUrl(user?.profile_photo_url || user?.profilePhotoUrl);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarSrc]);

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

  const renderAvatar = (className = 'avatar') => {
    if (avatarSrc && !avatarFailed) {
      return (
        <div className={className}>
          <img
            src={avatarSrc}
            alt={`${getDisplayName()} profile`}
            className="avatar-image"
            onError={() => setAvatarFailed(true)}
          />
        </div>
      );
    }

    return <div className={className}>{getUserInitials()}</div>;
  };

  return (
    <div className="profile-menu-wrapper" ref={menuRef}>
      <button 
        className="profile-menu-button" 
        onClick={toggleMenu}
        aria-expanded={isOpen}
        aria-label="User profile menu"
      >
        {renderAvatar()}
      </button>
      
      {isOpen && (
        <div className="profile-dropdown">
          <div className="profile-header">
            {renderAvatar('avatar profile-header-avatar')}
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
              <SquareUserRound className="profile-icon" aria-hidden="true" />
              Profile
            </Link>
            
            <Link 
              to="/settings" 
              className="profile-menu-item"
              onClick={handleLinkClick}
            >
              <Settings className="profile-icon" aria-hidden="true" />
              Settings
            </Link>
            
            <div className="profile-menu-divider"></div>
            
            <button 
              className="profile-menu-item logout-button"
              onClick={handleLogout}
            >
              <LogOut className="profile-icon" aria-hidden="true" />
              Log Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileMenu; 
