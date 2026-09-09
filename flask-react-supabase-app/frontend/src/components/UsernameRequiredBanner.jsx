import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/StatusBanners.css';

const UsernameRequiredBanner = () => {
  const { user } = useAuth();

  const username = String(user?.username || '').trim();
  if (!user || username) {
    return null;
  }

  return (
    <div className="shell-status-banner shell-status-banner--username">
      <div className="shell-status-banner__inner">
        <div className="shell-status-banner__copy">
          <span className="text-[13px] font-medium">
            Please set a username so your listings show your username (not your real name).
          </span>
        </div>
        <Link
          to="/settings"
          className="shell-status-banner__action"
        >
          Set Username
        </Link>
      </div>
    </div>
  );
};

export default UsernameRequiredBanner;
