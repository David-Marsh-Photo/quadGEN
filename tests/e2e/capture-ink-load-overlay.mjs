import { chromium } from 'playwright';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const OUTPUT_PATH = resolve('test-screenshots/ink-load-overlay.png');

async function captureOverlayScreenshot() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const indexUrl = pathToFileURL(resolve('index.html')).href;
    await page.goto(indexUrl);

    await page.waitForSelector('#globalLinearizationBtn', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(
      () => {
        const rows = (window).elements?.rows?.children;
        return !!rows && rows.length > 0;
      },
      undefined,
      { timeout: 15000 }
    );

    await page.click('#optionsBtn');
    const toggle = page.locator('#inkLoadOverlayToggle');
    await toggle.waitFor({ state: 'visible', timeout: 5000 });
    await toggle.check();
    await page.click('#closeOptionsBtn', { timeout: 5000 });

    await page.waitForFunction(() => {
      const overlay = (window).__quadDebug?.chartDebug?.lastInkLoadOverlay;
      return overlay && Array.isArray(overlay.curve) && overlay.curve.length === 256;
    }, { timeout: 5000 });

    await page.screenshot({ path: OUTPUT_PATH, fullPage: false });
  } finally {
    await browser.close();
  }
}

captureOverlayScreenshot().catch((error) => {
  console.error('Failed to capture ink-load overlay screenshot:', error);
  process.exit(1);
});
