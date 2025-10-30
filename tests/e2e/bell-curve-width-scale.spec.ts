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

test.describe('Bell width scale control', () => {
  test('shows linkable controls and updates metadata for left/right edits', async ({ page }, testInfo) => {
    await page.goto(FILE_URL);

    const domProbe = await page.evaluate(() => ({
      quadInput: !!document.querySelector('#quadFile'),
      editPanel: !!document.querySelector('#editPanelBody'),
    }));
    expect(domProbe.quadInput).toBe(true);
    expect(domProbe.editPanel).toBe(true);

    await page.setInputFiles('#quadFile', KCLK_QUAD);

    await page.waitForFunction(
      () => {
        const win = window as typeof window & { getChannelShapeMeta?: () => any; getLoadedQuadData?: () => any };
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

    await page.click('#editModeToggleBtn');
    await page.waitForFunction(() => {
      const btn = document.querySelector('#editModeToggleBtn');
      return btn?.getAttribute('aria-pressed') === 'true';
    });

    await page.selectOption('#editChannelSelect', 'C');

    const widthCard = page.locator('#editBellWidthContainer');
    await expect(widthCard).toBeVisible();

    await page.selectOption('#editChannelSelect', 'K');
    await expect(widthCard).toBeHidden();
    await page.selectOption('#editChannelSelect', 'C');
    await expect(widthCard).toBeVisible();

    const leftInput = widthCard.locator('#bellWidthLeftInput');
    const rightInput = widthCard.locator('#bellWidthRightInput');
    const linkToggle = widthCard.locator('#bellWidthLinkToggle');
    const leftDec = widthCard.locator('#bellWidthLeftDec');
    const resetBtn = widthCard.locator('#bellWidthResetBtn');

    const initialLeftValue = Number(await leftInput.inputValue());
    await leftDec.click();

    await page.waitForFunction(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return !!meta && Number(meta.bellWidthScale?.leftFactor ?? 0) < 1 && meta.bellWidthScale?.linked === true;
    });

    await expect(leftInput).toHaveValue(/^[0-9]+(\.[0-9]+)?$/);
    const afterLeftDecValue = Number(await leftInput.inputValue());
    expect(afterLeftDecValue).toBeLessThan(initialLeftValue);

    await linkToggle.click();

    await page.waitForFunction(() => {
      const btn = document.querySelector('#bellWidthLinkToggle');
      const linked = btn?.getAttribute('aria-pressed') === 'true';
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      return btn && win.getChannelShapeMeta?.()?.C?.bellWidthScale?.linked === linked;
    });

    const leftInc = widthCard.locator('#bellWidthLeftInc');
    let lastValue = Number(await leftInput.inputValue());
    for (let i = 0; i < 3; i += 1) {
      await leftInc.click();
      await page.waitForFunction((prev) => {
        const input = document.querySelector('#bellWidthLeftInput') as HTMLInputElement | null;
        if (!input) return false;
        const value = Number(input.value);
        return Number.isFinite(value) && value > prev + 0.5;
      }, lastValue);
      lastValue = Number(await leftInput.inputValue());
    }

    for (let i = 0; i < 3; i += 1) {
      await leftDec.click();
      await page.waitForFunction(() => {
        const win = window as typeof window & { getChannelShapeMeta?: () => any };
        const meta = win.getChannelShapeMeta?.()?.C;
        return !!meta && !meta.bellWidthScale?.linked;
      });
      const currentValue = Number(await leftInput.inputValue());
      expect(currentValue).toBeLessThan(lastValue);
      lastValue = currentValue;
    }

    const rightBefore = Number(await rightInput.inputValue());
    await leftInc.click();
    await page.waitForFunction(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return !!meta && !meta.bellWidthScale?.linked;
    });
    const rightAfter = Number(await rightInput.inputValue());
    expect(rightAfter).toBeCloseTo(rightBefore, 1);
    lastValue = Number(await leftInput.inputValue());

    const linkedValues = await page.evaluate(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      return win.getChannelShapeMeta?.()?.C?.bellWidthScale ?? null;
    });
    expect(Math.abs((linkedValues?.rightFactor ?? 0) - (linkedValues?.leftFactor ?? 0))).toBeLessThan(0.05);

    await rightInput.fill('130');
    await rightInput.press('Enter');

    await page.waitForFunction(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return (
        !!meta &&
        meta.bellWidthScale?.linked === false &&
        meta.bellWidthScale?.rightFactor !== undefined &&
        meta.bellWidthScale.rightFactor > 1.2
      );
    });
    expect(Number(await rightInput.inputValue())).toBeCloseTo(130, 1);

    await rightInput.fill('95');
    await rightInput.press('Enter');
    await page.waitForFunction(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return (
        !!meta &&
        meta.bellWidthScale?.linked === false &&
        meta.bellWidthScale?.rightFactor !== undefined &&
        meta.bellWidthScale.rightFactor < 1
      );
    });
    expect(Number(await rightInput.inputValue())).toBeCloseTo(95, 1);

    await linkToggle.click();

    await page.waitForFunction(() => {
      const btn = document.querySelector('#bellWidthLinkToggle');
      const linked = btn?.getAttribute('aria-pressed') === 'true';
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return btn && meta?.bellWidthScale?.linked === linked && linked === true;
    });

    const leftBeforeRelink = Number(await leftInput.inputValue());
    await leftDec.click();
    await page.waitForFunction(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return !!meta && meta.bellWidthScale?.linked === true;
    });
    const rightAfterRelink = Number(await rightInput.inputValue());
    expect(rightAfterRelink).toBeCloseTo(Number(await leftInput.inputValue()), 1);

    await resetBtn.click();

    await page.waitForFunction(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      const meta = win.getChannelShapeMeta?.()?.C;
      return (
        !!meta &&
        meta.bellWidthScale?.linked === true &&
        Math.abs((meta.bellWidthScale?.leftFactor ?? 1) - 1) < 0.01 &&
        Math.abs((meta.bellWidthScale?.rightFactor ?? 1) - 1) < 0.01
      );
    });

    const screenshotPath = testInfo.outputPath('bell-width-scale-control.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach('bell-width-scale-control', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    const artifactDir = path.join(PROJECT_ROOT, 'test-screenshots');
    await fs.promises.mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, 'bell-width-scale-control.png');
    await page.screenshot({ path: artifactPath, fullPage: false });
  });
});
