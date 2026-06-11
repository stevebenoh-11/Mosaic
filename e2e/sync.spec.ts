/**
 * Full sync flow against a mocked Drive: connect → edit → push → second
 * device pulls; concurrent offline edits merge without loss.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { MiniDrive, installMockDrive } from './mockDrive';
import { getState } from './helpers';

test.skip(({ isMobile }) => isMobile, 'desktop-only sync flow');
test.describe.configure({ mode: 'serial' });
// Two devices + several full sync round-trips per test.
test.setTimeout(180_000);

async function newDevice(browser: Browser, drive: MiniDrive): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await installMockDrive(context, drive);
  const page = await context.newPage();
  await page.goto('http://localhost:4173/');
  await page.waitForSelector('[data-testid="canvas"]');
  return page;
}

/** The account menu only closes on outside pointerdown. */
async function closeMenus(page: Page): Promise<void> {
  await page.mouse.click(500, 150);
  await page.waitForTimeout(120);
}

async function connect(page: Page): Promise<void> {
  await page.getByLabel('Account menu').click();
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Connect Google Drive' })
    .click();
  await expect(page.getByText('mock@example.com')).toBeVisible({ timeout: 15000 });
  await closeMenus(page);
  await expect(page.getByTestId('sync-pill')).toHaveText(/Synced/, { timeout: 20000 });
}

async function syncNow(page: Page): Promise<void> {
  await page.getByLabel('Account menu').click();
  await page.getByText('Sync now').click();
  await closeMenus(page);
  await expect(page.getByTestId('sync-pill')).toHaveText(/Synced/, { timeout: 20000 });
  await page.waitForTimeout(200);
}

test('connect → edit → sync → second device sees it (and back)', async ({ browser }) => {
  const drive = new MiniDrive();

  // Device A: connect and create content.
  const a = await newDevice(browser, drive);
  await connect(a);
  await a.mouse.dblclick(700, 400);
  await a.waitForTimeout(250);
  await a.keyboard.type('Synced from A');
  await a.keyboard.press('Escape');
  await a.getByText('All changes saved').waitFor();
  await syncNow(a);

  // The mock drive now holds manifest + board files.
  expect(drive.list("name = 'manifest.json'")).toHaveLength(1);

  // Device B: fresh profile, connect → pull, open A's board.
  const aBoardId = (await getState(a)).boardId!;
  const b = await newDevice(browser, drive);
  await connect(b);
  await expect(b.locator(`[data-board-nav-id="${aBoardId}"]`)).toBeVisible({ timeout: 20000 });
  await b.locator(`[data-board-nav-id="${aBoardId}"]`).click();
  await expect(b.getByText('Synced from A')).toBeVisible({ timeout: 20000 });

  // Device B edits; device A picks it up on "Sync now".
  await b.mouse.dblclick(700, 560);
  await b.waitForTimeout(250);
  await b.keyboard.type('Reply from B');
  await b.keyboard.press('Escape');
  await b.getByText('All changes saved').waitFor();
  await syncNow(b);

  await syncNow(a);
  await expect(a.getByText('Reply from B')).toBeVisible({ timeout: 20000 });

  await a.context().close();
  await b.context().close();
});

test('concurrent offline edits on both devices merge without loss', async ({ browser }) => {
  const drive = new MiniDrive();

  const a = await newDevice(browser, drive);
  await connect(a);
  await a.mouse.dblclick(640, 360);
  await a.waitForTimeout(250);
  await a.keyboard.type('Base card');
  await a.keyboard.press('Escape');
  await a.getByText('All changes saved').waitFor();
  await syncNow(a);

  const aBoardId = (await getState(a)).boardId!;
  const b = await newDevice(browser, drive);
  await connect(b);
  await expect(b.locator(`[data-board-nav-id="${aBoardId}"]`)).toBeVisible({ timeout: 20000 });
  await b.locator(`[data-board-nav-id="${aBoardId}"]`).click();
  await expect(b.getByText('Base card')).toBeVisible({ timeout: 20000 });

  // Go offline on both, edit different things.
  await a.context().setOffline(true);
  await b.context().setOffline(true);
  await a.mouse.dblclick(900, 300);
  await a.waitForTimeout(250);
  await a.keyboard.type('Offline A');
  await a.keyboard.press('Escape');
  await b.mouse.dblclick(900, 560);
  await b.waitForTimeout(250);
  await b.keyboard.type('Offline B');
  await b.keyboard.press('Escape');
  await a.getByText('All changes saved').waitFor();
  await b.getByText('All changes saved').waitFor();

  // Reconnect and sync both (twice, so the second pass pulls the other's push).
  await a.context().setOffline(false);
  await b.context().setOffline(false);
  await syncNow(a);
  await syncNow(b);
  await syncNow(a);

  await expect(a.getByText('Offline A')).toBeVisible();
  await expect(a.getByText('Offline B')).toBeVisible({ timeout: 20000 });
  await expect(b.getByText('Offline A')).toBeVisible({ timeout: 20000 });
  await expect(b.getByText('Offline B')).toBeVisible();

  // No element lost on either side.
  const sa = await getState(a);
  const sb = await getState(b);
  const textsA = Object.values(sa.elements).map((e) => JSON.stringify(e.content)).join('|');
  const textsB = Object.values(sb.elements).map((e) => JSON.stringify(e.content)).join('|');
  for (const t of ['Base card', 'Offline A', 'Offline B']) {
    expect(textsA).toContain(t);
    expect(textsB).toContain(t);
  }

  await a.context().close();
  await b.context().close();
});

test('disconnect keeps local data', async ({ browser }) => {
  const drive = new MiniDrive();
  const a = await newDevice(browser, drive);
  await connect(a);
  await a.mouse.dblclick(700, 400);
  await a.waitForTimeout(250);
  await a.keyboard.type('Keep me');
  await a.keyboard.press('Escape');
  await a.getByText('All changes saved').waitFor();

  a.on('dialog', (d) => void d.accept());
  await a.getByLabel('Account menu').click();
  await a.getByText('Disconnect…').click();
  await a.waitForTimeout(400);

  await expect(a.getByText('Keep me')).toBeVisible();
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('[data-testid="canvas"]');
  await expect(a.getByText('Keep me')).toBeVisible();
  // Pill hidden when disconnected.
  await expect(a.getByTestId('sync-pill')).toHaveCount(0);
  await a.context().close();
});
