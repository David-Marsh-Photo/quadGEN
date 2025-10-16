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

describe('Composite density ladder ordering [solver-overhaul-baseline]', () => {
  it('keeps K idle while lighter inks retain headroom', () => {
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

    const target = state?.snapshots?.find((snap) => {
      if (!snap?.perChannel) return false;
      const lk = snap.perChannel.LK;
      const c = snap.perChannel.C;
      const k = snap.perChannel.K;
      if (!lk || !c || !k) return false;
      const normalizedDelta = (c.normalizedAfter ?? 0) - (c.normalizedBefore ?? 0);
      const effectiveLK = lk.effectiveHeadroomAfter ?? lk.headroomAfter ?? 0;
      return (
        effectiveLK <= 5e-4 &&
        (lk.normalizedAfter ?? 0) > 0.98 &&
        normalizedDelta > 5e-5 &&
        ((k.normalizedAfter ?? 0) - (k.normalizedBefore ?? 0)) < 5e-3
      );
    });

    expect(target, 'expected snapshot where LK is constrained and C still has headroom').toBeTruthy();

    const lk = target.perChannel.LK;
    const c = target.perChannel.C;
    const k = target.perChannel.K;
    expect(Array.isArray(target.ladderSelection)).toBe(true);
    // console.log('ladderTrace', target.ladderTrace);

    expect(lk.normalizedAfter).toBeGreaterThan(0.97);
    expect(c.normalizedAfter - c.normalizedBefore).toBeGreaterThan(1e-4);

    const kDelta = (k.normalizedAfter ?? 0) - (k.normalizedBefore ?? 0);
    expect(
      kDelta,
      'K should not increase until lighter channels are exhausted'
    ).toBeLessThan(5e-3);

    const floorNormalized = lk.coverageFloorNormalized ?? 0;
    const expectedFloor = Math.max(lk.normalizedBefore ?? 0, c.normalizedAfter ?? 0);
    expect(Math.abs(floorNormalized - expectedFloor)).toBeLessThan(0.02);

    const layerNormalized = lk.layerNormalized ?? 0;
    expect(Math.abs(layerNormalized - ((lk.normalizedAfter ?? 0) - floorNormalized))).toBeLessThan(0.02);
  });

  it('hands off to C when LK headroom is fully reserved', () => {
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

    const handoff = state.snapshots?.find((snap) => {
      if (!snap?.perChannel) return false;
      const lk = snap.perChannel.LK;
      const c = snap.perChannel.C;
      if (!lk || !c) return false;
      const cDelta = (c.normalizedAfter ?? 0) - (c.normalizedBefore ?? 0);
      return (
        snap.deltaDensity > 0 &&
        (lk.reserveState === 'exhausted') &&
        ((lk.reserveAllowanceRemaining ?? 0) <= 5e-4) &&
        (lk.effectiveHeadroomAfter ?? 0) <= 5e-4 &&
        (lk.reserveReleaseScale ?? 1) < 0.5 &&
        cDelta > 5e-5
      );
    });

    expect(handoff, 'expected snapshot where LK reserve exhausted and C picks up the correction').toBeTruthy();
  });

  it('does not promote K while C retains effective headroom', () => {
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
    expect(snapshots.length).toBeGreaterThan(25);

    const firstKIndex = snapshots.findIndex((snap) => {
      const k = snap?.perChannel?.K;
      return k && (k.normalizedAfter ?? 0) > 5e-4;
    });

    expect(firstKIndex, 'expected K to remain inactive for early highlight samples').toBeGreaterThan(0);

    for (let i = 0; i < firstKIndex; i += 1) {
      const snap = snapshots[i];
      if (!snap?.perChannel) continue;
      const c = snap.perChannel.C;
      if (!c) continue;
      const cHeadroom = c.headroomAfter ?? Number.POSITIVE_INFINITY;
      if (cHeadroom <= 1e-4) {
        continue;
      }
      const sequence = Array.isArray(snap?.ladderTrace?.sequence)
        ? snap.ladderTrace.sequence
        : (Array.isArray(snap?.ladderTrace) ? snap.ladderTrace : []);
      const kInSequence = sequence.some((entry) => entry?.channel === 'K');
      expect(kInSequence, `snapshot ${snap?.index ?? i} should not include K while C has headroom (${cHeadroom})`).toBe(false);
    }
  });
});
