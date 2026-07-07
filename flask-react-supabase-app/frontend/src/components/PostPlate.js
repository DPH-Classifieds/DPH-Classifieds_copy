import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { getAccessToken } from '../utils/supabaseClient';
import { trackEvent } from '../utils/analytics';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';
import { getAreasForEmirate, UAE_EMIRATES } from '../utils/listingConstants';
import { getWhatsappPrefillTemplate } from '../utils/whatsapp';
import ActionNoticeModal from './ui/ActionNoticeModal';
import { buildDealerHelpMailto, buildErrorNotice } from '../utils/errorNotice';
import { clearListingDraft, loadListingDraft, saveListingDraft } from '../utils/listingDrafts';
import { moderateImage } from '../utils/imageModeration';
import { uploadRegistrationDocument } from '../utils/directUpload';
import '../styles/PostForms.css';
import '../styles/UAELicensePlate.css';
import UAELicensePlate from './UAELicensePlate';

const SUPPORTED_PROOF_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_PROOF_SIZE_BYTES = 20 * 1024 * 1024;

const RequiredMark = () => <span className="required-asterisk">*</span>;

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const DEFAULT_WHATSAPP_PREFILL = getWhatsappPrefillTemplate('plate');
const PLATE_DRAFT_STORAGE_KEY = 'dph_post_plate_draft_v1';
const PHONE_SPLIT_RE = /^(\+\d+)(\d+)$/;
const MAX_DESCRIPTION_WORDS = 300;

const splitPhoneNumber = (value, fallbackCountryCode = defaultCountryCode) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return { countryCode: fallbackCountryCode, localNumber: '' };
  }

  const match = raw.match(PHONE_SPLIT_RE);
  if (match) {
    return { countryCode: match[1], localNumber: match[2] };
  }

  return { countryCode: fallbackCountryCode, localNumber: raw.replace(/^\+/, '') };
};

const PLATE_FORMAT_OPTIONS = [
  'Any format',
  'Contains digit repeated 2 times',
  'Contains digit repeated 3 times',
  'Contains digit repeated 4 times',
  'x???x (5 Digits)',
  'xyzyx (5 Digits)',
  'xxxX (5 Digits)',
  '?xxx? (5 Digits)',
  'хухух (5 Digits)',
  'хууух (5 Digits)',
  '??xxx (5 Digits)',
  'XXX?? (5 Digits)',
  'xXXXx (5 Digits)',
  'x??X (4 Digits)',
  'xyyx (4 Digits)',
  'xyxy (4 Digits)',
  '?xx? (4 Digits)',
  'xxxy (4 Digits)',
  'ХУУУ (4 Digits)',
  'XXXX (4 Digits)',
  'xyx (3 Digits)',
  'xyz (3 Digits)',
  'xyy (3 Digits)',
  'xxy (3 Digits)',
  'XXX (3 Digits)',
];

const getCodeOptions = (city) => {
  switch (city) {
    case 'Dubai':
      return [...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)), 'AA', 'BB', 'CC', 'DD', 'EE', 'CR'];
    case 'Abu Dhabi':
      return [...Array.from({ length: 20 }, (_, index) => `${index + 1}`), '50'];
    case 'Sharjah':
      return ['White', '1', '2', '3'];
    case 'Ajman':
    case 'Ras Al Khaimah':
    case 'Fujairah':
    case 'Umm Al Quwain':
      return Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
    default:
      return [];
  }
};

const PostPlate = () => {
  const { id: listingId } = useParams();
  const isEdit = Boolean(listingId);
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [isLoadingListing, setIsLoadingListing] = useState(isEdit);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [draftNotice, setDraftNotice] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [proofDocumentUrl, setProofDocumentUrl] = useState('');
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  const [moderationError, setModerationError] = useState(null);
  const [moderating, setModerating] = useState(false);
  const proofInputRef = useRef(null);
  const [regDocFile, setRegDocFile] = useState(null);
  const [regDocUrl, setRegDocUrl] = useState('');
  const [uploadingRegDoc, setUploadingRegDoc] = useState(false);
  const [plateOcrStatus, setPlateOcrStatus] = useState('');
  const regDocInputRef = useRef(null);
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [useUsernameAsContactName, setUseUsernameAsContactName] = useState(false);
  const [formData, setFormData] = useState({
    city: '',
    code: '',
    digits: '',
    price: '',
    number: '',
    plate_format: 'Any format',
    contact_name: '',
    contact_phone: '',
    country_code: defaultCountryCode,
    whatsapp_country_code: defaultCountryCode,
    whatsapp_number: '',
    whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
    area: '',
    emirate: '',
    description: '',
    is_dealer: false,
  });

  useEffect(() => {
    syncWithSupabase();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const username = String(user?.username || '').trim();
    if (!username) {
      setUseUsernameAsContactName(false);
      return;
    }

    setUseUsernameAsContactName(true);
    setFormData((prev) => ({
      ...prev,
      contact_name: username,
    }));
  }, [user?.username]);

  useEffect(() => {
    const fetchListing = async () => {
      if (!isEdit || !listingId) {
        setIsLoadingListing(false);
        return;
      }

      try {
        const token = await getAccessToken();
        if (!token) {
          throw new Error('Authentication token not found');
        }

        const response = await fetch(`${API_URL}/api/plates/${listingId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load plate listing');
        }

        const data = await response.json();
        setFormData((prev) => ({
          ...prev,
          city: data.city || '',
          code: data.code || '',
          digits: data.digits ? String(data.digits) : '',
          price: data.price ? String(data.price) : '',
          number: data.number || '',
          plate_format: data.plate_format || 'Any format',
          contact_name: data.contact_name || '',
          contact_phone: data.contact_phone || '',
          country_code: data.country_code || defaultCountryCode,
          whatsapp_country_code: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).countryCode,
          whatsapp_number: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).localNumber,
          whatsapp_prefill_text: data.whatsapp_prefill_text || DEFAULT_WHATSAPP_PREFILL,
          area: data.area || '',
          emirate: data.emirate || data.city || '',
          description: data.description || '',
          is_dealer: Boolean(data.is_dealer),
        }));
        const normalizedContact = splitPhoneNumber(data.contact_phone || '', data.country_code || defaultCountryCode);
        const normalizedWhatsapp = splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode);
        setWhatsappSameAsPhone(
          Boolean(data.whatsapp_number) &&
            normalizedWhatsapp.countryCode === normalizedContact.countryCode &&
            normalizedWhatsapp.localNumber === normalizedContact.localNumber
        );

        if (data.proof_document_url) {
          setProofDocumentUrl(data.proof_document_url);
        }
        if (data.registration_doc_url) { setRegDocUrl(data.registration_doc_url); }

      } catch (fetchError) {
        setError(fetchError.message || 'Failed to load plate listing');
      } finally {
        setIsLoadingListing(false);
      }
    };

    fetchListing();
  }, [isEdit, listingId]);

  useEffect(() => {
    if (isEdit || !user?.id) {
      return;
    }

    let cancelled = false;
    const restoreDraft = async () => {
      const draft = await loadListingDraft('plate', PLATE_DRAFT_STORAGE_KEY);
      if (cancelled || !draft) {
        return;
      }

      const draftForm = draft.plateForm || draft.formData;
      if (draftForm) {
        setFormData((prev) => ({ ...prev, ...draftForm }));
      }
      if (typeof draft.whatsappSameAsPhone === 'boolean') {
        setWhatsappSameAsPhone(draft.whatsappSameAsPhone);
      }
      setDraftNotice('Draft restored.');
    };

    restoreDraft();
    return () => {
      cancelled = true;
    };
  }, [isEdit, user?.id]);

  const isUnauthed = !isLoading && !user;
  const codeOptions = useMemo(() => getCodeOptions(formData.city), [formData.city]);
  const areaOptions = useMemo(() => getAreasForEmirate(formData.city), [formData.city]);
  const errorNotice = useMemo(() => buildErrorNotice(error), [error]);
  const listingLimitActions = useMemo(
    () => [
      {
        label: 'My Listings',
        onClick: () => {
          setError(null);
          navigate('/my-listings');
        },
      },
      {
        label: "I’m a Dealer",
        href: buildDealerHelpMailto({
          subject: 'Dealer listing help',
          body: `Hi team,\n\nI reached the listing limit and would like help with dealer posting access.\n\nAccount email: ${user?.email || 'Not set'}\nListing page: ${typeof window !== 'undefined' ? window.location.href : ''}\n`,
        }),
      },
      {
        label: 'Home',
        onClick: () => {
          setError(null);
          navigate('/');
        },
      },
    ],
    [navigate, user?.email]
  );
  const errorActions = errorNotice?.code === 'listing_limit' ? listingLimitActions : [];

  useEffect(() => {
    if (!formData.city) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      code: codeOptions.includes(prev.code) ? prev.code : '',
    }));
  }, [codeOptions, formData.city]);

  const countWords = (text) => (String(text || '').trim().match(/\S+/g) || []).length;

  const limitWords = (text, maxWords) => {
    if (!text) return text;
    const matches = Array.from(String(text).matchAll(/\S+/g));
    if (matches.length <= maxWords) return text;
    const cutoff = matches[maxWords]?.index ?? String(text).length;
    return String(text).slice(0, cutoff).trimEnd();
  };

  const descriptionWordCount = countWords(formData.description || '');
  const descriptionCharacterCount = (formData.description || '').length;

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    let nextValue = type === 'checkbox' ? checked : value;

    if (name === 'number') {
      nextValue = value.replace(/\D/g, '').slice(0, 5);
    }

    if (name === 'price') {
      nextValue = value === '' ? '' : String(Math.max(0, Number(value)));
    }

    if (name === 'description') {
      nextValue = limitWords(value, MAX_DESCRIPTION_WORDS);
    }

    if (name === 'country_code') {
      setFormData((prev) => ({
        ...prev,
        country_code: value,
        whatsapp_country_code: whatsappSameAsPhone ? value : prev.whatsapp_country_code,
      }));
      return;
    }

    if (whatsappSameAsPhone && (name === 'contact_phone' || name === 'country_code')) {
      setFormData((prev) => ({
        ...prev,
        [name]: nextValue,
        whatsapp_country_code: name === 'country_code' ? value : prev.whatsapp_country_code,
        whatsapp_number: name === 'contact_phone' ? value : prev.whatsapp_number,
      }));
      return;
    }

    setFormData((prev) => {
      const updated = {
        ...prev,
        [name]: nextValue,
      };

      if (name === 'city') {
        updated.emirate = nextValue;
        updated.area = getAreasForEmirate(nextValue).includes(prev.area) ? prev.area : '';
      }

      if (name === 'number' && nextValue) {
        updated.digits = `${nextValue.length}`;
      }

      return updated;
    });
  };

  const handleProofFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!SUPPORTED_PROOF_TYPES.includes(file.type)) {
      setError({ message: 'Proof document must be a JPG, PNG, WEBP, or PDF file.' });
      return;
    }
    if (file.size > MAX_PROOF_SIZE_BYTES) {
      setError({ message: 'Proof document must be under 20 MB.' });
      return;
    }
    if (file.type !== 'application/pdf') {
      setModerating(true);
      setModerationError(null);
      try {
        const { blocked, reasons } = await moderateImage(file);
        if (blocked) {
          setModerationError(
            reasons.includes('nudity')
              ? 'This photo was blocked — explicit content detected. Please upload a valid proof of ownership document.'
              : 'This photo was blocked — a face was detected. Please upload a valid proof of ownership document.'
          );
          return;
        }
      } catch (err) {
        console.warn('Image moderation failed, allowing file:', err);
      } finally {
        setModerating(false);
      }
    }
    setProofFile(file);
    setIsUploadingProof(true);
    setError(null);
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'pdf';
      const objectPath = `${user.id}/plate-proofs/${Date.now()}.${ext}`;
      const signed = await apiClient.post('/api/storage/signed-upload-url', {
        bucket_name: 'listing-images',
        object_path: objectPath,
        upsert: false,
      });
      const { supabase: supabaseClient } = await import('../utils/supabaseClient');
      await supabaseClient.storage.from('listing-images').uploadToSignedUrl(
        objectPath,
        signed.token,
        file,
        { cacheControl: '31536000', contentType: file.type }
      );
      const { data: urlData } = supabaseClient.storage.from('listing-images').getPublicUrl(objectPath);
      setProofDocumentUrl(urlData.publicUrl);
    } catch (uploadErr) {
      setError({ message: 'Failed to upload proof document. Please try again.' });
      setProofFile(null);
    } finally {
      setIsUploadingProof(false);
    }
  };

  const handleRegDocChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRegDocFile(file);
    setRegDocUrl('');
    setPlateOcrStatus('');
    if (!user?.id) return;
    setUploadingRegDoc(true);
    try {
      const url = await uploadRegistrationDocument(file, { userId: user.id });
      setRegDocUrl(url);
    } catch (err) {
      console.warn('Failed to upload registration doc:', err);
    } finally {
      setUploadingRegDoc(false);
    }
  };

  const runPlateOcr = async () => {
    if (!regDocFile) return;
    setPlateOcrStatus('scanning');
    try {
      const reader = new FileReader();
      const b64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(regDocFile);
      });
      const resp = await apiClient.post('/api/ocr/hf-extract', { image_b64: b64 });
      const text = resp?.text || '';
      const plateMatch = text.match(/\b(\d{1,5})\b/);
      if (plateMatch) {
        setFormData((prev) => ({ ...prev, number: plateMatch[1] }));
        setPlateOcrStatus('done');
      } else {
        setPlateOcrStatus('error');
      }
    } catch (err) {
      console.warn('Plate OCR failed:', err);
      setPlateOcrStatus('error');
    }
  };

  const handleSaveDraft = async () => {
    if (!user) return;

    setIsDraftSaving(true);
    setError(null);
    setDraftNotice('Saving draft...');
    try {
      const draftPayload = {
        plateForm: formData,
        formData,
        whatsappSameAsPhone,
        savedAt: new Date().toISOString(),
      };

      await saveListingDraft('plate', PLATE_DRAFT_STORAGE_KEY, draftPayload);
      if (isEdit && listingId) {
        await apiClient.post(`/api/user/listings/plate/${listingId}/outcome`, {
          outcome: 'move_to_draft',
        });
      }

      setDraftNotice('Draft saved.');
      trackEvent('save_listing_draft', { listing_type: 'plate', platform: 'web' });
    } catch (draftError) {
      setError(draftError?.message || 'Could not sync your draft right now. It was saved in this browser, but please try again before switching devices.');
    } finally {
      setIsDraftSaving(false);
      window.setTimeout(() => {
        setDraftNotice((current) => (current && current !== 'Saving draft...' ? null : current));
      }, 2500);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!user) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      if (!isEdit && !proofDocumentUrl) {
        setError({ message: 'Please upload proof of ownership before submitting.' });
        setIsSubmitting(false);
        return;
      }

      const payload = {
        city: formData.city,
        code: formData.code,
        digits: Number(formData.digits),
        price: Number(formData.price),
        number: formData.number.trim(),
        plate_format: formData.plate_format,
        contact_name: formData.contact_name.trim(),
        contact_phone: formData.contact_phone.trim(),
        country_code: formData.country_code,
        whatsapp_number: formData.whatsapp_number
          ? `${formData.whatsapp_country_code}${formData.whatsapp_number.trim()}`
          : '',
        whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
        area: formData.area.trim(),
        emirate: formData.emirate || formData.city,
        description: formData.description.trim(),
        is_dealer: formData.is_dealer,
        ...(proofDocumentUrl && { proof_document_url: proofDocumentUrl }),
        ...(regDocUrl && { registration_doc_url: regDocUrl }),
      };

      if (isEdit) {
        const updateAttempts = ['PATCH', 'PUT', 'POST'];
        let lastError = null;
        for (const method of updateAttempts) {
          try {
            await apiClient.request(`/api/plates/${listingId}`, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: payload,
            });
            lastError = null;
            break;
          } catch (updateError) {
            lastError = updateError;
            if (updateError?.status === 404 || updateError?.status === 405) {
              continue;
            }
            throw updateError;
          }
        }
        if (lastError) {
          throw lastError;
        }
      } else {
        await apiClient.post('/api/plates', payload);
      }
      if (!isEdit) {
        await clearListingDraft('plate', PLATE_DRAFT_STORAGE_KEY);
        trackEvent('post_listing_success', { listing_type: 'plate', platform: 'web' });
      }
      setSuccess(true);

      setTimeout(() => {
        navigate('/my-listings');
      }, 1800);
    } catch (submissionError) {
      setError({
        message: submissionError.response?.data?.error || submissionError.message || `Failed to ${isEdit ? 'update' : 'submit'} plate listing.`,
        code: submissionError?.code || submissionError?.response?.data?.code || submissionError?.details?.code || null,
        details: submissionError?.details || submissionError?.response?.data || null,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isUnauthed) {
    return (
      <div className="auth-required">
        <h2>Authentication Required</h2>
        <p>You need to be logged in to post a plate listing.</p>
        <div className="auth-buttons">
          <button onClick={() => navigate('/login?redirect=/post-plate')}>Log In</button>
          <button onClick={() => navigate('/signup')}>Sign Up</button>
        </div>
      </div>
    );
  }

  if (isLoadingListing) {
    return (
      <div className="post-form-container success-message">
        <h2>Loading listing...</h2>
      </div>
    );
  }

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your license plate listing has been {isEdit ? 'updated' : 'submitted and is pending approval'}.</p>
        <p>You will be redirected to your listings shortly.</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      <section className="post-hero-section">
        <div className="post-hero-content">
          <div className="post-hero-text">
            <span className="post-hero-kicker">Sell Your Plate</span>
            <h1 className="post-hero-title">{isEdit ? 'Edit Your Plate Listing' : 'Present Your Plate Like A Premium Asset'}</h1>
            <p className="post-hero-subtitle">
              This flow now mirrors the car form structure and posts directly to the backend plate endpoint without the old client-side image detour.
            </p>
          </div>
        </div>
      </section>

      <section className="post-form-section">
        <div className="form-container">
          <ActionNoticeModal
            open={Boolean(errorNotice)}
            title={errorNotice?.code === 'listing_limit' ? 'Listing limit reached' : 'We could not save this listing'}
            message={errorNotice?.message || 'Please review the message and try again.'}
            details={errorNotice?.details}
            actions={errorActions}
            onClose={() => setError(null)}
          />

          <form onSubmit={handleSubmit} className="post-form">
            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Proof of ownership <RequiredMark /></h2>
                <p className="form-section-desc">
                  Upload a document proving you own this plate (e.g. Mulkiya, registration card, or bill of sale).
                </p>
                <p className="form-section-desc" style={{ marginTop: 8, fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
                  🔒 This document is for our verification only and will <strong>not</strong> be shown publicly.
                </p>
              </div>
              <div className="form-section-content">
                <div
                  className={`image-upload-area${proofDocumentUrl ? ' upload-success' : ''}`}
                  onClick={() => !proofDocumentUrl && proofInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: proofDocumentUrl ? 'default' : 'pointer' }}
                >
                  {proofDocumentUrl ? (
                    <>
                      <div className="upload-icon-wrapper">
                        <span className="material-symbols-outlined" style={{ color: 'var(--color-success, #22c55e)' }}>check_circle</span>
                      </div>
                      <p className="upload-text-main" style={{ color: 'var(--color-success, #22c55e)' }}>
                        {proofFile?.name || 'Document uploaded'}
                      </p>
                      <p className="upload-text-sub">
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', textDecoration: 'underline', fontSize: 13, padding: 0 }}
                          onClick={(e) => { e.stopPropagation(); setProofDocumentUrl(''); setProofFile(null); proofInputRef.current && (proofInputRef.current.value = ''); }}
                        >
                          Remove and re-upload
                        </button>
                      </p>
                    </>
                  ) : isUploadingProof ? (
                    <>
                      <div className="upload-icon-wrapper">
                        <span className="material-symbols-outlined">hourglass_top</span>
                      </div>
                      <p className="upload-text-main">Uploading…</p>
                    </>
                  ) : (
                    <>
                      <div className="upload-icon-wrapper">
                        <span className="material-symbols-outlined">upload_file</span>
                      </div>
                      <p className="upload-text-main">Click to upload proof of ownership</p>
                      <p className="upload-text-sub">JPG, PNG, WEBP, or PDF up to 20 MB</p>
                    </>
                  )}
                  <input
                    ref={proofInputRef}
                    className="file-input"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                    onChange={handleProofFileChange}
                    style={{ display: 'none' }}
                  />
                </div>
                {moderating && (
                  <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 4 }}>Checking document…</p>
                )}
                {moderationError && (
                  <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: 4 }}>{moderationError}</p>
                )}

                <div className="form-group" style={{ marginTop: 16 }}>
                  <label>Vehicle Registration Document <span style={{ fontWeight: 'normal', fontSize: '0.85em' }}>(optional)</span></label>
                  <div className="registration-doc-upload">
                    <input
                      ref={regDocInputRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                      className="file-input"
                      onChange={handleRegDocChange}
                      id="plate_registration_doc"
                    />
                    <label htmlFor="plate_registration_doc" className="upload-doc-label">
                      {regDocFile ? regDocFile.name : 'Upload vehicle registration (optional)'}
                    </label>
                    {uploadingRegDoc && <span className="form-text">Uploading…</span>}
                    {regDocUrl && !uploadingRegDoc && <span className="form-text text-success">Document uploaded.</span>}
                  </div>
                  {regDocFile && regDocUrl && (
                    <button type="button" className="btn btn-secondary btn-sm mt-1" onClick={runPlateOcr} disabled={plateOcrStatus === 'scanning'}>
                      {plateOcrStatus === 'scanning' ? 'Scanning…' : 'Scan for plate number'}
                    </button>
                  )}
                  {plateOcrStatus === 'done' && <p className="form-text text-success">Plate number pre-filled.</p>}
                  {plateOcrStatus === 'error' && <p className="form-text text-muted">No plate number found — enter manually.</p>}
                  <div className="form-text text-muted">Admin verification only. Never shown to buyers.</div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Plate identity</h2>
                <p className="form-section-desc">
                  Choose the city, code, and number exactly as they should be stored in the `license_plates` table. The preview updates from these same values.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="city">City <RequiredMark /></label>
                    <SearchableSelect id="city" name="city" value={formData.city} onChange={handleChange} required>
                      <option value="">Select city</option>
                      <option value="Dubai">Dubai</option>
                      <option value="Abu Dhabi">Abu Dhabi</option>
                      <option value="Sharjah">Sharjah</option>
                      <option value="Ajman">Ajman</option>
                      <option value="Fujairah">Fujairah</option>
                      <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                      <option value="Umm Al Quwain">Umm Al Quwain</option>
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="code">Plate code <RequiredMark /></label>
                    <SearchableSelect id="code" name="code" value={formData.code} onChange={handleChange} required disabled={!formData.city}>
                      <option value="">Select code</option>
                      {codeOptions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="number">Plate number <RequiredMark /></label>
                    <input id="number" name="number" value={formData.number} onChange={handleChange} required inputMode="numeric" placeholder="12345" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="digits">Digits <RequiredMark /></label>
                    <SearchableSelect id="digits" name="digits" value={formData.digits} onChange={handleChange} required>
                      <option value="">Select digits</option>
                      <option value="1">1 digit</option>
                      <option value="2">2 digits</option>
                      <option value="3">3 digits</option>
                      <option value="4">4 digits</option>
                      <option value="5">5 digits</option>
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="plate_format">Plate format <RequiredMark /></label>
                    <SearchableSelect id="plate_format" name="plate_format" value={formData.plate_format} onChange={handleChange} required>
                      {PLATE_FORMAT_OPTIONS.map((format) => (
                        <option key={format} value={format}>
                          {format}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="price">Price (AED) <RequiredMark /></label>
                    <input id="price" name="price" type="number" min="0" value={formData.price} onChange={handleChange} required placeholder="15000" />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Live preview</h2>
                <p className="form-section-desc">
                  The visual preview is now purely a frontend reference. The backend generates its own image from the same database values when the listing is created.
                </p>
              </div>
              <div className="form-section-content">
                <div className="plate-preview-panel">
                  {formData.city && formData.code ? (
                    <>
                      <div className="plate-preview-shell">
                        <UAELicensePlate city={formData.city} code={formData.code} number={formData.number || '12345'} />
                      </div>
                      <p className="form-text">
                        {formData.city} plate • {formData.plate_format} • AED {formData.price || '0'}
                      </p>
                    </>
                  ) : (
                    <p className="form-text">Select a city and code to generate the preview.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Seller details</h2>
                <p className="form-section-desc">
                  These contact fields map directly to the backend payload and will be carried through to listing moderation and buyer contact flows.
                </p>
              </div>
              <div className="form-section-content">
	                <div className="form-row">
	                  <div className="form-group">
	                    <label htmlFor="contact_name">Contact name <RequiredMark /></label>
	                    <input
	                      id="contact_name"
	                      name="contact_name"
	                      value={formData.contact_name}
	                      onChange={handleChange}
	                      required
	                      placeholder="Full name"
	                      disabled={useUsernameAsContactName && Boolean(String(user?.username || '').trim())}
	                    />
	                    <label
	                      className="checkbox-label"
	                      style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}
	                    >
	                      <input
	                        type="checkbox"
	                        checked={useUsernameAsContactName}
	                        disabled={!String(user?.username || '').trim()}
	                        onChange={(event) => {
	                          const nextChecked = event.target.checked;
	                          setUseUsernameAsContactName(nextChecked);
	                          if (nextChecked) {
	                            const username = String(user?.username || '').trim();
	                            if (username) {
	                              setFormData((prev) => ({ ...prev, contact_name: username }));
	                            }
	                          }
	                        }}
	                        style={{ width: 16, height: 16 }}
	                      />
	                      Use my username as seller name
	                    </label>
	                    {!String(user?.username || '').trim() && (
	                      <div className="form-text" style={{ color: '#fecaca' }}>
	                        You don’t have a username yet. Set one in <a href="/settings">Account Settings</a> to use it on your listings.
	                      </div>
	                    )}
	                  </div>
	                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="contact_phone">Contact phone <RequiredMark /></label>
                    <div className="phone-input-group">
                      <select
                        id="country_code"
                        name="country_code"
                        className="country-code-select"
                        value={formData.country_code}
                        onChange={handleChange}
                        aria-label="Country code"
                      >
                        {countryCodes.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.code}
                          </option>
                        ))}
                      </select>
                      <input id="contact_phone" name="contact_phone" value={formData.contact_phone} onChange={handleChange} required placeholder="501234567" className="phone-number-input" />
                    </div>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="whatsapp_number">WhatsApp Number</label>
                    <div className="phone-input-group">
                      <select
                        id="whatsapp_country_code"
                        name="whatsapp_country_code"
                        className="country-code-select"
                        value={formData.whatsapp_country_code}
                        onChange={handleChange}
                        disabled={whatsappSameAsPhone}
                        aria-label="WhatsApp country code"
                      >
                        {countryCodes.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.code}
                          </option>
                        ))}
                      </select>
                      <input
                        id="whatsapp_number"
                        name="whatsapp_number"
                        value={formData.whatsapp_number}
                        onChange={handleChange}
                        placeholder="501234567"
                        className="phone-number-input"
                        disabled={whatsappSameAsPhone}
                      />
                    </div>
                    <label className="checkbox-label" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                      <input
                        type="checkbox"
                        checked={whatsappSameAsPhone}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setWhatsappSameAsPhone(checked);
                          setFormData((prev) => ({
                            ...prev,
                            whatsapp_country_code: checked ? prev.country_code : prev.whatsapp_country_code,
                            whatsapp_number: checked ? prev.contact_phone : prev.whatsapp_number,
                          }));
                        }}
                        style={{ width: 14, height: 14 }}
                      />
                      Same as phone number
                    </label>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="area">Area <RequiredMark /></label>
                    {areaOptions.length > 0 ? (
                      <SearchableSelect id="area" name="area" value={formData.area} onChange={handleChange} required>
                        <option value="">Select Area</option>
                        {areaOptions.map((area) => (
                          <option key={area} value={area}>{area}</option>
                        ))}
                      </SearchableSelect>
                    ) : (
                      <input id="area" name="area" value={formData.area} onChange={handleChange} required placeholder="Area" />
                    )}
                  </div>
                  <div className="form-group">
                    <label htmlFor="emirate">Emirate</label>
                    <SearchableSelect id="emirate" name="emirate" value={formData.emirate || formData.city} onChange={handleChange}>
                      <option value="">Select emirate</option>
                      {UAE_EMIRATES.map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="is_dealer">Dealer listing</label>
                    <SearchableSelect
                      id="is_dealer"
                      name="is_dealer"
                      value={formData.is_dealer ? 'true' : 'false'}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          is_dealer: event.target.value === 'true',
                        }))
                      }
                    >
                      <option value="false">Private seller</option>
                      <option value="true">Dealer</option>
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="description">Description</label>
                    <textarea
                      id="description"
                      name="description"
                      rows="5"
                      value={formData.description}
                      onChange={handleChange}
                      placeholder="Share any provenance, rarity, transfer notes, or negotiation context."
                    />
                    <div className="form-text description-word-counter">
                      {descriptionWordCount}/{MAX_DESCRIPTION_WORDS} words • {descriptionCharacterCount} characters
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions-section">
              {isSubmitting ? (
                <div className="submit-loading-state" aria-live="polite" aria-atomic="true">
                  <div className="submit-loading-text">Submitting...</div>
                  <div className="submit-loading-bar" role="progressbar" aria-valuetext="Submitting your listing">
                    <span className="submit-loading-bar-fill" />
                  </div>
                </div>
              ) : null}
              {draftNotice ? <div className="draft-success-message">{draftNotice}</div> : null}
              <button type="button" className="btn-secondary" onClick={handleSaveDraft} disabled={isSubmitting || isDraftSaving}>
                {isDraftSaving ? 'Saving Draft...' : 'Save Draft'}
              </button>
              <button type="submit" className="submit-btn" disabled={isSubmitting}>
                {isSubmitting ? (isEdit ? 'Updating...' : 'Submitting...') : (isEdit ? 'Update Plate Listing' : 'Submit Plate Listing')}
              </button>
              <p>The listing is sent directly to the backend plate workflow and reviewed before it goes live.</p>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

export default PostPlate;
