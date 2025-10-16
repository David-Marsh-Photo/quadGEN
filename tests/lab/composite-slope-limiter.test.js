import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { computeSnapshotFlags } from '../../src/js/core/snapshot-flags.js';

const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const LAB_PATH = resolve('data/P800_K36C26LK25_V6.txt');

describe('composite slope limiter integration', () => {
  it('eliminates sharp-flag triggers for the P800 composite dataset', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'slope-limiter-'));
    const outputPath = join(tempDir, 'composite.json');

    execFileSync('node', [
      resolve('scripts/capture-composite-debug.mjs'),
      '--quad', QUAD_PATH,
      '--lab', LAB_PATH,
      '--mode', 'normalized',
      '--output', outputPath,
    ], { cwd: resolve('.') });

    const payload = JSON.parse(readFileSync(outputPath, 'utf8'));
    rmSync(tempDir, { recursive: true, force: true });

    const snapshotFlags = payload.flags || payload.snapshotFlags || {};
    expect(Object.keys(snapshotFlags)).toHaveLength(0);

    const computedFlags = computeSnapshotFlags(payload.snapshots, {
      channelNames: payload.summary?.channelNames || [],
      thresholdPercent: 7,
    });
    expect(Object.keys(computedFlags)).toHaveLength(0);
  });
});

