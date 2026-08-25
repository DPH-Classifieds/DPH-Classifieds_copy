import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';

const DealerPendingBanner = () => {
  const { user } = useAuth();

  if (!user?.is_dealer || user?.dealer_verified) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-[60px] z-40 border-b border-sky-500/20 bg-sky-500/10 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
        <div className="flex items-center gap-2.5 text-sky-200">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="text-[13px] font-medium">
            Verifying your documents… usually under a minute.
          </span>
        </div>
        <Link
          to="/settings"
          className="shrink-0 rounded-full border border-sky-400/30 bg-sky-400/10 px-3.5 py-1 text-[12px] font-semibold text-sky-200 transition-colors hover:bg-sky-400/20"
        >
          View Status
        </Link>
      </div>
    </div>
  );
};

export default DealerPendingBanner;
