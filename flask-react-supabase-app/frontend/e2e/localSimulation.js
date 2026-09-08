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
  const role = ['user', 'dealer', 'admin'].find((candidate) => auth.startsWith(`Bearer local.${candidate}.`));
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

/**
 * Install an in-memory API contract simulator for one browser page.
 * It only matches localhost/test API traffic during this Playwright project.
 */
async function installLocalSimulation(page) {
  const state = { currentRole: null, created: [], events: [], verified: new Set() };

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
      return user ? response(route, user) : response(route, { message: 'Unauthorized' }, 401);
    }
    if (path === '/api/auth/logout') { state.currentRole = null; return response(route, {}); }
    if (path === '/api/auth/admin-check') {
      return response(route, { is_admin: true, is_super_admin: true });
    }
    if (path === '/api/dealer/me') {
      return response(route, {
        dealership: { id: 'local-dealership-1', name: 'Local Motors Simulation', status: 'verified' },
        role: 'owner', actor_kind: 'member',
      });
    }

    if (path === '/api/storage/signed-upload-url' && method === 'POST') {
      return response(route, { token: 'local-upload-token', path: 'local/simulated-upload.jpg', public_url: 'https://local.test/simulated-upload.jpg' });
    }
    if (path === '/api/listings/counts') return response(route, { cars: 1, parts: 1, plates: 1, bikes: 1, total: 4 });
    if (/^\/api\/cars\/[^/]+\/?$/.test(path) && method === 'GET') return response(route, baseCar);
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

    if (path.startsWith('/api/dealer/analytics/')) {
      if (path.includes('/kpis')) return response(route, dealerMetrics.kpis);
      if (path.includes('/trends')) return response(route, dealerMetrics.trends);
      if (path.includes('/funnel')) return response(route, dealerMetrics.funnel);
      if (path.includes('/top-performers')) return response(route, dealerMetrics.top);
      if (path.includes('/underperformers')) return response(route, dealerMetrics.under);
    }
    if (path === '/api/admin/metrics/overview') return response(route, metrics);
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
