import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const STORAGE_KEY = 'quadgen.correctionMethod.v1';

test.describe('Options correction method', () => {
  test('shows the default and persists the selected method', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    await page.reload();
    await page.locator('#optionsBtn').click();

    const group = page.getByRole('group', { name: 'Correction method' });
    const simpleScaling = group.getByRole('radio', { name: /Simple Scaling/ });
    const densitySolver = group.getByRole('radio', { name: /Density Solver/ });

    await expect(group).toBeVisible();
    await expect(simpleScaling).toBeChecked();
    await expect(densitySolver).not.toBeChecked();

    await densitySolver.check();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
      .toBe('densitySolver');

    await page.reload();
    await page.locator('#optionsBtn').click();
    await expect(densitySolver).toBeChecked();
    await expect(simpleScaling).not.toBeChecked();

    await simpleScaling.check();
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
      .toBe('simpleScaling');
  });
});
