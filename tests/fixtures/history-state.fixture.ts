import { readFile, writeFile, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Page } from '@playwright/test';
import { navigateToApp, waitForAppReady, ensureCleanHistory } from '../utils/history-helpers';

export type HistoryFixtureOptions = {
  globalLab?: string;
  perChannelLab?: Record<string, string>;
};

async function createTempFile(prefix: string, contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'quadgen-history-'));
  const filePath = join(dir, prefix);
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}

export async function loadHistoryFixture(page: Page, options: HistoryFixtureOptions = {}): Promise<void> {
  await navigateToApp(page);
  await waitForAppReady(page);
  await ensureCleanHistory(page);

  await page.evaluate(() => {
    const api = window as typeof window & { getHistoryManager?: () => any };
    if (typeof api.getHistoryManager === 'function') {
      api.getHistoryManager();
    }
  });

  if (options.globalLab) {
    await loadGlobalLab(page, options.globalLab);
  }

  if (options.perChannelLab) {
    for (const [channel, content] of Object.entries(options.perChannelLab)) {
      await loadPerChannelLab(page, channel, content);
    }
  }
}

async function loadGlobalLab(page: Page, labText: string): Promise<void> {
  const filePath = await createTempFile('global-lab.txt', labText);
  const input = page.locator('#linearizationFile');
  await input.setInputFiles(filePath);
}

async function loadPerChannelLab(page: Page, channel: string, labText: string): Promise<void> {
  const filePath = await createTempFile(`${channel.toLowerCase()}-lab.txt`, labText);
  const row = page.locator(`[data-channel="${channel}"]`);
  const fileInput = row.locator('.per-channel-file');
  await fileInput.setInputFiles(filePath);
}

export async function saveCurveSnapshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const api = window as typeof window & { getHistoryManager?: () => any };
    const manager = typeof api.getHistoryManager === 'function' ? api.getHistoryManager() : null;
    if (!manager || typeof manager.captureState !== 'function') {
      throw new Error('HistoryManager.captureState not available');
    }
    manager.captureState('Fixture Snapshot');
    const entry = manager.history?.[manager.history.length - 1];
    if (!entry) {
      throw new Error('No history entries recorded after capture');
    }
    return JSON.stringify(entry.state ?? null);
  });
}

export async function restoreCurveSnapshot(page: Page, serialized: string): Promise<void> {
  await page.evaluate((payload) => {
    const api = window as typeof window & { getHistoryManager?: () => any };
    const manager = typeof api.getHistoryManager === 'function' ? api.getHistoryManager() : null;
    if (!manager || typeof manager.restoreSnapshot !== 'function') {
      throw new Error('HistoryManager.restoreSnapshot not available');
    }
    const state = JSON.parse(payload);
    if (!state) {
      throw new Error('Fixture payload missing state');
    }
    manager.restoreSnapshot(state);
  }, serialized);
}

export async function readFixtureFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}
