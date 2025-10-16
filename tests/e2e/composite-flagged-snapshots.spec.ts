import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;

test.use({ headless: false });

test.describe('Composite flagged snapshots overlay', () => {
  test('renders flag marker and panel badge', async ({ page }) => {
    await page.goto(indexUrl);

    await page.locator('#optionsBtn').click();
    const debugToggle = page.locator('input#compositeDebugToggle');
    await expect(debugToggle).toBeVisible();
    await debugToggle.check();
    await page.locator('#closeOptionsBtn').click();

    const { flagKeys } = await page.evaluate(() => new Promise((resolve) => {
      const channelName = 'K';
      const snapshotFlags = {
        1: {
          kind: 'rise',
          magnitude: 75,
          threshold: 7,
          channels: [channelName],
          details: [
            {
              channel: channelName,
              delta: 75,
              magnitude: 75,
              direction: 'rise',
            },
          ],
        },
      };
      const snapshots = [
        {
          index: 0,
          inputPercent: 0,
          perChannel: {
            [channelName]: { normalizedAfter: 0.2 },
          },
        },
        {
          index: 1,
          inputPercent: 50,
          perChannel: {
            [channelName]: { normalizedAfter: 0.95 },
          },
        },
      ];
      const summary = {
        channelNames: [channelName],
        channelMaxima: { [channelName]: 65535 },
      };
      const debug = window.__quadDebug?.compositeDebug;
      debug?.setCompositeDebugEnabled?.(true);
      debug?.commitCompositeDebugSession?.({
        summary,
        snapshots,
        selectionIndex: 1,
        snapshotFlags,
        flags: snapshotFlags,
      });
      window.initializeCompositeDebugPanel?.();
      requestAnimationFrame(() => {
        window.updateInkChart?.();
        requestAnimationFrame(() => {
          const state = debug?.getCompositeDebugState?.();
          resolve({
            flagKeys: state && state.flags ? Object.keys(state.flags) : [],
          });
        });
      });
    }));

    expect(flagKeys).toContain('1');

    await page.waitForFunction(() => {
      const overlay = document.getElementById('snapshotFlagOverlay');
      const badge = document.querySelector('[data-debug-flags] button');
      return overlay?.querySelector('[data-flagged-snapshot]') && badge;
    });

    const stateFlags = await page.evaluate(() => window.getCompositeDebugState?.()?.flags ?? {});
    expect(Object.keys(stateFlags)).toContain('1');

    await expect(page.locator('[data-flagged-snapshot]')).toHaveCount(1);
    await expect(page.locator('[data-debug-flags] button')).toHaveCount(1);

    await expect(page).toHaveScreenshot('composite-flagged-snapshot.png', {
      fullPage: true,
      animations: 'disabled',
      mask: [page.locator('#status')],
    });
  });
});
