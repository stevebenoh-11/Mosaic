// M3 verification: nested boards, sidebar management, cross-board moves, search.
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
      boardId: s.currentBoardId,
      boards: Object.fromEntries(
        Object.entries(s.boards).map(([id, b]) => [
          id,
          { id, title: b.title, parent: b.parentBoardId, si: b.sortIndex },
        ]),
      ),
      elements: Object.fromEntries(
        Object.entries(s.elements).map(([id, e]) => [
          id,
          { id, type: e.type, boardId: e.boardId, content: e.content },
        ]),
      ),
    };
  });

async function drag(from, to, { steps = 12 } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(150);
}
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');

// ---------- create + rename a root board ----------
await page.getByLabel('New board').click();
await page.waitForTimeout(300);
let s = await getState();
const projectsId = s.boardId;
// New board opens with sidebar rename active.
await page.keyboard.type('Projects');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
s = await getState();
ok('sidebar create + inline rename', s.boards[projectsId].title === 'Projects');

// ---------- nested board via toolbar Board tool ----------
await page.getByLabel('Add Board').click();
await page.waitForTimeout(250);
s = await getState();
const boardCard = Object.values(s.elements).find((e) => e.type === 'boardLink');
ok('Board tool creates boardLink card', !!boardCard);
const subId = boardCard.content.boardId;
ok('child board nested under current', s.boards[subId]?.parent === projectsId);

const cardBox = await page.locator(`[data-element-id="${boardCard.id}"]`).boundingBox();
await page.mouse.dblclick(center(cardBox).x, center(cardBox).y);
await page.waitForTimeout(350);
s = await getState();
ok('double-click opens nested board', s.boardId === subId && page.url().includes(subId));
ok('breadcrumbs show chain',
  await page.locator('nav[aria-label="Breadcrumbs"]').getByText('Projects').isVisible());

// ---------- deep nesting + browser back/forward ----------
await page.getByLabel('Add Board').click();
await page.waitForTimeout(250);
s = await getState();
const deepCard = Object.values(s.elements).find(
  (e) => e.type === 'boardLink' && e.boardId === subId,
);
const deepId = deepCard.content.boardId;
const deepBox = await page.locator(`[data-element-id="${deepCard.id}"]`).boundingBox();
await page.mouse.dblclick(center(deepBox).x, center(deepBox).y);
await page.waitForTimeout(350);
s = await getState();
ok('deep nesting works (depth 3)', s.boardId === deepId);
await page.goBack();
await page.waitForTimeout(350);
ok('browser back navigates boards', (await getState()).boardId === subId);
await page.goForward();
await page.waitForTimeout(350);
ok('browser forward navigates boards', (await getState()).boardId === deepId);

// ---------- content for search + cross-board moves ----------
await page.mouse.dblclick(700, 400);
await page.waitForTimeout(200);
await page.keyboard.type('Quarterly roadmap thoughts');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// ---------- sidebar drag: nest "Projects" sibling ----------
await page.getByLabel('New board').click();
await page.waitForTimeout(250);
await page.keyboard.type('Archive');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
s = await getState();
const archiveId = s.boardId;

const archiveRow = await page.locator(`[data-board-nav-id="${archiveId}"]`).boundingBox();
const projectsRow = await page.locator(`[data-board-nav-id="${projectsId}"]`).boundingBox();
await drag(center(archiveRow), center(projectsRow), { steps: 10 });
s = await getState();
ok('sidebar drag nests board inside another', s.boards[archiveId].parent === projectsId);

// reorder back to root: drag onto Welcome row's bottom edge
const welcomeId = Object.values(s.boards).find((b) => b.title === 'Welcome')?.id;
const archiveRow2 = await page.locator(`[data-board-nav-id="${archiveId}"]`).boundingBox();
const welcomeRow = await page.locator(`[data-board-nav-id="${welcomeId}"]`).boundingBox();
await drag(center(archiveRow2), { x: center(welcomeRow).x, y: welcomeRow.y + welcomeRow.height - 2 }, { steps: 10 });
s = await getState();
ok('sidebar drag reorders to root level', s.boards[archiveId].parent === null);

// ---------- move element via drag onto sidebar board ----------
await page.goto(`${BASE}/b/${deepId}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(400);
s = await getState();
const noteId = Object.values(s.elements).find(
  (e) => e.type === 'note' && e.boardId === deepId,
)?.id;
const noteBox = await page.locator(`[data-element-id="${noteId}"]`).boundingBox();
await page.mouse.click(center(noteBox).x, center(noteBox).y);
const archiveRow3 = await page.locator(`[data-board-nav-id="${archiveId}"]`).boundingBox();
await drag(center(noteBox), center(archiveRow3), { steps: 14 });
s = await getState();
ok('drag onto sidebar moves element to board', s.elements[noteId]?.boardId === archiveId);
await page.getByText('All changes saved').waitFor({ timeout: 5000 });

// ---------- cut/paste across boards ----------
await page.goto(`${BASE}/b/${archiveId}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(400);
const noteBox2 = await page.locator(`[data-element-id="${noteId}"]`).boundingBox();
ok('moved note visible on target board', !!noteBox2 &&
  await page.getByText('Quarterly roadmap thoughts').isVisible());
await page.mouse.click(center(noteBox2).x, center(noteBox2).y);
await page.keyboard.press('Control+x');
await page.waitForTimeout(200);
ok('cut removes element', !(await page.getByText('Quarterly roadmap thoughts').isVisible()));
// In-app navigation (sidebar click) — the clipboard lives in memory.
await page.locator(`[data-board-nav-id="${projectsId}"]`).click();
await page.waitForTimeout(400);
await page.keyboard.press('Control+v');
await page.waitForTimeout(250);
s = await getState();
ok('paste recreates on current board (new id, same text)',
  await page.getByText('Quarterly roadmap thoughts').isVisible() &&
  Object.values(s.elements).some(
    (e) => e.boardId === projectsId && JSON.stringify(e.content).includes('Quarterly'),
  ));

// ---------- delete board with confirmation, sub-board re-parent ----------
s = await getState();
ok('pre-delete: sub board exists under Projects', s.boards[subId].parent === projectsId);
page.once('dialog', (d) => d.accept());
const projRow = page.locator(`[data-board-nav-id="${projectsId}"]`);
await projRow.hover();
await page.getByLabel(`Delete board Projects`).click();
await page.waitForTimeout(400);
s = await getState();
ok('board deleted', !s.boards[projectsId]);
ok('sub-boards re-parented to grandparent', s.boards[subId]?.parent === null);
const tombstoned = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('mosaic');
  req.onsuccess = () => {
    const c = req.result.transaction('tombstones', 'readonly').objectStore('tombstones').count();
    c.onsuccess = () => res(c.result);
  };
}));
ok('deleted board elements tombstoned', tombstoned >= 2, `tombstones=${tombstoned}`);

// ---------- command palette ----------
await page.getByText('All changes saved').waitFor({ timeout: 5000 });
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
ok('Ctrl+K opens palette', await page.getByLabel('Search boards and cards').isVisible());
const recentCount = await page.locator('[data-testid="palette-result"]').count();
ok('empty query lists recent boards', recentCount > 0, `recents=${recentCount}`);
await page.getByLabel('Search boards and cards').fill('double-click anywhere');
await page.waitForTimeout(300);
const resCount = await page.locator('[data-testid="palette-result"]').count();
ok('fuzzy search finds note text', resCount >= 1, `results=${resCount}`);
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
s = await getState();
ok('search result navigates + selects element',
  s.selection.length === 1 &&
  JSON.stringify(s.elements[s.selection[0]]?.content ?? {}).toLowerCase().includes('double-click'));

// search finds board titles too
await page.keyboard.press('Control+k');
await page.getByLabel('Search boards and cards').fill('Archi');
await page.waitForTimeout(250);
ok('search finds board by title',
  await page.locator('[data-testid="palette-result"]').getByText('Archive').first().isVisible());
await page.keyboard.press('Escape');

// ---------- reload persistence ----------
const boardCount = Object.keys((await getState()).boards).length;
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(400);
ok('board tree survives reload', Object.keys((await getState()).boards).length === boardCount);

await page.screenshot({ path: 'screenshots/m3-desktop.png' });

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="canvas"]');
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/m3-mobile.png' });

const realErrors = errors.filter((e) => !/CORS|ERR_FAILED|Failed to load resource/.test(e));
ok('no console/page errors', realErrors.length === 0, realErrors.slice(0, 4).join(' | '));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
