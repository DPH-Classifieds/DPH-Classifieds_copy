const { test, expect } = require('@playwright/test');
const { installLocalSimulation, signInWithLocalUser } = require('./localSimulation');

const viewports = [
  ['desktop', { width: 1440, height: 900 }],
  ['tablet', { width: 1024, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
];

async function assertScroll(page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(80);
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

test.describe('local simulated authenticated feature contracts', () => {
  test('synthetic user credentials complete the real login flow and protected posting screens', async ({ page }) => {
    await installLocalSimulation(page);
    await signInWithLocalUser(page);
    for (const [route, heading] of [
      ['/post-car', /list your vehicle/i],
      ['/post-car-parts', /list parts/i],
      ['/post-plate', /present your plate/i],
      ['/post-bike', /publish a bike/i],
    ]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
      await assertScroll(page);
    }
  });

  test('car, part, plate, and bike posting contracts create and clean up disposable records', async ({ page }) => {
    const state = await installLocalSimulation(page);
    await signInWithLocalUser(page);
    const token = await page.evaluate(() => sessionStorage.getItem('supabase_access_token'));
    expect(token).toBeTruthy();

    const payloads = {
      car: { car_manufacturer: 'Toyota', car_model: 'Land Cruiser', make_year: 2022, images: [{ url: 'https://local.test/car.jpg' }] },
      part: { name: 'Local simulation part', part_type: 'Engine', price: 850, images: [{ url: 'https://local.test/part.jpg' }] },
      plate: { city: 'Dubai', code: '7', number: '12345', digits: 5, price: 15000, proof_document_url: 'local/proof.pdf' },
      bike: { bike_brand: 'Yamaha', bike_model: 'MT-09', year: 2024, price: 25000, images: [{ url: 'https://local.test/bike.jpg' }] },
    };
    const created = [];
    for (const [type, payload] of Object.entries(payloads)) {
      const endpoint = { car: 'cars', part: 'parts', plate: 'plates', bike: 'bikes' }[type];
      const result = await page.evaluate(async ({ endpoint, payload, token }) => {
        const response = await fetch(`/api/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        return { status: response.status, body: await response.json() };
      }, { endpoint, payload, token });
      expect(result.status).toBe(201);
      const body = result.body;
      expect(body.id).toMatch(/^local-created-/);
      created.push({ endpoint, id: body.id });
    }
    for (const item of created) {
      const status = await page.evaluate(async ({ endpoint, id, token }) => {
        const response = await fetch(`/api/${endpoint}/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        return response.status;
      }, { ...item, token });
      expect(status).toBe(204);
    }
    expect(state.created).toHaveLength(4);
  });

  test('VIN reveal records the open and reveal analytics events after phone verification', async ({ page }) => {
    const state = await installLocalSimulation(page);
    await signInWithLocalUser(page);
    await page.goto('/cars/2022-toyota-land-cruiser-dubai-local-ca');
    await expect(page.getByRole('heading', { name: /VIN \/ Chassis Number/i })).toBeVisible();
    await expect(page.locator('.cd-vin-value')).toContainText('8901');
    await page.locator('.cd-vin-value').click();
    await expect(page.locator('.cd-vin-value')).toContainText('JTEBU5JR2K5678901');
    await expect.poll(() => state.events.filter((event) => event.payload?.action === 'vin_open').length).toBe(1);
    await expect.poll(() => state.events.filter((event) => event.payload?.action === 'vin_reveal').length).toBe(1);
    await assertScroll(page);
  });

  test('dealer dashboard loads metrics and switches windows without breaking scroll', async ({ page }) => {
    await installLocalSimulation(page);
    await signInWithLocalUser(page, 'dealer');
    await page.goto('/dealer/dashboard');
    await expect(page.getByRole('heading', { name: /Local Motors Simulation/i })).toBeVisible();
    await expect(page.getByText('Active listings')).toBeVisible();
    await page.getByRole('button', { name: '7d' }).click();
    await page.getByRole('button', { name: '90d' }).click();
    await assertScroll(page);
  });

  test('normal user signup reaches phone verification with the submitted account contract', async ({ page }) => {
    const state = await installLocalSimulation(page);
    await page.goto('/signup');
    await page.locator('#firstName').fill('Synthetic');
    await page.locator('#lastName').fill('User');
    await page.locator('#username').fill('synthetic_user_2026');
    await page.locator('#email').fill('synthetic.user@example.test');
    await page.locator('#phone').fill('501234567');
    await page.locator('#password').fill('SyntheticUser!2026');
    await page.locator('#confirmPassword').fill('SyntheticUser!2026');
    await page.locator('input[name="acceptTerms"]').check();
    await page.locator('input[name="acceptPrivacy"]').check();
    await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page).toHaveURL(/\/verify-phone/);
    await expect(page.getByRole('heading', { name: 'Enter verification code' })).toBeVisible();
    expect(state.signupPayload).toMatchObject({
      email: 'synthetic.user@example.test', username: 'synthetic_user_2026', isDealer: false,
    });
  });

  test('dealer completes the settings application submission and multipart document flow', async ({ page }) => {
    const state = await installLocalSimulation(page);
    await signInWithLocalUser(page, 'dealer');
    await page.goto('/dealer/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Application: draft')).toBeVisible();

    await page.locator('#dealer-doc-date-trade_license').fill('2027-09-01');
    await page.locator('#dealer-doc-trade_license').setInputFiles({
      name: 'trade-license.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-local-simulation%'),
    });
    await expect(page.getByText(/Uploaded\. PaddleOCR is verifying/i)).toBeVisible();
    await page.locator('#dealer-doc-tax_registration').setInputFiles({
      name: 'tax-registration.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-local-simulation%'),
    });
    await expect(page.getByText(/Uploaded\. PaddleOCR is verifying/i)).toBeVisible();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText(/Application submitted/i)).toBeVisible();
    expect(state.dealerApplicationStatus).toBe('submitted');
  });

  test('dealer runs the inventory, listing intelligence, lead, integration, and webhook flows', async ({ page }) => {
    const state = await installLocalSimulation(page);
    await signInWithLocalUser(page, 'dealer');

    await page.goto('/dealer/listings');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
    await expect(page.getByText('Current limit')).toBeVisible();
    await page.getByRole('button', { name: 'Analytics' }).click();
    await expect(page.locator('p').filter({ hasText: 'Impressions' }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Market position', exact: true }).click();
    await expect(page.getByText('Price position', { exact: true })).toBeVisible();

    await page.goto('/dealer/listings/car/local-car-1/diagnostic');
    await expect(page.getByRole('heading', { name: /Why isn't this listing selling/i })).toBeVisible();
    await expect(page.getByText(/Performing at par with the market/i)).toBeVisible();

    await page.goto('/dealer/leads');
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();
    await page.goto('/dealer/leads/local-lead-1');
    await expect(page.getByRole('heading', { name: /Lead · whatsapp/i })).toBeVisible();
    await page.locator('select').first().selectOption('contacted');
    await expect.poll(() => state.dealerLeads[0].status).toBe('contacted');
    await page.locator('textarea[placeholder="Add a note…"]').fill('Followed up from local browser simulation.');
    await page.getByRole('button', { name: 'Post' }).click();

    await page.goto('/dealer/webhooks');
    await expect(page.getByRole('heading', { name: 'Outbound webhooks' })).toBeVisible();
    await page.goto('/dealer/integrations');
    await expect(page.getByRole('heading', { name: 'API Integrations' })).toBeVisible();

    const token = await page.evaluate(() => sessionStorage.getItem('supabase_access_token'));
    const lifecycle = await page.evaluate(async (accessToken) => {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
      const webhook = await fetch('/api/dealer/webhooks', { method: 'POST', headers, body: JSON.stringify({ label: 'Local CRM', url: 'https://local.test/webhook', events: ['lead.created'] }) });
      const webhookBody = await webhook.json();
      const test = await fetch(`/api/dealer/webhooks/${webhookBody.id}/test`, { method: 'POST', headers, body: '{}' });
      const source = await fetch('/api/dealer/api-sources', { method: 'POST', headers, body: JSON.stringify({ label: 'Local DMS', adapter: 'generic_json', endpoint_url: 'https://local.test/inventory', auth_type: 'none', field_mapping: {} }) });
      const sourceBody = await source.json();
      const sourceTest = await fetch(`/api/dealer/api-sources/${sourceBody.id}/test`, { method: 'POST', headers, body: '{}' });
      return { webhookStatus: webhook.status, testStatus: test.status, sourceStatus: source.status, sourceTest: await sourceTest.json() };
    }, token);
    expect(lifecycle).toMatchObject({ webhookStatus: 201, testStatus: 200, sourceStatus: 201, sourceTest: { rows_valid: 2 } });
    expect(state.dealerWebhooks).toHaveLength(1);
    expect(state.dealerApiSources).toHaveLength(1);
  });

  test('super admin reviews a dealer application and tracks an exact vehicle market cohort', async ({ page }) => {
    const state = await installLocalSimulation(page);
    await signInWithLocalUser(page, 'admin');
    await page.goto('/admin/dealerships/hub');
    await expect(page.getByRole('heading', { name: 'Dealers' })).toBeVisible();
    await expect(page.getByText('Synthetic Motors')).toBeVisible();
    await page.getByTitle('Approve dealer').click();
    await expect.poll(() => state.dealerApplicants[0].dealer_verified).toBe(true);
    await page.getByRole('button', { name: 'Approved', exact: true }).click();
    await expect(page.getByText('Synthetic Motors')).toBeVisible();

    await page.goto('/admin/metrics');
    await page.getByRole('button', { name: 'Market tracker', exact: true }).click();
    await page.getByLabel('Make').fill('Toyota');
    await page.getByRole('textbox', { name: 'Model', exact: true }).fill('Camry');
    await page.getByRole('spinbutton', { name: 'Model year', exact: true }).fill('2019');
    await page.getByRole('button', { name: 'Track market' }).click();
    await expect(page.getByRole('heading', { name: /Toyota Camry · 2019/i })).toBeVisible();
    await expect(page.getByText('AED 68,500')).toBeVisible();
    await expect(page.getByText(/below the 5-listing reliability threshold/i)).toBeVisible();
    await assertScroll(page);
  });

  test('admin metrics loads all tabs and health data', async ({ page }) => {
    await installLocalSimulation(page);
    await signInWithLocalUser(page, 'admin');
    await page.goto('/admin/metrics');
    await expect(page.getByRole('heading', { name: 'Platform metrics' })).toBeVisible();
    for (const tab of ['Acquisition', 'Conversion', 'Market tracker', 'Health', 'Email', 'Errors', 'Engagement']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await expect(page.locator('body')).not.toContainText('ChunkLoadError');
    }
    await assertScroll(page);
  });

  test('phone verification simulation sends and verifies a disposable OTP', async ({ page }) => {
    await installLocalSimulation(page);
    await signInWithLocalUser(page);
    await page.goto('/verify-phone?phone=%2B971501234567&purpose=profile_verify&redirect=%2F');
    await page.getByRole('button', { name: /Send OTP to/i }).click();
    await expect(page.getByLabel('Verification digit 1')).toBeVisible();
    for (let index = 1; index <= 6; index += 1) {
      await page.getByLabel(`Verification digit ${index}`).fill(String(index));
    }
    await expect(page.getByText('Phone verified', { exact: true })).toBeVisible();
  });
});

for (const [name, viewport] of viewports) {
  test(`simulated user posting screens scroll at ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installLocalSimulation(page);
    await signInWithLocalUser(page);
    for (const route of ['/post-car', '/post-car-parts', '/post-plate', '/post-bike']) {
      await page.goto(route);
      await expect(page.locator('#root')).not.toBeEmpty();
      await assertScroll(page);
    }
  });
}
