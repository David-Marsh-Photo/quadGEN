import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'url';
import { resolve, dirname } from 'path';
import { mkdirSync } from 'fs';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/TRIFORCE_V4.quad');
const LAB_PATH = resolve('data/TRIFORCE_V4.txt');

async function waitForAppReady(page: Page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);

  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

test.describe('Composite debug panel', () => {
  test('enables debug overlay and tracks snapshot selection', async ({ page }, testInfo) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    // Enable composite debug panel via Options toggle
    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');
    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'attached', timeout: 10000 });
    await debugToggle.waitFor({ state: 'visible', timeout: 10000 });
    await debugToggle.check();
    const weightingSelect = page.locator('#compositeWeightingSelect');
    await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
    await weightingSelect.selectOption('normalized');
    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 5000 });

    // Load composite dataset
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return !!(data && data.curves && Object.keys(data.curves).length);
    }, null, { timeout: 15000 });

    await page.setInputFiles('#linearizationFile', LAB_PATH);

    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );

    await page.waitForTimeout(2000);

    await page.waitForFunction(() => {
      const state = typeof window.getCompositeDebugState === 'function' ? window.getCompositeDebugState() : null;
      return !!(state && state.enabled && state.summary);
    }, null, { timeout: 15000 });

    const panel = page.locator('#compositeDebugPanel');
    await expect(panel).toBeVisible();

    // Ensure maxima and weight summary render
    await expect(panel.locator('[data-debug-maxima]')).toContainText('K');

    const screenshot = await panel.screenshot();
    await testInfo.attach('composite-debug-panel.png', {
      body: screenshot,
      contentType: 'image/png'
    });
    await expect(panel.locator('[data-debug-weights]')).toContainText('LK');

    // Adjust snapshot selection via input
    const snapshotInput = page.locator('#compositeDebugSnapshotInput');
    await snapshotInput.fill('242');
    await snapshotInput.press('Enter');

    const stateAfterInput = await page.evaluate(() => {
      if (typeof window.getCompositeDebugState === 'function') {
        return window.getCompositeDebugState();
      }
      return null;
    });
    expect(stateAfterInput?.selection?.index).toBe(242);

    // Nudge forward using the next button
    await page.click('#compositeDebugNext');
    const stateAfterNext = await page.evaluate(() => {
      if (typeof window.getCompositeDebugState === 'function') {
        return window.getCompositeDebugState();
      }
      return null;
    });
    expect(stateAfterNext?.selection?.index).toBe(243);
    expect(stateAfterNext?.selection?.index).not.toBeNull();
    const debugComposite = stateAfterNext?.snapshots?.[243];
    expect(debugComposite?.perChannel?.C).toBeTruthy();

    // Snapshot detail area reflects the updated index
    await expect(panel.locator('[data-debug-selected]')).toContainText('243');
  });

  test('enabling overlay after loading data replays cached diagnostics', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    // Load data first with the overlay disabled
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return !!(data && data.curves && Object.keys(data.curves).length);
    }, null, { timeout: 15000 });

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );

    // Confirm overlay still hidden
    await page.waitForTimeout(500);
    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');
    const panelBefore = await page.evaluate(() => {
      const panel = document.getElementById('compositeDebugPanel');
      return panel ? !panel.classList.contains('hidden') : false;
    });
    expect(panelBefore).toBe(false);

    // Enable debug overlay now that data is loaded
    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'visible', timeout: 10000 });
    await debugToggle.check();
    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 5000 });

    await page.waitForFunction(() => {
      const state = typeof window.getCompositeDebugState === 'function' ? window.getCompositeDebugState() : null;
      return !!(state && state.enabled && state.summary);
    }, null, { timeout: 15000 });

    const panel = page.locator('#compositeDebugPanel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-debug-mode]')).toContainText('Mode');
    await expect(panel.locator('[data-debug-maxima]')).toContainText('K');
  });

  test('channel rows remain in base channel order across snapshots', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    // Enable composite debug panel
    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');
    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'visible', timeout: 10000 });
    await debugToggle.check();
    const weightingSelect = page.locator('#compositeWeightingSelect');
    await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
    await weightingSelect.selectOption('normalized');
    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 5000 });

    // Load composite dataset
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return !!(data && data.curves && Object.keys(data.curves).length);
    }, null, { timeout: 15000 });

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );

    await page.waitForFunction(() => {
      const state = typeof window.getCompositeDebugState === 'function' ? window.getCompositeDebugState() : null;
      return !!(state && state.enabled && state.summary);
    }, null, { timeout: 15000 });

    const panel = page.locator('#compositeDebugPanel');
    await expect(panel).toBeVisible();

    const snapshotInput = page.locator('#compositeDebugSnapshotInput');

    const captureOrder = async (index: number) => {
      await snapshotInput.fill(String(index));
      await snapshotInput.press('Enter');
      await page.waitForFunction(
        (target) => {
          if (typeof window.getCompositeDebugState !== 'function') return false;
          const state = window.getCompositeDebugState();
          if (!state || state.selection?.index !== target) return false;
          const selected = document.querySelector('[data-debug-selected]');
          return !!selected && selected.textContent?.includes(`#${target}`);
        },
        index,
        { timeout: 15000 }
      );
      await page.waitForFunction(() => {
        const labels = document.querySelectorAll('[data-debug-channels] .tracking-wide.uppercase');
        return labels.length > 0;
      }, null, { timeout: 5000 });
      return page.evaluate(() => {
        const labels = Array.from(
          document.querySelectorAll('[data-debug-channels] .tracking-wide.uppercase')
        );
        return labels.map((el) => (el.textContent || '').trim()).filter(Boolean);
      });
    };

    const orderAtFive = await captureOrder(5);
    expect(orderAtFive.length).toBeGreaterThan(0);

    const orderAtOneEightyFour = await captureOrder(184);
    expect(orderAtOneEightyFour.length).toBeGreaterThan(0);

    expect(orderAtOneEightyFour).toEqual(orderAtFive);
  });

  test('shows smoothing window badge when redistribution smoothing is enabled', async ({ page }, testInfo) => {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');
    const debugToggle = page.locator('#compositeDebugToggle');
    await debugToggle.waitFor({ state: 'visible', timeout: 10000 });
    await debugToggle.check();
    const smoothingToggle = page.locator('#redistributionSmoothingToggle');
    await smoothingToggle.waitFor({ state: 'visible', timeout: 10000 });
    await smoothingToggle.check();
    const weightingSelect = page.locator('#compositeWeightingSelect');
    await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
    await weightingSelect.selectOption('normalized');
    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 5000 });

    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return !!(data && data.curves && Object.keys(data.curves).length);
    }, null, { timeout: 15000 });

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );

    const panel = page.locator('#compositeDebugPanel');
    await expect(panel).toBeVisible();

    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');
    await expect(smoothingToggle).toBeChecked();
    await expect(debugToggle).toBeChecked();
    await page.click('#closeOptionsBtn');
    const targetIndex = await page.evaluate<number | null>(() => {
      const state = typeof window.getCompositeDebugState === 'function' ? window.getCompositeDebugState() : null;
      if (!state || !state.summary) {
        return null;
      }
      const summary = state.summary;
      if (Array.isArray(summary.smoothingWindows) && summary.smoothingWindows.length) {
        const windowEntry = summary.smoothingWindows.find((entry) => Number.isInteger(entry?.startIndex) && Number.isInteger(entry?.endIndex));
        if (windowEntry) {
          const start = Number(windowEntry.startIndex);
          const end = Number(windowEntry.endIndex);
          if (Number.isInteger(start) && Number.isInteger(end)) {
            return Math.round((start + end) / 2);
          }
        }
      }
      if (summary.coverageSummary && typeof summary.coverageSummary === 'object') {
        for (const entry of Object.values(summary.coverageSummary)) {
          if (!entry || typeof entry !== 'object') continue;
          const samples = Array.isArray((entry as any).clampedSamples) ? (entry as any).clampedSamples : [];
          const first = samples.find((sample: any) => Number.isFinite(sample?.index));
          if (first) {
            const idx = Math.trunc(Number(first.index));
            if (Number.isInteger(idx)) {
              return idx;
            }
          }
        }
      }
      return null;
    });
    if (targetIndex === null) {
      test.skip(true, 'Smoothing metadata unavailable for current dataset.');
      return;
    }

    const snapshotInput = page.locator('#compositeDebugSnapshotInput');
    await snapshotInput.fill(String(targetIndex));
    await snapshotInput.press('Enter');
    await expect(panel.locator('[data-debug-selected]')).toContainText(`#${targetIndex}`);
    const badge = panel.locator('[data-debug-smoothing-badge]');
    await expect(badge).toBeVisible();

    const screenshotPath = resolve('artifacts/composite-smoothing-window.png');
    mkdirSync(dirname(screenshotPath), { recursive: true });
    await panel.screenshot({ path: screenshotPath });
    await testInfo.attach('composite-smoothing-window.png', { path: screenshotPath, contentType: 'image/png' });
  });
});
