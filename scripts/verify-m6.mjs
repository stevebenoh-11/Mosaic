// M6 quick check on the dev server: graceful no-client-id state + clean console.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('screenshots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const failures = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${extra}`}`);
  if (!cond) failures.push(name);
};

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');

// no client id → sync disabled gracefully
await page.getByLabel('Account menu').click();
ok('no-client-id state explains setup',
  await page.getByText('Add a Google client ID to enable sync', { exact: false }).isVisible()
  || await page.getByText('VITE_GOOGLE_CLIENT_ID').isVisible());
ok('no sync pill when disconnected', (await page.getByTestId('sync-pill').count()) === 0);
ok('no onboarding card without client id',
  !(await page.getByText('Sync across your devices').isVisible()));
await page.screenshot({ path: 'screenshots/m6-desktop.png' });

const realErrors = errors.filter((e) => !/CORS|ERR_FAILED|Failed to load resource/.test(e));
ok('no console/page errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
