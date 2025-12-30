import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ProfileMenu from './ProfileMenu';
import '../styles/Header.css';

const Header = () => {
  const { user, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [browseDropdownOpen, setBrowseDropdownOpen] = useState(false);
  const [postDropdownOpen, setPostDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const browseDropdownRef = useRef(null);
  const postDropdownRef = useRef(null);
  const headerRef = useRef(null);

  // Handle scroll effect for the header
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Toggle body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.classList.add('menu-open');
    } else {
      document.body.classList.remove('menu-open');
    }

    return () => {
      document.body.classList.remove('menu-open');
    };
  }, [mobileMenuOpen]);

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Close browse dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (browseDropdownRef.current && !browseDropdownRef.current.contains(event.target)) {
        setBrowseDropdownOpen(false);
      }
      if (postDropdownRef.current && !postDropdownRef.current.contains(event.target)) {
        setPostDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
    // Close dropdowns when toggling mobile menu
    setBrowseDropdownOpen(false);
    setPostDropdownOpen(false);
  };

  const toggleBrowseDropdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBrowseDropdownOpen(!browseDropdownOpen);
    if (postDropdownOpen) setPostDropdownOpen(false);
  };

  const togglePostDropdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPostDropdownOpen(!postDropdownOpen);
    if (browseDropdownOpen) setBrowseDropdownOpen(false);
  };

  // Check if the current path matches a nav link
  const isActive = (path) => {
    return location.pathname === path;
  };

  // Check if current path is any browse-related path
  const isBrowseActive = () => {
    const browsePaths = ['/cars', '/car-parts', '/plates', '/bikes'];
    return browsePaths.some(path => location.pathname.startsWith(path));
  };

  // Check if current path is any post-related path
  const isPostActive = () => {
    const postPaths = ['/create-listing', '/post-car', '/post-bike', '/post-plate', '/post-car-part'];
    return postPaths.some(path => location.pathname.startsWith(path));
  };

  // Create post URL with redirection if not logged in
  const getPostUrl = (path) => {
    return user ? path : `/login?redirect=${path}`;
  };

  return (
    <header className={`header ${scrolled ? 'scrolled' : ''}`} ref={headerRef}>
      <div className="header-container">
        <Link to="/" className="logo">
          <span className="logo-icon"></span>
          <span className="logo-text">DPHClassifieds</span>
        </Link>

        <button 
          className="mobile-menu-button" 
          onClick={toggleMobileMenu}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          <span className={`hamburger ${mobileMenuOpen ? 'active' : ''}`}></span>
        </button>

        <nav className={`nav-menu ${mobileMenuOpen ? 'open' : ''}`}>
          <ul className="nav-links">
            <li>
              <Link 
                to="/" 
                className={`nav-link ${isActive('/') ? 'active' : ''}`} 
                onClick={() => setMobileMenuOpen(false)}
              >
                Home
              </Link>
            </li>
            <li className="browse-dropdown-container" ref={browseDropdownRef}>
              <button 
                className={`nav-link browse-toggle btn-link ${isBrowseActive() ? 'active' : ''}`} 
                onClick={toggleBrowseDropdown}
                aria-expanded={browseDropdownOpen}
              >
                Browse <span className="dropdown-arrow">▾</span>
              </button>
              {browseDropdownOpen && (
                <div className="browse-dropdown">
                  <Link 
                    to="/cars" 
                    className="browse-item"
                    onClick={() => {
                      setBrowseDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Browse Cars
                  </Link>
                  <Link 
                    to="/car-parts" 
                    className="browse-item"
                    onClick={() => {
                      setBrowseDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Browse Car Parts
                  </Link>
                  <Link 
                    to="/plates" 
                    className="browse-item"
                    onClick={() => {
                      setBrowseDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Browse Plates
                  </Link>
                  <Link 
                    to="/bikes" 
                    className="browse-item"
                    onClick={() => {
                      setBrowseDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Browse Bikes
                  </Link>
                </div>
              )}
            </li>
            <li className="post-dropdown-container" ref={postDropdownRef}>
              <button 
                className={`nav-link nav-link-highlighted post-toggle btn-link ${isPostActive() ? 'active' : ''}`} 
                onClick={togglePostDropdown}
                aria-expanded={postDropdownOpen}
              >
                + Post <span className="dropdown-arrow">▾</span>
              </button>
              {postDropdownOpen && (
                <div className="post-dropdown">
                  <Link 
                    to={getPostUrl("/post-car")} 
                    className="post-item"
                    onClick={() => {
                      setPostDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Post a Car
                  </Link>
                  <Link 
                    to={getPostUrl("/post-bike")} 
                    className="post-item"
                    onClick={() => {
                      setPostDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Post a Bike
                  </Link>
                  <Link 
                    to={getPostUrl("/post-plate")} 
                    className="post-item"
                    onClick={() => {
                      setPostDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Post a Plate
                  </Link>
                  <Link 
                    to={getPostUrl("/post-car-parts")} 
                    className="post-item"
                    onClick={() => {
                      setPostDropdownOpen(false);
                      setMobileMenuOpen(false);
                    }}
                  >
                    Post Car Parts
                  </Link>
                </div>
              )}
            </li>
            <li>
              <Link 
                to="/about" 
                className={`nav-link ${isActive('/about') ? 'active' : ''}`} 
                onClick={() => setMobileMenuOpen(false)}
              >
                About
              </Link>
            </li>
            {/* Contact page link removed as requested */}
            {user && (
              <li className="desktop-hide">
                <Link 
                  to="/my-listings" 
                  className={`nav-link ${isActive('/my-listings') ? 'active' : ''}`} 
                  onClick={() => setMobileMenuOpen(false)}
                >
                  My Listings
                </Link>
              </li>
            )}
          </ul>

          <div className="auth-buttons">
            {user ? (
              <div className="user-section">
                {user.email && (
                  <span className="user-email-display">
                    {user.email.split('@')[0]}
                  </span>
                )}
                <ProfileMenu user={user} onLogout={handleLogout} closeMenu={() => setMobileMenuOpen(false)} />
              </div>
            ) : (
              <>
                <Link 
                  to="/login" 
                  className="btn btn-outline"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Log In
                </Link>
                <Link 
                  to="/signup" 
                  className="btn btn-primary"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
};

export default Header; 
