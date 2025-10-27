import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { gotoApp, loadQuadFixture, enableEditMode } from './utils/edit-mode-helpers';

const KCLK_QUAD_PATH = resolve('data/KCLK.quad');

type BaselineState = {
  baseline: Record<string, number[]>;
  ends: Record<string, number>;
  activeChannels: string[];
  plateau: Record<string, boolean>;
};

type PostToggleState = {
  samples: Record<string, number[]>;
  plateauFlags: Record<string, boolean>;
  relativePeaks: Record<string, number | null>;
  seedSummary: {
    channelName: string;
    pointCount: number;
    linearSource: boolean;
    context: string;
  } | null;
};

test.describe('Edit Mode plateau regression – KCLK quad', () => {
  test('enabling Edit Mode preserves loaded curve samples for every active channel', async ({ page }) => {
    await gotoApp(page);
    await loadQuadFixture(page, KCLK_QUAD_PATH);
    await page.evaluate(() => {
      (window as typeof window & { DEBUG_LOGS?: boolean }).DEBUG_LOGS = true;
    });
    const state = (await page.evaluate(() => {
      const win = window as typeof window & {
        getLoadedQuadData?: () => any;
        loadedQuadData?: any;
      };
      const snapshot: BaselineState = {
        baseline: {},
        ends: {},
        activeChannels: [],
        plateau: {}
      };

      const data = typeof win.getLoadedQuadData === 'function' ? win.getLoadedQuadData() : win.loadedQuadData;
      if (!data || typeof data !== 'object' || !data.curves) {
        throw new Error('Quad data did not load correctly');
      }

      const entries = Object.entries(data.curves as Record<string, unknown>);
      for (const [channel, rawValues] of entries) {
        if (!Array.isArray(rawValues) || rawValues.length === 0) continue;
        const numericValues = rawValues.map((value) => {
          const n = Number(value);
          return Number.isFinite(n) ? n : 0;
        });
        snapshot.baseline[channel] = numericValues;

        const row = document.querySelector<HTMLTableRowElement>(`tr.channel-row[data-channel="${channel}"]`);
        const endInput = row?.querySelector<HTMLInputElement>('.end-input');
        let endValue = Number(endInput?.value ?? Number.NaN);
        if (!Number.isFinite(endValue)) {
          const fallback =
            (data.inkLimits && typeof data.inkLimits[channel]?.value === 'number' ? data.inkLimits[channel].value : null) ??
            (data.endPoints && typeof data.endPoints[channel]?.value === 'number' ? data.endPoints[channel].value : null);
          endValue = typeof fallback === 'number' ? fallback : Number.NaN;
        }

        if (Number.isFinite(endValue)) {
          snapshot.ends[channel] = endValue;
          const hasSignal = numericValues.some((value) => value > 0);
          if (hasSignal) {
            snapshot.activeChannels.push(channel);
          }

          if (numericValues.length > 0) {
            const tailWindow = Math.min(32, numericValues.length);
            const tailSlice = numericValues.slice(numericValues.length - tailWindow);
            const plateau =
              tailSlice.length > 0 &&
              tailSlice.every((value) => value === tailSlice[tailSlice.length - 1]) &&
              tailSlice[0] > 0;
            snapshot.plateau[channel] = plateau;
          }
        }
      }

      return snapshot;
    })) as BaselineState;

    const { baseline, ends, activeChannels, plateau: baselinePlateaus } = state;

    await enableEditMode(page);

    if (activeChannels.length > 0) {
      await page.waitForFunction(
        (channels) => {
          const win = window as typeof window & {
            ControlPoints?: { get?: (channel: string) => { points: Array<{ input: number; output: number }> | null } };
          };
          if (!Array.isArray(channels) || channels.length === 0) return true;
          if (!win.ControlPoints || typeof win.ControlPoints.get !== 'function') return false;
          for (const channel of channels) {
            const entry = win.ControlPoints.get(channel);
            if (!entry || !Array.isArray(entry.points) || entry.points.length < 2) {
              return false;
            }
          }
          return true;
        },
        activeChannels,
        { timeout: 15000 }
      );
    }

    const post = (await page.evaluate(({ ends: incomingEnds }) => {
      const win = window as typeof window & {
        make256?: (endValue: number, channelName: string, applyLinearization?: boolean) => number[];
        ControlPoints?: {
          get: (channel: string) => { points: Array<{ input: number; output: number }> } | null;
        };
      };

      const result: PostToggleState = {
        samples: {},
        plateauFlags: {},
        relativePeaks: {},
        seedSummary: null
      };

      const entries = Object.entries(incomingEnds as Record<string, number>);
      for (const [channel, endValue] of entries) {
        if (!Number.isFinite(endValue)) continue;
        const values = win.make256 ? win.make256(Number(endValue), channel, true) : [];
        const numericValues = Array.isArray(values)
          ? values.map((value) => {
              const n = Number(value);
              return Number.isFinite(n) ? n : 0;
            })
          : [];
        result.samples[channel] = numericValues;
        if (numericValues.length === 0) {
          result.plateauFlags[channel] = false;
          result.relativePeaks[channel] = null;
          continue;
        }
        const tailWindow = Math.min(32, numericValues.length);
        const tailSlice = numericValues.slice(numericValues.length - tailWindow);
        const plateau = tailSlice.every((value) => value === tailSlice[tailSlice.length - 1]) && tailSlice[0] > 0;
        result.plateauFlags[channel] = plateau;

        const smartEntry = win.ControlPoints?.get?.(channel) || null;
        const lastPoint =
          smartEntry && Array.isArray(smartEntry.points) && smartEntry.points.length
            ? smartEntry.points[smartEntry.points.length - 1]
            : null;
        result.relativePeaks[channel] =
          lastPoint && typeof lastPoint.output === 'number' ? lastPoint.output : null;
      }

      const lastSeed = (window as any).__EDIT_LAST_SEED;
      if (lastSeed && typeof lastSeed === 'object') {
        result.seedSummary = {
          channelName: lastSeed.channelName,
          pointCount: Number(lastSeed.pointCount) || 0,
          linearSource: !!lastSeed.linearSource,
          context: String(lastSeed.context || '')
        };
      }

      return result;
    }, { ends })) as PostToggleState;

    const seedAudit = (await page.evaluate(() => {
      const audit = (window as any).__EDIT_SEED_AUDIT || {};
      return audit;
    })) as Record<string, { absolutePreview?: Array<{ input: number; output: number }>; samplePreview?: number[] }>;

    const kControlPointsLength = await page.evaluate(() => {
      const entry = (window as any).ControlPoints?.get?.('K');
      return entry && Array.isArray(entry.points) ? entry.points.length : 0;
    });

    for (const channel of Object.keys(baseline)) {
      const baseValues = baseline[channel];
      if (!Array.isArray(baseValues) || baseValues.length === 0) continue;
      const postValues = post.samples[channel];
      expect(postValues, `Missing post-toggle samples for ${channel}`).toBeDefined();
      expect(postValues.length, `Sample length mismatch for ${channel}`).toBe(baseValues.length);
      expect(postValues, `${channel} samples changed after enabling Edit Mode`).toEqual(baseValues);
      const plateauDetected = post.plateauFlags[channel] ?? false;
      const expectedPlateau = baselinePlateaus[channel] ?? false;
      expect(
        plateauDetected,
        `${channel} channel plateau state diverged after enabling Edit Mode`
      ).toBe(expectedPlateau);
    }

    const kRelativePeak = post.relativePeaks.K;
    expect(kRelativePeak, 'Missing Smart curve peak for K channel').not.toBeNull();
    expect(Number(kRelativePeak)).toBeGreaterThanOrEqual(100);

    expect(seedAudit?.K, 'Missing seed audit for K channel').toBeTruthy();
    const kAbsolutePreview = seedAudit?.K?.absolutePreview || [];
    expect(kAbsolutePreview.length).toBeGreaterThan(0);
    expect(kAbsolutePreview.some((point) => Number(point?.output) > 0)).toBe(true);
    expect(kControlPointsLength, 'Insufficient Smart key points for K channel').toBeGreaterThan(2);
  });
});
