import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const quadPath = resolve('data/P800_K36C26LK25_V6.quad');
const EXPECTED_P800_CHANNELS = ['C', 'K', 'LC', 'LK', 'LM', 'LLK', 'M', 'Y'];
const P700_SUPERSET_CHANNELS = ['C', 'K', 'LC', 'LK', 'LM', 'LLK', 'M', 'MK', 'V', 'Y'];
const quadSupersetPath = resolve('data/P700-P900_MK100-3.quad');

async function waitForQuadLoad(page: import('@playwright/test').Page) {
  await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
  await page.setInputFiles('#quadFile', quadPath);
  await page.waitForFunction(
    () => (window.getLoadedQuadData?.()?.curves?.K || []).length === 256,
    null,
    { timeout: 20000 }
  );
}

test.describe('Printer channel state pruning', () => {
  test('state manager drops channels outside the loaded quad layout', async ({ page }) => {
    await page.goto(indexUrl);
    await waitForQuadLoad(page);

    const snapshot = await page.evaluate(() => {
      const manager = typeof window.getStateManager === 'function' ? window.getStateManager() : null;
      if (!manager) {
        return null;
      }
      const state = manager.getState();
      const channelValues = state?.printer?.channelValues || {};
      const channelStates = state?.printer?.channelStates || {};
      const activeChannels = state?.printer?.channels || [];
      const enabledMap: Record<string, boolean> = {};
      Object.keys(channelStates).forEach((name) => {
        enabledMap[name] = manager.isChannelEnabled(name);
      });
      return {
        valuesKeys: Object.keys(channelValues).sort(),
        statesKeys: Object.keys(channelStates).sort(),
        channelValues,
        channelStates,
        enabledMap,
        activeChannels
      };
    });

    expect(snapshot).not.toBeNull();
    if (!snapshot) {
      return;
    }
    const expected = [...EXPECTED_P800_CHANNELS].sort();
    expect(snapshot.valuesKeys).toEqual(expected);
    expect(snapshot.statesKeys).toEqual(expected);
  });

  test('switching between printer layouts prunes legacy channel state', async ({ page }) => {
    await page.goto(indexUrl);
    await waitForQuadLoad(page);

    await page.setInputFiles('#quadFile', quadSupersetPath);
    await page.waitForFunction(
      () => {
        const data = window.getLoadedQuadData?.();
        const channels = data?.channels || [];
        return channels.includes('MK') && channels.includes('V');
      },
      null,
      { timeout: 20000 }
    );

    const supersetSnapshot = await page.evaluate(() => {
      const manager = window.getStateManager?.();
      if (!manager) return null;
      const state = manager.getState();
      return {
        valuesKeys: Object.keys(state.printer?.channelValues || {}).sort(),
        statesKeys: Object.keys(state.printer?.channelStates || {}).sort()
      };
    });

    expect(supersetSnapshot).not.toBeNull();
    if (!supersetSnapshot) {
      return;
    }
    expect(supersetSnapshot.valuesKeys).toEqual([...P700_SUPERSET_CHANNELS].sort());
    expect(supersetSnapshot.statesKeys).toEqual([...P700_SUPERSET_CHANNELS].sort());

    await waitForQuadLoad(page); // reload P800 dataset

    const trimmed = await page.evaluate(() => {
      const manager = window.getStateManager?.();
      if (!manager) return null;
      const state = manager.getState();
      return {
        valuesKeys: Object.keys(state.printer?.channelValues || {}).sort(),
        statesKeys: Object.keys(state.printer?.channelStates || {}).sort()
      };
    });

    expect(trimmed).not.toBeNull();
    if (!trimmed) return;
    const expectedSubset = [...EXPECTED_P800_CHANNELS].sort();
    expect(trimmed.valuesKeys).toEqual(expectedSubset);
    expect(trimmed.statesKeys).toEqual(expectedSubset);
  });
});
