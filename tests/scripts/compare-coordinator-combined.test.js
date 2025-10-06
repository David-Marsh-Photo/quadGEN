/* @vitest-environment node */

import { describe, it, expect } from 'vitest';

const SCRIPT_PATH = '../../scripts/diagnostics/compare-coordinator-combined.js';

describe('diagnostics combined Smart + LAB parity script', () => {
  it('exposes exported helpers for combined parity generation', async () => {
    const module = await import(SCRIPT_PATH);

    expect(typeof module.runCombinedScenario).toBe('function');
    expect(typeof module.generateCombinedParityArtifact).toBe('function');
  });
});
