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

test.describe('Curve shape detection (KCLK)', () => {
  test('detects bell vs monotonic channels and renders badges', async ({ page }, testInfo) => {
    await page.goto(FILE_URL);

    const domProbe = await page.evaluate(() => ({
      hasQuadInput: !!document.querySelector('#quadFile'),
      channelCount: document.querySelectorAll('tr.channel-row[data-channel]').length,
    }));
    expect(domProbe.hasQuadInput).toBe(true);

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
        const data = (window as typeof window & { getLoadedQuadData?: () => any }).getLoadedQuadData?.();
        return !!data && /KCLK/i.test(data.filename || '');
      },
      { timeout: 5000 }
    );

    const shapeMeta = await page.evaluate(() => {
      const win = window as typeof window & { getChannelShapeMeta?: () => any };
      if (typeof win.getChannelShapeMeta === 'function') {
        return win.getChannelShapeMeta();
      }
      const data = (win.getLoadedQuadData && win.getLoadedQuadData()) || null;
      return data?.channelShapeMeta || null;
    });

    expect(shapeMeta).toBeTruthy();
    expect(shapeMeta.C?.classification).toBe('bell');
    expect(shapeMeta.LK?.classification).toBe('bell');
    expect(shapeMeta.K?.classification).toBe('monotonic');

    await expect(channelRow(page, 'C').locator('[data-channel-shape]')).toHaveText('🔔');
    await expect(channelRow(page, 'LK').locator('[data-channel-shape]')).toHaveText('🔔');
    await expect(channelRow(page, 'K').locator('[data-channel-shape]')).toHaveText('📈');

    const screenshotPath = testInfo.outputPath('channel-shape-kclk.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach('channel-shape-kclk', {
      path: screenshotPath,
      contentType: 'image/png',
    });

    const artifactDir = path.join(PROJECT_ROOT, 'test-screenshots');
    await fs.promises.mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, 'channel-shape-kclk.png');
    await page.screenshot({ path: artifactPath, fullPage: false });
  });
});
