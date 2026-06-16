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

test('mobile touch: dragging a card moves it (not pan)', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  await page.waitForTimeout(500);

  await page.getByLabel('Quick capture').click();
  await page.getByText('Note', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.keyboard.type('Drag me');
  await page.touchscreen.tap(40, 700); // exit editing
  await page.waitForTimeout(400);

  const s0 = await getState(page);
  const note = Object.values(s0.elements).find(
    (e) => JSON.stringify(e.content).includes('Drag me'),
  )!;
  const id = note.id;
  const x0 = note.x;
  const y0 = note.y;
  const vp0 = await page.evaluate(() => window.__mosaicStore.getState().viewport);

  // Touch-drag from the centre of the card itself.
  const box = (await page.locator(`[data-element-id="${id}"]`).boundingBox())!;
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: sx, y: sy, id: 1 }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: sx + i * 12, y: sy + i * 9, id: 1 }],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);

  // The card moved…
  const moved = (await getState(page)).elements[id];
  expect(Math.abs(moved.x - x0) + Math.abs(moved.y - y0)).toBeGreaterThan(30);
  // …and the canvas did NOT pan.
  const vp1 = await page.evaluate(() => window.__mosaicStore.getState().viewport);
  expect(Math.abs(vp1.x - vp0.x)).toBeLessThan(5);
});
