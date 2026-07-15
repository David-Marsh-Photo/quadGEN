import { test, expect, type Locator } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const STORAGE_KEY = 'quadgen.correctionMethod.v1';

async function contrastRatio(locator: Locator, property: 'color' | 'borderColor' = 'color') {
  return locator.evaluate((element, property) => {
    const parseColor = (value: string) => {
      const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
      const rgb = value.startsWith('color(srgb')
        ? channels.slice(0, 3).map((channel) => channel * 255)
        : channels.slice(0, 3);
      return { rgb, alpha: channels[3] ?? 1 };
    };
    const luminance = (rgb: number[]) => rgb
      .map((channel) => channel / 255)
      .map((channel) => channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);

    const foreground = parseColor(getComputedStyle(element)[property]).rgb;
    let background = [255, 255, 255];
    for (let current: Element | null = element; current; current = current.parentElement) {
      const candidate = parseColor(getComputedStyle(current).backgroundColor);
      if (candidate.rgb.length === 3 && candidate.alpha === 1) {
        background = candidate.rgb;
        break;
      }
    }

    const [lighter, darker] = [luminance(foreground), luminance(background)]
      .sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  }, property);
}

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

  test('keeps primary Options text readable in dark mode', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('quadgen.theme', 'dark'));
    await page.goto(INDEX_URL);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#optionsBtn').click();

    const title = page.locator('#optionsModalTitle');
    const optionLabel = page.locator('label[for="smartPointDragToggle"]');
    await expect(title).toBeVisible();
    await expect(optionLabel).toBeVisible();
    expect(await contrastRatio(title), 'Options title contrast').toBeGreaterThanOrEqual(4.5);
    expect(await contrastRatio(optionLabel), 'Options label contrast').toBeGreaterThanOrEqual(4.5);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`keeps Options help controls distinguishable in ${theme} mode`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem('quadgen.theme', selectedTheme);
      }, theme);
      await page.goto(INDEX_URL);
      await page.locator('#optionsBtn').click();

      const helpButton = page.getByRole('button', { name: 'What does the correction method control?' });
      await expect(helpButton).toBeVisible();
      expect(await contrastRatio(helpButton), `${theme} help glyph contrast`)
        .toBeGreaterThanOrEqual(4.5);
      expect(await contrastRatio(helpButton, 'borderColor'), `${theme} help boundary contrast`)
        .toBeGreaterThanOrEqual(3);

      await helpButton.hover();
      expect(await contrastRatio(helpButton), `${theme} hovered help glyph contrast`)
        .toBeGreaterThanOrEqual(4.5);
      expect(await contrastRatio(helpButton, 'borderColor'), `${theme} hovered help boundary contrast`)
        .toBeGreaterThanOrEqual(3);
    });
  }
});
