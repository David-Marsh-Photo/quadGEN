import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync } from 'fs';

test.describe('Manual LAB global toggle', () => {
  test('loading LAB measurement keeps global correction unbaked', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');

    expect(existsSync(manualLabPath)).toBe(true);

    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(`console error: ${message.text()}`);
      }
    });

    await page.goto(indexUrl);
    await page.waitForSelector('#editModeToggleBtn', { timeout: 15000 });

    const initialDom = await page.evaluate(() => {
      const editToggle = document.querySelector('#editModeToggleBtn');
      const globalToggle = document.querySelector('#globalLinearizationToggle');
      const fileInput = document.querySelector('#linearizationFile');
      return {
        editTogglePresent: !!editToggle,
        globalToggle: globalToggle
          ? {
              disabled: globalToggle.hasAttribute('disabled') || globalToggle.getAttribute('aria-disabled') === 'true',
              datasetBaked: globalToggle.getAttribute('data-baked') || globalToggle.dataset?.baked || null,
              checked: (globalToggle as HTMLInputElement).checked
            }
          : null,
        fileInputPresent: !!fileInput,
        fileInputAccept: fileInput?.getAttribute('accept') || null
      };
    });

    expect(initialDom.editTogglePresent).toBe(true);
    expect(initialDom.fileInputPresent).toBe(true);
    expect(initialDom.globalToggle).not.toBeNull();

    const toggleDiagnostics = await page.evaluate(() => {
      const toggle = document.querySelector('#globalLinearizationToggle');
      if (!toggle) {
        return null;
      }
      const rect = toggle.getBoundingClientRect();
      const style = window.getComputedStyle(toggle);
      const label = document.querySelector(`label[for="${toggle.id}"]`);
      return {
        rect,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        labelHtml: label ? label.outerHTML : null,
        parentHtml: toggle.parentElement ? toggle.parentElement.outerHTML : null
      };
    });

    expect(toggleDiagnostics).not.toBeNull();
    expect(toggleDiagnostics?.parentHtml).toContain('slider-toggle');

    await page.click('#editModeToggleBtn');
    await page.waitForFunction(() => {
      return typeof window.isEditModeEnabled === 'function' && window.isEditModeEnabled();
    }, null, { timeout: 10000 });

    const preLoadState = await page.evaluate(() => {
      const toggle = document.querySelector('#globalLinearizationToggle') as HTMLInputElement | null;
      return {
        applied: !!window.LinearizationState?.globalApplied,
        baked: !!window.LinearizationState?.isGlobalBaked?.(),
        bakedMeta: window.LinearizationState?.getGlobalBakedMeta?.() || null,
        toggleDisabled: toggle ? (toggle.disabled || toggle.getAttribute('aria-disabled') === 'true') : null
      };
    });

    expect(preLoadState.baked).toBe(false);

    await page.setInputFiles('#linearizationFile', manualLabPath);

    await page.waitForFunction(() => {
      const data = window.linearizationData;
      const samplesReady = Array.isArray(data?.samples) && data.samples.length > 0;
      const formatReady = typeof data?.format === 'string' && data.format.length > 0;
      return Boolean(samplesReady && formatReady);
    }, null, { timeout: 15000 });

    const postLoadState = await page.evaluate(() => {
      const toggle = document.querySelector('#globalLinearizationToggle') as HTMLInputElement | null;
      const bakedMeta = window.LinearizationState?.getGlobalBakedMeta?.() || null;
      const keyPointsMeta = window.loadedQuadData?.keyPointsMeta || null;
      return {
        applied: !!window.LinearizationState?.globalApplied,
        baked: !!window.LinearizationState?.isGlobalBaked?.(),
        bakedMeta,
        toggleDisabled: toggle ? (toggle.disabled || toggle.getAttribute('aria-disabled') === 'true') : null,
        toggleDatasetBaked: toggle?.dataset?.baked || null,
        keyPointsMeta
      };
    });

    const postToggleDiagnostics = await page.evaluate(() => {
      const toggle = document.querySelector('#globalLinearizationToggle');
      if (!toggle) return null;
      const rect = toggle.getBoundingClientRect();
      const style = window.getComputedStyle(toggle);
      const label = toggle.closest('label');
      return {
        disabledAttr: toggle.hasAttribute('disabled'),
        rect,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        labelClasses: label ? label.className : null,
        labelHtml: label ? label.outerHTML : null
      };
    });

    expect(postToggleDiagnostics?.disabledAttr).toBe(false);

    expect(postLoadState.applied).toBe(true);
    expect(postLoadState.baked).toBe(false);
    expect(postLoadState.toggleDisabled).toBe(false);
    expect(postLoadState.toggleDatasetBaked).toBeNull();

    const globalSlider = page.locator('label.slider-toggle[title="Enable/disable global correction"] .slider');
    await expect(globalSlider).toBeVisible();
    await globalSlider.click();
    await page.waitForFunction(() => !window.LinearizationState?.globalApplied, null, { timeout: 10000 });

    const afterDisable = await page.evaluate(() => ({
      applied: !!window.LinearizationState?.globalApplied,
      baked: !!window.LinearizationState?.isGlobalBaked?.()
    }));

    expect(afterDisable.applied).toBe(false);
    expect(afterDisable.baked).toBe(false);

    await globalSlider.click();
    await page.waitForFunction(() => !!window.LinearizationState?.globalApplied, null, { timeout: 10000 });

    const afterReEnable = await page.evaluate(() => ({
      applied: !!window.LinearizationState?.globalApplied,
      baked: !!window.LinearizationState?.isGlobalBaked?.()
    }));

    expect(afterReEnable.applied).toBe(true);
    expect(afterReEnable.baked).toBe(false);

    expect(consoleErrors).toEqual([]);
  });
});
