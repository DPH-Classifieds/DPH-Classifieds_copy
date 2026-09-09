import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loader2, UploadCloud } from 'lucide-react';
import '../styles/StatusBanners.css';

const DealerPendingBanner = () => {
  const { user } = useAuth();

  if (!user?.is_dealer || user?.dealer_verified) {
    return null;
  }

  // Signup can't upload the documents (it has no session yet), so a brand new
  // dealer has none on file. Claiming "verifying…" there left dealers waiting
  // forever on a review that had nothing to review.
  const awaitingDocuments = !user?.verification_documents_submitted;

  return (
    <div className="shell-status-banner shell-status-banner--dealer">
      <div className="shell-status-banner__inner">
        <div className="shell-status-banner__copy flex items-center gap-2.5">
          {awaitingDocuments ? (
            <UploadCloud className="h-4 w-4 shrink-0" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          )}
          <span className="text-[13px] font-medium">
            {awaitingDocuments
              ? 'Finish your dealer verification — upload your Trade License and TRN certificate.'
              : 'Verifying your documents… usually under a minute.'}
          </span>
        </div>
        <Link
          to="/dealer/verification"
          className="shell-status-banner__action"
        >
          {awaitingDocuments ? 'Upload documents' : 'View Status'}
        </Link>
      </div>
    </div>
  );
};

export default DealerPendingBanner;
