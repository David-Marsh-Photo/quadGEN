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

describe('Composite ladder release smoothing', () => {
  it('delays saturation and smooths the release taper', () => {
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
    expect(Array.isArray(state?.snapshots)).toBe(true);

    const snapshots = state.snapshots.filter(Boolean);
    const taperIndex = snapshots.findIndex((snap) => {
      const scale = snap?.perChannel?.LK?.reserveReleaseScale;
      return typeof scale === 'number' && scale < 0.999;
    });
    expect(taperIndex, 'expected reserve taper to engage after initial ramp').toBeGreaterThan(10);

    const taperSnapshot = snapshots[taperIndex];
    const taperFollowSnapshot = snapshots[taperIndex + 1];
    expect(taperSnapshot).toBeTruthy();
    expect(taperFollowSnapshot).toBeTruthy();

    const taperScale = taperSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    const taperNextScale = taperFollowSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    expect(taperScale).toBeGreaterThan(1e-4);
    expect(taperScale).toBeLessThan(1);
    expect(taperNextScale).toBeLessThanOrEqual(taperScale + 1e-6);

    const firstZeroIndex = snapshots.findIndex((snap) => {
      const lk = snap?.perChannel?.LK;
      return lk && (lk.headroomAfter ?? 0) <= 1e-4;
    });

    expect(firstZeroIndex, 'expected LK to retain headroom until the crest').toBeGreaterThanOrEqual(50);

    const crestSnapshot = snapshots[firstZeroIndex];
    const releaseSnapshot = snapshots[firstZeroIndex + 1];
    expect(crestSnapshot).toBeTruthy();
    expect(releaseSnapshot).toBeTruthy();

    const crestReserveScale = crestSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    const crestReserveHeadroom = crestSnapshot?.perChannel?.LK?.reserveReleaseHeadroom ?? 0;
    const releaseReserveScale = releaseSnapshot?.perChannel?.LK?.reserveReleaseScale ?? 1;
    expect(releaseReserveScale).toBeLessThanOrEqual(crestReserveScale + 1e-6);
    expect(crestReserveHeadroom).toBeGreaterThanOrEqual(0);
    expect(crestReserveHeadroom).toBeLessThan(0.06);

    const lkCrestDelta = crestSnapshot?.perChannel?.LK?.valueDelta ?? 0;
    const lkReleaseDelta = releaseSnapshot?.perChannel?.LK?.valueDelta ?? 0;
    const change = Math.abs(lkCrestDelta - lkReleaseDelta);

    expect(
      change,
      'LK release should taper instead of an abrupt drop'
    ).toBeLessThan(650);
  });
});
