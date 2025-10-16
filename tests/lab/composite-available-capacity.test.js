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

describe('Composite capacity accounting [solver-overhaul-available-capacity]', () => {
  it('exposes a per-channel available capacity metric before and after redistribution', () => {
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
    const snapshots = state?.snapshots ?? [];
    expect(Array.isArray(snapshots)).toBe(true);

    const highlightSnapshot = snapshots.find((snap) => {
      const lk = snap?.perChannel?.LK;
      return lk && (lk.normalizedAfter ?? 0) > 0.9;
    });
    expect(highlightSnapshot, 'expected highlight snapshot to exist').toBeTruthy();

    const lk = highlightSnapshot?.perChannel?.LK ?? {};
    const c = highlightSnapshot?.perChannel?.C ?? {};

    expect(typeof lk.capacityBeforeNormalized).toBe('number');
    expect(typeof lk.capacityAfterNormalized).toBe('number');
    expect(typeof c.capacityBeforeNormalized).toBe('number');
    expect(typeof c.capacityAfterNormalized).toBe('number');

    expect(lk.capacityBeforeNormalized).toBeGreaterThanOrEqual(lk.capacityAfterNormalized ?? Number.NEGATIVE_INFINITY);
    expect(c.capacityBeforeNormalized).toBeGreaterThanOrEqual(0);
  });
});
