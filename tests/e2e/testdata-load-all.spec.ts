import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { promises as fs } from 'fs';

const SUPPORTED_EXTENSIONS = new Set([
  'quad',
  'cube',
  'acv',
  'txt',
  'ti3',
  'cgats',
]);

test.describe('testdata fixtures load without console errors', () => {
  test('each supported file loads via the appropriate input', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const testdataDir = resolve('testdata');

    const entries = await fs.readdir(testdataDir);
    const fixtures = entries
      .filter((filename) => {
        const ext = filename.split('.').pop();
        return !!ext && SUPPORTED_EXTENSIONS.has(ext.toLowerCase());
      })
      .sort();

    expect(fixtures.length).toBeGreaterThan(0);

    const consoleEvents: { type: string; text: string }[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      consoleEvents.push({ type: msg.type(), text });
      console.log(`[console:${msg.type()}] ${text}`);
    });

    for (const filename of fixtures) {
      await test.step(`load ${filename}`, async () => {
        const startIndex = consoleEvents.length;
        await page.goto(indexUrl);

        await page.waitForFunction(
          () => !!(window.ControlPoints && typeof window.ControlPoints.get === 'function'),
          null,
          { timeout: 15000 },
        );

        const inputDiagnostics = await page.evaluate(() => {
          const quadInput = document.querySelector('input#quadFile') as HTMLInputElement | null;
          const linInput = document.querySelector('input#linearizationFile') as HTMLInputElement | null;
          return {
            quad: quadInput
              ? {
                  hidden: quadInput.hasAttribute('hidden'),
                  disabled: quadInput.disabled,
                  accept: quadInput.getAttribute('accept'),
                }
              : null,
            linearization: linInput
              ? {
                  hidden: linInput.hasAttribute('hidden'),
                  disabled: linInput.disabled,
                  accept: linInput.getAttribute('accept'),
                }
              : null,
          };
        });
        console.log(`[diagnostic:${filename}] inputs ${JSON.stringify(inputDiagnostics)}`);

        const absPath = resolve(testdataDir, filename);
        const ext = filename.split('.').pop()!.toLowerCase();

        if (ext === 'quad') {
          expect(inputDiagnostics.quad?.disabled).toBeFalsy();
          await page.setInputFiles('input#quadFile', absPath);

          await page.waitForFunction(
            () => !!(window.loadedQuadData && window.loadedQuadData.valid && window.loadedQuadData.channels?.length),
            null,
            { timeout: 20000 },
          );

          const quadState = await page.evaluate(() => ({
            valid: window.loadedQuadData?.valid ?? null,
            channelCount: window.loadedQuadData?.channels?.length ?? null,
            firstChannel: window.loadedQuadData?.channels?.[0] ?? null,
          }));

          expect(quadState.valid).toBe(true);
          expect(quadState.channelCount).toBeGreaterThan(0);
          expect(quadState.firstChannel).not.toBeNull();
        } else {
          expect(inputDiagnostics.linearization?.disabled).toBeFalsy();
          await page.setInputFiles('input#linearizationFile', absPath);

          await page.waitForFunction(
            () => !!(window.linearizationData && window.linearizationData.valid),
            null,
            { timeout: 20000 },
          );

          const linState = await page.evaluate(() => ({
            valid: window.linearizationData?.valid ?? null,
            format: window.linearizationData?.format || null,
            sampleCount: Array.isArray(window.linearizationData?.samples)
              ? window.linearizationData.samples.length
              : null,
            globalApplied: !!window.LinearizationState?.globalApplied,
          }));

          expect(linState.valid).toBe(true);
          expect(linState.format).toBeTruthy();
          expect(linState.globalApplied).toBe(true);

          if (ext === 'cube' || ext === 'acv') {
            expect(linState.sampleCount).toBeTruthy();
          }
        }

        const newLogs = consoleEvents.slice(startIndex).filter((entry) => entry.type === 'error');
        expect(newLogs, `Console errors while loading ${filename}:\n${newLogs.map((e) => e.text).join('\n')}`).toEqual([]);
      });
    }
  });
});

