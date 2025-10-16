import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseLabData } from '../../src/js/data/lab-parser.js';
import { parseQuadFile } from '../../src/js/parsers/file-parsers.js';
import {
  beginCompositeLabRedistribution,
  registerCompositeLabBase,
  finalizeCompositeLabRedistribution
} from '../../src/js/core/processing-pipeline.js';
import {
  getCompositeDebugState,
  setCompositeDebugEnabled
} from '../../src/js/core/composite-debug.js';

const QUAD_PATH = path.resolve('data/P800_K36C26LK25_V6.quad');
const LAB_PATH = path.resolve('data/*BAKED* P800_K36C26LK25_V6.txt');
const SNAPSHOT_INDEX = 184;
const CHANNELS = ['K', 'C', 'LK'] as const;

beforeEach(() => {
  setCompositeDebugEnabled(true);
});

describe('composite redistribution analysis-only mode', () => {
  it('preserves baseline curves for baked LAB datasets', () => {
    const quadContent = fs.readFileSync(QUAD_PATH, 'utf8');
    const labContent = fs.readFileSync(LAB_PATH, 'utf8');

    const quadData = parseQuadFile(quadContent);
    const labEntry = parseLabData(labContent, path.basename(LAB_PATH));

    const channelNames = Object.keys(quadData.curves || {});
    const endValues: Record<string, number> = {};
    channelNames.forEach((name) => {
      const curve = quadData.curves[name];
      endValues[name] = Array.isArray(curve) ? Math.max(...curve) : 0;
    });

    const active = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      analysisOnly: true
    });

    expect(active).toBe(true);

    channelNames.forEach((name) => {
      registerCompositeLabBase(name, quadData.curves[name]);
    });

    finalizeCompositeLabRedistribution();

    const state = getCompositeDebugState();
    expect(state).toBeTruthy();
    expect(Array.isArray(state?.snapshots)).toBe(true);

    const snapshot = state?.snapshots?.[SNAPSHOT_INDEX];
    expect(snapshot).toBeTruthy();
    expect(snapshot?.deltaDensity ?? 0).toBeCloseTo(0, 6);
    expect(snapshot?.inkDelta ?? 0).toBe(0);

    CHANNELS.forEach((channel) => {
      const entry = snapshot?.perChannel?.[channel];
      expect(entry).toBeTruthy();
      expect(entry?.valueDelta ?? 0).toBeCloseTo(0, 6);
      expect((entry?.normalizedAfter ?? 0) - (entry?.normalizedBefore ?? 0)).toBeCloseTo(0, 6);
    });
  });
});
