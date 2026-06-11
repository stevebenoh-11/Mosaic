// M4 verification: drawing, exports, backup/restore.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, statSync } from 'node:fs';

const BASE = 'http://localhost:5173';
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
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

const getState = () =>
  page.evaluate(() => {
    const s = window.__mosaicStore.getState();
    return {
      selection: s.selection,
      boardId: s.currentBoardId,
      boards: Object.keys(s.boards).length,
      elements: Object.fromEntries(
        Object.entries(s.elements).map(([id, e]) => [
          id,
          { id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, content: e.content, boardId: e.boardId },
        ]),
      ),
    };
  });
const els = async () => {
  const s = await getState();
  return Object.values(s.elements).filter((e) => e.boardId === s.boardId);
};
const byType = async (t) => (await els()).filter((e) => e.type === t);

async function strokeDrag(points) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.getByLabel('New board').click();
await page.waitForTimeout(250);
await page.keyboard.type('Export test');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);

// ---------- drawing ----------
await page.getByLabel('Add Draw').click();
await page.waitForTimeout(200);
ok('draw mode opens tool bar', await page.getByLabel('Drawing tools').isVisible());

await strokeDrag([
  { x: 600, y: 300 }, { x: 700, y: 340 }, { x: 800, y: 300 }, { x: 880, y: 380 },
]);
let drawings = await byType('drawing');
ok('first stroke creates drawing element', drawings.length === 1 && drawings[0].content.paths.length === 1);
const ptCount = drawings[0]?.content.paths[0]?.points.length ?? 0;
ok('stroke points are simplified', ptCount >= 4 && ptCount <= 60, `points=${ptCount}`);

await strokeDrag([
  { x: 620, y: 420 }, { x: 760, y: 460 }, { x: 900, y: 420 },
]);
drawings = await byType('drawing');
ok('second stroke extends same drawing', drawings.length === 1 && drawings[0].content.paths.length === 2);

await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
drawings = await byType('drawing');
ok('undo removes one stroke', drawings[0]?.content.paths.length === 1);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);

// eraser removes a whole stroke
await page.getByLabel('Eraser').click();
await strokeDrag([{ x: 740, y: 430 }, { x: 770, y: 450 }]);
drawings = await byType('drawing');
ok('eraser removes touched stroke', drawings[0]?.content.paths.length === 1,
  `paths=${drawings[0]?.content.paths.length}`);

await page.getByLabel('Done drawing').click();
await page.waitForTimeout(150);
ok('done exits draw mode', !(await page.getByLabel('Drawing tools').isVisible()));

// ---------- content for export ----------
await page.mouse.dblclick(500, 550);
await page.waitForTimeout(200);
await page.keyboard.type('Exported note');
await page.keyboard.press('Escape');

const png = await sharp({
  create: { width: 200, height: 120, channels: 3, background: { r: 80, g: 120, b: 220 } },
}).png().toBuffer();
await page.setInputFiles('input[type="file"][accept="image/*"]', {
  name: 'pic.png', mimeType: 'image/png', buffer: png,
});
await page.waitForTimeout(400);
ok('image added for export test', (await byType('image')).length === 1);

// ---------- exports ----------
async function downloadVia(label) {
  await page.getByLabel('Export', { exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByText(label).click(),
  ]);
  const path = await download.path();
  const size = path ? statSync(path).size : 0;
  return { name: download.suggestedFilename(), size };
}

const pngDl = await downloadVia('Export PNG (2x)');
ok('PNG export downloads', pngDl.name.endsWith('.png') && pngDl.size > 5000,
  `${pngDl.name} ${pngDl.size}b`);

const pdfDl = await downloadVia('Export PDF');
ok('PDF export downloads', pdfDl.name.endsWith('.pdf') && pdfDl.size > 5000,
  `${pdfDl.name} ${pdfDl.size}b`);

const jsonDl = await downloadVia('Export JSON');
ok('Board JSON downloads', jsonDl.name.endsWith('.json') && jsonDl.size > 200,
  `${jsonDl.name} ${jsonDl.size}b`);

// ---------- backup → mutate → restore (lossless) ----------
await page.getByText('All changes saved').waitFor({ timeout: 5000 });
const beforeCounts = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('mosaic');
  req.onsuccess = () => {
    const tx = req.result.transaction(['boards', 'elements', 'assets'], 'readonly');
    const out = {};
    let pending = 3;
    for (const store of ['boards', 'elements', 'assets']) {
      const c = tx.objectStore(store).count();
      c.onsuccess = () => {
        out[store] = c.result;
        if (--pending === 0) res(out);
      };
    }
  };
}));

await page.getByLabel('Export', { exact: true }).click();
const [backupDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByText('Download backup (.zip)').click(),
]);
const backupPath = await backupDl.path();
ok('backup zip downloads', !!backupPath && statSync(backupPath).size > 1000);

// mutate: delete the exported note
const s1 = await getState();
const note = Object.values(s1.elements).find(
  (e) => e.type === 'note' && JSON.stringify(e.content).includes('Exported note'),
);
await page.evaluate((id) => window.__mosaicStore.getState().setSelection([id]), note.id);
await page.mouse.move(60, 860);
await page.keyboard.press('Delete');
await page.waitForTimeout(300);
ok('note deleted before restore', !(await page.getByText('Exported note').isVisible()));

// restore
page.on('dialog', (d) => void d.accept());
await page.getByLabel('Export', { exact: true }).click();
await page.getByText('Restore backup…').click();
await page.setInputFiles('input[type="file"][accept=".zip"]', backupPath);
await page.waitForURL('**/b/**', { timeout: 20000 });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(600);

const afterCounts = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('mosaic');
  req.onsuccess = () => {
    const tx = req.result.transaction(['boards', 'elements', 'assets'], 'readonly');
    const out = {};
    let pending = 3;
    for (const store of ['boards', 'elements', 'assets']) {
      const c = tx.objectStore(store).count();
      c.onsuccess = () => {
        out[store] = c.result;
        if (--pending === 0) res(out);
      };
    }
  };
}));
ok('restore is lossless (boards/elements/assets counts match)',
  JSON.stringify(beforeCounts) === JSON.stringify(afterCounts),
  `${JSON.stringify(beforeCounts)} vs ${JSON.stringify(afterCounts)}`);

// deleted note is back
await page.keyboard.press('Control+k');
await page.getByLabel('Search boards and cards').fill('Exported note');
await page.waitForTimeout(300);
ok('restored note findable', (await page.locator('[data-testid="palette-result"]').count()) >= 1);
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
ok('restored note visible', await page.getByText('Exported note').isVisible());

await page.screenshot({ path: 'screenshots/m4-desktop.png' });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'screenshots/m4-mobile.png' });

const realErrors = errors.filter((e) => !/CORS|ERR_FAILED|Failed to load resource/.test(e));
ok('no console/page errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
