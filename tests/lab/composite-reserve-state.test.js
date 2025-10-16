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

describe('Composite reserve state diagnostics [solver-overhaul-reserve-state]', () => {
  it('exposes tri-state reserve markers across highlight crest samples', () => {
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
    expect(snapshots.length).toBeGreaterThan(50);

    const highlightWindow = snapshots.filter((snap) => {
      const index = snap?.index ?? null;
      return typeof index === 'number' && index >= 0 && index <= 60;
    });
    expect(highlightWindow.length).toBeGreaterThan(0);

    const observedStates = new Set();
    highlightWindow.forEach((snap) => {
      const reserveState = snap?.perChannel?.LK?.reserveState ?? null;
      if (reserveState != null) {
        observedStates.add(reserveState);
      }
    });

    expect(observedStates.has('approaching')).toBe(true);
    expect(observedStates.has('within')).toBe(true);
    expect(observedStates.has('exhausted')).toBe(true);
  });
});
