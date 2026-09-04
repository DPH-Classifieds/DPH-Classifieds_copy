import { API_BASE_URL } from '../utils/apiBase';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getBestAccessToken } from '../utils/supabaseClient';

const VISITOR_STORAGE_KEY = 'dph_platform_visitor_id';
const SESSION_STORAGE_KEY = 'dph_platform_session_id';
const SESSION_STARTED_AT_KEY = 'dph_platform_session_started_at';

const createId = () =>
  window.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const getOrCreateLocalId = (storage, key) => {
  try {
    const existing = storage.getItem(key);
    if (existing) {
      return existing;
    }
    const nextId = createId();
    storage.setItem(key, nextId);
    return nextId;
  } catch (error) {
    return createId();
  }
};

const classifyPath = (path) => {
  const normalized = String(path || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (normalized.startsWith('/cars/')) return { listing_type: 'car', listing_id: normalized.split('/')[2] };
  if (normalized.startsWith('/bikes/')) return { listing_type: 'bike', listing_id: normalized.split('/')[2] };
  if (normalized.startsWith('/plates/')) return { listing_type: 'plate', listing_id: normalized.split('/')[2] };
  if (normalized.startsWith('/car-parts/')) return { listing_type: 'part', listing_id: normalized.split('/')[2] };
  return {};
};

const getPageKind = (path) => {
  const normalized = String(path || '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (normalized === '/') return 'home';
  if (normalized.startsWith('/admin')) return 'admin';
  if (normalized.startsWith('/post-') || normalized.startsWith('/create')) return 'post_form';
  if (normalized.startsWith('/edit/')) return 'edit_form';
  if (normalized.startsWith('/login') || normalized.startsWith('/signup') || normalized.startsWith('/verify')) return 'auth';
  if (normalized.startsWith('/cars/') || normalized.startsWith('/bikes/') || normalized.startsWith('/plates/') || normalized.startsWith('/car-parts/')) return 'listing_detail';
  if (normalized.startsWith('/cars') || normalized.startsWith('/bikes') || normalized.startsWith('/plates') || normalized.startsWith('/car-parts')) return 'browse';
  if (normalized.startsWith('/about') || normalized.startsWith('/contact') || normalized.startsWith('/privacy') || normalized.startsWith('/terms')) return 'content';
  return 'other';
};

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);

const PlatformAnalyticsTracker = () => {
  const location = useLocation();
  const { user } = useAuth();
  const authTokenRef = useRef(null);
  const sessionIdRef = useRef(null);
  const visitorIdRef = useRef(null);
  const sessionStartedAtRef = useRef(Date.now());
  const pageStartedAtRef = useRef(Date.now());
  const lastPathRef = useRef('');
  const firstPageViewRef = useRef(false);

  useEffect(() => {
    visitorIdRef.current = getOrCreateLocalId(window.localStorage, VISITOR_STORAGE_KEY);
    sessionIdRef.current = getOrCreateLocalId(window.sessionStorage, SESSION_STORAGE_KEY);
    sessionStartedAtRef.current = Number(window.sessionStorage.getItem(SESSION_STARTED_AT_KEY) || Date.now());
    window.sessionStorage.setItem(SESSION_STARTED_AT_KEY, String(sessionStartedAtRef.current));
  }, []);

  useEffect(() => {
    let active = true;
    getBestAccessToken()
      .then((token) => {
        if (active) {
          authTokenRef.current = token || null;
        }
      })
      .catch(() => {
        if (active) {
          authTokenRef.current = null;
        }
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const sendEvent = async (eventName, payload = {}, options = {}) => {
    const body = {
      event_id: window.crypto?.randomUUID?.() || `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      event_name: eventName,
      platform: 'web',
      page_path: payload.page_path || `${window.location.pathname}${window.location.search}`,
      page_title: payload.page_title || document.title,
      page_kind: payload.page_kind || getPageKind(payload.page_path || `${window.location.pathname}${window.location.search}`),
      element_tag: payload.element_tag || null,
      element_text: payload.element_text || null,
      target_url: payload.target_url || null,
      listing_type: payload.listing_type || null,
      listing_id: payload.listing_id || null,
      session_id: sessionIdRef.current,
      visitor_id: visitorIdRef.current,
      duration_ms: payload.duration_ms || 0,
      metadata: {
        platform: 'web',
        referrer: document.referrer || null,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        page_kind: payload.page_kind || getPageKind(payload.page_path || `${window.location.pathname}${window.location.search}`),
        intent: payload.intent || null,
        label: payload.label || null,
        form_id: payload.form_id || null,
        form_name: payload.form_name || null,
        form_method: payload.form_method || null,
        ...payload.metadata,
      },
    };

    const headers = {
      'Content-Type': 'application/json',
    };

    if (authTokenRef.current) {
      headers.Authorization = `Bearer ${authTokenRef.current}`;
    }

    try {
      await fetch(`${API_BASE_URL}/api/analytics/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        credentials: 'include',
        keepalive: options.keepalive !== false,
      });
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        console.debug('Analytics event send failed:', eventName, error);
      }
    }
  };

  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    const previousPath = lastPathRef.current;

    if (!firstPageViewRef.current) {
      firstPageViewRef.current = true;
      void sendEvent('session_start', {
        page_path: path,
        intent: 'session_start',
        metadata: {
          session_started_at: sessionStartedAtRef.current,
        },
      });
    } else if (previousPath && previousPath !== path) {
      void sendEvent('page_exit', {
        page_path: previousPath,
        duration_ms: Date.now() - pageStartedAtRef.current,
        metadata: {
          exit_reason: 'route_change',
        },
      });
    }

    pageStartedAtRef.current = Date.now();
    lastPathRef.current = path;

    const listing = classifyPath(path);
    void sendEvent(listing.listing_id ? 'listing_view' : 'page_view', {
      page_path: path,
      listing_type: listing.listing_type || null,
      listing_id: listing.listing_id || null,
      metadata: {
        referrer: document.referrer || null,
      },
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const handleClick = (event) => {
      const target = event.target instanceof Element ? event.target.closest('a, button, [role="button"], [data-analytics-event]') : null;
      if (!target) return;

      const tagName = target.tagName ? target.tagName.toLowerCase() : 'element';
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const pathMeta = classifyPath(currentPath);
      const href = tagName === 'a' ? target.href : target.getAttribute('href') || target.dataset.href || null;
      const text = normalizeText(target.getAttribute('aria-label') || target.title || target.innerText || target.textContent);
      const explicitEvent = target.dataset.analyticsEvent;

      void sendEvent(explicitEvent || (tagName === 'a' ? 'link_click' : 'button_click'), {
        page_path: currentPath,
        element_tag: tagName,
        element_text: text,
        target_url: href,
        listing_type: target.dataset.listingType || pathMeta.listing_type || null,
        listing_id: target.dataset.listingId || pathMeta.listing_id || null,
        intent: target.dataset.analyticsIntent || null,
        label: target.dataset.analyticsLabel || text || null,
        metadata: {
          current_path: currentPath,
          target_href: href,
          analytics_event: explicitEvent || null,
        },
      });
    };

    const handleSubmit = (event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;

      const currentPath = `${window.location.pathname}${window.location.search}`;
      const formName = form.getAttribute('name') || form.id || null;
      void sendEvent('form_submit', {
        page_path: currentPath,
        element_tag: 'form',
        element_text: normalizeText(form.getAttribute('aria-label') || formName || form.getAttribute('action') || 'form'),
        target_url: form.getAttribute('action') || currentPath,
        intent: form.dataset.analyticsIntent || null,
        label: formName || null,
        metadata: {
          form_id: form.id || null,
          form_name: formName,
          form_method: form.getAttribute('method') || 'post',
        },
      });
    };

    const handlePageExit = () => {
      const path = lastPathRef.current || `${window.location.pathname}${window.location.search}`;
      void sendEvent('session_end', {
        page_path: path,
        duration_ms: Date.now() - sessionStartedAtRef.current,
        metadata: {
          exit_reason: 'pagehide',
        },
      }, { keepalive: true });

      if (lastPathRef.current) {
        void sendEvent('page_exit', {
          page_path: path,
          duration_ms: Date.now() - pageStartedAtRef.current,
          metadata: {
            exit_reason: 'pagehide',
          },
        }, { keepalive: true });
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('submit', handleSubmit, true);
    window.addEventListener('pagehide', handlePageExit);
    window.addEventListener('beforeunload', handlePageExit);

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('submit', handleSubmit, true);
      window.removeEventListener('pagehide', handlePageExit);
      window.removeEventListener('beforeunload', handlePageExit);
    };
  }, []);

  return null;
};

export default PlatformAnalyticsTracker;
