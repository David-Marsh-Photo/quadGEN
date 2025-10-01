/**
 * Manual L* parity test
 *
 * Submits the same 7-point Manual L* dataset to both the legacy build (quadgen.html)
 * and the modular build (index.html), captures the resulting 256-point correction
 * samples, and compares them for parity.
 */

import path from 'path';
import { chromium } from 'playwright';

const manualValues = [98, 88, 76, 62, 48, 32, 20];
const filesUnderTest = [
  { label: 'legacy', file: 'quadgen.html' },
  { label: 'modular', file: 'index.html' }
];

async function applyManualLstar(page, values) {
  await page.waitForSelector('#manualLstarBtn');
  await page.waitForFunction(() => typeof window.parseManualLstarData === 'function', { timeout: 5000 });
  await page.evaluate(() => {
    if (typeof window.parseManualLstarData === 'function' && !window.__manualLstarCaptureInstalled) {
      const original = window.parseManualLstarData;
      window.__manualLstarCaptureInstalled = true;
      window.parseManualLstarData = function (...args) {
        const result = original.apply(this, args);
        try {
          window.__lastManualLstarData = JSON.parse(JSON.stringify(result));
        } catch (err) {
          window.__lastManualLstarData = result;
        }
        return result;
      };
    }
    if (window.__manualLstarCaptureInstalled) {
      window.__lastManualLstarData = null;
    }
  });

  await page.click('#manualLstarBtn');
  await page.waitForSelector('#lstarModal:not(.hidden)');

  // Add extra rows to reach the desired count
  for (let i = 5; i < values.length; i++) {
    await page.click('#addLstarInput');
  }

  // Populate L* inputs
  await page.evaluate((vals) => {
    const inputs = Array.from(document.querySelectorAll('#lstarInputs .lstar-input'));
    if (inputs.length !== vals.length) {
      throw new Error(`Expected ${vals.length} rows, found ${inputs.length}`);
    }
    inputs.forEach((input, index) => {
      input.value = String(vals[index]);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, values);

  // Wait for validation to enable the Generate button
  await page.waitForFunction(() => {
    const btn = document.getElementById('generateFromLstar');
    return btn && !btn.disabled;
  });

  await page.click('#generateFromLstar');
  await page.waitForSelector('#lstarModal.hidden', { state: 'attached' });
  await page.waitForFunction(() => {
    const captured = window.__lastManualLstarData;
    if (captured && Array.isArray(captured.samples) && captured.samples.length > 0) {
      return true;
    }
    const legacy = typeof window.linearizationData !== 'undefined' ? window.linearizationData : null;
    const modular = (typeof window.LinearizationState !== 'undefined'
      && typeof window.LinearizationState.getGlobalData === 'function')
      ? window.LinearizationState.getGlobalData()
      : null;
    const source = legacy || modular;
    return !!(source && Array.isArray(source.samples) && source.samples.length > 0);
  }, { timeout: 5000 });

  const payload = await page.evaluate(() => {
    const source = window.__lastManualLstarData
      || (typeof window.linearizationData !== 'undefined' ? window.linearizationData : null)
      || ((typeof window.LinearizationState !== 'undefined'
        && typeof window.LinearizationState.getGlobalData === 'function')
        ? window.LinearizationState.getGlobalData()
        : null);
    if (!source || !Array.isArray(source.samples)) {
      throw new Error('Unable to retrieve manual L* samples from the page');
    }

    // Mirror the MCP safe-default guidance: stringify the payload and enforce a hard cap
    // so remote providers never attempt to ship oversized DOM snapshots.
    const safePayload = JSON.stringify({ samples: source.samples.slice() });
    if (safePayload.length > 8192) {
      return JSON.stringify({ ok: false, err: 'samples_payload_exceeds_safe_cap' });
    }
    return safePayload;
  });

  const parsed = JSON.parse(payload);
  if (!parsed || parsed.ok === false) {
    throw new Error(parsed?.err || 'Unable to retrieve manual L* samples from the page');
  }
  return parsed.samples;
}

async function captureSamples(fileEntry) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const fileUrl = `file://${path.resolve(process.cwd(), fileEntry.file)}`;

  try {
    await page.goto(fileUrl);
    await page.waitForSelector('#manualLstarBtn', { timeout: 5000 });
    const samples = await applyManualLstar(page, manualValues);
    return samples;
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function compareSamples(legacySamples, modularSamples) {
  if (!Array.isArray(legacySamples) || !Array.isArray(modularSamples)) {
    throw new Error('Both sample arrays must be present for comparison');
  }
  if (legacySamples.length !== modularSamples.length) {
    throw new Error(`Sample length mismatch: legacy=${legacySamples.length}, modular=${modularSamples.length}`);
  }

  let maxDiff = 0;
  let sumDiff = 0;
  for (let i = 0; i < legacySamples.length; i++) {
    const diff = Math.abs(legacySamples[i] - modularSamples[i]);
    if (diff > maxDiff) maxDiff = diff;
    sumDiff += diff;
  }
  const meanDiff = sumDiff / legacySamples.length;
  return { maxDiff, meanDiff };
}

(async function run() {
  try {
    const results = [];
    for (const fileEntry of filesUnderTest) {
      results.push(await captureSamples(fileEntry));
    }
    const [legacy, modular] = results;
    const { maxDiff, meanDiff } = compareSamples(legacy, modular);
    console.log('Manual L* parity comparison');
    console.log(` - Max abs diff: ${maxDiff}`);
    console.log(` - Mean abs diff: ${meanDiff}`);

    const tolerance = 1e-6;
    if (maxDiff > tolerance) {
      console.error(`FAIL: difference exceeds tolerance (${tolerance})`);
      process.exit(1);
    } else {
      console.log('PASS: curves match within tolerance');
      process.exit(0);
    }
  } catch (err) {
    console.error('Error during Manual L* parity test:', err);
    process.exit(1);
  }
})();
