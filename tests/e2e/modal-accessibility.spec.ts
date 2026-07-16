import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  navigateToApp,
  openGlobalCorrectionTab,
  waitForAppReady,
} from '../utils/history-helpers';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DIAGNOSTIC_ASSERTION = { timeout: 250 };
const VISIBLE_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].map((selector) => `${selector}:visible`).join(', ');

async function preparePage(page: Page) {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await navigateToApp(page);
  await waitForAppReady(page);
}

async function openWithKeyboard(page: Page, trigger: Locator, dialog: Locator) {
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
}

async function expectDialogFrame(
  page: Page,
  dialog: Locator,
  closeButton: Locator,
  accessibleName: string,
) {
  await expect.soft(dialog).toHaveAttribute('role', 'dialog', DIAGNOSTIC_ASSERTION);
  await expect.soft(dialog).toHaveAttribute('aria-modal', 'true', DIAGNOSTIC_ASSERTION);
  await expect.soft(dialog).toHaveAttribute('aria-hidden', 'false', DIAGNOSTIC_ASSERTION);
  await expect.soft(dialog).toHaveAccessibleName(accessibleName, DIAGNOSTIC_ASSERTION);
  await expect.soft(closeButton).toBeFocused(DIAGNOSTIC_ASSERTION);

  const panel = dialog.locator(':scope > div').first();
  const closeBox = await closeButton.boundingBox();
  const viewport = page.viewportSize();

  expect(closeBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!closeBox || !viewport) return;

  await expect.poll(async () => {
    const panelBox = await panel.boundingBox();
    return !!panelBox
      && panelBox.x >= 0
      && panelBox.y >= 0
      && panelBox.x + panelBox.width <= viewport.width + 0.5
      && panelBox.y + panelBox.height <= viewport.height + 0.5;
  }).toBe(true);
  expect.soft(closeBox.width).toBeGreaterThanOrEqual(44);
  expect.soft(closeBox.height).toBeGreaterThanOrEqual(44);
}

async function expectContainedFocus(page: Page, dialog: Locator) {
  const focusable = dialog.locator(VISIBLE_FOCUSABLE_SELECTOR);
  const first = focusable.first();
  const last = focusable.last();

  expect(await focusable.count()).toBeGreaterThan(1);

  await last.focus();
  await page.keyboard.press('Tab');
  await expect.soft(first).toBeFocused(DIAGNOSTIC_ASSERTION);

  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect.soft(last).toBeFocused(DIAGNOSTIC_ASSERTION);
}

async function expectLiveRegion(region: Locator) {
  const hasLiveSemantics = await region.evaluate((element) => {
    const role = element.getAttribute('role');
    const ariaLive = element.getAttribute('aria-live');
    return role === 'alert'
      || role === 'status'
      || ariaLive === 'polite'
      || ariaLive === 'assertive';
  });

  expect.soft(hasLiveSemantics).toBe(true);
}

async function expectClosePaths(
  page: Page,
  trigger: Locator,
  dialog: Locator,
  closeButton: Locator,
) {
  await page.keyboard.press('Escape');
  const escaped = await dialog.isHidden();
  expect.soft(escaped).toBe(true);
  await expect.soft(dialog).toHaveAttribute('aria-hidden', 'true', DIAGNOSTIC_ASSERTION);
  await expect.soft(trigger).toBeFocused(DIAGNOSTIC_ASSERTION);

  if (!escaped) {
    await closeButton.click();
  }

  await trigger.click();
  await expect(dialog).toBeVisible();
  await closeButton.click();
  await expect(dialog).toBeHidden();
  await expect.soft(dialog).toHaveAttribute('aria-hidden', 'true', DIAGNOSTIC_ASSERTION);
  await expect.soft(trigger).toBeFocused(DIAGNOSTIC_ASSERTION);

  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect.soft(trigger).toBeFocused(DIAGNOSTIC_ASSERTION);
}

test.describe('remaining dialog accessibility contracts', () => {
  test('contains and restores focus in Manual L* entry', async ({ page }) => {
    await preparePage(page);
    await openGlobalCorrectionTab(page);

    const trigger = page.locator('#manualLstarBtn');
    const dialog = page.locator('#lstarModal');
    const closeButton = page.locator('#closeLstarModal');
    const validation = page.locator('#lstarValidation');

    await openWithKeyboard(page, trigger, dialog);
    await expectDialogFrame(page, dialog, closeButton, 'Manual Luminosity (L*) Entry');

    await expect(validation).toContainText('All L* values must be set');
    await expectLiveRegion(validation);
    await page.locator('.lstar-input').first().fill('101');
    await expect(validation).toHaveText('L* values must be between 0 and 100');

    await expectContainedFocus(page, dialog);
    await expectClosePaths(page, trigger, dialog, closeButton);
  });

  test('contains and restores focus in Channel Builder', async ({ page }) => {
    await preparePage(page);

    const trigger = page.locator('#channelBuilderBtn');
    const dialog = page.locator('#channelBuilderModal');
    const closeButton = page.locator('#closeChannelBuilderModal');
    const validation = page.locator('#cbKValidation');
    const channelValidation = page.locator('#cbChValidation');

    await openWithKeyboard(page, trigger, dialog);
    await expectDialogFrame(page, dialog, closeButton, 'Channel Builder');

    await page.locator('#cbKEntryModeManual').click();
    await expect(validation).toContainText('All L* values must be set');
    await expectLiveRegion(validation);
    await expectLiveRegion(channelValidation);
    await page.locator('.cbK-lstar-input').first().fill('101');
    await expect(validation).toHaveText('L* values must be between 0 and 100');

    await expectContainedFocus(page, dialog);
    await expectClosePaths(page, trigger, dialog, closeButton);
  });

  test('contains and restores focus in Intent Help', async ({ page }) => {
    await preparePage(page);

    const trigger = page.locator('#intentHelpBtn');
    const dialog = page.locator('#intentHelpPopup');
    const closeButton = page.locator('#closeIntentHelpBtn');

    await openWithKeyboard(page, trigger, dialog);
    await expectDialogFrame(page, dialog, closeButton, 'Global Correction & Intent');
    await expectContainedFocus(page, dialog);
    await expectClosePaths(page, trigger, dialog, closeButton);

    await trigger.click();
    await dialog.locator('[data-open-workflow-help]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#helpPopup')).toBeVisible();
    await expect(page.locator('#closeHelpBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
});
