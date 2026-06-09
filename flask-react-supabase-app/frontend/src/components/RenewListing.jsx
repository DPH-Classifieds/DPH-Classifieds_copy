import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';

const URL_TYPE_TO_API_TYPE = {
  cars: 'car',
  bikes: 'bike',
  parts: 'part',
  plates: 'plate',
  // tolerate already-singular params too
  car: 'car',
  bike: 'bike',
  part: 'part',
  plate: 'plate',
};

const URL_TYPE_TO_DETAIL_PATH = {
  car: 'cars',
  bike: 'bikes',
  part: 'car-parts',
  plate: 'plates',
};

const buildDetailUrl = (apiType, id) => {
  const slug = URL_TYPE_TO_DETAIL_PATH[apiType] || `${apiType}s`;
  return `/${slug}/${id}`;
};

const formatTitle = (listing) =>
  listing?.listing_title
  || listing?.title
  || listing?.item_name
  || listing?.car_model
  || listing?.bike_model
  || listing?.name
  || 'Your listing';

const RenewListing = () => {
  const { type: rawType, id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const apiType = URL_TYPE_TO_API_TYPE[rawType];

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { action, message }

  const loadListing = useCallback(async () => {
    if (!apiType || !id) {
      setError('This renewal link looks malformed. Please open the link from the email or SMS again.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const data = await apiClient.get(`/api/user/listings`);
      const all = Array.isArray(data?.listings) ? data.listings : Array.isArray(data) ? data : [];
      const match = all.find((l) => String(l.id) === String(id));
      if (!match) {
        setError("We couldn't find this listing on your account. If it belongs to you, please log in with the same account you used to create it.");
      } else {
        setListing(match);
      }
    } catch (e) {
      setError(e?.message || 'Failed to load your listing.');
    } finally {
      setLoading(false);
    }
  }, [apiType, id]);

  useEffect(() => {
    loadListing();
  }, [loadListing]);

  const submitOutcome = async (outcome) => {
    if (!apiType || !id || submitting) return;
    try {
      setSubmitting(true);
      setError('');
      const resp = await apiClient.post(
        `/api/user/listings/${apiType}/${id}/outcome`,
        { outcome }
      );
      if (outcome === 'not_sold_renew') {
        setResult({
          action: 'renewed',
          message: "Your listing is back live for 15 more days. We'll email you 2 days before it expires next time.",
          listing: resp?.listing || null,
        });
      } else if (outcome === 'sold_on_dph') {
        setResult({
          action: 'sold_dph',
          message: 'Thanks for letting us know — congratulations on the sale! 🎉',
        });
      } else if (outcome === 'sold_elsewhere') {
        setResult({
          action: 'sold_elsewhere',
          message: 'Thanks for letting us know. We hope you found the right buyer.',
        });
      }
    } catch (e) {
      setError(e?.message || 'Something went wrong. Please try again, or open the link again from your email.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = formatTitle(listing);
  const detailUrl = listing && apiType ? buildDetailUrl(apiType, id) : null;
  const isNudge = searchParams.get('utm_source') === 'admin_nudge';

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.brand}>
          DPH<span style={{ color: '#ffffff' }}>CLASSIFIEDS</span>
        </div>

        {loading && <p style={styles.muted}>Loading your listing…</p>}

        {!loading && error && (
          <>
            <h1 style={styles.h1}>We need a quick check</h1>
            <p style={styles.body}>{error}</p>
            <button style={styles.secondaryBtn} onClick={() => navigate('/login')}>Log in</button>
          </>
        )}

        {!loading && !error && !result && listing && (
          <>
            <h1 style={styles.h1}>Did you sell {title}?</h1>
            {isNudge && (
              <p style={styles.muted}>
                We sent this link because your listing has expired. Tell us what happened — it takes one tap.
              </p>
            )}
            <div style={styles.summary}>
              <p style={styles.summaryLabel}>Your listing</p>
              <p style={styles.summaryTitle}>{title}</p>
              {listing?.expires_at && (
                <p style={styles.muted}>
                  Expired on {new Date(listing.expires_at).toLocaleDateString()}
                </p>
              )}
            </div>

            <div style={styles.actions}>
              <button
                style={styles.primaryBtn}
                disabled={submitting}
                onClick={() => submitOutcome('not_sold_renew')}
              >
                {submitting ? 'Working…' : "No — please renew it (+15 days)"}
              </button>
              <button
                style={styles.secondaryBtn}
                disabled={submitting}
                onClick={() => submitOutcome('sold_on_dph')}
              >
                Yes — sold via DPH Classifieds
              </button>
              <button
                style={styles.secondaryBtn}
                disabled={submitting}
                onClick={() => submitOutcome('sold_elsewhere')}
              >
                Yes — sold elsewhere
              </button>
            </div>

            {detailUrl && (
              <p style={styles.footnote}>
                <a href={detailUrl} style={styles.link}>View the listing →</a>
              </p>
            )}
          </>
        )}

        {result && (
          <>
            <h1 style={styles.h1}>
              {result.action === 'renewed' ? 'Renewed!' : 'Got it'}
            </h1>
            <p style={styles.body}>{result.message}</p>
            <div style={styles.actions}>
              <button style={styles.primaryBtn} onClick={() => navigate('/my-listings')}>
                Go to my listings
              </button>
              {result.action === 'renewed' && detailUrl && (
                <button style={styles.secondaryBtn} onClick={() => navigate(detailUrl)}>
                  Open the listing
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: '#041008',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: '#f0fdf4',
  },
  card: {
    width: '100%',
    maxWidth: 520,
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 24,
    padding: 32,
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
  },
  brand: {
    fontWeight: 800,
    fontSize: 24,
    color: '#8bd6b4',
    letterSpacing: '-0.02em',
    marginBottom: 24,
    textAlign: 'center',
  },
  h1: {
    margin: '0 0 12px',
    fontSize: 22,
    fontWeight: 700,
    color: '#ffffff',
  },
  body: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 1.55,
    margin: '0 0 20px',
  },
  muted: {
    color: '#94a3b8',
    fontSize: 13,
    margin: '0 0 16px',
  },
  summary: {
    background: 'rgba(139, 214, 180, 0.04)',
    border: '1px dashed rgba(139, 214, 180, 0.18)',
    borderRadius: 14,
    padding: '14px 16px',
    margin: '0 0 20px',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#8bd6b4',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    margin: '0 0 6px',
  },
  summaryTitle: {
    fontSize: 16,
    color: '#f0fdf4',
    fontWeight: 600,
    margin: '0 0 4px',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 8,
  },
  primaryBtn: {
    background: '#8bd6b4',
    color: '#041008',
    border: 'none',
    borderRadius: 12,
    padding: '12px 18px',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
  },
  secondaryBtn: {
    background: 'rgba(255,255,255,0.06)',
    color: '#f0fdf4',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: '12px 18px',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  footnote: {
    marginTop: 18,
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
  link: {
    color: '#8bd6b4',
    textDecoration: 'none',
  },
};

export default RenewListing;
