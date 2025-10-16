import { chromium } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const INDEX_URL = pathToFileURL(resolve('index.html')).href;
const QUAD_PATH = resolve('data/P800_K36C26LK25_V6.quad');
const LAB_PATH = resolve('data/P800_K36C26LK25_V6.txt');
const OUTPUT_PATH = resolve('artifacts/channel-coverage-indicator.png');

async function waitForAppReady(page) {
  await Promise.all([
    page.waitForSelector('#quadFile', { timeout: 15000, state: 'attached' }),
    page.waitForSelector('#linearizationFile', { timeout: 15000, state: 'attached' })
  ]);
  await page.waitForFunction(() => typeof window.getLoadedQuadData === 'function', null, { timeout: 20000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(INDEX_URL);
    await waitForAppReady(page);

    await page.evaluate(() => {
      if (typeof window.enableCompositeLabRedistribution === 'function') {
        window.enableCompositeLabRedistribution(true);
      }
    });

    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal:not(.hidden)');

    const autoRaiseToggle = page.locator('#autoRaiseInkToggle');
    try {
      await autoRaiseToggle.waitFor({ state: 'visible', timeout: 5000 });
      if (!(await autoRaiseToggle.isChecked())) {
        await autoRaiseToggle.check();
      }
    } catch {
      // ignore if toggle not present
    }

    const weightingSelect = page.locator('#compositeWeightingSelect');
    try {
      await weightingSelect.waitFor({ state: 'visible', timeout: 5000 });
      await weightingSelect.selectOption('normalized');
    } catch {
      // selector may not be present if options modal differs; that's fine
    }

    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 5000 });

    // Load the multi-ink dataset so coverage indicators populate
    await page.setInputFiles('#quadFile', QUAD_PATH);
    await page.waitForFunction(() => {
      const data = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
      return !!(data && data.curves && Object.keys(data.curves).length);
    }, null, { timeout: 20000 });

    await page.setInputFiles('#linearizationFile', LAB_PATH);
    await page.waitForFunction(
      () => !!(window.LinearizationState && window.LinearizationState.globalApplied),
      null,
      { timeout: 20000 }
    );

    // Allow UI updates (status toasts, table refresh) to settle before sampling the indicator
    await page.waitForTimeout(2500);

    const debugSnapshot = await page.evaluate(() => Array.from(document.querySelectorAll('[data-coverage-indicator]')).map((el) => ({
      text: el.textContent,
      classes: el.className
    })));
    console.log('Coverage indicator DOM snapshot:', debugSnapshot);

    const coverageSummary = await page.evaluate(() => (typeof window.getCompositeCoverageSummary === 'function' ? window.getCompositeCoverageSummary() : null));
    console.log('Coverage summary snapshot:', coverageSummary);

    // Wait for the coverage indicator to render
    const indicator = page.locator('[data-coverage-indicator]:not(.hidden)').first();
    await indicator.waitFor({ state: 'visible', timeout: 15000 });

    const cellHandle = await indicator.evaluateHandle((el) => el.closest('td'));
    const cellElement = cellHandle.asElement();
    if (cellElement) {
      await cellElement.screenshot({ path: OUTPUT_PATH, animations: 'disabled' });
    } else {
      await indicator.screenshot({ path: OUTPUT_PATH, animations: 'disabled' });
    }
    console.log(`Saved coverage indicator screenshot to ${OUTPUT_PATH}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('[capture-coverage-indicator]', error);
  process.exitCode = 1;
});
