import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
const KCLK_QUAD = path.join(DATA_ROOT, 'KCLK.quad');
const FILE_URL = 'file://' + path.join(PROJECT_ROOT, 'index.html');

function channelRow(page, channel: string) {
  return page.locator(`tr.channel-row[data-channel="${channel}"]`);
}

test.describe('Bell apex shift control', () => {
  test('appears for bell-classified channels and nudging updates metadata', async ({ page }, testInfo) => {
    await page.goto(FILE_URL);

    const domProbe = await page.evaluate(() => ({
      quadInput: !!document.querySelector('#quadFile'),
      channelRows: document.querySelectorAll('tr.channel-row[data-channel]').length,
    }));
    expect(domProbe.quadInput).toBe(true);
    expect(domProbe.channelRows).toBeGreaterThan(0);

    const quadInputState = await page.evaluate(() => {
      const input = document.querySelector('#quadFile') as HTMLInputElement | null;
      return {
        exists: !!input,
        hidden: input ? input.classList.contains('hidden') : false,
        accept: input?.getAttribute('accept') || '',
      };
    });
    expect(quadInputState.exists).toBe(true);

    await page.setInputFiles('#quadFile', KCLK_QUAD);

    await page.waitForFunction(
      () => {
        const win = window as typeof window & { getChannelShapeMeta?: () => any };
        const meta = win.getChannelShapeMeta?.();
        const data = win.getLoadedQuadData?.();
        return (
          !!data &&
          /KCLK/i.test(data.filename || '') &&
          !!meta?.C &&
          meta.C.classification === 'bell' &&
          !!meta.K &&
          meta.K.classification === 'monotonic'
        );
      },
      { timeout: 5000 }
    );

    const editToggle = page.locator('#editModeToggleBtn');
    await editToggle.click();
    await page.waitForFunction(() => {
      const btn = document.querySelector('#editModeToggleBtn');
      return btn?.getAttribute('aria-pressed') === 'true';
    });

    await page.selectOption('#editChannelSelect', 'C');

    const bellControl = page.locator('#editBellShiftContainer');
    await expect(bellControl).toBeVisible();
    await page.selectOption('#editChannelSelect', 'K');
    await expect(bellControl).toBeHidden();
    await page.selectOption('#editChannelSelect', 'C');

    const bellInput = bellControl.locator('#editBellShiftInput');
    const bellDec = bellControl.locator('[data-bell-shift-nudge="dec"]');
    const bellInc = bellControl.locator('[data-bell-shift-nudge="inc"]');

    const initialValue = Number(await bellInput.inputValue());
    const initialMeta = await page.evaluate(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      return win.getChannelShapeMeta?.()?.C ?? null;
    });
    expect(initialMeta?.bellShift?.shiftedApexInputPercent).toBeDefined();
    expect(Number(initialMeta.bellShift.shiftedApexInputPercent?.toFixed?.(1))).toBeCloseTo(
      Number(initialValue.toFixed(1))
    );

    await bellDec.click();

    await page.waitForFunction(
      (previous) => {
        const win = window as typeof window & { getChannelShapeMeta?: () => any };
        const meta = win.getChannelShapeMeta?.()?.C;
        return !!meta && meta.bellShift?.offsetPercent !== undefined && meta.bellShift.offsetPercent < previous;
      },
      initialMeta?.bellShift?.offsetPercent ?? 0
    );

    const afterDecValue = Number(await bellInput.inputValue());
    expect(afterDecValue).toBeLessThan(initialValue);

    await bellInput.fill((afterDecValue + 2).toFixed(1));
    await bellInput.press('Enter');

    await page.waitForFunction(
      (target) => {
        const win = window as typeof window & { getChannelShapeMeta?: () => any };
        const meta = win.getChannelShapeMeta?.()?.C;
        return (
          !!meta &&
          meta.bellShift?.shiftedApexInputPercent !== undefined &&
          Math.abs(meta.bellShift.shiftedApexInputPercent - target) < 0.2
        );
      },
      afterDecValue + 2
    );

    await bellInc.click();
    await page.waitForFunction(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return !!meta && Number.isFinite(meta.bellShift?.shiftedApexInputPercent);
    });

    const finalMeta = await page.evaluate(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      return win.getChannelShapeMeta?.() ?? null;
    });
    expect(finalMeta?.C?.bellShift?.offsetPercent).toBeDefined();

    const screenshotPath = testInfo.outputPath('bell-apex-shift-control.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach('bell-apex-shift-control', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    const artifactDir = path.join(PROJECT_ROOT, 'test-screenshots');
    await fs.promises.mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, 'bell-apex-shift-control.png');
    await page.screenshot({ path: artifactPath, fullPage: false });
  });
});
