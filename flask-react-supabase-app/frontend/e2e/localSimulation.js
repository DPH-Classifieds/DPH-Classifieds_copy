const { expect } = require('@playwright/test');
const { LOCAL_E2E_CREDENTIALS } = require('./localCredentials');

const listingByType = {
  car: { id: 'local-car-1', title: '2022 Toyota Land Cruiser', endpoint: 'cars' },
  part: { id: 'local-part-1', title: 'OEM LED headlight assembly', endpoint: 'parts' },
  plate: { id: 'local-plate-1', title: 'Dubai plate 7', endpoint: 'plates' },
  bike: { id: 'local-bike-1', title: '2024 Yamaha MT-09', endpoint: 'bikes' },
};

const users = {
  user: {
    id: 'local-user-1', email: LOCAL_E2E_CREDENTIALS.user.email, phone: '+971501234567',
    phone_verified: true, is_admin: false, is_dealer: false, first_name: 'Local', last_name: 'User',
  },
  dealer: {
    id: 'local-dealer-1', email: LOCAL_E2E_CREDENTIALS.dealer.email, phone: '+971501234568',
    phone_verified: true, is_admin: false, is_dealer: true, first_name: 'Local', last_name: 'Dealer',
  },
  admin: {
    id: 'local-admin-1', email: LOCAL_E2E_CREDENTIALS.admin.email, phone: '+971501234569',
    phone_verified: true, is_admin: true, is_super_admin: true, is_dealer: false, first_name: 'Local', last_name: 'Admin',
  },
};

const tokenForRole = (role) => `local.${Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64')}.token`;

const json = (body) => JSON.stringify(body);

const response = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  ...(status === 204 ? {} : { body: json(body) }),
});

const readJson = async (request) => {
  try { return request.postDataJSON() || {}; } catch { return {}; }
};

const userForToken = (request) => {
  const auth = request.headers().authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const directRole = ['user', 'dealer', 'admin'].find((candidate) => token.startsWith(`local.${candidate}.`));
  let encodedRole = null;
  try {
    encodedRole = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8')).role;
  } catch { /* guest or malformed token */ }
  const role = directRole || (['user', 'dealer', 'admin'].includes(encodedRole) ? encodedRole : null);
  return role ? users[role] : null;
};

const baseCar = {
  id: listingByType.car.id,
  make_year: 2022,
  car_manufacturer: 'Toyota',
  car_model: 'Land Cruiser',
  trim: 'GXR',
  listing_title: listingByType.car.title,
  expected_selling_price: 225000,
  kilometer_driven: 28000,
  car_city: 'Dubai',
  car_owner_phone_number: '+971501234567',
  vin_number: 'JTEBU5JR2K5678901',
  images: [{ url: 'https://local.test/car.jpg', image_url: 'https://local.test/car.jpg', display_url: 'https://local.test/car.jpg' }],
};

const metrics = {
  repeat_return_rate: 24.5,
  avg_time_on_site_seconds: 142,
  avg_pages_per_session: 3.4,
  conversion_rate_percent: 4.8,
  total_listings: 42,
  total_users: 18,
  total_leads: 31,
  daily_activity: [{ date: '2026-09-07', visits: 22, leads: 4 }],
  listings_by_type: { cars: 20, parts: 10, plates: 7, bikes: 5 },
};

const dealerMetrics = {
  kpis: { tiles: {
    active_listings: { value: 8, delta: 4.2 }, impressions: { value: 1200, delta: 7.1 },
    detail_views: { value: 340, delta: 3.0 }, leads: { value: 26, delta: 8.8 },
    lead_conversion_pct: { value: 7.6, delta: 1.1 }, sold_on_platform: { value: 2, delta: 0 },
  } },
  trends: { daily: [{ date: '2026-09-07', impressions: 80, leads: 3 }], leads_by_source: { phone: 10, whatsapp: 16 } },
  funnel: { steps: [{ label: 'Impressions', value: 1200 }, { label: 'Detail views', value: 340 }, { label: 'Leads', value: 26 }] },
  top: { top_by_impressions: [{ listing_id: 'local-car-1', listing_type: 'car', impressions: 500 }], top_by_conversion: [] },
  under: { worst_by_impressions: [], views_no_leads: [] },
};

const dealerListing = {
  ...baseCar,
  listing_type: 'car',
  status: 'approved',
  sold_status: 'available',
  view_count: 37,
  created_at: '2026-09-07T10:00:00.000Z',
};

const dealerMarket = {
  snapshot: {
    p25: 208000,
    median: 220000,
    p75: 236000,
    percentile_rank: 0.58,
    median_days_on_market: 19,
  },
  comp_count: 8,
};

const marketTracker = {
  cohort: { make: 'Toyota', model: 'Camry', year: 2019 },
  average_price: 68500,
  median_price: 67000,
  min_price: 52000,
  max_price: 84000,
  listing_count: 4,
  min_sample_size: 5,
  sample_quality: 'limited',
  history: [{ snapshot_date: '2026-09-10', average_price: 68000, median_price: 66500, listing_count: 4 }],
};

/**
 * Install an in-memory API contract simulator for one browser page.
 * It only matches localhost/test API traffic during this Playwright project.
 */
async function installLocalSimulation(page) {
  const state = {
    currentRole: null,
    created: [],
    events: [],
    verified: new Set(),
    dealerApplicationStatus: 'draft',
    dealerDocuments: [
      { id: 'local-doc-license', document_type: 'trade_license', status: 'approved', uploaded_at: '2026-09-01T10:00:00.000Z', expires_at: '2027-09-01' },
      { id: 'local-doc-trn', document_type: 'tax_registration', status: 'approved', uploaded_at: '2026-09-01T10:00:00.000Z' },
    ],
    dealerProfile: { name: 'Local Motors Simulation', legal_name: 'Local Motors Simulation LLC', phone: '+971501234568', whatsapp: '+971501234568', website: 'https://local.test', bio: 'Synthetic dealership for browser contract tests.' },
    dealerWebhooks: [],
    dealerApiSources: [],
    dealerLeads: [{
      id: 'local-lead-1', source: 'whatsapp', status: 'new', event_count: 2,
      listing_id: listingByType.car.id, listing_type: 'car', last_event_at: '2026-09-10T10:00:00.000Z',
    }],
    dealerMembers: [{ id: 'local-member-1', user_id: users.dealer.id, role: 'owner', status: 'active', joined_at: '2026-08-01T10:00:00.000Z', user: users.dealer }],
    dealershipStatus: 'active',
    dealerApplicants: [{
      id: 'local-applicant-1', first_name: 'Synthetic', last_name: 'Applicant', company_name: 'Synthetic Motors',
      email: 'applicant@example.test', city: 'Dubai', emirate: 'Dubai', dealer_verified: false,
      readiness: {
        required_documents: ['trade_license', 'tax_registration'],
        document_labels: { trade_license: 'Trade license', tax_registration: 'Tax registration (TRN)' },
        approved_documents: ['trade_license', 'tax_registration'], pending_documents: [], denied_documents: [], ready_to_approve: true,
      },
    }],
  };

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.includes('/storage/v1/')) {
      return response(route, { Key: 'local/simulated-upload.jpg' });
    }
    if (!path.startsWith('/api/')) return route.continue();

    if (path === '/api/config/google-signin') return response(route, { enabled: false });
    if (path === '/api/analytics/events' && method === 'POST') return response(route, {}, 202);
    if (path === '/api/recommendations' && method === 'POST') return response(route, { recommendations: [] });
    if (path === '/api/auth/check-username' && method === 'GET') return response(route, { available: true, message: 'Username available' });
    if (path === '/api/auth/signup' && method === 'POST') {
      const payload = await readJson(request);
      state.signupPayload = payload;
      state.currentRole = payload.isDealer ? 'dealer' : 'user';
      return response(route, {
        access_token: tokenForRole(state.currentRole), refresh_token: `local-${state.currentRole}-refresh`, user: users[state.currentRole],
        phone_verification: { verification_id: 'local-signup-verification-1', phone: payload.phone, status: 'pending' },
      }, 201);
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const payload = await readJson(request);
      const role = Object.keys(LOCAL_E2E_CREDENTIALS).find((key) => (
        LOCAL_E2E_CREDENTIALS[key].email === payload.email && LOCAL_E2E_CREDENTIALS[key].password === payload.password
      ));
      if (!role) return response(route, { message: 'Invalid local simulation credentials' }, 401);
      state.currentRole = role;
      return response(route, { access_token: tokenForRole(role), refresh_token: `local-${role}-refresh`, user: users[role] });
    }
    if (path === '/api/auth/me') {
      const user = userForToken(request) || (state.currentRole ? users[state.currentRole] : null);
      return user ? response(route, { ...user, dealer_application_status: user.is_dealer ? state.dealerApplicationStatus : undefined }) : response(route, { message: 'Unauthorized' }, 401);
    }
    if (path === '/api/auth/logout') { state.currentRole = null; return response(route, {}); }
    if (path === '/api/auth/admin-check') {
      const user = userForToken(request) || (state.currentRole ? users[state.currentRole] : null);
      return user?.is_admin ? response(route, { is_admin: true, is_super_admin: true }) : response(route, { is_admin: false, is_super_admin: false }, 403);
    }
    if (path === '/api/auth/dealer-submit-application' && method === 'POST') {
      state.dealerApplicationStatus = 'submitted';
      return response(route, { status: state.dealerApplicationStatus });
    }
    if (path === '/api/dealer/me') {
      return response(route, {
        dealership: { id: 'local-dealership-1', ...state.dealerProfile, status: state.dealershipStatus },
        role: 'owner', actor_kind: 'member',
      });
    }

    if (path === '/api/user/dealer-documents') {
      if (method === 'POST') {
        const body = request.postData() || '';
        const match = body.match(/name="document_type"\r?\n\r?\n([^\r\n]+)/);
        const documentType = match?.[1] || 'trade_license';
        const existing = state.dealerDocuments.find((doc) => doc.document_type === documentType);
        if (existing) existing.status = 'pending';
        else state.dealerDocuments.push({ id: `local-doc-${documentType}`, document_type: documentType, status: 'pending', uploaded_at: new Date().toISOString() });
        return response(route, { ok: true });
      }
      return response(route, {
        documents: state.dealerDocuments,
        readiness: {
          application_status: state.dealerApplicationStatus,
          required_documents: ['trade_license', 'tax_registration'],
          document_labels: { trade_license: 'Trade license', tax_registration: 'Tax registration (TRN)' },
          missing_uploads: state.dealerDocuments.length >= 2 ? [] : ['trade_license', 'tax_registration'],
        },
      });
    }
    if (path === '/api/dealer/profile' && method === 'PATCH') {
      Object.assign(state.dealerProfile, await readJson(request));
      return response(route, { dealership: { id: 'local-dealership-1', ...state.dealerProfile, status: state.dealershipStatus } });
    }

    if (path === '/api/storage/signed-upload-url' && method === 'POST') {
      return response(route, { token: 'local-upload-token', path: 'local/simulated-upload.jpg', public_url: 'https://local.test/simulated-upload.jpg' });
    }
    if (path === '/api/listings/counts') return response(route, { cars: 1, parts: 1, plates: 1, bikes: 1, total: 4 });
    if (/^\/api\/cars\/[^/]+\/?$/.test(path) && method === 'GET') {
      const viewer = userForToken(request);
      if (viewer) return response(route, baseCar);
      const { vin_number, ...publicCar } = baseCar;
      return response(route, { ...publicCar, vin_available: true });
    }
    if (path === '/api/cars' || path === '/api/parts' || path === '/api/plates' || path === '/api/bikes') {
      if (method === 'POST') {
        const type = path.split('/').pop().replace(/s$/, '').replace('part', 'part');
        const item = listingByType[type] || listingByType.car;
        const created = { ...item, id: `local-created-${state.created.length + 1}` };
        state.created.push({ type, item: created, payload: await readJson(request) });
        return response(route, { id: created.id, listing: created, data: created }, 201);
      }
      return response(route, { data: Object.values(listingByType), listings: Object.values(listingByType) });
    }
    if (/^\/api\/(cars|parts|plates|bikes)\/[^/]+$/.test(path) && ['DELETE', 'PATCH', 'PUT', 'POST'].includes(method)) {
      return method === 'DELETE' ? response(route, {}, 204) : response(route, { ok: true });
    }
    if (path.includes('/lead-events')) {
      state.events.push({ path, payload: await readJson(request) });
      return response(route, { ok: true });
    }
    if (path.includes('/api/phone-verifications/start') && method === 'POST') {
      return response(route, { phone_verification: { verification_id: 'local-verification-1', masked_phone: '***4567', status: 'pending' } });
    }
    if (path.includes('/api/phone-verifications/verify') && !path.includes('verify-token') && method === 'POST') {
      state.verified.add('local-verification-1');
      return response(route, { verified: true, phone_verified: true });
    }
    if (path === '/api/phone-verifications/verify-token') return response(route, { verified: true, phone_verified: true });

    if (path === '/api/dealer/listings') return response(route, { listings: [dealerListing] });
    if (path === '/api/dealer/listing-limit') return response(route, { limit: 10, used: 8, remaining: 2, can_request: true });
    if (path === '/api/dealer/members') return response(route, { members: state.dealerMembers });
    if (path === '/api/dealer/leads' && method === 'GET') return response(route, { leads: state.dealerLeads, total: state.dealerLeads.length });
    if (/^\/api\/dealer\/leads\/[^/]+$/.test(path) && method === 'GET') {
      const lead = state.dealerLeads.find((item) => path.endsWith(item.id)) || state.dealerLeads[0];
      return response(route, {
        lead,
        listing: { id: listingByType.car.id, type: 'car', title: baseCar.listing_title, price: baseCar.expected_selling_price },
        timeline: [{ id: 'local-timeline-1', kind: 'inbound_contact', payload: { source: lead.source }, created_at: lead.last_event_at }],
        session: [],
      });
    }
    if (/^\/api\/dealer\/leads\/[^/]+$/.test(path) && method === 'PATCH') {
      const payload = await readJson(request);
      const lead = state.dealerLeads.find((item) => path.endsWith(item.id));
      if (lead) Object.assign(lead, payload);
      return response(route, { ok: true });
    }
    if (/^\/api\/dealer\/leads\/[^/]+\/note$/.test(path) && method === 'POST') return response(route, { ok: true });

    if (/^\/api\/dealer\/listings\/[^/]+\/[^/]+\/analytics$/.test(path)) return response(route, {
      tiles: { impressions: 42, detail_views: 18, call_clicks: 1, whatsapp_clicks: 1, vin_reveals: 0, engagement_no_contact: 12, conversion_pct: 4.8 },
      series: [{ date: '2026-09-10', impressions: 42, detail_views: 18, leads: 2 }],
    });
    if (/^\/api\/dealer\/listings\/[^/]+\/[^/]+\/diagnostic$/.test(path)) return response(route, {
      verdict: 'performing_par', cohort_meta: { comp_count: 8, median_price: 220000, p25_price: 208000, p75_price: 236000 }, findings: [],
    });
    if (/^\/api\/dealer\/listings\/[^/]+\/[^/]+\/market$/.test(path)) return response(route, dealerMarket);

    if (path === '/api/dealer/webhooks' && method === 'GET') return response(route, { webhooks: state.dealerWebhooks });
    if (path === '/api/dealer/webhooks' && method === 'POST') {
      const payload = await readJson(request);
      const webhook = { id: `local-webhook-${state.dealerWebhooks.length + 1}`, ...payload, enabled: true };
      state.dealerWebhooks.push(webhook);
      return response(route, webhook, 201);
    }
    if (path === '/api/dealer/webhooks/deliveries' && method === 'GET') return response(route, { deliveries: [] });
    if (/^\/api\/dealer\/webhooks\/[^/]+\/test$/.test(path) && method === 'POST') return response(route, { status_code: 200, signature: 'local-signature' });
    if (/^\/api\/dealer\/webhooks\/[^/]+$/.test(path) && method === 'PATCH') {
      const payload = await readJson(request);
      const webhook = state.dealerWebhooks.find((item) => path.endsWith(item.id));
      if (webhook) Object.assign(webhook, payload);
      return response(route, webhook || {});
    }
    if (/^\/api\/dealer\/webhooks\/[^/]+$/.test(path) && method === 'DELETE') {
      state.dealerWebhooks = state.dealerWebhooks.filter((item) => !path.endsWith(item.id));
      return response(route, {}, 204);
    }

    if (path === '/api/dealer/api-sources' && method === 'GET') return response(route, { sources: state.dealerApiSources });
    if (path === '/api/dealer/api-sources' && method === 'POST') {
      const payload = await readJson(request);
      const source = { id: `local-source-${state.dealerApiSources.length + 1}`, ...payload, enabled: true, last_status: null };
      state.dealerApiSources.push(source);
      return response(route, source, 201);
    }
    if (/^\/api\/dealer\/api-sources\/[^/]+\/test$/.test(path) && method === 'POST') return response(route, { rows_seen: 2, rows_valid: 2 });
    if (/^\/api\/dealer\/api-sources\/[^/]+$/.test(path) && method === 'PATCH') {
      const payload = await readJson(request);
      const source = state.dealerApiSources.find((item) => path.endsWith(item.id));
      if (source) Object.assign(source, payload);
      return response(route, source || {});
    }
    if (/^\/api\/dealer\/api-sources\/[^/]+$/.test(path) && method === 'DELETE') {
      state.dealerApiSources = state.dealerApiSources.filter((item) => !path.endsWith(item.id));
      return response(route, {}, 204);
    }

    if (path.startsWith('/api/dealer/analytics/')) {
      if (path.includes('/kpis')) return response(route, dealerMetrics.kpis);
      if (path.includes('/trends')) return response(route, dealerMetrics.trends);
      if (path.includes('/funnel')) return response(route, dealerMetrics.funnel);
      if (path.includes('/top-performers')) return response(route, dealerMetrics.top);
      if (path.includes('/underperformers')) return response(route, dealerMetrics.under);
    }
    if (path === '/api/admin/metrics/overview') {
      return response(route, url.searchParams.has('market_make') ? { ...metrics, market_tracker: marketTracker } : metrics);
    }
    if (path === '/api/admin/dealers' && method === 'GET') return response(route, state.dealerApplicants);
    if (/^\/api\/admin\/dealers\/[^/]+\/verify$/.test(path) && method === 'POST') {
      const dealer = state.dealerApplicants.find((item) => path.includes(`/${item.id}/verify`));
      if (dealer) dealer.dealer_verified = true;
      return response(route, { ok: true });
    }
    if (/^\/api\/admin\/dealers\/[^/]+\/reject$/.test(path) && method === 'POST') return response(route, { ok: true });
    if (path === '/api/admin/dealer/listing-upgrade-requests' && method === 'GET') return response(route, []);
    if (path === '/api/admin/dealerships/local-dealership-1' && method === 'GET') return response(route, {
      dealership: { id: 'local-dealership-1', ...state.dealerProfile, name: state.dealerProfile.name, slug: 'local-motors-simulation', status: state.dealershipStatus, members: state.dealerMembers },
    });
    if (/^\/api\/admin\/dealerships\/local-dealership-1\/(suspend|restore)$/.test(path) && method === 'POST') {
      state.dealershipStatus = path.endsWith('/suspend') ? 'suspended' : 'active';
      return response(route, { ok: true });
    }
    if (path === '/api/admin/metrics/email') return response(route, { sent: 12, delivered: 11, bounced: 1, failed: 0 });
    if (path === '/api/admin/metrics/errors') return response(route, { total: 0, recent: [] });
    if (path === '/api/admin/health') return response(route, { status: 'healthy', services: { database: 'healthy', storage: 'healthy' } });

    if (path.startsWith('/api/')) return response(route, {});
    return route.continue();
  });

  return state;
}

async function signInWithLocalUser(page, role = 'user') {
  const credentials = LOCAL_E2E_CREDENTIALS[role];
  await page.goto('/login');
  await page.getByLabel('Email or Username').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
}

module.exports = { installLocalSimulation, signInWithLocalUser, LOCAL_E2E_CREDENTIALS };
