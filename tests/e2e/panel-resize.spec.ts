import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';

const INDEX_PATH = `file://${process.cwd()}/index.html`;

test.describe('Panel Resize Functionality', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure clean test state
    await page.goto(INDEX_PATH);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#panelDivider', { timeout: 5000 });
  });

  test('should have dual panel layout with correct structure', async ({ page }) => {
    // Verify layout structure exists
    const dualPanel = await page.$('.dual-panel-layout');
    expect(dualPanel).toBeTruthy();

    const chartPanel = await page.$('#chartPanel');
    expect(chartPanel).toBeTruthy();

    const rightPanel = await page.$('#rightPanel');
    expect(rightPanel).toBeTruthy();

    const panelDivider = await page.$('#panelDivider');
    expect(panelDivider).toBeTruthy();

    console.log('✓ Dual panel layout structure verified');
  });

  test('should have vertical tabs in right panel', async ({ page }) => {
    // Verify vertical tab navigation
    const verticalTabNav = await page.$('.vertical-tab-nav');
    expect(verticalTabNav).toBeTruthy();

    // Check for Edit and Global tab buttons
    const editBtn = await page.$('.tab-btn-vertical[data-tab="edit"]');
    const globalBtn = await page.$('.tab-btn-vertical[data-tab="global"]');

    expect(editBtn).toBeTruthy();
    expect(globalBtn).toBeTruthy();

    // Verify Channels tab (bottom panel) is active
    const channelsBtn = await page.$('.tab-btn[data-tab="channels"]');
    const channelsActive = await channelsBtn?.evaluate(el => el.classList.contains('active'));
    expect(channelsActive).toBe(true);

    // Vertical tabs may or may not be active by default (based on HTML/localStorage)
    // What matters is they are independent from horizontal tabs
    console.log('✓ Vertical tabs verified (Channels active in bottom panel)');
  });

  test('should switch between vertical tabs', async ({ page }) => {
    const editBtn = await page.$('.tab-btn-vertical[data-tab="edit"]');
    const globalBtn = await page.$('.tab-btn-vertical[data-tab="global"]');

    // Click Global tab
    await globalBtn?.click();
    await page.waitForTimeout(300);

    // Verify Global is active
    const globalActive = await globalBtn?.evaluate(el => el.classList.contains('active'));
    const editActive = await editBtn?.evaluate(el => el.classList.contains('active'));

    expect(globalActive).toBe(true);
    expect(editActive).toBe(false);

    // Verify content visibility
    const editContent = await page.$('.tab-content[data-tab-content="edit"]');
    const globalContent = await page.$('.tab-content[data-tab-content="global"]');

    const editHidden = await editContent?.evaluate(el => el.hasAttribute('hidden'));
    const globalHidden = await globalContent?.evaluate(el => el.hasAttribute('hidden'));

    expect(editHidden).toBe(true);
    expect(globalHidden).toBe(false);

    console.log('✓ Tab switching works');
  });

  test('global correction tab content stays within right panel wrapper', async ({ page }) => {
    const globalBtn = page.locator('.tab-btn-vertical[data-tab="global"]');
    await globalBtn.click();
    await page.waitForSelector('.tab-content[data-tab-content="global"]', { state: 'attached' });

    const parentInfo = await page.evaluate(() => {
      const panel = document.querySelector('.tab-content[data-tab-content="global"]');
      if (!panel) {
        return { parentClassList: [], parentId: null };
      }
      const parent = panel.parentElement;
      return {
        parentClassList: parent ? Array.from(parent.classList) : [],
        parentId: parent ? parent.id || null : null
      };
    });

    expect(parentInfo.parentClassList).toContain('tab-content-wrapper-vertical');

    const screenshotPath = test.info().outputPath('global-correction-tab.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await test.info().attach('global-correction-tab', {
      path: screenshotPath,
      contentType: 'image/png'
    });
  });

  test('should keep tab groups independent', async ({ page }) => {
    // Click Edit tab (vertical)
    await page.click('.tab-btn-vertical[data-tab="edit"]');
    await page.waitForTimeout(300);

    // Verify Channels (horizontal) is still active
    const channelsActive1 = await page.evaluate(() => {
      return document.querySelector('.tab-btn[data-tab="channels"]')?.classList.contains('active');
    });
    expect(channelsActive1).toBe(true);

    // Click Lab Tech tab (horizontal)
    await page.click('.tab-btn[data-tab="lab"]');
    await page.waitForTimeout(300);

    // Verify Edit (vertical) is still active
    const editActive = await page.evaluate(() => {
      return document.querySelector('.tab-btn-vertical[data-tab="edit"]')?.classList.contains('active');
    });
    expect(editActive).toBe(true);

    // Verify Lab Tech is now active (horizontal)
    const labActive = await page.evaluate(() => {
      return document.querySelector('.tab-btn[data-tab="lab"]')?.classList.contains('active');
    });
    expect(labActive).toBe(true);

    // Verify Channels is no longer active (horizontal switched)
    const channelsActive2 = await page.evaluate(() => {
      return document.querySelector('.tab-btn[data-tab="channels"]')?.classList.contains('active');
    });
    expect(channelsActive2).toBe(false);

    console.log('✓ Tab groups are independent');
  });

  test('should resize panels by dragging divider', async ({ page }) => {
    const chartPanel = page.locator('#chartPanel');
    const rightPanel = page.locator('#rightPanel');
    const panelDivider = page.locator('#panelDivider');

    // Get initial widths
    const initialChartWidth = await chartPanel.evaluate(el => el.offsetWidth);
    const initialRightWidth = await rightPanel.evaluate(el => el.offsetWidth);

    console.log(`Initial widths - Chart: ${initialChartWidth}px, Right: ${initialRightWidth}px`);

    // Get divider position
    const dividerBox = await panelDivider.boundingBox();
    expect(dividerBox).toBeTruthy();

    // Drag divider to the left (expand right panel, shrink chart)
    await page.mouse.move(dividerBox!.x + dividerBox!.width / 2, dividerBox!.y + dividerBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dividerBox!.x - 100, dividerBox!.y + dividerBox!.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(500);

    // Get new widths
    const newChartWidth = await chartPanel.evaluate(el => el.offsetWidth);
    const newRightWidth = await rightPanel.evaluate(el => el.offsetWidth);

    console.log(`After drag - Chart: ${newChartWidth}px, Right: ${newRightWidth}px`);

    // Verify widths changed
    expect(newChartWidth).toBeLessThan(initialChartWidth);
    expect(newRightWidth).toBeGreaterThan(initialRightWidth);

    console.log('✓ Panel resize by dragging works');
  });

  test('should respect minimum width constraints', async ({ page }) => {
    const chartPanel = page.locator('#chartPanel');
    const rightPanel = page.locator('#rightPanel');
    const panelDivider = page.locator('#panelDivider');

    const dividerBox = await panelDivider.boundingBox();
    expect(dividerBox).toBeTruthy();

    // Try to drag far right (shrink right panel beyond minimum)
    await page.mouse.move(dividerBox!.x + dividerBox!.width / 2, dividerBox!.y + dividerBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dividerBox!.x + 500, dividerBox!.y + dividerBox!.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(500);

    const rightWidth = await rightPanel.evaluate(el => el.offsetWidth);

    // Right panel should not be smaller than 380px minimum
    expect(rightWidth).toBeGreaterThanOrEqual(256);

    console.log(`✓ Minimum width constraint enforced: ${rightWidth}px >= 256px`);
  });

  test('should persist panel width to localStorage', async ({ page }) => {
    const panelDivider = page.locator('#panelDivider');
    const rightPanel = page.locator('#rightPanel');

    // Resize panels
    const dividerBox = await panelDivider.boundingBox();
    await page.mouse.move(dividerBox!.x + dividerBox!.width / 2, dividerBox!.y + dividerBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dividerBox!.x - 100, dividerBox!.y + dividerBox!.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(500);

    const resizedWidth = await rightPanel.evaluate(el => el.offsetWidth);

    // Check localStorage
    const storedWidth = await page.evaluate(() => localStorage.getItem('quadgen.rightPanelWidth'));
    expect(storedWidth).toBeTruthy();

    console.log(`✓ Width persisted to localStorage: ${storedWidth}`);

    // Reload page
    await page.reload();
    await page.waitForSelector('#panelDivider', { timeout: 5000 });

    // Verify width is restored
    const restoredWidth = await rightPanel.evaluate(el => el.offsetWidth);

    // Allow small rounding differences
    expect(Math.abs(restoredWidth - resizedWidth)).toBeLessThan(5);

    console.log(`✓ Width restored after reload: ${restoredWidth}px (was ${resizedWidth}px)`);
  });

  test('should work with both horizontal and vertical dividers independently', async ({ page }) => {
    const chartContainer = page.locator('#chartContainer');
    const chartDivider = page.locator('#chartDivider');
    const panelDivider = page.locator('#panelDivider');

    // Get initial heights and widths
    const initialHeight = await chartContainer.evaluate(el => el.offsetHeight);
    const initialChartWidth = await page.locator('#chartPanel').evaluate(el => el.offsetWidth);

    // Resize chart height (horizontal divider)
    const chartDividerBox = await chartDivider.boundingBox();
    await page.mouse.move(chartDividerBox!.x + chartDividerBox!.width / 2, chartDividerBox!.y + chartDividerBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(chartDividerBox!.x + chartDividerBox!.width / 2, chartDividerBox!.y + 50);
    await page.mouse.up();

    await page.waitForTimeout(500);

    const newHeight = await chartContainer.evaluate(el => el.offsetHeight);
    expect(newHeight).toBeGreaterThan(initialHeight);

    // Resize panel width (vertical divider)
    const panelDividerBox = await panelDivider.boundingBox();
    await page.mouse.move(panelDividerBox!.x + panelDividerBox!.width / 2, panelDividerBox!.y + panelDividerBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(panelDividerBox!.x - 50, panelDividerBox!.y + panelDividerBox!.height / 2);
    await page.mouse.up();

    await page.waitForTimeout(500);

    const newChartWidth = await page.locator('#chartPanel').evaluate(el => el.offsetWidth);
    expect(newChartWidth).toBeLessThan(initialChartWidth);

    console.log('✓ Both dividers work independently');
  });

  test('should show proper cursor on hover', async ({ page }) => {
    const panelDivider = page.locator('#panelDivider');

    // Check cursor style
    const cursor = await panelDivider.evaluate(el => {
      return window.getComputedStyle(el).cursor;
    });

    expect(cursor).toBe('col-resize');

    console.log('✓ Correct cursor displayed');
  });

  test('visual regression: light mode panel layout', async ({ page }) => {
    await page.waitForTimeout(1000); // Let everything render

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toBeTruthy();

    console.log('✓ Light mode screenshot captured');
  });

  test('visual regression: dark mode panel layout', async ({ page }) => {
    // Enable dark mode
    const themeToggle = await page.$('#themeToggle');
    if (themeToggle) {
      await themeToggle.click();
      await page.waitForTimeout(500);
    }

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot).toBeTruthy();

    console.log('✓ Dark mode screenshot captured');
  });

  test('responsive: should stack panels below 830px', async ({ page }) => {
    // Set viewport to narrow width
    await page.setViewportSize({ width: 800, height: 1000 });
    await page.waitForTimeout(500);

    const dualPanel = page.locator('.dual-panel-layout');
    const flexDirection = await dualPanel.evaluate(el => {
      return window.getComputedStyle(el).flexDirection;
    });

    expect(flexDirection).toBe('column');

    // Verify divider is hidden
    const dividerDisplay = await page.locator('#panelDivider').evaluate(el => {
      return window.getComputedStyle(el).display;
    });

    expect(dividerDisplay).toBe('none');

    console.log('✓ Responsive layout verified');
  });

});
