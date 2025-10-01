import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

test.describe('Edit Mode channel navigation', () => {
  test('channel selector arrows cycle through enabled channels', async ({ page }) => {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForFunction(
      () => window.elements?.rows?.children?.length > 0,
      null,
      { timeout: 10000 },
    );

    const quadPath = resolve('testdata/humped_shadow_dip.quad');
    await page.setInputFiles('input#quadFile', quadPath);

    await page.waitForFunction(
      () => window.loadedQuadData?.channels?.length > 1,
      null,
      { timeout: 10000 },
    );

    await page.locator('#editModeToggleBtn').click();

    await page.waitForFunction(
      () => window.isEditModeEnabled?.(),
      null,
      { timeout: 10000 },
    );

    await page.waitForFunction(
      () => {
        const select = document.getElementById('editChannelSelect') as HTMLSelectElement | null;
        return !!select && select.options.length > 1 && !!select.value;
      },
      null,
      { timeout: 10000 },
    );

    const before = await page.evaluate(() => {
      const select = document.getElementById('editChannelSelect') as HTMLSelectElement | null;
      const options = select ? Array.from(select.options).map(opt => opt.value) : [];
      const selectedChannel = window.EDIT?.selectedChannel ?? null;
      return { selectedChannel, options };
    });

    expect(before.selectedChannel).not.toBeNull();
    expect(before.options.length).toBeGreaterThan(1);

    const currentIndex = before.options.indexOf(before.selectedChannel!);
    expect(currentIndex).toBeGreaterThanOrEqual(0);

    const expectedNext = before.options[(currentIndex + 1) % before.options.length];

    await page.locator('#editChannelNext').click();

    const after = await page.evaluate(() => {
      const select = document.getElementById('editChannelSelect') as HTMLSelectElement | null;
      return {
        selectedChannel: window.EDIT?.selectedChannel ?? null,
        dropdownValue: select?.value ?? null,
      };
    });

    expect(after.selectedChannel).toBe(expectedNext);
    expect(after.dropdownValue).toBe(expectedNext);

    await page.waitForFunction(() => Array.isArray((window as any).__chartDrawMeta) && (window as any).__chartDrawMeta.length > 1);
    const drawMeta = await page.evaluate(() => {
      const meta = (window as any).__chartDrawMeta;
      return Array.isArray(meta) ? meta as Array<{ channelName: string; alpha: number; isSelected: boolean }> : [];
    });

    const selectedMeta = drawMeta.find(entry => entry.channelName === expectedNext);
    expect(selectedMeta).toBeDefined();
    expect(selectedMeta?.isSelected).toBe(true);
    expect(selectedMeta?.alpha ?? 0).toBeGreaterThan(0.9);

    const otherAlphas = drawMeta.filter(entry => entry.channelName !== expectedNext);
    expect(otherAlphas.length).toBeGreaterThan(0);
    otherAlphas.forEach(entry => {
      expect(entry.isSelected).toBe(false);
      expect(entry.alpha).toBeLessThan(0.7);
    });

    await page.evaluate(() => window.undo());
    await page.waitForTimeout(250);
    const afterUndo = await page.evaluate(() => window.EDIT?.selectedChannel ?? null);
    expect(afterUndo).toBe(before.selectedChannel);
    await page.waitForFunction(() => Array.isArray((window as any).__chartDrawMeta) && (window as any).__chartDrawMeta.some((entry: any) => entry.isSelected));
    let meta = await page.evaluate(() => (window as any).__chartDrawMeta as Array<{ channelName: string; alpha: number; isSelected: boolean }>);
    let selectedEntry = meta.find(entry => entry.isSelected);
    expect(selectedEntry?.channelName).toBe(afterUndo ?? undefined);

    await page.evaluate(() => window.redo());
    await page.waitForTimeout(250);
    const afterRedo = await page.evaluate(() => window.EDIT?.selectedChannel ?? null);
    expect(afterRedo).toBe(expectedNext);
    await page.waitForFunction(() => Array.isArray((window as any).__chartDrawMeta) && (window as any).__chartDrawMeta.some((entry: any) => entry.isSelected));
    meta = await page.evaluate(() => (window as any).__chartDrawMeta as Array<{ channelName: string; alpha: number; isSelected: boolean }>);
    selectedEntry = meta.find(entry => entry.isSelected);
    expect(selectedEntry?.channelName).toBe(expectedNext);
  });
});
