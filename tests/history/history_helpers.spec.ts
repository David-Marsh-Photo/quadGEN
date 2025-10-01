import { test, expect } from '@playwright/test';
import { navigateToApp, waitForUndoRedoReady, getUndoRedoButtons } from '../utils/history-helpers';

test.describe('History helper utilities', () => {
  test('navigates to quadGEN and exposes undo/redo controls', async ({ page }) => {
    await navigateToApp(page);
    await waitForUndoRedoReady(page);

    const { undoButton, redoButton } = await getUndoRedoButtons(page);
    await expect(undoButton).toBeVisible();
    await expect(redoButton).toBeVisible();
    await expect(undoButton).toBeDisabled();
    await expect(redoButton).toBeDisabled();
  });
});
