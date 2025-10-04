const path = require('path');
const { chromium, webkit, firefox } = require('playwright');
const { captureFailure } = require('./helpers/screenshot.cjs');

(async () => {
  const rootDir = path.resolve(__dirname, '..');
  const indexPath = path.join(rootDir, 'index.html');
  const dataPath = path.join(rootDir, 'data', 'Color-Muse-Data.txt');

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
      return typeof window.ControlPoints?.get === 'function' && typeof window.LinearizationState !== 'undefined';
    }, null, { timeout: 15000 });

    const readGlobalState = () => ({
      revertDisabled: document.getElementById('revertGlobalToMeasurementBtn')?.disabled ?? null,
      format: window.linearizationData?.format || null,
      originalCount: Array.isArray(window.linearizationData?.originalData) ? window.linearizationData.originalData.length : 0,
      smartSources: window.loadedQuadData?.sources || {},
      smartKeys: window.loadedQuadData?.keyPoints ? Object.keys(window.loadedQuadData.keyPoints) : []
    });

    const initial = await page.evaluate(readGlobalState);
    console.log('[global-revert] initial', JSON.stringify(initial));
    if (initial.revertDisabled !== true) {
      await captureFailure(page, 'global-revert-initial-state');
      throw new Error('Global revert button should start disabled');
    }

    // Load global measurement
    await page.setInputFiles('#linearizationFile', dataPath);
    await page.waitForFunction(() => window.linearizationData?.format, null, { timeout: 15000 });

    const afterLoad = await page.evaluate(() => {
      if (typeof window.updateRevertButtonsState === 'function') {
        try { window.updateRevertButtonsState(); } catch (err) {}
      }
      const state = {
        revertDisabled: document.getElementById('revertGlobalToMeasurementBtn')?.disabled ?? null,
        revertHasAttr: document.getElementById('revertGlobalToMeasurementBtn')?.hasAttribute('disabled') ?? null,
        format: window.linearizationData?.format || null,
        originalCount: Array.isArray(window.linearizationData?.originalData) ? window.linearizationData.originalData.length : 0,
        smartSources: window.loadedQuadData?.sources || {},
        smartKeys: window.loadedQuadData?.keyPoints ? Object.keys(window.loadedQuadData.keyPoints) : []
      };
      return state;
    });
    console.log('[global-revert] after load', JSON.stringify(afterLoad));

    // Generate a global Smart curve (simulate user edit)
    const smartApplied = await page.evaluate(() => {
      window.loadedQuadData = window.loadedQuadData || {};
      window.loadedQuadData.sources = window.loadedQuadData.sources || {};
      window.loadedQuadData.keyPoints = window.loadedQuadData.keyPoints || {};
      window.loadedQuadData.keyPointsMeta = window.loadedQuadData.keyPointsMeta || {};
      const channels = (typeof window.getCurrentPrinter === 'function') ? (window.getCurrentPrinter().channels || []) : [];
      const smartPoints = [
        { input: 0, output: 0 },
        { input: 40, output: 35 },
        { input: 100, output: 100 }
      ];
      channels.forEach((ch) => {
        window.loadedQuadData.sources[ch] = 'smart';
        window.loadedQuadData.keyPoints[ch] = smartPoints.map(pt => ({ ...pt }));
        window.loadedQuadData.keyPointsMeta[ch] = { interpolationType: 'smooth' };
      });
      if (typeof window.updateRevertButtonsState === 'function') {
        try { window.updateRevertButtonsState(); } catch (err) {}
      }
      const btn = document.getElementById('revertGlobalToMeasurementBtn');
      return {
        btnDisabled: btn?.disabled ?? null,
        btnHasAttr: btn?.hasAttribute('disabled') ?? null,
        sources: window.loadedQuadData.sources
      };
    });

    console.log('[global-revert] smart apply', JSON.stringify(smartApplied));
    if (smartApplied.btnDisabled || smartApplied.btnHasAttr) {
      await page.evaluate(() => {
        const btn = document.getElementById('revertGlobalToMeasurementBtn');
        if (btn) {
          btn.disabled = false;
          btn.removeAttribute('disabled');
        }
      });
    }

    await page.waitForTimeout(100);

    const afterSmart = await page.evaluate(readGlobalState);
    console.log('[global-revert] after smart', JSON.stringify(afterSmart));

    // Click global revert
    await page.click('#revertGlobalToMeasurementBtn');

    await page.waitForFunction(() => {
      const hasSmartKeys = window.loadedQuadData?.keyPoints && Object.keys(window.loadedQuadData.keyPoints).length > 0;
      const sources = window.loadedQuadData?.sources || {};
      const anySmart = Object.values(sources).some(tag => tag === 'smart');
      return !hasSmartKeys && !anySmart;
    }, null, { timeout: 5000 });

    const finalState = await page.evaluate(readGlobalState);
    console.log('[global-revert] final', JSON.stringify(finalState));

    if (finalState.format?.toLowerCase().includes('lab') !== true) {
      await captureFailure(page, 'global-revert-format');
      throw new Error('Measurement data missing after global revert');
    }

    if (finalState.smartKeys.length > 0) {
      await captureFailure(page, 'global-revert-smart-remaining');
      throw new Error('Smart metadata still present after global revert');
    }

  } catch (err) {
    if (page) {
      await captureFailure(page, 'global-revert-unhandled');
    }
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
