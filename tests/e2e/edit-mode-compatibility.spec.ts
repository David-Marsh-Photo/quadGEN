import { test, expect } from '@playwright/test';
import { navigateToApp, waitForAppReady } from '../utils/history-helpers';

test.describe('Edit Mode legacy compatibility bridge', () => {
  test('exposes edit-mode globals needed for ordinal overlays', async ({ page }) => {
    await navigateToApp(page);
    await waitForAppReady(page);

    await page.locator('#editModeToggleBtn').click();

    await page.waitForFunction(() => {
      const win = window as typeof window & {
        isEditModeEnabled?: () => boolean;
        EDIT?: { selectedChannel?: string | null; selectedOrdinal?: number | null };
      };
      return typeof win.isEditModeEnabled === 'function' && typeof win.EDIT === 'object';
    });

    const legacyState = await page.evaluate(() => {
      const win = window as typeof window & {
        isEditModeEnabled?: () => boolean;
        EDIT?: { selectedChannel?: string | null; selectedOrdinal?: number | null };
      };
      return {
        enabled: typeof win.isEditModeEnabled === 'function' ? win.isEditModeEnabled() : null,
        selectedChannel: win.EDIT?.selectedChannel ?? null,
        selectedOrdinal: win.EDIT?.selectedOrdinal ?? null
      };
    });

    expect(legacyState.enabled).toBe(true);
    expect(legacyState.selectedChannel).not.toBeNull();
    expect(legacyState.selectedOrdinal).toBeGreaterThan(0);
  });
});
