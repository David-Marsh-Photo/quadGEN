import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const LAB_PATH = resolve('data/P800_K36C26LK25_V6.txt');

function normalizedSeriesFromSnapshots(payload, channel) {
  if (!payload || !Array.isArray(payload.snapshots)) {
    return [];
  }
  return payload.snapshots.map((snapshot) => {
    const perChannel = snapshot?.perChannel || {};
    const entry = perChannel[channel];
    return entry ? Number(entry.normalizedAfter) || 0 : 0;
  });
}

function extractRollOffWindow(series) {
  if (!Array.isArray(series) || series.length < 3) {
    return series.slice();
  }
  let maxDelta = 0;
  let peakIndex = 1;
  for (let i = 1; i < series.length; i += 1) {
    const delta = Math.abs(series[i] - series[i - 1]);
    if (delta > maxDelta) {
      maxDelta = delta;
      peakIndex = i;
    }
  }
  const start = Math.max(0, peakIndex - 4);
  const end = Math.min(series.length - 1, peakIndex + 8);
  return series.slice(start, end + 1);
}

function computeDeltas(series) {
  const deltas = [];
  for (let i = 1; i < series.length; i += 1) {
    deltas.push(series[i] - series[i - 1]);
  }
  return deltas;
}

describe('composite slope kernel integration', () => {
  it('captures eased roll-off deltas when kernel smoothing flag is enabled', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'slope-kernel-'));
    const outputPath = join(tempDir, 'kernel.json');

    execFileSync('node', [
      resolve('scripts/capture-composite-debug.mjs'),
      '--quad', QUAD_PATH,
      '--lab', LAB_PATH,
      '--mode', 'normalized',
      '--output', outputPath,
    ], {
      cwd: resolve('.'),
    });

    const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
    rmSync(tempDir, { recursive: true, force: true });

    const normalized = extractRollOffWindow(normalizedSeriesFromSnapshots(payload, 'K'));
    expect(normalized.length).toBeGreaterThan(4);

    const deltas = computeDeltas(normalized);
    const maxDelta = deltas.reduce((max, delta) => Math.max(max, Math.abs(delta)), 0);
    expect(maxDelta).toBeLessThan(0.07 + 1e-5);

    const early = deltas.slice(0, Math.min(3, deltas.length)).map((delta) => Math.abs(delta));
    const late = deltas.slice(-Math.min(3, deltas.length)).map((delta) => Math.abs(delta));
    const avg = (entries) => (entries.length ? entries.reduce((sum, value) => sum + value, 0) / entries.length : 0);
    const earlyAvg = avg(early);
    const lateAvg = avg(late);

    expect(earlyAvg).toBeLessThan(0.071);
    expect(lateAvg).toBeLessThan(0.015);
    expect(earlyAvg - lateAvg).toBeGreaterThan(0.05);

    const guard = 0.07;
    const nearThreshold = guard * 0.98;
    let longestRun = 0;
    let currentRun = 0;
    deltas.forEach((delta) => {
      if (Math.abs(delta) >= nearThreshold) {
        currentRun += 1;
        if (currentRun > longestRun) {
          longestRun = currentRun;
        }
      } else {
        currentRun = 0;
      }
    });
    expect(longestRun).toBeLessThan(3);
  });
});
