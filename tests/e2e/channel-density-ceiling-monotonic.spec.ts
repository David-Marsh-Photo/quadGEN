import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const GLOBAL_PATH = resolve('data/P800_K36C26LK25_V6.txt');
const SNAPSHOT_RANGE = [182, 183, 184, 185, 186] as const;
const CHANNELS = ['K', 'C'] as const;
const EPSILON = 1e-12;

async function waitForApp(page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 }),
    page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 })
  ]);
  await page.waitForFunction(
    () => typeof window.getLoadedQuadData === 'function' &&
      typeof window.getCompositeDebugState === 'function',
    null,
    { timeout: 20000 }
  );
}

async function loadQuad(page) {
  await page.setInputFiles('#quadFile', QUAD_PATH);
  await page.waitForFunction(
    () => {
      const data = window.getLoadedQuadData?.();
      return !!(data && data.curves && data.curves.K && data.curves.C);
    },
    null,
    { timeout: 20000 }
  );
}

async function loadGlobal(page) {
  await page.setInputFiles('#linearizationFile', GLOBAL_PATH);
  await page.waitForFunction(
    () => window.LinearizationState?.globalApplied === true,
    null,
    { timeout: 20000 }
  );
}

test.describe('Composite density ceilings', () => {
  test('highlight inks do not reverse direction when delta demands lightening', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForApp(page);
    await loadQuad(page);
    await loadGlobal(page);
    await page.waitForTimeout(5000); // allow composite redistribution to settle

    const tempDir = mkdtempSync(join(tmpdir(), 'density-debug-'));
    const outputPath = join(tempDir, 'snapshot.json');
    execFileSync('node', [
      resolve('scripts/capture-composite-debug.mjs'),
      '--quad', QUAD_PATH,
      '--lab', GLOBAL_PATH,
      '--mode', 'equal',
      '--output', outputPath
    ], { cwd: resolve('.') });

    const snapshots = JSON.parse(readFileSync(outputPath, 'utf8')).snapshots;
    rmSync(tempDir, { recursive: true, force: true });
    expect(Array.isArray(snapshots)).toBe(true);

    CHANNELS.forEach((channel) => {
      let previous: number | null = null;
      SNAPSHOT_RANGE.forEach((idx) => {
        const snapshot = snapshots?.[idx] || null;
        expect(snapshot, `missing snapshot ${idx}`).toBeTruthy();
        const perChannel = snapshot?.perChannel?.[channel];
        expect(perChannel, `missing ${channel} data at ${idx}`).toBeTruthy();
        const normalizedAfter = Number(perChannel?.normalizedAfter);
        expect(Number.isFinite(normalizedAfter), `invalid normalized value for ${channel} at ${idx}`).toBe(true);

        if (previous != null) {
          expect(
            normalizedAfter,
            `${channel} normalized output increased between snapshots with negative deltaDensity`
          ).toBeLessThanOrEqual(previous + EPSILON);
        }
        previous = normalizedAfter;
      });
    });
  });
});
