import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { promises as fs } from 'fs';

import {
  runLinearizationAudit,
  buildAuditSummaries,
  LinearizationDataset
} from './utils/lab-flow';

const DATASET: LinearizationDataset = {
  quadPath: 'data/TRIFORCE_V4.quad',
  labPath: 'data/TRIFORCE_V4.txt'
};

const SAMPLE_PERCENTS = (() => {
  const raw = process.env.AUDIT_PERCENTS;
  if (!raw) return [5, 95];
  const parsed = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  return parsed.length ? parsed : [5, 95];
})();

test.describe('TRIFORCE_V4 LAB correction audit', () => {
  test('captures composite redistribution snapshots via UI flow', async ({ page }, testInfo) => {
    const dataset = {
      quadPath: resolve(DATASET.quadPath),
      labPath: resolve(DATASET.labPath)
    };

    const flowResult = await runLinearizationAudit(page, dataset, {
      enableComposite: true,
      percentages: SAMPLE_PERCENTS,
      waitAfterLoadMs: 3500
    });

    expect(flowResult.correctedCurves).not.toBeNull();

    const channelNames = flowResult.correctedCurves ? Object.keys(flowResult.correctedCurves) : [];
    expect(channelNames.length).toBeGreaterThan(0);

    const summaries = buildAuditSummaries(flowResult, SAMPLE_PERCENTS);

    summaries.forEach((summary) => {
      expect(summary.perChannel).not.toEqual({});

      if (
        summary.targetNormalized !== null &&
        summary.measurementNormalized !== null &&
        summary.densityDelta !== null
      ) {
        const expectedSign = Math.sign(summary.targetNormalized - summary.measurementNormalized);
        const observedSign = Math.sign(summary.densityDelta);
        expect(observedSign).toBe(expectedSign);
      }
    });

    const artifact = {
      dataset: DATASET,
      meta: flowResult.globalMeta,
      warnings: flowResult.warnings,
      summaries,
      originalData: flowResult.originalData,
      originalSamples: flowResult.originalSamples
    };

    const outputPath = testInfo.outputPath('triforce-v4-correction.json');
    await fs.writeFile(outputPath, JSON.stringify(artifact, null, 2), 'utf8');
    await testInfo.attach('triforce-v4-correction.json', {
      path: outputPath,
      contentType: 'application/json'
    });
  });
});
