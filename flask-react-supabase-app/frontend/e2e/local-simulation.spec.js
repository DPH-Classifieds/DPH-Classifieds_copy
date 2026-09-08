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

  test('admin metrics loads all tabs and health data', async ({ page }) => {
    await installLocalSimulation(page);
    await signInWithLocalUser(page, 'admin');
    await page.goto('/admin/metrics');
    await expect(page.getByRole('heading', { name: 'Platform metrics' })).toBeVisible();
    for (const tab of ['Acquisition', 'Conversion', 'Health', 'Email', 'Errors', 'Engagement']) {
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
