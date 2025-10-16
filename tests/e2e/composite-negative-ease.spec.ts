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
    () =>
      typeof window.getLoadedQuadData === 'function' &&
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

test.describe('Composite sign-flip easing', () => {
  test('smooths dark-channel uptake and keeps lighter channel tapering [solver-overhaul-sign-flip]', async ({ page }, testInfo) => {
    testInfo.annotations.push({
      type: 'overhaul-sign-flip',
      description: 'Normalized weighting negative-delta easing capture'
    });

    await page.goto(INDEX_URL);
    await waitForApp(page);
    await loadQuad(page);
    await loadGlobal(page);
    await page.waitForTimeout(4000);

    const tempDir = mkdtempSync(join(tmpdir(), 'normalized-signflip-'));
    const outputPath = join(tempDir, 'snapshot.json');

    execFileSync('node', [
      resolve('scripts/capture-composite-debug.mjs'),
      '--quad', QUAD_PATH,
      '--lab', GLOBAL_PATH,
      '--mode', 'normalized',
      '--output', outputPath
    ], { cwd: resolve('.') });

    const report = JSON.parse(readFileSync(outputPath, 'utf8'));
    rmSync(tempDir, { recursive: true, force: true });

    expect(Array.isArray(report.snapshots)).toBe(true);
    const snapshots = report.snapshots.filter(Boolean);
    expect(snapshots.length).toBeGreaterThan(160);

    const signFlipIndex = snapshots.findIndex((snap, idx) => {
      const delta = snap?.deltaDensity ?? 0;
      const prevDelta = idx > 0 ? (snapshots[idx - 1]?.deltaDensity ?? 0) : 0;
      return delta < -1e-6 && prevDelta > 0;
    });
    expect(signFlipIndex).toBeGreaterThanOrEqual(0);

    const window = snapshots.slice(signFlipIndex, signFlipIndex + 8);
    expect(window.length).toBeGreaterThan(4);

    let maxKStep = 0;
    let cDeltaRegistered = false;
    let previousKAfter: number | null = null;
    let previousCAfter: number | null = null;

    for (const snap of window) {
      const perChannel = snap?.perChannel ?? {};
      const k = perChannel.K ?? {};
      const c = perChannel.C ?? {};

      const kAfter = typeof k.normalizedAfter === 'number' ? k.normalizedAfter : null;
      if (kAfter != null) {
        if (previousKAfter != null) {
          const step = Math.abs(kAfter - previousKAfter);
          if (step > maxKStep) {
            maxKStep = step;
          }
        }
        previousKAfter = kAfter;
      }

      const cAfter = typeof c.normalizedAfter === 'number' ? c.normalizedAfter : null;
      if (cAfter != null && previousCAfter != null) {
        const cStep = cAfter - previousCAfter;
        if (Math.abs(cStep) >= 1e-4) {
          cDeltaRegistered = true;
        }
      }
      if (cAfter != null) {
        previousCAfter = cAfter;
      }
    }

    expect(
      maxKStep,
      'K channel delta per sample should stay within 0.02 after sign flip'
    ).toBeLessThanOrEqual(0.02);

    expect(
      cDeltaRegistered,
      'C channel must continue tapering instead of freezing during the sign flip window'
    ).toBe(true);
  });
});
