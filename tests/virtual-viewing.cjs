// Run with: node tests/virtual-viewing.cjs (requires Playwright and Chromium).
// CAPTCHA and booking service are mocked ONLY in this isolated browser test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.DH_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.join(root, pathname.replace(/^\/DwellHunt\//, '') || 'index.html');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(body);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.DH_BROWSER ? { executablePath: process.env.DH_BROWSER } : {}) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    // Keep configured production services unreachable from this test.
    await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await page.route('**/viewing-config.js', route => route.fulfill({
      contentType: 'text/javascript',
      body: 'window.DWELLHUNT_VIEWING = { turnstileSiteKey: "", bookingUrl: "" };'
    }));
    await page.goto(origin + '/DwellHunt/');
    // Open an actual listing from the existing compiled application.
    await page.getByText('The Glass Pavilion: Contemporary Architectural Villa', { exact: true }).first().click();
    const button = page.getByRole('button', { name: 'Book Virtual Viewing', exact: true });
    await button.waitFor();
    const id = await button.getAttribute('data-dh-viewing-id');
    assert.equal(id, 'prop-cinnamon-gardens-villa');
    await button.click();
    await page.getByText('Virtual viewing booking is awaiting configuration.', { exact: false }).waitFor();
    assert(await page.locator('#dh-viewing [type=submit]').isDisabled());
    await page.getByRole('button', { name: 'Close booking form' }).click();
    const requests = [];
    let mode = 'network';
    await page.route('https://booking.example/webhook/dwellhunt-virtual-viewing', async route => {
      requests.push(route.request().postDataJSON());
      if (mode === 'network') return route.abort('failed');
      const data = mode === 'captcha' ? { ok: false, code: 'HUMAN_VERIFICATION_FAILED' }
        : mode === 'slot' ? { ok: true, booking_id: 'dh-test', status: 'reschedule_requested' }
        : { ok: true, booking_id: 'dh-test', status: 'pending_approval', duplicate: true };
      return route.fulfill({ status: mode === 'captcha' ? 403 : 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.evaluate(() => {
      window.DWELLHUNT_VIEWING = { turnstileSiteKey: 'isolated-test-fixture', bookingUrl: 'https://booking.example/webhook/dwellhunt-virtual-viewing' };
      window.turnstile = {
        render(host, opts) { window.testCaptcha = opts; return 'fixture'; },
        reset() {}, remove() {}
      };
    });
    await button.click();
    const form = page.locator('#dh-viewing form');
    for (const [name, value] of Object.entries({ customer_name: 'Test Buyer', email: 'test@example.com', whatsapp: '+94771234567', country: 'Sri Lanka', buyer_timezone: 'Asia/Colombo', preferred_date: '2026-11-15', preferred_time: '19:00' })) {
      await form.locator(`[name=${name}]`).fill(value);
    }
    await form.locator('[name=consent]').check();
    const send = async () => {
      const before = requests.length;
      await page.evaluate(() => window.testCaptcha.callback('fresh-fixture-token'));
      await form.locator('[type=submit]').click();
      await page.waitForFunction(() => !document.querySelector('#dh-viewing .dh-close').disabled);
      assert.equal(requests.length, before + 1);
    };
    await send();
    assert.match(await page.locator('#dh-viewing [role=status]').textContent(), /may have arrived/);
    assert.match(requests[0].idempotency_key, /^[A-Za-z0-9_-]{16,100}$/);
    assert.equal(requests[0].turnstile_token, 'fresh-fixture-token');
    assert.equal(requests[0].property_id, id);
    assert.equal(requests[0].property_title, 'The Glass Pavilion: Contemporary Architectural Villa');
    assert.equal(requests[0].consent, true);
    assert(!('utc_offset_minutes' in requests[0]));
    mode = 'captcha'; await send();
    assert.equal(requests[0].idempotency_key, requests[1].idempotency_key);
    assert.match(await page.locator('#dh-viewing [role=status]').textContent(), /Verification was rejected/);
    await form.locator('[name=preferred_time]').fill('20:00');
    mode = 'slot'; await send();
    assert.notEqual(requests[0].idempotency_key, requests[2].idempotency_key);
    assert.match(await page.locator('#dh-viewing [role=status]').textContent(), /slot is unavailable/);
    mode = 'success'; await send();
    assert.equal(requests[2].idempotency_key, requests[3].idempotency_key);
    assert.match(await page.locator('#dh-viewing [role=status]').textContent(), /earlier request was found/);
    assert(await form.locator('[type=submit]').isDisabled());
    await page.keyboard.press('Escape');
    assert(await button.evaluate(el => document.activeElement === el));
    await page.setViewportSize({ width: 375, height: 812 });
    await button.click();
    const bounds = await page.locator('#dh-viewing').boundingBox();
    assert(bounds.width <= 375 && bounds.height <= 812);
    assert.equal(await page.evaluate(() => window.testCaptcha.action), 'booking');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    console.log('PASS real listing hook, subpath assets, fail-closed config, payload, secure key, retry, CAPTCHA rejection, unavailable slot, duplicate response, focus restoration, mobile bounds, no runtime errors. Mock integrations only.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
