import { resolve } from 'path';
import { pathToFileURL } from 'url';
import type { Locator, Page } from '@playwright/test';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;

export type HistoryStacks = {
  history: number;
  redo: number;
};

export async function navigateToApp(page: Page, options: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; timeout?: number } = {}): Promise<void> {
  const { waitUntil = 'load', timeout } = options;
  await page.goto(INDEX_URL, { waitUntil, timeout });
}

export async function waitForAppReady(page: Page, options: { timeout?: number } = {}): Promise<void> {
  const { timeout = 15000 } = options;
  await page.waitForSelector('#globalLinearizationBtn', { state: 'attached', timeout });
  await waitForUndoRedoReady(page, { timeout });
}

export async function waitForUndoRedoReady(page: Page, options: { timeout?: number } = {}): Promise<void> {
  const { timeout = 10000 } = options;
  await Promise.all([
    page.waitForSelector('#undoBtn', { timeout }),
    page.waitForSelector('#redoBtn', { timeout })
  ]);
}

export function getUndoRedoButtons(page: Page): { undoButton: Locator; redoButton: Locator } {
  return {
    undoButton: page.locator('#undoBtn'),
    redoButton: page.locator('#redoBtn')
  };
}

export async function clickUndo(page: Page): Promise<void> {
  const { undoButton } = getUndoRedoButtons(page);
  await undoButton.click();
}

export async function clickRedo(page: Page): Promise<void> {
  const { redoButton } = getUndoRedoButtons(page);
  await redoButton.click();
}

export async function getHistoryStackCounts(page: Page): Promise<HistoryStacks> {
  return page.evaluate(() => {
    const api = window as typeof window & { getHistoryManager?: () => any };
    const manager = typeof api.getHistoryManager === 'function' ? api.getHistoryManager() : null;
    if (!manager) {
      return { history: 0, redo: 0 };
    }
    const history = Array.isArray(manager.history) ? manager.history.length : 0;
    const redo = Array.isArray(manager.redoStack) ? manager.redoStack.length : 0;
    return { history, redo };
  });
}

export async function setChannelPercentage(page: Page, channelName: string, percentage: number): Promise<void> {
  await page.waitForSelector(`tr[data-channel="${channelName}"]`, { state: 'attached' });
  await page.evaluate(({ channelName, percentage }) => {
    const row = document.querySelector(`tr[data-channel="${channelName}"]`);
    const input = row?.querySelector<HTMLInputElement>('.percent-input');
    if (!input) {
      throw new Error(`Unable to locate percent input for channel ${channelName}`);
    }
    input.value = String(percentage);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { channelName, percentage });
}

export async function getChannelPercentage(page: Page, channelName: string): Promise<string> {
  await page.waitForSelector(`[data-channel="${channelName}"] .percent-input`);
  return page.evaluate(({ channelName }) => {
    const row = document.querySelector(`[data-channel="${channelName}"]`);
    const input = row?.querySelector<HTMLInputElement>('.percent-input');
    if (!input) {
      throw new Error(`Unable to locate percent input for channel ${channelName}`);
    }
    return input.value;
  }, { channelName });
}

export async function toggleChannel(page: Page, channelName: string, enabled: boolean): Promise<void> {
  const row = page.locator(`[data-channel="${channelName}"]`);
  const checkbox = row.locator('input[type="checkbox"]');
  const current = await checkbox.isChecked();
  if (current !== enabled) {
    await checkbox.click();
  }
}

export async function ensureCleanHistory(page: Page): Promise<void> {
  await page.evaluate(() => {
    const curveHistory = (window as typeof window & { CurveHistory?: any }).CurveHistory;
    if (curveHistory && typeof curveHistory.clear === 'function') {
      curveHistory.clear();
    }
  });
}
