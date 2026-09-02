import React from 'react';
import { X } from 'lucide-react';
import { useSavedListings } from '../context/SavedListingsContext';
import '../styles/SavedListings.css';
import '../styles/shell-tokens.css';

const SavedListingsNotice = () => {
  const savedListingsContext = useSavedListings();
  if (!savedListingsContext || !savedListingsContext.notice) {
    return null;
  }

  const { notice, clearNotice } = savedListingsContext;

  return (
    <div className={`saved-listings-notice ${notice.type === 'error' ? 'is-error' : 'is-success'}`} role="status" aria-live="polite">
      <span>{notice.message}</span>
      <button type="button" className="saved-listings-notice-close" onClick={clearNotice} aria-label="Dismiss notification">
        <X size={16} />
      </button>
    </div>
  );
};

export default SavedListingsNotice;
