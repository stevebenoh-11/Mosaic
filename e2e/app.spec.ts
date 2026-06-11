import { expect, test } from '@playwright/test';
import {
  boardElements,
  center,
  drag,
  getState,
  newBoard,
  waitSaved,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test.skip(({ isMobile }) => isMobile, 'desktop flows');

test('note lifecycle: create, edit, move, undo, persist', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  await newBoard(page, 'E2E Desktop');

  // create + type
  await page.mouse.dblclick(700, 400);
  await page.waitForTimeout(250);
  let s = await getState(page);
  expect(s.editing).not.toBeNull();
  const noteId = s.editing!;
  await page.keyboard.type('Note one');
  await page.keyboard.press('Escape');
  await expect(page.getByText('Note one')).toBeVisible();

  // move with undo
  const box = (await page.locator(`[data-element-id="${noteId}"]`).boundingBox())!;
  const before = (await getState(page)).elements[noteId]!;
  await page.mouse.click(center(box).x, center(box).y);
  await drag(page, center(box), { x: center(box).x + 180, y: center(box).y + 60 });
  let after = (await getState(page)).elements[noteId]!;
  expect(Math.abs(after.x - before.x - 180)).toBeLessThanOrEqual(10);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  after = (await getState(page)).elements[noteId]!;
  expect(after.x).toBe(before.x);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(150);

  // persistence
  await waitSaved(page);
  const snapshot = (await getState(page)).elements[noteId]!;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="canvas"]');
  await page.waitForTimeout(400);
  const restored = (await getState(page)).elements[noteId]!;
  expect(restored.x).toBe(snapshot.x);
  expect(restored.y).toBe(snapshot.y);
  await expect(page.getByText('Note one')).toBeVisible();
});

test('column stacking and reorder', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  await newBoard(page, 'E2E Columns');

  await page.getByLabel('Add Column').click();
  await page.waitForTimeout(200);
  let s = await getState(page);
  const colId = s.selection[0]!;
  await page.keyboard.press('Escape');

  const colBox = (await page.locator(`[data-element-id="${colId}"]`).boundingBox())!;
  await drag(page, center(colBox), { x: 400, y: 380 });

  await page.mouse.dblclick(900, 300);
  await page.waitForTimeout(200);
  const a = (await getState(page)).editing!;
  await page.keyboard.type('Col card A');
  await page.keyboard.press('Escape');

  const aBox = (await page.locator(`[data-element-id="${a}"]`).boundingBox())!;
  const colBox2 = (await page.locator(`[data-element-id="${colId}"]`).boundingBox())!;
  await page.mouse.click(center(aBox).x, center(aBox).y);
  await drag(page, center(aBox), {
    x: colBox2.x + colBox2.width / 2,
    y: colBox2.y + colBox2.height - 16,
  });
  s = await getState(page);
  expect(s.elements[a]!.parent).toBe(colId);
});

test('nested board navigation', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  await newBoard(page, 'E2E Parent');

  await page.getByLabel('Add Board').click();
  await page.waitForTimeout(250);
  const s = await getState(page);
  const card = Object.values(s.elements).find(
    (e) => e.type === 'boardLink' && e.boardId === s.boardId,
  )!;
  const childBoardId = (card.content as { boardId: string }).boardId;
  const cardBox = (await page.locator(`[data-element-id="${card.id}"]`).boundingBox())!;
  await page.mouse.dblclick(center(cardBox).x, center(cardBox).y);
  await page.waitForTimeout(350);
  expect((await getState(page)).boardId).toBe(childBoardId);
  await expect(
    page.locator('nav[aria-label="Breadcrumbs"]').getByText('E2E Parent'),
  ).toBeVisible();
  await page.goBack();
  await page.waitForTimeout(300);
  expect((await getState(page)).boardId).not.toBe(childBoardId);
});

test('image upload via file input', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  await newBoard(page, 'E2E Images');

  // 1x1 red pixel PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.setInputFiles('input[aria-label="Upload image"]', {
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.waitForTimeout(500);
  const images = (await boardElements(page)).filter((e) => e.type === 'image');
  expect(images).toHaveLength(1);
  await expect(page.locator('img').first()).toBeVisible();
});

test('export PNG downloads', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  await page.mouse.dblclick(700, 400);
  await page.waitForTimeout(200);
  await page.keyboard.type('Export me');
  await page.keyboard.press('Escape');

  await page.getByLabel('Export', { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('Export PNG (2x)').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test('offline cold start', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  // Let the service worker finish precaching.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas"]', { timeout: 15000 });
  expect((await getState(page)).boardId).not.toBeNull();
  await context.setOffline(false);
});

test('stress board stays responsive with virtualization', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="canvas"]');
  const stressId = await page.evaluate(() => window.__mosaicSeedStress(1500));
  await page.goto(`/b/${stressId}`);
  await page.waitForSelector('[data-testid="canvas"]');
  await page.waitForTimeout(800);

  const total = (await boardElements(page)).length;
  expect(total).toBe(1500);
  const mounted = await page.locator('[data-element-id]').count();
  expect(mounted).toBeLessThan(500); // virtualization keeps the DOM small

  // pan a lot; should stay quick
  const start = Date.now();
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(700, 450);
    await page.keyboard.down('Space');
    await drag(page, { x: 700, y: 450 }, { x: 460, y: 330 }, 6);
    await page.keyboard.up('Space');
  }
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(15000);
});
