import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const UsernameRequiredBanner = () => {
  const { user } = useAuth();

  const username = String(user?.username || '').trim();
  if (!user || username) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-[104px] z-30 border-b border-emerald-400/20 bg-emerald-500/10 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
        <div className="text-emerald-100">
          <span className="text-[13px] font-medium">
            Please set a username so your listings show your username (not your real name).
          </span>
        </div>
        <Link
          to="/settings"
          className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-1 text-[12px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-400/20"
        >
          Set Username
        </Link>
      </div>
    </div>
  );
};

export default UsernameRequiredBanner;
