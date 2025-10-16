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

test.describe('Composite normalized weighting ladder', () => {
test('uses lighter highlight before falling back to K [solver-overhaul-baseline]', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'overhaul-baseline', description: 'Normalized ladder baseline capture' });
    await page.goto(INDEX_URL);
    await waitForApp(page);
    await loadQuad(page);
    await loadGlobal(page);
    await page.waitForTimeout(4000);

    const tempDir = mkdtempSync(join(tmpdir(), 'normalized-ladder-'));
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

    const blendWindow = snapshots
      .filter((snap) => typeof snap?.index === 'number' && snap.index >= 16 && snap.index <= 20)
      .map((snap) => snap?.perChannel?.C?.normalizedAfter ?? null)
      .filter((value) => value != null);
    expect(blendWindow.length).toBeGreaterThan(1);

    let maxCJump = 0;
    for (let i = 1; i < blendWindow.length; i += 1) {
      const prev = blendWindow[i - 1] ?? 0;
      const current = blendWindow[i] ?? 0;
      const jump = Math.abs(current - prev);
      if (jump > maxCJump) {
        maxCJump = jump;
      }
    }
    expect(
      maxCJump,
      'C channel normalized share should not jump more than 0.001 between snapshots 16-20'
    ).toBeLessThanOrEqual(0.001);

    const target = report.snapshots.find((snap) => {
      if (!snap?.perChannel) return false;
      const lk = snap.perChannel.LK;
      const c = snap.perChannel.C;
      const k = snap.perChannel.K;
      if (!lk || !c || !k) return false;
      return (
        (lk.effectiveHeadroomAfter ?? lk.headroomAfter ?? 0) <= 5e-4 &&
        (lk.normalizedAfter ?? 0) > 0.97 &&
        (c.normalizedAfter ?? 0) - (c.normalizedBefore ?? 0) > 5e-5 &&
        ((k.normalizedAfter ?? 0) - (k.normalizedBefore ?? 0)) < 5e-3
      );
    });

    expect(target, 'expected snapshot where LK is clamped while C has headroom').toBeTruthy();

    const { perChannel } = target;
    const lk = perChannel.LK;
    const c = perChannel.C;
    const k = perChannel.K;

    expect(typeof lk.capacityBeforeNormalized).toBe('number');
    expect(typeof lk.capacityAfterNormalized).toBe('number');
    expect(typeof c.capacityBeforeNormalized).toBe('number');
    expect(typeof c.capacityAfterNormalized).toBe('number');

    expect(lk.normalizedAfter).toBeGreaterThan(0.97);
    expect(c.normalizedAfter - c.normalizedBefore).toBeGreaterThan(5e-5);

    const kDelta = k.normalizedAfter - (k.normalizedBefore ?? 0);
    expect(
      kDelta,
      'K should remain at baseline until lighter channels are exhausted'
    ).toBeLessThan(5e-3);

    const floorNormalized = lk.coverageFloorNormalized ?? 0;
    const expectedFloor = Math.max(lk.normalizedBefore ?? 0, c.normalizedAfter ?? 0);
    expect(Math.abs(floorNormalized - expectedFloor)).toBeLessThan(0.02);

    const layerNormalized = lk.layerNormalized ?? 0;
    expect(Math.abs(layerNormalized - ((lk.normalizedAfter ?? 0) - floorNormalized))).toBeLessThan(0.02);

    const ladderArray: any[] = Array.isArray(target.ladderSelection)
      ? (target.ladderSelection as any[])
      : [];
    const ladderEntry = ladderArray.find((entry) => entry?.channel === 'LK');
    expect(ladderEntry, 'ladder selection should include LK').toBeTruthy();
    if (ladderEntry) {
      if (typeof ladderEntry.floorNormalized === 'number') {
        expect(Math.abs(ladderEntry.floorNormalized - floorNormalized)).toBeLessThan(0.02);
      }
      if (typeof ladderEntry.layerNormalized === 'number') {
        expect(Math.abs(ladderEntry.layerNormalized - layerNormalized)).toBeLessThan(0.02);
      }
      const allowedNormalized = lk.allowedNormalized ?? null;
      if (allowedNormalized != null) {
        expect(Math.abs((ladderEntry.allowedNormalized ?? allowedNormalized) - allowedNormalized)).toBeLessThan(0.02);
      }
    }

    const firstZeroIndex = snapshots.findIndex((snap) => {
      const lkChannel = snap?.perChannel?.LK;
      return lkChannel && (lkChannel.headroomAfter ?? 0) <= 1e-4;
    });
    expect(firstZeroIndex, 'expected ladder to retain LK headroom until crest').toBeGreaterThanOrEqual(50);

    const taperIndex = snapshots.findIndex((snap) => {
      const scale = snap?.perChannel?.LK?.reserveReleaseScale;
      return typeof scale === 'number' && scale < 0.999;
    });
    expect(taperIndex, 'expected reserve taper to engage after initial ramp').toBeGreaterThan(10);

    const taperSnapshot = snapshots[taperIndex];
    const taperNextSnapshot = snapshots[taperIndex + 1];
    expect(taperSnapshot, 'taper snapshot must exist').toBeTruthy();
    expect(taperNextSnapshot, 'post-taper snapshot must exist').toBeTruthy();

    const taperScale = taperSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    const taperNextScale = taperNextSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    expect(taperScale).toBeGreaterThan(1e-4);
    expect(taperScale).toBeLessThan(1);
    expect(taperNextScale).toBeLessThanOrEqual(taperScale + 1e-6);

    const crestSnapshot = snapshots[firstZeroIndex];
    const releaseSnapshot = snapshots[firstZeroIndex + 1];
    expect(crestSnapshot, 'crest snapshot must exist').toBeTruthy();
    expect(releaseSnapshot, 'release snapshot must exist').toBeTruthy();

    const crestReserveScale = crestSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    const releaseReserveScale = releaseSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    expect(releaseReserveScale).toBeLessThanOrEqual(crestReserveScale + 1e-6);

    const lkCrestDelta = crestSnapshot?.perChannel?.LK?.valueDelta ?? 0;
    const lkReleaseDelta = releaseSnapshot?.perChannel?.LK?.valueDelta ?? 0;
    const deltaChange = Math.abs(lkCrestDelta - lkReleaseDelta);
    expect(
      deltaChange,
      'LK release should taper instead of a sharp drop'
    ).toBeLessThan(650);

    const reserveHandOff = snapshots.find((snap) => {
      if (!snap?.perChannel) return false;
      if ((snap.deltaDensity ?? 0) <= 0) return false;
      const lkChannel = snap.perChannel.LK;
      const cChannel = snap.perChannel.C;
      if (!lkChannel || !cChannel) return false;
      const cDelta = (cChannel.normalizedAfter ?? 0) - (cChannel.normalizedBefore ?? 0);
      return (
        (lkChannel.layerNormalized ?? 0) <= 1e-6 &&
        (lkChannel.reserveReleaseScale ?? 1) < 0.2 &&
        (lkChannel.reserveReleaseHeadroom ?? 0) <= ((lkChannel.frontReserveBase ?? 0) + 1e-3) &&
        cDelta > 5e-5
      );
    });
    expect(reserveHandOff, 'expected C to absorb the delta when LK is fully reserved').toBeTruthy();

    const crestStates = snapshots
      .filter((snap) => typeof snap?.index === 'number' && snap.index >= 48 && snap.index <= 58)
      .map((snap) => snap?.perChannel?.LK?.reserveState)
      .filter((value) => typeof value === 'string');
    expect(crestStates.length).toBeGreaterThan(0);
    expect(crestStates.some((state) => state === 'approaching')).toBe(true);
    expect(crestStates.some((state) => state === 'within')).toBe(true);
    expect(crestStates.some((state) => state === 'exhausted')).toBe(true);
  });
});
