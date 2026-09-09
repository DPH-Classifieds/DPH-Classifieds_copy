import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import { API_BASE_URL as API_URL } from '../utils/apiBase';
import { getAccessToken } from '../utils/supabaseClient';
import { getCurrentUser } from '../utils/authService';
import { useAuth } from '../context/AuthContext';
import './DealerVerificationPage.css';

const DOC_ACCEPT = '.jpg,.jpeg,.png,.pdf';
const DOC_MAX_BYTES = 10 * 1024 * 1024;

const POLL_INTERVAL_MS = 8000;

const DOC_LABELS = {
  trade_license: 'Trade License',
  tax_registration: 'TRN Certificate',
};

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return String(value);
  }
}

function statusChipForDoc(doc) {
  const status = String(doc?.status || '').toLowerCase();
  if (status === 'approved') return { label: 'Approved', kind: 'success' };
  if (status === 'denied') return { label: 'Denied', kind: 'danger' };
  if (status === 'pending') return { label: 'Pending review', kind: 'pending' };
  return { label: 'Awaiting upload', kind: 'muted' };
}

function dealerStatusChip(readiness, applicationStatus, dealerVerified) {
  if (dealerVerified) return { label: 'Verified Dealer', kind: 'success' };
  if (readiness?.ready_to_approve) return { label: 'Awaiting admin approval', kind: 'pending' };
  // "submitted" has to win over ready_to_submit, or an application that has
  // already been sent keeps advertising itself as still needing sending.
  if (applicationStatus === 'submitted') return { label: 'Under review', kind: 'pending' };
  if (readiness?.ready_to_submit) return { label: 'Ready to submit', kind: 'pending' };
  return { label: 'Action needed', kind: 'muted' };
}

const DealerVerificationPage = () => {
  const { updateUser } = useAuth();
  const [readiness, setReadiness] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [applicationStatus, setApplicationStatus] = useState(null);
  const [dealerVerified, setDealerVerified] = useState(false);
  const [dealerCompanyName, setDealerCompanyName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(true);

  const [draftMessage, setDraftMessage] = useState('');
  const [draftContext, setDraftContext] = useState('Verification update');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [lastSendAt, setLastSendAt] = useState(null);

  const [uploadingDocType, setUploadingDocType] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // The backend rejects a trade licence whose expiry PaddleOCR can't read and
  // tells the dealer to "enter the expiry date manually" — so give them a way.
  const [expiryPrompt, setExpiryPrompt] = useState(null); // { file, message }
  const [expiryValue, setExpiryValue] = useState('');

  const isMountedRef = useRef(true);
  const fileInputRefs = useRef({});

  const fetchStatus = useCallback(async () => {
    try {
      const resp = await apiClient.get('/api/user/dealer-verification');
      if (!isMountedRef.current) return;
      setReadiness(resp?.readiness || resp);
      setApplicationStatus(resp?.application_status || null);
      setDealerVerified(Boolean(resp?.dealer_verified));
      setDocuments(Array.isArray(resp?.documents) ? resp.documents : []);
      if (resp?.dealer_company_name) setDealerCompanyName(resp.dealer_company_name);
      setError(null);
      setLastSyncedAt(new Date());
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err?.message || 'Failed to load verification status');
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const resp = await apiClient.get('/api/dealer/verification/messages');
      if (!isMountedRef.current) return;
      setMessages(Array.isArray(resp?.messages) ? resp.messages : []);
    } catch (err) {
      if (!isMountedRef.current) return;
      // Non-fatal — keep the page usable even if the audit log query fails.
      console.warn('Failed to load dealer admin messages', err);
    } finally {
      if (isMountedRef.current) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchStatus();
    fetchMessages();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchStatus, fetchMessages]);

  useEffect(() => {
    if (dealerVerified) return undefined;
    const intervalId = setInterval(() => {
      fetchStatus();
      fetchMessages();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [dealerVerified, fetchStatus, fetchMessages]);

  const onSubmitMessage = async (event) => {
    event.preventDefault();
    if (sending) return;
    const trimmed = draftMessage.trim();
    if (trimmed.length < 4) {
      setSendError('Message must be at least 4 characters.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await apiClient.post('/api/dealer/verification/notify-admin', {
        message: trimmed,
        context: draftContext.trim() || 'Verification update',
      });
      setDraftMessage('');
      setLastSendAt(new Date());
      await fetchMessages();
    } catch (err) {
      setSendError(err?.message || 'Failed to send update');
    } finally {
      setSending(false);
    }
  };

  // The checklist used to say "Awaiting upload" with nowhere to upload, so a
  // dealer who signed up could never finish verification from this page.
  const sendDocument = async (documentType, file, expiresAt) => {
    const token = await getAccessToken();
    const body = new FormData();
    body.append('file', file);
    body.append('document_type', documentType);
    if (expiresAt) body.append('expires_at', expiresAt);
    const response = await fetch(`${API_URL}/api/user/dealer-documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
  };

  const onUploadDocument = async (documentType, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setExpiryPrompt(null);
    if (file.size > DOC_MAX_BYTES) {
      setUploadError('File too large. Maximum size: 10MB');
      event.target.value = '';
      return;
    }
    setUploadingDocType(documentType);
    try {
      const { ok, data } = await sendDocument(documentType, file);
      if (!ok) {
        if (data.code === 'trade_license_expiry_not_detected') {
          // Keep the file so the retry doesn't make them pick it again.
          setExpiryPrompt({ file, message: data.error });
          return;
        }
        throw new Error(data.error || 'Failed to upload document');
      }
      await fetchStatus();
    } catch (err) {
      setUploadError(err?.message || 'Failed to upload document');
    } finally {
      if (isMountedRef.current) setUploadingDocType(null);
      if (fileInputRefs.current[documentType]) fileInputRefs.current[documentType].value = '';
    }
  };

  const onSubmitExpiry = async (event) => {
    event.preventDefault();
    if (!expiryPrompt?.file || !expiryValue) return;
    setUploadingDocType('trade_license');
    setUploadError(null);
    try {
      const { ok, data } = await sendDocument('trade_license', expiryPrompt.file, expiryValue);
      if (!ok) throw new Error(data.error || 'Failed to upload document');
      setExpiryPrompt(null);
      setExpiryValue('');
      await fetchStatus();
    } catch (err) {
      setUploadError(err?.message || 'Failed to upload document');
    } finally {
      if (isMountedRef.current) setUploadingDocType(null);
    }
  };

  const onSubmitApplication = async () => {
    if (submitting) return;
    setSubmitting(true);
    setUploadError(null);
    try {
      await apiClient.post('/api/auth/dealer-submit-application', {});
      await fetchStatus();
      // Re-hydrate the session user or the site-wide banner keeps telling them
      // to upload documents they just submitted.
      try {
        const { user: refreshed } = await getCurrentUser(true);
        if (refreshed?.id) updateUser(refreshed);
      } catch (refreshError) {
        console.warn('Failed to refresh user after dealer submission', refreshError);
      }
    } catch (err) {
      setUploadError(err?.message || 'Failed to submit application');
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  const dealerStatus = useMemo(
    () => dealerStatusChip(readiness, applicationStatus, dealerVerified),
    [readiness, applicationStatus, dealerVerified]
  );

  const checklist = useMemo(() => {
    if (!readiness) return [];
    const docsByType = new Map();
    for (const doc of documents) {
      if (doc?.document_type && !docsByType.has(doc.document_type)) {
        docsByType.set(doc.document_type, doc);
      }
    }
    const items = [];
    items.push({
      key: 'trading-name',
      label: 'Trading Name',
      state: readiness.missing_fields?.includes('Trading Name') ? 'missing' : 'ok',
    });
    items.push({
      key: 'legal-name',
      label: 'Legal Business Name',
      state: readiness.missing_fields?.includes('Legal Business Name') ? 'missing' : 'ok',
    });
    items.push({
      key: 'trn',
      label: '15-digit TRN',
      state: readiness.missing_fields?.includes('15-digit TRN') ? 'missing' : 'ok',
    });
    const requiredDocs = Array.isArray(readiness.required_documents)
      ? readiness.required_documents
      : [];
    for (const docType of requiredDocs) {
      const doc = docsByType.get(docType);
      const chip = statusChipForDoc(doc);
      items.push({
        key: `doc-${docType}`,
        docType,
        label: DOC_LABELS[docType] || docType,
        state: chip.kind === 'success'
          ? 'ok'
          : chip.kind === 'danger'
            ? 'error'
            : chip.kind === 'pending'
              ? 'pending'
              : 'missing',
        meta: chip.label,
        doc,
      });
    }
    return items;
  }, [readiness, documents]);

  if (loading && !readiness) {
    return (
      <div className="dvp-shell">
        <div className="dvp-loading">Loading your verification status…</div>
      </div>
    );
  }

  return (
    <div className="dvp-shell">
      <header className="dvp-header">
        <div>
          <span className="dvp-kicker">Dealer Account</span>
          <h1>Verification status</h1>
          {dealerCompanyName ? (
            <p className="dvp-subtitle">{dealerCompanyName}</p>
          ) : null}
        </div>
        <span className={`dvp-chip dvp-chip-${dealerStatus.kind}`}>{dealerStatus.label}</span>
      </header>

      {error ? (
        <div className="dvp-error" role="alert">
          {error}
          <button type="button" className="dvp-link" onClick={fetchStatus}>Retry</button>
        </div>
      ) : null}

      <section className="dvp-section">
        <div className="dvp-section-head">
          <h2>Application checklist</h2>
          <p className="dvp-section-meta">
            Live • last synced {lastSyncedAt ? formatDate(lastSyncedAt.toISOString()) : '—'}
            {!dealerVerified ? ' • refreshing every 8s' : ''}
          </p>
        </div>
        <ul className="dvp-checklist">
          {checklist.map((item) => (
            <li key={item.key} className={`dvp-item dvp-item-${item.state}`}>
              <span className="dvp-item-dot" aria-hidden="true">
                {item.state === 'ok' ? '✓' : item.state === 'error' ? '!' : item.state === 'pending' ? '…' : '○'}
              </span>
              <div className="dvp-item-body">
                <span className="dvp-item-label">{item.label}</span>
                {item.meta ? <span className={`dvp-chip dvp-chip-${item.state === 'ok' ? 'success' : item.state === 'error' ? 'danger' : item.state === 'pending' ? 'pending' : 'muted'}`}>{item.meta}</span> : null}
                {item.doc?.denial_reason ? (
                  <p className="dvp-item-note">{item.doc.denial_reason}</p>
                ) : null}
                {item.docType && item.state !== 'ok' ? (
                  <div className="dvp-item-upload">
                    <input
                      ref={(node) => { fileInputRefs.current[item.docType] = node; }}
                      id={`dvp-upload-${item.docType}`}
                      type="file"
                      accept={DOC_ACCEPT}
                      className="dvp-file-input"
                      onChange={(event) => onUploadDocument(item.docType, event)}
                      disabled={uploadingDocType === item.docType}
                    />
                    <label
                      htmlFor={`dvp-upload-${item.docType}`}
                      className="dvp-button dvp-button-secondary dvp-button-compact"
                    >
                      {uploadingDocType === item.docType
                        ? 'Uploading…'
                        : item.state === 'pending'
                          ? `Replace ${item.label}`
                          : `Upload ${item.label}`}
                    </label>
                    <span className="dvp-item-hint">JPG, PNG or PDF — up to 10 MB</span>
                  </div>
                ) : null}
                {item.docType === 'trade_license' && expiryPrompt ? (
                  <form className="dvp-expiry-prompt" onSubmit={onSubmitExpiry}>
                    <p className="dvp-item-note">{expiryPrompt.message}</p>
                    <label className="dvp-field dvp-field-inline">
                      <span>Trade licence expiry date</span>
                      <input
                        type="date"
                        value={expiryValue}
                        required
                        onChange={(event) => setExpiryValue(event.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="dvp-button dvp-button-primary dvp-button-compact"
                      disabled={!expiryValue || uploadingDocType === 'trade_license'}
                    >
                      {uploadingDocType === 'trade_license' ? 'Uploading…' : 'Upload with this date'}
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {uploadError ? <div className="dvp-form-error" role="alert">{uploadError}</div> : null}
        {!dealerVerified && readiness?.ready_to_submit && applicationStatus !== 'submitted' ? (
          <button
            type="button"
            className="dvp-button dvp-button-primary dvp-submit-application"
            onClick={onSubmitApplication}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </button>
        ) : null}
        {dealerVerified ? (
          <p className="dvp-success-note">
            Your dealer account is verified. You can post up to your assigned listing cap.
          </p>
        ) : null}
        <div className="dvp-section-actions">
          <Link to="/account-settings" className="dvp-button dvp-button-secondary">
            Update business details
          </Link>
          <Link to="/dealer/dashboard" className="dvp-button dvp-button-primary">
            Go to dealer dashboard
          </Link>
        </div>
      </section>

      <section className="dvp-section">
        <div className="dvp-section-head">
          <h2>Talk to the admin team</h2>
          <p className="dvp-section-meta">
            Send a quick update when something on your end changes (re-uploaded trade license,
            new branch address, etc.). Every message is logged and emailed to the admins.
          </p>
        </div>
        <form onSubmit={onSubmitMessage} className="dvp-form">
          <label className="dvp-field">
            <span>Topic</span>
            <input
              type="text"
              value={draftContext}
              maxLength={200}
              onChange={(event) => setDraftContext(event.target.value)}
              placeholder="Verification update"
            />
          </label>
          <label className="dvp-field">
            <span>Message</span>
            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              maxLength={1500}
              placeholder="Tell us what's changed and what you'd like reviewed…"
              rows={5}
            />
          </label>
          {sendError ? <div className="dvp-form-error">{sendError}</div> : null}
          {lastSendAt && !sendError ? (
            <div className="dvp-form-success">
              Update sent at {formatDate(lastSendAt.toISOString())}.
            </div>
          ) : null}
          <div className="dvp-form-actions">
            <span className="dvp-form-counter">{draftMessage.length}/1500</span>
            <button
              type="submit"
              className="dvp-button dvp-button-primary"
              disabled={sending || draftMessage.trim().length < 4}
            >
              {sending ? 'Sending…' : 'Send update'}
            </button>
          </div>
        </form>

        <div className="dvp-history">
          <h3>Recent updates</h3>
          {messagesLoading ? (
            <p className="dvp-history-empty">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="dvp-history-empty">No updates sent yet.</p>
          ) : (
            <ul className="dvp-history-list">
              {messages.slice(0, 8).map((msg) => (
                <li key={msg.id} className="dvp-history-item">
                  <div className="dvp-history-head">
                    <span className="dvp-history-context">{msg.context || 'Verification update'}</span>
                    <time className="dvp-history-time">{formatDate(msg.created_at)}</time>
                  </div>
                  <p className="dvp-history-body">{msg.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default DealerVerificationPage;