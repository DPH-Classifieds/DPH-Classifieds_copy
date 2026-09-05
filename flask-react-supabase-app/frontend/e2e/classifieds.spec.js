const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

const credentials = {
  email: process.env.E2E_USER_EMAIL,
  password: process.env.E2E_USER_PASSWORD,
};
const adminCredentials = {
  email: process.env.E2E_ADMIN_EMAIL,
  password: process.env.E2E_ADMIN_PASSWORD,
};
const dealerCredentials = {
  email: process.env.E2E_DEALER_EMAIL,
  password: process.env.E2E_DEALER_PASSWORD,
};
const mutationsEnabled = process.env.E2E_ALLOW_MUTATIONS === 'true';
const strictAuthenticated = process.env.E2E_STRICT_AUTH === 'true';

function requireCredential(value, name) {
  if (value) return;
  if (strictAuthenticated) {
    throw new Error(`Missing required ${name} for strict authenticated E2E`);
  }
  test.skip(true, `set ${name}`);
}

const publicRoutes = [
  '/', '/cars', '/car-parts', '/plates', '/bikes', '/explore',
  '/login', '/signup', '/forgot-password', '/about', '/contact',
  '/privacy-policy', '/terms-of-use',
];

async function assertResponsiveScroll(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.scrollTo(0, 0));
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.scrollHeight,
  }));
  expect(layout.scrollWidth, `horizontal overflow at ${layout.viewport}px`).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.scrollHeight).toBeGreaterThanOrEqual(layout.bodyHeight);
}

async function login(page, user = credentials) {
  await page.goto('/login');
  await page.getByLabel('Email or Username').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
  if (page.url().includes('/verify-phone')) {
    throw new Error('The supplied E2E account is not phone-verified; provide a verified test account or E2E phone handling.');
  }
}

test.describe('public responsive surfaces', () => {
  for (const route of publicRoutes) {
    test(`${route} renders and scrolls without horizontal overflow`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('#root')).not.toBeEmpty();
      await expect(page.locator('body')).not.toContainText('ChunkLoadError');
      await expect(page.locator('body')).not.toContainText('Something went wrong');
      await assertResponsiveScroll(page);
    });
  }
});

test('login client validation is visible and does not submit an empty form', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign In' }).click();
  expect(await page.getByLabel('Email or Username').evaluate((element) => !element.checkValidity())).toBeTruthy();
});

test('signup client validation is visible before network submission', async ({ page }) => {
  await page.goto('/signup');
  await page.getByRole('button', { name: /create account|sign up|register/i }).click();
  expect(await page.locator('input[required]').first().evaluate((element) => !element.checkValidity())).toBeTruthy();
});

test.describe('authenticated listing flows', () => {
  test.beforeEach(async ({ page }) => {
    requireCredential(credentials.email, 'E2E_USER_EMAIL');
    requireCredential(credentials.password, 'E2E_USER_PASSWORD');
    await login(page);
  });

  for (const [route, heading] of [
    ['/post-car', /submit your listing|publish/i],
    ['/post-car-parts', /list parts/i],
    ['/post-plate', /present your plate/i],
    ['/post-bike', /publish a bike/i],
  ]) {
    test(`${route} is reachable after login`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await assertResponsiveScroll(page);
    });
  }

  test('car form exposes VIN validation feedback', async ({ page }) => {
    await page.goto('/post-car');
    const vin = page.locator('#vin_number');
    await vin.fill('INVALIDVIN1234567');
    await expect(page.locator('body')).toContainText(/VIN appears invalid|VIN validation/i);
  });

  test('listing mutation contracts can be run against the real backend', async ({ page }) => {
    if (!mutationsEnabled) {
      test.skip(true, 'set E2E_ALLOW_MUTATIONS=true only for disposable test accounts/data');
    }
    requireCredential(process.env.E2E_MUTATION_FIXTURE, 'E2E_MUTATION_FIXTURE');
    const fixture = JSON.parse(fs.readFileSync(process.env.E2E_MUTATION_FIXTURE, 'utf8'));
    const token = await page.evaluate(() => {
      const direct = sessionStorage.getItem('supabase_access_token');
      if (direct) return direct;
      try { return JSON.parse(sessionStorage.getItem('authData') || '{}').access_token || ''; } catch { return ''; }
    });
    expect(token, 'login did not produce a browser access token').toBeTruthy();

    const created = [];
    for (const [type, payload] of Object.entries(fixture)) {
      const endpoint = { car: 'cars', bike: 'bikes', plate: 'plates', part: 'parts' }[type];
      expect(endpoint, `unsupported mutation fixture type: ${type}`).toBeTruthy();
      const response = await page.request.post(`${process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:8000'}/api/${endpoint}`, {
        data: payload,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.ok(), `${type} POST returned ${response.status()}`).toBeTruthy();
      const body = await response.json();
      const id = body.id || body.listing?.id || body.data?.id;
      expect(id, `${type} response did not return a listing id`).toBeTruthy();
      created.push({ endpoint, id });
    }

    for (const { endpoint, id } of created) {
      const response = await page.request.delete(`${process.env.PLAYWRIGHT_API_URL || 'http://127.0.0.1:8000'}/api/${endpoint}/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect([200, 204, 404]).toContain(response.status());
    }
  });
});

test.describe('VIN, dealer, and admin flows', () => {
  test('VIN detail route is reachable when a fixture listing id is supplied', async ({ page }) => {
    requireCredential(process.env.E2E_CAR_ID, 'E2E_CAR_ID');
    await page.goto(`/cars/${encodeURIComponent(process.env.E2E_CAR_ID)}`);
    await expect(page.locator('body')).not.toContainText('ChunkLoadError');
    await assertResponsiveScroll(page);
  });

  test('dealer suite is reachable for a dealer account', async ({ page }) => {
    requireCredential(dealerCredentials.email, 'E2E_DEALER_EMAIL');
    requireCredential(dealerCredentials.password, 'E2E_DEALER_PASSWORD');
    await login(page, dealerCredentials);
    await page.goto('/dealer/dashboard');
    await expect(page.getByRole('heading', { name: /dashboard/i }).first()).toBeVisible();
    await assertResponsiveScroll(page);
  });

  test('dealer signup surface is reachable', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('body')).toContainText(/create account|dealer/i);
  });

  test('admin metrics is reachable for an admin account', async ({ page }) => {
    requireCredential(adminCredentials.email, 'E2E_ADMIN_EMAIL');
    requireCredential(adminCredentials.password, 'E2E_ADMIN_PASSWORD');
    await login(page, adminCredentials);
    await page.goto('/admin/metrics');
    await expect(page.getByRole('heading', { name: /platform metrics|metrics unavailable/i }).first()).toBeVisible();
    await assertResponsiveScroll(page);
  });
});
