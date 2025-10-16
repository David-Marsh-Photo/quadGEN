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

describe('Composite ladder blend window [solver-overhaul-blend]', () => {
  it('keeps channel shares from jumping more than 0.1 between snapshots 16-20', () => {
    const quadContent = fs.readFileSync(QUAD_PATH, 'utf8');
    const labContent = fs.readFileSync(LAB_PATH, 'utf8');

    const quadData = parseQuadFile(quadContent);
    expect(quadData.valid).toBe(true);

    const labEntry = parseLabData(labContent, path.basename(LAB_PATH));
    expect(labEntry?.valid).toBe(true);

    const channelNames = ['LK', 'C', 'K'];
    const endValues = {};
    channelNames.forEach((channel) => {
      const curve = quadData.curves?.[channel];
      expect(Array.isArray(curve)).toBe(true);
      endValues[channel] = Math.max(...curve);
    });

    const active = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      weightingMode: 'normalized'
    });
    expect(active).toBe(true);

    channelNames.forEach((channel) => {
      registerCompositeLabBase(channel, quadData.curves[channel]);
    });

    finalizeCompositeLabRedistribution();

    const state = getCompositeDebugState();
    expect(state).toBeTruthy();
    const snapshots = Array.isArray(state?.snapshots) ? state.snapshots : [];
    expect(snapshots.length).toBeGreaterThan(30);

    const cSeries = snapshots
      .map((snap, index) => ({
        index,
        normalizedAfter: snap?.perChannel?.C?.normalizedAfter ?? null
      }))
      .filter(({ normalizedAfter }) => normalizedAfter != null);

    const windowStart = 16;
    const windowEnd = 20;
    const windowSeries = cSeries.filter(({ index }) => index >= windowStart && index <= windowEnd);
    expect(windowSeries.length).toBeGreaterThan(1);

    let maxJump = 0;
    for (let i = 1; i < windowSeries.length; i += 1) {
      const prev = windowSeries[i - 1].normalizedAfter ?? 0;
      const current = windowSeries[i].normalizedAfter ?? 0;
      maxJump = Math.max(maxJump, Math.abs(current - prev));
    }

    expect(
      maxJump,
      'normalized C share should ramp smoothly during ladder promotion (jump ≤ 0.001)'
    ).toBeLessThanOrEqual(0.001);
  });
});
