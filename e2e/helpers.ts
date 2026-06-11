import type { Page } from '@playwright/test';
import type { Element } from '../src/db/types';

export interface StateSnapshot {
  selection: string[];
  editing: string | null;
  boardId: string | null;
  boards: Record<string, { id: string; title: string; parent: string | null }>;
  elements: Record<
    string,
    {
      id: string;
      type: string;
      x: number;
      y: number;
      w: number;
      h: number;
      parent: string | null;
      boardId: string;
      content: Element['content'];
    }
  >;
}

export function getState(page: Page): Promise<StateSnapshot> {
  return page.evaluate(() => {
    const s = window.__mosaicStore.getState();
    return {
      selection: s.selection,
      editing: s.editingElementId,
      boardId: s.currentBoardId,
      boards: Object.fromEntries(
        Object.entries(s.boards).map(([id, b]) => [
          id,
          { id, title: b.title, parent: b.parentBoardId },
        ]),
      ),
      elements: Object.fromEntries(
        Object.entries(s.elements).map(([id, e]) => [
          id,
          {
            id,
            type: e.type,
            x: e.x,
            y: e.y,
            w: e.w,
            h: e.h,
            parent: e.parentColumnId,
            boardId: e.boardId,
            content: e.content,
          },
        ]),
      ),
    } as StateSnapshot;
  });
}

export async function boardElements(page: Page) {
  const s = await getState(page);
  return Object.values(s.elements).filter((e) => e.boardId === s.boardId);
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

export const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

export async function newBoard(page: Page, title: string) {
  await page.getByLabel('New board').click();
  await page.waitForTimeout(250);
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
}

export async function waitSaved(page: Page) {
  await page.getByText('All changes saved').waitFor({ timeout: 8000 });
}
