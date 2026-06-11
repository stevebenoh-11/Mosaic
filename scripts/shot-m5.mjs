import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

mkdirSync('screenshots', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(600);
await page.getByLabel('Quick capture').click();
await page.waitForTimeout(200);
await page.screenshot({ path: 'screenshots/m5-mobile-fab.png' });
await page.keyboard.press('Escape');
await page.getByLabel('Open boards menu').click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/m5-mobile-drawer.png' });
await browser.close();
console.log('done');
