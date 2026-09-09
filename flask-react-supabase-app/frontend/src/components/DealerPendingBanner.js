import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';
import '../styles/StatusBanners.css';

const DealerPendingBanner = () => {
  const { user } = useAuth();

  if (!user?.is_dealer || user?.dealer_verified) {
    return null;
  }

  return (
    <div className="shell-status-banner shell-status-banner--dealer">
      <div className="shell-status-banner__inner">
        <div className="shell-status-banner__copy flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="text-[13px] font-medium">
            Verifying your documents… usually under a minute.
          </span>
        </div>
        <Link
          to="/dealer/verification"
          className="shell-status-banner__action"
        >
          View Status
        </Link>
      </div>
    </div>
  );
};

export default DealerPendingBanner;
