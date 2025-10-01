const path = require('path');
const { chromium, webkit, firefox } = require('playwright');
const { captureFailure } = require('./helpers/screenshot.cjs');

(async () => {
  const rootDir = path.resolve(__dirname, '..');
  const indexPath = path.join(rootDir, 'index.html');
  const dataPath = path.join(rootDir, 'Color-Muse-Data.txt');

  async function launchBrowser() {
    const launchers = [
      () => chromium.launch({ headless: true, chromiumSandbox: false }).catch(err => {
        console.warn('[playwright-test] Chromium launch failed:', err.message);
        return null;
      }),
      () => webkit.launch({ headless: true }).catch(err => {
        console.warn('[playwright-test] WebKit launch failed:', err.message);
        return null;
      }),
      () => firefox.launch({ headless: true }).catch(err => {
        console.warn('[playwright-test] Firefox launch failed:', err.message);
        return null;
      })
    ];

    for (const attempt of launchers) {
      const browser = await attempt();
      if (browser) return browser;
    }

    throw new Error('Failed to launch any Playwright browser (Chromium/WebKit/Firefox).');
  }

  let browser;
  let page;

  try {
    browser = await launchBrowser();
    page = await browser.newPage();
    page.on('console', msg => {
      console.log(`[page] ${msg.text()}`);
    });

    await page.goto(`file://${indexPath}`);
    await page.waitForFunction(() => {
      return !!(window.ControlPoints && typeof window.ControlPoints.get === 'function');
    }, null, { timeout: 15000 });

  const readChannelCounts = () => {
    return Array.from(document.querySelectorAll('[data-channel]')).map(row => {
      const channel = row.getAttribute('data-channel');
      const pts = window.ControlPoints?.get?.(channel)?.points;
      return {
        channel,
        count: Array.isArray(pts) ? pts.length : 0
      };
    });
  };

  const readChannelInfo = () => {
    return Array.from(document.querySelectorAll('[data-channel]')).map(row => ({
      channel: row.getAttribute('data-channel'),
      percent: row.querySelector('.percent-input')?.value,
      end: row.querySelector('.end-input')?.value
    }));
  };

  const getLinearizationMeta = () => ({
    format: window.linearizationData?.format || null,
    hasOriginal: Array.isArray(window.linearizationData?.originalData),
    originalCount: Array.isArray(window.linearizationData?.originalData) ? window.linearizationData.originalData.length : 0,
    keyPointMeta: window.loadedQuadData?.keyPointsMeta || null,
    hasSmoothingFn: typeof window.linearizationData?.getSmoothingControlPoints === 'function'
  });

  const hasThreshold = (counts, threshold) => counts.some(entry => entry.count >= threshold);

  // Enable edit mode once to capture baseline counts
  await page.click('#editModeToggleBtn');
  const defaultChannelCounts = await page.evaluate(readChannelCounts);
  const defaultChannelInfo = await page.evaluate(readChannelInfo);
  console.log('[debug] default channel counts', JSON.stringify(defaultChannelCounts));
  console.log('[debug] default channel info before load', JSON.stringify(defaultChannelInfo));
  await page.click('#editModeToggleBtn');
  await page.waitForTimeout(200);

  // Load measurement data
  await page.setInputFiles('#linearizationFile', dataPath);
  await page.waitForFunction(() => {
    const data = window.linearizationData;
    return !!(data && typeof data.format === 'string');
  }, null, { timeout: 15000 });

  const linearizationMeta = await page.evaluate(getLinearizationMeta);
  const originalDataSample = await page.evaluate(() => {
    const data = Array.isArray(window.linearizationData?.originalData)
      ? window.linearizationData.originalData.slice(0, 5)
      : null;
    return data;
  });
  const sampleValues = await page.evaluate(() => {
    const arr = Array.isArray(window.linearizationData?.samples)
      ? window.linearizationData.samples.slice(0, 5)
      : null;
    return arr;
  });
  const globalApplied = await page.evaluate(() => !!window.LinearizationState?.globalApplied);
  const linearizationKeys = await page.evaluate(() => Object.keys(window.linearizationData || {}));
  console.log('[debug] linearization meta', JSON.stringify(linearizationMeta));
  console.log('[debug] original data sample', JSON.stringify(originalDataSample));
  console.log('[debug] first samples', JSON.stringify(sampleValues));
  console.log('[debug] linearization keys', JSON.stringify(linearizationKeys));
  console.log('[debug] globalApplied', globalApplied);

    // Re-enable edit mode to allow Smart point regeneration
    await page.click('#editModeToggleBtn');
    try {
      await page.waitForFunction(() => {
        const counts = Array.from(document.querySelectorAll('[data-channel]')).map(row => {
          const channel = row.getAttribute('data-channel');
          const pts = window.ControlPoints?.get?.(channel)?.points;
          return Array.isArray(pts) ? pts.length : 0;
        });
        return counts.some(count => count >= 20);
      }, null, { timeout: 15000 });
    } catch (error) {
      const debugState = await page.evaluate(() => ({
        counts: Array.from(document.querySelectorAll('[data-channel]')).map(row => {
          const channel = row.getAttribute('data-channel');
          const pts = window.ControlPoints?.get?.(channel)?.points;
          return { channel, count: Array.isArray(pts) ? pts.length : 0 };
        }),
        meta: window.loadedQuadData?.keyPointsMeta || null,
        linearizationFormat: window.linearizationData?.format || null
      }));
      console.log('[debug] wait for measurement points timed out:', JSON.stringify(debugState));
      await captureFailure(page, 'edit-mode-seeding-timeout');
      error.__screenshotCaptured = true;
      throw error;
    }

    const seededChannelCounts = await page.evaluate(readChannelCounts);
    const postLoadChannelInfo = await page.evaluate(readChannelInfo);

    const defaultMax = defaultChannelCounts.reduce((max, entry) => Math.max(max, entry.count), 0);
    const seededMax = seededChannelCounts.reduce((max, entry) => Math.max(max, entry.count), 0);

    const result = {
      defaultChannelCounts,
      seededChannelCounts,
      defaultMax,
      seededMax,
      linearizationMeta,
      defaultChannelInfo,
      postLoadChannelInfo
    };

    console.log('[debug] default counts', JSON.stringify(defaultChannelCounts));
    console.log('[debug] seeded counts', JSON.stringify(seededChannelCounts));
    console.log('[debug] default channel info', JSON.stringify(defaultChannelInfo));
    console.log('[debug] post-load channel info', JSON.stringify(postLoadChannelInfo));
    console.log(JSON.stringify(result, null, 2));

    if (!hasThreshold(seededChannelCounts, 20)) {
      const err = new Error(`Expected at least one channel to have >=20 Smart points after measurement load. Seeded counts: ${JSON.stringify(seededChannelCounts)}`);
      await captureFailure(page, 'edit-mode-seeding-threshold');
      err.__screenshotCaptured = true;
      throw err;
    }
  } catch (err) {
    if (page && !err.__screenshotCaptured) {
      await captureFailure(page, 'edit-mode-seeding-unhandled');
      err.__screenshotCaptured = true;
    }
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
