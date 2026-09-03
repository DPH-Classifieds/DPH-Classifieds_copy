import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSavedListings } from '../context/SavedListingsContext';
import { buildListingSaveData } from '../utils/listingRouteState';
import '../styles/SavedListings.css';
import '../styles/shell-tokens.css';

const SavedListingToggleButton = ({
  listingType,
  listingId,
  listingData,
  className = '',
  label = 'Save',
  showLabel = false,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const savedListingsContext = useSavedListings();

  if (!savedListingsContext) {
    return null;
  }

  const { isSaved, isSaving, toggleSavedListing } = savedListingsContext;
  const saved = isSaved(listingType, listingId);
  const saving = isSaving(listingType, listingId);

  const handleClick = async () => {
    if (!user) {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      navigate(`/login?redirect=${encodeURIComponent(redirect)}`);
      return;
    }

    await toggleSavedListing({
      listingType,
      listingId,
      listingData: buildListingSaveData(listingData),
    });
  };

  return (
    <button
      type="button"
      className={[
        'saved-listing-button',
        saved ? 'is-saved' : '',
        saving ? 'is-saving' : '',
        className,
      ].filter(Boolean).join(' ')}
      onClick={handleClick}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from favourites' : label}
      title={saved ? 'Remove from favourites' : label}
      disabled={saving}
    >
      {saving ? <Loader2 size={16} className="saved-listing-spinner" aria-hidden="true" /> : <Heart size={16} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />}
      {showLabel ? <span>{saved ? 'Saved' : label}</span> : null}
    </button>
  );
};

export default SavedListingToggleButton;
