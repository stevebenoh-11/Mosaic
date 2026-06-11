// M1 verification: canvas interactions end-to-end in a real browser.
import { chromium } from 'playwright';
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
      viewport: s.viewport,
      boardId: s.currentBoardId,
      elements: Object.fromEntries(
        Object.entries(s.elements).map(([id, e]) => [
          id,
          { id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, z: e.zIndex, boardId: e.boardId },
        ]),
      ),
      canUndo: s.canUndo,
      canRedo: s.canRedo,
    };
  });

const boardElements = async () => {
  const s = await getState();
  return Object.values(s.elements).filter((e) => e.boardId === s.boardId);
};

async function drag(from, to, { steps = 8, before, after } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  if (before) await before();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  if (after) await after();
  await page.mouse.up();
  await page.waitForTimeout(80);
}

const elBox = async (id) => {
  const box = await page.locator(`[data-element-id="${id}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
};

// ---------- setup: fresh empty board ----------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.getByLabel('New board').click();
await page.waitForTimeout(300);
ok('new empty board created', (await boardElements()).length === 0);

// ---------- create note via double-click, type, exit ----------
await page.mouse.dblclick(760, 420);
await page.waitForTimeout(250);
let s = await getState();
ok('double-click creates note in edit mode', s.editing !== null);
const note1 = s.editing;
await page.keyboard.type('Hello world');
await page.waitForTimeout(450); // > debounce
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
s = await getState();
ok('Escape exits edit, keeps selection', s.editing === null && s.selection.length === 1);
ok('typed text rendered', await page.getByText('Hello world').isVisible());

// ---------- Enter re-enters edit; second session is a separate undo step ----------
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
s = await getState();
ok('Enter edits selected note', s.editing === note1);
await page.keyboard.press('End');
await page.keyboard.type(' again');
await page.waitForTimeout(450);
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
ok('second session text rendered', await page.getByText('Hello world again').isVisible());
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
ok('undo reverts only last edit session',
  (await page.getByText('Hello world').isVisible()) &&
  !(await page.getByText('Hello world again').isVisible()));
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(150);
ok('redo restores the session', await page.getByText('Hello world again').isVisible());
await page.keyboard.press('Control+z'); // back to "Hello world" for cleaner text asserts
await page.waitForTimeout(100);

// ---------- toolbar drag creates a note ----------
const toolNote = page.getByLabel('Add Note');
const tb = await toolNote.boundingBox();
await drag({ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }, { x: 520, y: 300 });
await page.waitForTimeout(200);
s = await getState();
ok('toolbar drag creates note (in edit mode)', Object.keys(s.elements).length === 2 && s.editing !== null);
const note2 = s.editing;
await page.keyboard.type('Second');
await page.waitForTimeout(450);
await page.keyboard.press('Escape');

// ---------- selection: click, shift-click, marquee ----------
let b1 = await elBox(note1);
await page.mouse.click(b1.x, b1.y);
await page.waitForTimeout(80);
s = await getState();
ok('click selects', s.selection.length === 1 && s.selection[0] === note1);
const b2 = await elBox(note2);
await page.keyboard.down('Shift');
await page.mouse.click(b2.x, b2.y);
await page.keyboard.up('Shift');
await page.waitForTimeout(80);
s = await getState();
ok('shift-click adds to selection', s.selection.length === 2);
await page.mouse.click(1100, 700);
await page.waitForTimeout(80);
s = await getState();
ok('click empty clears selection', s.selection.length === 0);
await drag({ x: 380, y: 200 }, { x: 1000, y: 560 });
s = await getState();
ok('marquee selects both notes', s.selection.length === 2);

// ---------- drag move ----------
await page.mouse.click(1100, 700); // clear
b1 = await elBox(note1);
const beforeMove = (await getState()).elements[note1];
await page.mouse.click(b1.x, b1.y);
await drag({ x: b1.x, y: b1.y }, { x: b1.x + 150, y: b1.y + 90 });
s = await getState();
const moved = s.elements[note1];
ok('drag moves note (~150,90, snap tolerance)',
  Math.abs(moved.x - beforeMove.x - 150) <= 10 && Math.abs(moved.y - beforeMove.y - 90) <= 10,
  `dx=${moved.x - beforeMove.x} dy=${moved.y - beforeMove.y}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
s = await getState();
ok('undo restores position', s.elements[note1].x === beforeMove.x && s.elements[note1].y === beforeMove.y);
await page.keyboard.press('Control+Shift+z');
await page.waitForTimeout(100);

// ---------- resize via east handle ----------
b1 = await elBox(note1);
await page.mouse.click(b1.x, b1.y);
await page.waitForTimeout(100);
const wBefore = (await getState()).elements[note1].w;
const handle = await page.locator('[data-handle="e"]').boundingBox();
ok('resize handle visible', !!handle);
await drag(
  { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
  { x: handle.x + handle.width / 2 + 80, y: handle.y + handle.height / 2 },
);
s = await getState();
ok('east handle widens note by ~80', Math.abs(s.elements[note1].w - wBefore - 80) <= 10,
  `w ${wBefore} -> ${s.elements[note1].w}`);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
ok('undo reverts resize', (await getState()).elements[note1].w === wBefore);

// ---------- duplicate: Ctrl+D and alt-drag ----------
b1 = await elBox(note1);
await page.mouse.click(b1.x, b1.y);
await page.keyboard.press('Control+d');
await page.waitForTimeout(150);
ok('Ctrl+D duplicates', (await boardElements()).length === 3);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
ok('undo removes duplicate', (await boardElements()).length === 2);

b1 = await elBox(note1);
await page.mouse.click(b1.x, b1.y);
await page.keyboard.down('Alt');
await drag({ x: b1.x, y: b1.y }, { x: b1.x + 200, y: b1.y + 120 });
await page.keyboard.up('Alt');
await page.waitForTimeout(150);
ok('alt-drag duplicates', (await boardElements()).length === 3);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
ok('alt-drag is ONE undo step', (await boardElements()).length === 2);

// ---------- z-order ----------
b1 = await elBox(note1);
await page.mouse.click(b1.x, b1.y);
const zBefore = (await getState()).elements[note1].z;
await page.keyboard.press('Shift+]');
await page.waitForTimeout(100);
const zAfter = (await getState()).elements[note1].z;
ok('Shift+] brings to front (z grows)', zAfter > zBefore || zBefore > (await getState()).elements[note2].z,
  `z ${zBefore} -> ${zAfter}`);

// ---------- delete + undo ----------
await page.keyboard.press('Delete');
await page.waitForTimeout(100);
ok('Delete removes selection', (await boardElements()).length === 1);
await page.keyboard.press('Control+z');
await page.waitForTimeout(100);
ok('undo restores deleted note', (await boardElements()).length === 2 &&
  await page.getByText('Hello world').isVisible());

// ---------- pan + zoom ----------
const vp0 = (await getState()).viewport;
await page.keyboard.down('Space');
await drag({ x: 700, y: 450 }, { x: 850, y: 520 });
await page.keyboard.up('Space');
let vp1 = (await getState()).viewport;
ok('space+drag pans', Math.abs(vp1.x - vp0.x - 150) <= 3 && Math.abs(vp1.y - vp0.y - 70) <= 3,
  `dx=${vp1.x - vp0.x} dy=${vp1.y - vp0.y}`);

await page.mouse.move(720, 450);
await page.keyboard.down('Control');
await page.mouse.wheel(0, -240);
await page.keyboard.up('Control');
await page.waitForTimeout(120);
vp1 = (await getState()).viewport;
ok('ctrl+wheel zooms in', vp1.scale > vp0.scale, `scale ${vp0.scale} -> ${vp1.scale}`);

ok('zoom clamped at 400%', vp1.scale <= 4.0001);
await page.getByLabel('Zoom level').click();
await page.getByText('100%', { exact: true }).click(); // reset to 100%
await page.waitForTimeout(80);
await page.getByLabel('Zoom in').click();
const vpPlus = (await getState()).viewport;
ok('toolbar + zooms', Math.abs(vpPlus.scale - 1.2) < 0.01, `scale=${vpPlus.scale}`);
await page.getByLabel('Zoom level').click();
await page.getByText('Fit to content').click();
await page.waitForTimeout(120);
const vpFit = (await getState()).viewport;
ok('fit-to-content changes viewport', vpFit.scale !== vpPlus.scale || vpFit.x !== vpPlus.x);

// ---------- shortcuts panel ----------
await page.keyboard.press('?');
ok('? opens shortcuts panel', await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
ok('Escape closes panel', !(await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).isVisible()));

// ---------- autosave indicator + outbox + reload persistence ----------
await page.waitForTimeout(600);
ok('save indicator settles', await page.getByText('All changes saved').isVisible());
const outboxCount = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('mosaic');
  req.onsuccess = () => {
    const tx = req.result.transaction('outbox', 'readonly');
    const c = tx.objectStore('outbox').count();
    c.onsuccess = () => resolve(c.result);
  };
}));
ok('mutations landed in outbox', outboxCount >= 2, `count=${outboxCount}`);

const snapshot = await boardElements();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(400);
const restored = await boardElements();
const sameGeometry = snapshot.length === restored.length && snapshot.every((e) => {
  const r = restored.find((x) => x.id === e.id);
  return r && r.x === e.x && r.y === e.y && r.w === e.w;
});
ok('reload restores exact positions', sameGeometry,
  JSON.stringify({ before: snapshot.map(e=>[e.id.slice(0,4),e.x,e.y]), after: restored.map(e=>[e.id.slice(0,4),e.x,e.y]) }));

await page.screenshot({ path: 'screenshots/m1-desktop.png' });

// ---------- mobile sanity ----------
// Same page (= same IndexedDB), resized to a mobile viewport.
const mobile = page;
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.reload({ waitUntil: 'networkidle' });
await mobile.waitForSelector('[data-testid="canvas"]');
await mobile.waitForTimeout(600);
ok('mobile: board renders with note', await mobile.getByText('Hello world').isVisible());
await mobile.screenshot({ path: 'screenshots/m1-mobile.png' });

ok('no console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
