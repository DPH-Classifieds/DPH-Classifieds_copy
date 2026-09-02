import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/supabaseClient';
import { ensureContactAccess } from '../utils/contactAccess';
import { resolveMediaUrl } from '../utils/media';
import './ExplorePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

export default function BuyingRequestDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const title = useMemo(() => row?.item_name || 'Buying request', [row]);
  const images = useMemo(() => (Array.isArray(row?.images) ? row.images.filter(Boolean) : []), [row]);
  const heroImage = useMemo(() => {
    const img = images[activeImageIndex] || images[0] || null;
    return resolveMediaUrl(img?.display_url) || resolveMediaUrl(img?.image_url) || resolveMediaUrl(img?.url) || null;
  }, [images, activeImageIndex]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError('');
        const resp = await axios.get(`${API_URL}/api/buying-requests/${id}`);
        setRow(resp.data);
      } catch (e) {
        setError('Failed to load buying request.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [id, row?.id]);

  const revealWhatsapp = async () => {
    setRevealError('');
    if (!ensureContactAccess({ user, navigate, nextRoute: `${location.pathname}${location.search}` })) {
      return;
    }

    try {
      setRevealing(true);
      const token = await getAccessToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const resp = await axios.post(`${API_URL}/api/buying-requests/${id}/reveal-whatsapp`, {}, { headers });
      const whatsappUrl = resp.data?.whatsapp_url;
      if (!whatsappUrl) {
        setRevealError('WhatsApp link not available.');
        return;
      }
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      const apiError = e?.response?.data?.error;
      setRevealError(apiError || 'Failed to reveal WhatsApp link.');
    } finally {
      setRevealing(false);
    }
  };

  if (loading) {
    return (
      <div className="explore-v2">
        <div className="explore-v2-shell" style={{ maxWidth: 720, paddingTop: 32 }}>
          <div className="explore-v2-state-card">Loading…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="explore-v2">
        <div className="explore-v2-shell" style={{ maxWidth: 720, paddingTop: 32 }}>
          <div className="explore-v2-inline-alert">{error}</div>
          <Link className="explore-v2-button explore-v2-button-secondary" style={{ marginTop: 16 }} to="/buying-requests">
            Back to Buying Requests
          </Link>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="explore-v2">
        <div className="explore-v2-shell" style={{ maxWidth: 720, paddingTop: 32 }}>
          <div className="explore-v2-state-card">
            <p>Buying request not found.</p>
            <Link className="explore-v2-button explore-v2-button-secondary" to="/buying-requests">Back</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="explore-v2">
      <div className="explore-v2-shell" style={{ maxWidth: 720, paddingTop: 32, paddingBottom: 64 }}>
        <nav style={{ fontSize: 14, color: 'var(--ex-text-muted)' }}>
          <Link to="/" style={{ color: 'inherit' }}>Home</Link> <span style={{ padding: '0 4px' }}>/</span>{' '}
          <Link to="/buying-requests" style={{ color: 'inherit' }}>Buying Requests</Link>
        </nav>

        <h1 style={{ marginTop: 16, fontSize: 22, fontWeight: 800, color: 'var(--ex-text)' }}>{title}</h1>
        <p style={{ marginTop: 4, fontSize: 14, color: 'var(--ex-text-muted)' }}>
          Anonymous buying request · {String(row?.item_type || '').toUpperCase()}
        </p>

        <div style={{ marginTop: 24, overflow: 'hidden', borderRadius: 10, border: '1px solid var(--ex-line)', background: 'var(--ex-surface)' }}>
          <div className="explore-v2-wtb-card-image" style={{ aspectRatio: '16 / 10' }}>
            <img src={heroImage || PLACEHOLDER_IMAGE} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          {images.length > 1 ? (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: 12, borderTop: '1px solid var(--ex-line)' }}>
              {images.map((img, index) => {
                const thumb = img?.display_url || img?.image_url || img?.url || PLACEHOLDER_IMAGE;
                const resolvedThumb = resolveMediaUrl(thumb) || PLACEHOLDER_IMAGE;
                const isActive = activeImageIndex === index;
                return (
                  <button
                    key={`${thumb}-${index}`}
                    type="button"
                    onClick={() => setActiveImageIndex(index)}
                    style={{
                      height: 64,
                      width: 96,
                      flexShrink: 0,
                      overflow: 'hidden',
                      borderRadius: 8,
                      border: `1px solid ${isActive ? 'var(--ex-primary)' : 'var(--ex-line-strong)'}`,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    <img src={resolvedThumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                );
              })}
            </div>
          ) : null}
          <div style={{ display: 'grid', gap: 8, padding: 20, color: 'var(--ex-text)' }}>
            <div><span style={{ color: 'var(--ex-text-muted)' }}>Regional spec:</span> {row.regional_spec}</div>
            <div><span style={{ color: 'var(--ex-text-muted)' }}>Mileage preference:</span> {row.mileage_preference}</div>
            {row?.budget ? <div><span style={{ color: 'var(--ex-text-muted)' }}>Budget:</span> AED {Number(row.budget).toLocaleString()}</div> : null}
            {row?.reference_notes ? <div style={{ paddingTop: 4 }}><span style={{ color: 'var(--ex-text-muted)' }}>Description:</span> {row.reference_notes}</div> : null}
            {(row?.car_manufacturer || row?.car_model || row?.trim) ? (
              <div style={{ paddingTop: 4 }}>
                <span style={{ color: 'var(--ex-text-muted)' }}>Make/Model/Trim:</span>{' '}
                {[row.car_manufacturer, row.car_model, row.trim].filter(Boolean).join(' ')}
              </div>
            ) : null}
          </div>
        </div>

        {revealError ? <div className="explore-v2-inline-alert" style={{ marginTop: 16 }}>{revealError}</div> : null}

        <button
          onClick={revealWhatsapp}
          disabled={revealing}
          className="explore-v2-button explore-v2-button-primary"
          style={{ marginTop: 24, width: '100%' }}
        >
          {revealing ? 'Revealing…' : 'Reveal WhatsApp link'}
        </button>
      </div>
    </div>
  );
}
