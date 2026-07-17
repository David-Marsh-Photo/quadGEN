import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForSelector('#globalLinearizationBtn', { state: 'attached', timeout: 15000 });
  await page.waitForFunction(
    () => {
      const rows = (window as any).elements?.rows?.children;
      return !!rows && rows.length > 0;
    },
    undefined,
    { timeout: 15000 }
  );
}

async function readLayout(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const chart = document.querySelector<HTMLElement>('#chartPanel')!;
    const right = document.querySelector<HTMLElement>('#rightPanel')!;
    const divider = document.querySelector<HTMLElement>('#panelDivider')!;
    const editStack = document.querySelector<HTMLElement>('#editPanelBody > .flex')!;
    const editGrid = document.querySelector<HTMLElement>('#editPanelBody .grid.grid-cols-5')!;
    const filename = document.querySelector<HTMLElement>('#filenameInput')!;
    const quadFile = document.querySelector<HTMLElement>('#quadFile')!;
    const chartRect = chart.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();

    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      channelBackdrop: getComputedStyle(document.querySelector('#channelBuilderModal')!).backgroundColor,
      optionsBackdrop: getComputedStyle(document.querySelector('#optionsModal')!).backgroundColor,
      rightBackground: getComputedStyle(right).backgroundColor,
      scaleBackground: getComputedStyle(document.querySelector('#scaleAllInput')!).backgroundColor,
      scaleBorder: getComputedStyle(document.querySelector('#scaleAllInput')!).borderColor,
      dividerDisplay: getComputedStyle(divider).display,
      editStackDirection: getComputedStyle(editStack).flexDirection,
      editGridColumns: getComputedStyle(editGrid).gridTemplateColumns
        .split(' ')
        .filter(Boolean).length,
      filenameFlexGrow: getComputedStyle(filename).flexGrow,
      quadFileDisplay: getComputedStyle(quadFile).display,
      chart: {
        x: chartRect.x,
        y: chartRect.y,
        right: chartRect.right,
        bottom: chartRect.bottom,
        width: chartRect.width,
      },
      right: {
        x: rightRect.x,
        y: rightRect.y,
        width: rightRect.width,
      },
    };
  });
}

type LayoutSnapshot = Awaited<ReturnType<typeof readLayout>>;

function expectUtilityLayout(layout: LayoutSnapshot) {
  expect(layout.quadFileDisplay).toBe('none');
  expect(layout.filenameFlexGrow).toBe('1');
  expect(layout.editStackDirection).toBe('column');
  expect(layout.editGridColumns).toBe(5);
}

function expectDesktopLayout(layout: LayoutSnapshot) {
  expect(layout.dividerDisplay).not.toBe('none');
  expect(Math.abs(layout.chart.y - layout.right.y)).toBeLessThanOrEqual(1);
  expect(layout.right.x).toBeGreaterThanOrEqual(layout.chart.right);
}

function expectNarrowLayout(layout: LayoutSnapshot) {
  expect(layout.dividerDisplay).toBe('none');
  expect(Math.abs(layout.right.x - layout.chart.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.right.width - layout.chart.width)).toBeLessThanOrEqual(1);
  expect(layout.right.y).toBeGreaterThanOrEqual(layout.chart.bottom);
}

function expectLightTheme(layout: LayoutSnapshot) {
  expect(layout.bodyBackground).toBe('rgb(249, 250, 251)');
  expect(layout.rightBackground).toBe('rgb(255, 255, 255)');
  expect(layout.scaleBackground).toBe('rgb(255, 255, 255)');
  expect(layout.scaleBorder).toBe('rgb(229, 231, 235)');
  expect(layout.channelBackdrop).toMatch(/(?:\/|,)\s*0\.5\)$/);
  expect(layout.optionsBackdrop).toMatch(/(?:\/|,)\s*0\.3\)$/);
}

function expectDarkTheme(layout: LayoutSnapshot) {
  expect(layout.bodyBackground).toBe('rgb(10, 10, 10)');
  expect(layout.rightBackground).toBe('rgb(23, 23, 23)');
  expect(layout.channelBackdrop).toBe('rgb(23, 23, 23)');
  expect(layout.optionsBackdrop).toBe('rgb(23, 23, 23)');
}

test.describe('Page load smoke check', () => {
  test('loads index.html without errors or an assistant surface', async ({ page }) => {
    const indexPath = resolve('index.html');
    const consoleErrors: string[] = [];
    const externalRequests: string[] = [];

    await page.route(/^https?:\/\//, async (route) => {
      externalRequests.push(route.request().url());
      await route.abort('internetdisconnected');
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`pageerror: ${error.message}`);
    });

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(`console error: ${message.text()}`);
      }
    });

    await page.goto(indexUrl);
    await waitForAppReady(page);

    await expect(page.locator('#autoBlackLimitToggle')).not.toBeChecked();
    await expect(page.locator('.tab-nav .tab-btn')).toHaveCount(2);
    await expect(page.locator('.tab-btn[data-tab="preview"]')).toBeVisible();
    await expect(page.locator('.tab-btn[data-tab="lab"]')).toHaveCount(0);
    await expect(page.locator('[data-tab-content="lab"]')).toHaveCount(0);
    await expect(page.locator('#aiInputCompact')).toHaveCount(0);
    await expect(page.locator('#sendMessageBtnCompact')).toHaveCount(0);

    const assistantGlobals = await page.evaluate(() => {
      return ['aiConfig', 'chatInterface', 'chatUI', 'sendChatMessage']
        .filter((name) => name in window);
    });

    expect(assistantGlobals).toEqual([]);
    expect(readFileSync(indexPath, 'utf8')).not.toContain(
      'sparkling-shape-8b5a.marshmonkey.workers.dev'
    );
    for (const dynamicUtility of ['border-blue-400', 'border-green-400', 'border-orange-400']) {
      expect(readFileSync(indexPath, 'utf8')).toContain(`.${dynamicUtility}`);
    }
    expect(externalRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('retains utility layout offline across viewport and theme changes', async ({ page }) => {
    const externalRequests: string[] = [];

    await page.route(/^https?:\/\//, async (route) => {
      externalRequests.push(route.request().url());
      await route.abort('internetdisconnected');
    });
    await page.addInitScript(() => {
      localStorage.setItem('quadgen.theme', 'light');
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(indexUrl);
    await waitForAppReady(page);

    const desktopLight = await readLayout(page);
    expectUtilityLayout(desktopLight);
    expectDesktopLayout(desktopLight);
    expectLightTheme(desktopLight);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    await expect(page.locator('#themeToggle')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#themeToggle').click();
    const desktopDark = await readLayout(page);
    expectUtilityLayout(desktopDark);
    expectDesktopLayout(desktopDark);
    expectDarkTheme(desktopDark);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#themeToggle')).toHaveAttribute('aria-pressed', 'true');

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowDark = await readLayout(page);
    expectUtilityLayout(narrowDark);
    expectNarrowLayout(narrowDark);
    expectDarkTheme(narrowDark);

    await page.locator('#themeToggle').click();
    const narrowLight = await readLayout(page);
    expectUtilityLayout(narrowLight);
    expectNarrowLayout(narrowLight);
    expectLightTheme(narrowLight);
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    await expect(page.locator('#themeToggle')).toHaveAttribute('aria-pressed', 'false');

    expect(externalRequests).toEqual([]);
  });
});
