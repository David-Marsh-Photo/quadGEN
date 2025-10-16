import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseQuadFile,
  parseLabData
} from '../../src/js/parsers/file-parsers.js';
import {
  beginCompositeLabRedistribution,
  registerCompositeLabBase,
  finalizeCompositeLabRedistribution
} from '../../src/js/core/processing-pipeline.js';
import {
  setCompositeWeightingMode
} from '../../src/js/core/composite-settings.js';
import {
  setCompositeDebugEnabled,
  getCompositeDebugState
} from '../../src/js/core/composite-debug.js';

const QUAD_PATH = path.resolve('data/P800_K36C26LK25_V6.quad');
const LAB_PATH = path.resolve('data/P800_K36C26LK25_V6.txt');

beforeEach(() => {
  setCompositeDebugEnabled(true);
  setCompositeWeightingMode('normalized');
});

describe('Composite solver negative-delta easing [solver-overhaul-sign-flip]', () => {
  it('limits the K channel delta and keeps C tapering when the correction flips negative', () => {
    const quadContent = fs.readFileSync(QUAD_PATH, 'utf8');
    const labContent = fs.readFileSync(LAB_PATH, 'utf8');

    const quadData = parseQuadFile(quadContent);
    expect(quadData.valid).toBe(true);

    const labEntry = parseLabData(labContent, path.basename(LAB_PATH));
    expect(labEntry?.valid).toBe(true);

    const channelNames = ['K', 'C', 'LK'];
    const endValues = {};
    channelNames.forEach((channel) => {
      const curve = quadData.curves?.[channel];
      expect(Array.isArray(curve)).toBe(true);
      endValues[channel] = Math.max(...curve);
    });

    const sessionActive = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      weightingMode: 'normalized'
    });
    expect(sessionActive).toBe(true);

    channelNames.forEach((channel) => {
      registerCompositeLabBase(channel, quadData.curves[channel]);
    });

    finalizeCompositeLabRedistribution();

    const state = getCompositeDebugState();
    expect(state).toBeTruthy();
    const snapshots = Array.isArray(state?.snapshots) ? state.snapshots : [];
    expect(snapshots.length).toBeGreaterThan(160);

    const signFlipIndex = snapshots.findIndex((snap, idx) => {
      if (!snap) return false;
      const delta = snap.deltaDensity ?? 0;
      const prev = idx > 0 ? (snapshots[idx - 1]?.deltaDensity ?? 0) : 0;
      return delta < -1e-6 && prev > 0;
    });

    expect(signFlipIndex, 'expected to find sign flip in composite snapshots').toBeGreaterThan(0);

    const window = snapshots.slice(signFlipIndex, signFlipIndex + 8);
    expect(window.length).toBeGreaterThan(4);

    let maxKStep = 0;
    let cDeltaRegistered = false;
    let previousKAfter = null;
    let previousCAfter = null;

    window.forEach((snap) => {
      const perChannel = snap?.perChannel ?? {};
      const k = perChannel.K ?? {};
      const c = perChannel.C ?? {};

      const kAfter = k.normalizedAfter ?? null;
      if (kAfter != null) {
        if (previousKAfter != null) {
          const kStep = Math.abs(kAfter - previousKAfter);
          if (kStep > maxKStep) {
            maxKStep = kStep;
          }
        }
        previousKAfter = kAfter;
      }

      const cAfter = c.normalizedAfter ?? null;
      if (cAfter != null && previousCAfter != null) {
        const cStep = cAfter - previousCAfter;
        if (Math.abs(cStep) >= 1e-4) {
          cDeltaRegistered = true;
        }
      }
      if (cAfter != null) {
        previousCAfter = cAfter;
      }
    });

    expect(
      maxKStep,
      'K channel should not change more than 0.02 between successive snapshots when the correction flips negative'
    ).toBeLessThanOrEqual(0.02);

    expect(
      cDeltaRegistered,
      'C channel should taper rather than freezing at zero delta during the negative sign flip window'
    ).toBe(true);
  });
});
