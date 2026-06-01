import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/supabaseClient';
import { ensureContactAccess } from '../utils/contactAccess';

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

  const title = useMemo(() => row?.item_name || 'Buying request', [row]);
  const heroImage = useMemo(() => {
    const img = Array.isArray(row?.images) ? row.images[0] : null;
    return img?.display_url || img?.image_url || img?.url || null;
  }, [row]);

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
    return <div className="mx-auto max-w-3xl px-5 py-10 text-white/70">Loading…</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-red-100">{error}</div>
        <Link className="mt-6 inline-block text-[#8bd6b4] underline" to="/buying-requests">
          Back to Buying Requests
        </Link>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10 text-white/70">
        Buying request not found. <Link className="text-[#8bd6b4] underline" to="/buying-requests">Back</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16 pt-10">
      <nav className="text-sm text-white/60">
        <Link to="/" className="hover:text-white">Home</Link> <span className="px-1">/</span>{' '}
        <Link to="/buying-requests" className="hover:text-white">Buying Requests</Link>
      </nav>

      <h1 className="mt-4 text-2xl font-semibold text-white">{title}</h1>
      <p className="mt-1 text-sm text-white/55">Anonymous buying request · {String(row?.item_type || '').toUpperCase()}</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        <div className="aspect-[16/10] w-full bg-black/20">
          <img src={heroImage || PLACEHOLDER_IMAGE} alt="" className="h-full w-full object-cover opacity-90" />
        </div>
        <div className="grid gap-2 p-5 text-white/80">
          <div><span className="text-white/55">Regional spec:</span> {row.regional_spec}</div>
          <div><span className="text-white/55">Mileage preference:</span> {row.mileage_preference}</div>
          {row?.budget ? <div><span className="text-white/55">Budget:</span> AED {Number(row.budget).toLocaleString()}</div> : null}
          {row?.reference_notes ? <div className="pt-1"><span className="text-white/55">Description:</span> {row.reference_notes}</div> : null}
          {(row?.car_manufacturer || row?.car_model || row?.trim) ? (
            <div className="pt-1">
              <span className="text-white/55">Make/Model/Trim:</span>{' '}
              {[row.car_manufacturer, row.car_model, row.trim].filter(Boolean).join(' ')}
            </div>
          ) : null}
        </div>
      </div>

      {revealError ? (
        <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-red-100">{revealError}</div>
      ) : null}

      <button
        onClick={revealWhatsapp}
        disabled={revealing}
        className="mt-6 w-full rounded-xl bg-[#8bd6b4] px-4 py-3 font-semibold text-black disabled:opacity-60"
      >
        {revealing ? 'Revealing…' : 'Reveal WhatsApp link'}
      </button>
    </div>
  );
}
