import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import { parseLabData } from '../../src/js/data/lab-parser.js';
import { LinearizationState } from '../../src/js/data/linearization-utils.js';
import {
  beginCompositeLabRedistribution,
  finalizeCompositeLabRedistribution,
  make256
} from '../../src/js/core/processing-pipeline.js';
import { setLoadedQuadData, ensureLoadedQuadData } from '../../src/js/core/state.js';

const CURVE_RESOLUTION = 256;

function parseQuadFile(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const headerLine = lines.find((line) => line.startsWith('## QuadToneRIP '));
  if (!headerLine) {
    throw new Error(`Quad header missing in ${relativePath}`);
  }
  const channels = headerLine.replace('## QuadToneRIP ', '').trim().split(',');
  const curves = {};
  channels.forEach((name) => {
    curves[name] = new Array(CURVE_RESOLUTION);
  });

  let currentChannel = null;
  let pointer = 0;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      const maybeChannel = trimmed.replace(/^#+/, '').trim();
      if (maybeChannel.endsWith('curve')) {
        const [name] = maybeChannel.split(/\s+/);
        if (Object.prototype.hasOwnProperty.call(curves, name)) {
          currentChannel = name;
          pointer = 0;
        } else {
          currentChannel = null;
        }
      }
      return;
    }
    if (/^-?\d+$/.test(trimmed) && currentChannel) {
      if (pointer < CURVE_RESOLUTION) {
        curves[currentChannel][pointer] = parseInt(trimmed, 10) || 0;
        pointer += 1;
      }
    }
  });

  channels.forEach((name) => {
    const series = curves[name];
    if (!Array.isArray(series)) return;
    for (let i = 0; i < CURVE_RESOLUTION; i += 1) {
      if (typeof series[i] !== 'number') {
        series[i] = 0;
      }
    }
  });

  return { channels, curves };
}

describe('Composite density profile diagnostics', () => {
  beforeEach(() => {
    LinearizationState.clear();
    setLoadedQuadData(null);
    ensureLoadedQuadData();
  });

  it('exposes normalized per-channel shares that sum to unity', () => {
    const quad = parseQuadFile('data/TRIFORCE_V4.quad');
    const measurementText = fs.readFileSync(path.resolve('data/TRIFORCE_V4.txt'), 'utf8');
    const labEntry = parseLabData(measurementText, 'TRIFORCE_V4.txt');

    LinearizationState.setGlobalData(labEntry, true);

    const channelNames = ['K', 'LK'];
    const endValues = {};
    channelNames.forEach((channelName) => {
      const curve = quad.curves[channelName];
      expect(Array.isArray(curve)).toBe(true);
      endValues[channelName] = Math.max(...curve);
    });

    setLoadedQuadData({
      curves: quad.curves,
      baselineEnd: { ...endValues },
      sources: {},
      normalizeToEndChannels: {}
    });
    const loadedData = ensureLoadedQuadData();

    const sessionStarted = beginCompositeLabRedistribution({
      channelNames,
      endValues,
      labEntry,
      interpolationType: 'cubic',
      smoothingPercent: 0
    });
    expect(sessionStarted).toBe(true);

    channelNames.forEach((channelName) => {
      const endValue = endValues[channelName];
      const base = make256(endValue, channelName, true);
      expect(Array.isArray(base)).toBe(true);
      loadedData.plotBaseCurves[channelName] = base.slice();
    });

    const compositeResult = finalizeCompositeLabRedistribution();
    expect(compositeResult?.curves).toBeTruthy();

    const samplePercents = [10, 30, 55, 82, 95];
    samplePercents.forEach((percent) => {
      const profile = LinearizationState.getCompositeDensityProfile?.(percent);
      expect(profile, `composite density profile available at ${percent}%`).toBeTruthy();
      if (!profile) return;

      const { densityDelta, perChannel } = profile;
      expect(perChannel).toBeTruthy();

      const shareSum = Object.values(perChannel).reduce((sum, entry) => {
        const share = typeof entry?.share === 'number' ? entry.share : 0;
        return sum + share;
      }, 0);

      if (densityDelta > 0.0005 && shareSum > 0) {
        expect(shareSum).toBeGreaterThan(0.98);
        expect(shareSum).toBeLessThan(1.02);
      }
    });
  });
});
