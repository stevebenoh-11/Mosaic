// M2 verification: element types end-to-end.
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:5173';
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

const getState = () =>
  page.evaluate(() => {
    const s = window.__mosaicStore.getState();
    return {
      selection: s.selection,
      editing: s.editingElementId,
      boardId: s.currentBoardId,
      elements: Object.fromEntries(
        Object.entries(s.elements).map(([id, e]) => [
          id,
          {
            id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h,
            parent: e.parentColumnId, si: e.sortIndex, content: e.content,
            boardId: e.boardId,
          },
        ]),
      ),
    };
  });
const els = async () => {
  const s = await getState();
  return Object.values(s.elements).filter((e) => e.boardId === s.boardId);
};
const byType = async (t) => (await els()).filter((e) => e.type === t);

async function drag(from, to, { steps = 14 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(120);
}
const center = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
const elBox = async (id) => page.locator(`[data-element-id="${id}"]`).boundingBox();

// ---------- fresh board ----------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.getByLabel('New board').click();
await page.waitForTimeout(300);

// ---------- column ----------
await page.getByLabel('Add Column').click();
await page.waitForTimeout(200);
let s = await getState();
const colId = s.selection[0];
ok('column created (edit mode)', (await byType('column')).length === 1 && s.editing === colId);
await page.keyboard.type('Ideas');
await page.keyboard.press('Enter');
await page.waitForTimeout(100);
ok('column titled', ((await getState()).elements[colId].content).title === 'Ideas');

// Move column to a known free spot (left side).
let colBox = await elBox(colId);
await drag(center(colBox), { x: 420, y: 350 });

// ---------- notes to stack ----------
await page.mouse.dblclick(900, 250);
await page.waitForTimeout(200);
const noteA = (await getState()).editing;
await page.keyboard.type('Card A');
await page.keyboard.press('Escape');
await page.mouse.dblclick(900, 420);
await page.waitForTimeout(200);
const noteB = (await getState()).editing;
await page.keyboard.type('Card B');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ---------- drop into column ----------
let aBox = await elBox(noteA);
colBox = await elBox(colId);
await page.mouse.click(center(aBox).x, center(aBox).y);
await drag(center(aBox), { x: colBox.x + colBox.width / 2, y: colBox.y + colBox.height - 20 });
s = await getState();
ok('drag into column sets parentColumnId', s.elements[noteA].parent === colId);
ok('column count badge shows 1', await page.locator(`[data-column-id="${colId}"]`).getByText('1', { exact: true }).isVisible());

let bBox = await elBox(noteB);
colBox = await elBox(colId);
await page.mouse.click(center(bBox).x, center(bBox).y);
await drag(center(bBox), { x: colBox.x + colBox.width / 2, y: colBox.y + colBox.height - 12 });
s = await getState();
ok('second card stacks below', s.elements[noteB].parent === colId && s.elements[noteB].si > s.elements[noteA].si);

// ---------- reorder inside column (dnd-kit) ----------
const bChild = await page.locator(`[data-child-id="${noteB}"]`).boundingBox();
const aChild = await page.locator(`[data-child-id="${noteA}"]`).boundingBox();
await drag(center(bChild), { x: center(aChild).x, y: aChild.y - 4 }, { steps: 16 });
s = await getState();
ok('dnd-kit reorder swaps order', s.elements[noteB].si < s.elements[noteA].si,
  `siA=${s.elements[noteA].si} siB=${s.elements[noteB].si}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(120);
s = await getState();
ok('undo restores order', s.elements[noteB].si > s.elements[noteA].si);

// ---------- drag out of column ----------
const aChild2 = await page.locator(`[data-child-id="${noteA}"]`).boundingBox();
await drag(center(aChild2), { x: 1000, y: 600 }, { steps: 16 });
s = await getState();
ok('drag out returns card to canvas', s.elements[noteA].parent === null);
ok('column badge back to 1', await page.locator(`[data-column-id="${colId}"]`).getByText('1', { exact: true }).isVisible());

// ---------- image upload + aspect resize ----------
const png = await sharp({
  create: { width: 320, height: 200, channels: 3, background: { r: 200, g: 80, b: 60 } },
}).png().toBuffer();
await page.setInputFiles('input[aria-label="Upload image"]', { name: 'photo.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(500);
const images = await byType('image');
ok('image element created from file', images.length === 1 && images[0].content.assetId.length > 10);
const imgRatio = images[0].w / images[0].h;
ok('image sized to natural ratio', Math.abs(imgRatio - 1.6) < 0.05, `ratio=${imgRatio}`);
const assetCount = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('mosaic');
  req.onsuccess = () => {
    const c = req.result.transaction('assets', 'readonly').objectStore('assets').count();
    c.onsuccess = () => res(c.result);
  };
}));
ok('image blob stored in Dexie', assetCount >= 1, `assets=${assetCount}`);

const imgId = images[0].id;
let imgBox = await elBox(imgId);
await page.mouse.click(center(imgBox).x, center(imgBox).y);
await page.waitForTimeout(100);
const seHandle = await page.locator('[data-handle="se"]').boundingBox();
await drag(center(seHandle), { x: center(seHandle).x + 60, y: center(seHandle).y + 5 });
s = await getState();
const resized = s.elements[imgId];
ok('image resize keeps aspect ratio', Math.abs(resized.w / resized.h - imgRatio) < 0.03,
  `now ${resized.w}x${resized.h}`);

// ---------- link via paste ----------
const pasteWorked = await page.evaluate(() => {
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://example.com/page');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    return true;
  } catch {
    return false;
  }
});
await page.waitForTimeout(600);
let links = await byType('link');
if (!pasteWorked || links.length === 0) {
  // Fallback path: toolbar link tool with prompt dialog.
  page.once('dialog', (d) => d.accept('https://example.com/page'));
  await page.getByLabel('Add Link').click();
  await page.waitForTimeout(600);
  links = await byType('link');
}
ok('pasting/creating URL makes link card', links.length === 1 && links[0].content.url.includes('example.com'));
ok('link card shows domain fallback', await page.getByText('example.com', { exact: false }).first().isVisible());

// ---------- todo ----------
await page.getByLabel('Add To-do').click();
await page.waitForTimeout(200);
const todoId = (await getState()).selection[0];
const addInput = page.locator(`[data-element-id="${todoId}"]`).getByLabel('Add to-do item');
await addInput.click();
await addInput.fill('First task');
await addInput.press('Enter');
await addInput.fill('Second task');
await addInput.press('Enter');
await page.waitForTimeout(150);
s = await getState();
ok('todo items added', s.elements[todoId].content.items.length === 2);
await page.locator(`[data-element-id="${todoId}"]`).getByRole('checkbox').first().check();
await page.waitForTimeout(120);
s = await getState();
ok('todo item checks', s.elements[todoId].content.items[0].done === true);

// ---------- swatch edit ----------
await page.getByLabel('Add Swatch').click();
await page.waitForTimeout(150);
const swatchId = (await getState()).selection[0];
const swBox = await elBox(swatchId);
await page.mouse.dblclick(center(swBox).x, swBox.y + 24);
await page.waitForTimeout(150);
await page.getByLabel('Swatch color').evaluate((input) => {
  // React-controlled input: must go through the native setter so React's
  // value tracker sees the change.
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  setter.call(input, '#ff3300');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.getByLabel('Swatch label').fill('Brand red');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
s = await getState();
ok('swatch color + label edited',
  s.elements[swatchId].content.hex === '#ff3300' && s.elements[swatchId].content.label === 'Brand red');

// ---------- connector line via anchors ----------
aBox = await elBox(noteA);
await page.mouse.click(center(aBox).x, center(aBox).y);
await page.waitForTimeout(150);
const anchorE = await page.locator('[data-anchor="e"]').boundingBox();
ok('anchors visible on selected card', !!anchorE);
const colBox2 = await elBox(colId); // connect noteA → column card
await drag(center(anchorE), center(colBox2), { steps: 16 });
await page.waitForTimeout(150);
let lines = await byType('line');
ok('anchor drag creates a line', lines.length === 1);
const lineId = lines[0]?.id;
ok('line endpoints reference elements',
  lines[0] && 'elementId' in lines[0].content.from && 'elementId' in lines[0].content.to);

// line property toggles
const dBefore = await page.evaluate(() => document.querySelector('svg g path')?.getAttribute('d'));
await page.getByLabel('Toggle curve').click();
await page.waitForTimeout(120);
s = await getState();
ok('curve toggle persists', s.elements[lineId].content.curve === true);
await page.getByLabel('Toggle dashed').click();
await page.waitForTimeout(120);
ok('dashed toggle persists', (await getState()).elements[lineId].content.dashed === true);

// line re-routes when the source moves
aBox = await elBox(noteA);
await page.mouse.click(center(aBox).x, center(aBox).y);
await drag(center(aBox), { x: center(aBox).x - 120, y: center(aBox).y - 60 });
const dAfter = await page.evaluate(() => document.querySelector('svg g path')?.getAttribute('d'));
ok('line re-routes live as element moves', dBefore !== dAfter);

// ---------- comment ----------
await page.getByLabel('Add Comment').click();
await page.waitForTimeout(200);
let comments = await byType('comment');
ok('comment pin created', comments.length === 1);
const commentBtn = page.getByLabel('Comment', { exact: true });
await commentBtn.click();
await page.waitForTimeout(200);
await page.keyboard.type('Looks great');
await page.waitForTimeout(500);
s = await getState();
const cdoc = JSON.stringify(s.elements[comments[0].id].content.doc);
ok('comment text saved', cdoc.includes('Looks great'));
await page.getByLabel('Resolve').click();
await page.waitForTimeout(120);
ok('comment resolves', (await getState()).elements[comments[0].id].content.resolved === true);
await page.keyboard.press('Escape');

// ---------- delete cascade (line follows its card) ----------
const countBefore = (await els()).length;
// Click-selection covered above; the center is a deliberate pile of cards, so
// select programmatically for the cascade check.
await page.evaluate((id) => window.__mosaicStore.getState().setSelection([id]), noteA);
await page.locator('[data-testid="canvas"]').focus().catch(() => {});
await page.mouse.move(60, 860); // keyboard target: ensure no input focused
await page.waitForTimeout(100);
await page.keyboard.press('Delete');
await page.waitForTimeout(150);
lines = await byType('line');
ok('deleting card cascades to its line', lines.length === 0);
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
ok('undo restores card + line', (await els()).length === countBefore && (await byType('line')).length === 1);

// ---------- reload persistence ----------
const snapshot = (await els()).map((e) => `${e.type}:${e.parent ? 'col' : 'free'}`).sort();
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(500);
const restored = (await els()).map((e) => `${e.type}:${e.parent ? 'col' : 'free'}`).sort();
ok('reload restores all element types', JSON.stringify(snapshot) === JSON.stringify(restored),
  `${snapshot} vs ${restored}`);

await page.screenshot({ path: 'screenshots/m2-desktop.png' });

// ---------- mobile sanity ----------
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(600);
ok('mobile: renders column board', (await els()).length === restored.length);
await page.screenshot({ path: 'screenshots/m2-mobile.png' });

// Cross-origin fetches (link metadata) legitimately fail with CORS noise.
const realErrors = errors.filter(
  (e) => !/CORS|ERR_FAILED|Failed to load resource/.test(e),
);
ok('no console/page errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
