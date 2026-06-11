// M0 verification: loads the app at desktop + mobile viewports, checks the
// checklist items, and saves screenshots. Run with the dev server up.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch();
const failures = [];
const ok = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures.push(name);
};

// ---------- Desktop ----------
const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
desktop.on('pageerror', (e) => errors.push(String(e)));
desktop.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await desktop.goto(BASE, { waitUntil: 'networkidle' });
await desktop.waitForSelector('[data-testid="canvas"]', { timeout: 10000 });

ok('welcome board loads (URL is /b/:id)', desktop.url().includes('/b/'));
ok('sidebar renders with Welcome board', await desktop.locator('aside').getByText('Welcome').isVisible());
ok('breadcrumbs render', await desktop.locator('nav[aria-label="Breadcrumbs"]').getByText('Welcome').isVisible());
ok('welcome note visible on canvas', await desktop.getByText('This is your first board').isVisible());
ok('save indicator shows saved', await desktop.getByText('All changes saved').isVisible());

// PWA basics
const manifestHref = await desktop.locator('link[rel="manifest"]').getAttribute('href');
ok('manifest link present', !!manifestHref);
const manifest = await desktop.evaluate(async (href) => {
  const r = await fetch(href);
  return r.ok ? r.json() : null;
}, manifestHref ?? '');
ok('manifest has name + icons (incl. maskable)',
  !!manifest && manifest.name?.includes('Mosaic') &&
  manifest.icons?.length >= 3 && manifest.icons.some((i) => i.purpose === 'maskable'));
const iconOk = await desktop.evaluate(async () => (await fetch('/icons/icon-512.png')).ok);
ok('512px icon served', iconOk);
const swReady = await desktop.evaluate(async () => {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((res) => setTimeout(() => res(null), 8000)),
  ]);
  return !!reg;
});
ok('service worker registered', swReady);

// deviceId persisted + survives reload; data persists
const deviceId1 = await desktop.evaluate(async () => {
  return new Promise((resolve) => {
    const req = indexedDB.open('mosaic');
    req.onsuccess = () => {
      const dbx = req.result;
      const tx = dbx.transaction('meta', 'readonly');
      const get = tx.objectStore('meta').get('deviceId');
      get.onsuccess = () => resolve(get.result?.value ?? null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
});
ok('deviceId persisted', typeof deviceId1 === 'string' && deviceId1.length > 10);

await desktop.reload({ waitUntil: 'networkidle' });
await desktop.waitForSelector('[data-testid="canvas"]');
ok('data survives reload (welcome note still there)', await desktop.getByText('This is your first board').isVisible());
const deviceId2 = await desktop.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('mosaic');
  req.onsuccess = () => {
    const dbx = req.result;
    const get = dbx.transaction('meta', 'readonly').objectStore('meta').get('deviceId');
    get.onsuccess = () => resolve(get.result?.value ?? null);
    get.onerror = () => resolve(null);
  };
}));
ok('deviceId stable across reload', deviceId1 === deviceId2);

// Account menu placeholder
await desktop.getByLabel('Account menu').click();
ok('account menu opens', await desktop.getByText('Not connected').isVisible());
await desktop.keyboard.press('Escape');

await desktop.screenshot({ path: 'screenshots/m0-desktop.png' });

// ---------- Mobile ----------
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await mobile.waitForSelector('[data-testid="canvas"]', { timeout: 10000 });
ok('mobile: canvas renders', await mobile.getByText('This is your first board').isVisible());
ok('mobile: breadcrumbs render', await mobile.locator('nav[aria-label="Breadcrumbs"]').isVisible());
await mobile.screenshot({ path: 'screenshots/m0-mobile.png' });

ok('no console/page errors (desktop)', errors.length === 0);
if (errors.length) console.log('errors:', errors.slice(0, 5));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
