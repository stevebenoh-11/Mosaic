import { expect, test } from '@playwright/test';
import { getState } from './helpers';

test.describe.configure({ mode: 'serial' });

test.skip(({ isMobile }) => !isMobile, 'mobile flows');

test('mobile shell: drawer, bottom toolbar, FAB note capture', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');

  // sidebar is a drawer
  await expect(page.getByLabel('Open boards menu')).toBeVisible();
  await page.getByLabel('Open boards menu').click();
  const drawer = page.locator('div.fixed aside'); // mobile drawer instance
  await expect(drawer.getByText('Boards', { exact: true })).toBeVisible();
  await drawer.getByText('Welcome').click();
  await page.waitForTimeout(300);

  // bottom toolbar exists
  await expect(page.getByLabel('Add Note')).toBeVisible();

  // quick capture FAB → note
  await page.getByLabel('Quick capture').click();
  await page.getByText('Note', { exact: true }).click();
  await page.waitForTimeout(500);
  const s = await getState(page);
  expect(s.editing).not.toBeNull();
  await page.keyboard.type('Captured on phone');
  // tap empty canvas to exit editing
  await page.touchscreen.tap(40, 700);
  await page.waitForTimeout(300);
  await expect(page.getByText('Captured on phone')).toBeVisible();
});

test('mobile touch: tap selects, one-finger pan on canvas', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  await page.waitForTimeout(500);

  // Fresh context per test: capture a note first via the FAB.
  await page.getByLabel('Quick capture').click();
  await page.getByText('Note', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.keyboard.type('Tap target');
  await page.touchscreen.tap(40, 700); // exit editing
  await page.waitForTimeout(400);

  // tap a card to select it (the wrapper owns pointer events, not the text)
  const s0 = await getState(page);
  const noteId = Object.values(s0.elements).find(
    (e) => JSON.stringify(e.content).includes('Tap target'),
  )!.id;
  await page.locator(`[data-element-id="${noteId}"]`).tap();
  await page.waitForTimeout(200);
  const s = await getState(page);
  expect(s.selection.length).toBe(1);

  // one-finger pan on empty canvas clears selection and moves viewport
  const vp0 = await page.evaluate(() => window.__mosaicStore.getState().viewport);
  const canvas = (await page.locator('[data-testid="canvas"]').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  // Empty area: top-left of the canvas (toolbar is bottom, FAB/zoom right).
  const sx = canvas.x + 60;
  const sy = canvas.y + 150;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: sx, y: sy, id: 1 }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: sx + i * 18, y: sy + i * 12, id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const vp1 = await page.evaluate(() => window.__mosaicStore.getState().viewport);
  expect(Math.abs(vp1.x - vp0.x)).toBeGreaterThan(50);
});
