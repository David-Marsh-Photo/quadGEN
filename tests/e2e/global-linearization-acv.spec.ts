import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test('loading an ACV global correction succeeds without parse errors', async ({ page }) => {
  const indexUrl = pathToFileURL(resolve('index.html')).href;
  const acvPath = resolve('testdata/midtone_lift.acv');
  const consoleMessages: string[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push(text);
    console.log(`[console:${msg.type()}] ${text}`);
  });

  await page.goto(indexUrl);

  await page.waitForFunction(
    () => !!(window.ControlPoints && typeof window.ControlPoints.get === 'function'),
    null,
    { timeout: 15000 },
  );

  const diagnostics = await page.evaluate(() => {
    const input = document.querySelector('input#linearizationFile') as HTMLInputElement | null;
    return {
      hasInput: !!input,
      tagName: input?.tagName || null,
      typeAttr: input?.getAttribute('type') || null,
      hidden: input?.hasAttribute('hidden') || false,
      disabled: !!input?.disabled,
      accept: input?.getAttribute('accept') || null,
    };
  });
  console.log('[diagnostic] linearization input', JSON.stringify(diagnostics));

  expect(diagnostics.hasInput).toBe(true);
  expect(diagnostics.disabled).toBe(false);

  await page.setInputFiles('input#linearizationFile', acvPath);

  await page.waitForTimeout(500);

  const preWaitState = await page.evaluate(() => ({
    hasData: !!window.linearizationData,
    format: window.linearizationData?.format || null,
    errorBanner: document.querySelector('#globalLinearizationError')?.textContent?.trim() || null,
  }));
  console.log('[diagnostic] state after load', JSON.stringify(preWaitState));

  await page.waitForFunction(
    () => {
      const data = window.linearizationData;
      return !!data && data.format === 'ACV';
    },
    null,
    { timeout: 15000 },
  );

  const result = await page.evaluate(() => ({
    format: window.linearizationData?.format || null,
    sampleCount: Array.isArray(window.linearizationData?.samples)
      ? window.linearizationData.samples.length
      : null,
    globalApplied: !!window.LinearizationState?.globalApplied,
  }));

  if (consoleMessages.some((msg) => /Failed to parse linearization data/i.test(msg))) {
    throw new Error(`Parse error present in console: ${consoleMessages.join('\n')}`);
  }

  expect(result.format).toBe('ACV');
  expect(result.sampleCount).toBe(256);
  expect(result.globalApplied).toBe(true);
});
