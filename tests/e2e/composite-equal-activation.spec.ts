import { test, expect } from '@playwright/test';
import { resolve, join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const GLOBAL_PATH = resolve('data/P800_K36C26LK25_V6.txt');

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
      return !!(data && data.curves && data.curves.K && data.curves.C && data.curves.LK);
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

test.describe('Composite equal weighting activation', () => {
  test('secondary channel participates once primary highlight saturates', async ({ page }) => {
    await page.goto(INDEX_URL);
    await waitForApp(page);
    await loadQuad(page);
    await loadGlobal(page);
    await page.waitForTimeout(4000);

    const tempDir = mkdtempSync(join(tmpdir(), 'equal-activation-'));
    const outputPath = join(tempDir, 'snapshot.json');

    execFileSync('node', [
      resolve('scripts/capture-composite-debug.mjs'),
      '--quad', QUAD_PATH,
      '--lab', GLOBAL_PATH,
      '--mode', 'equal',
      '--output', outputPath
    ], { cwd: resolve('.') });

    const report = JSON.parse(readFileSync(outputPath, 'utf8'));
    rmSync(tempDir, { recursive: true, force: true });

    expect(Array.isArray(report.snapshots)).toBe(true);
    const snapshot = report.snapshots?.[5];
    expect(snapshot, 'missing snapshot 5').toBeTruthy();
    const channelData = snapshot.perChannel?.C;
    expect(channelData, 'no C channel data in snapshot 5').toBeTruthy();

    const normalizedBefore = Number(channelData.normalizedBefore);
    const normalizedAfter = Number(channelData.normalizedAfter);
    expect(Number.isFinite(normalizedBefore)).toBe(true);
    expect(Number.isFinite(normalizedAfter)).toBe(true);

    const delta = normalizedAfter - normalizedBefore;
    expect(
      delta,
      'Equal weighting should let C pick up density once LK is capped'
    ).toBeGreaterThan(1e-4);
  });
});
