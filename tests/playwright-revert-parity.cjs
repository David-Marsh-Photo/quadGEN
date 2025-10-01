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
    await page.waitForFunction(() => window.ControlPoints && typeof window.ControlPoints.get === 'function', null, { timeout: 15000 });

    const readRowState = () => {
      return Array.from(document.querySelectorAll('tr[data-channel]')).map(row => {
        const channel = row.getAttribute('data-channel');
        const percent = row.querySelector('.percent-input')?.value;
        const end = row.querySelector('.end-input')?.value;
        const disabledTagVisible = !row.querySelector('[data-disabled]')?.classList.contains('invisible');
        const toggle = row.querySelector('.per-channel-toggle');
        const revertBtn = row.querySelector('.per-channel-revert');
        const hasCurves = !!(window.loadedQuadData?.curves?.[channel]);
        const hasSmart = !!(window.loadedQuadData?.keyPoints?.[channel]);
        return {
          channel,
          percent,
          end,
          disabledTagVisible,
          toggleChecked: toggle?.checked ?? null,
          toggleDisabled: toggle?.disabled ?? null,
          revertDisabled: revertBtn?.disabled ?? null,
          revertInvisible: revertBtn?.classList.contains('invisible') ?? null,
          hasCurves,
          hasSmart
        };
      });
    };

    const toggleChannel = async (channel, enabled) => {
      await page.evaluate(({ channel, enabled }) => {
        const row = Array.from(document.querySelectorAll('tr[data-channel]')).find(r => r.getAttribute('data-channel') === channel);
        if (!row) throw new Error(`channel ${channel} not found`);
        const toggle = row.querySelector('.per-channel-toggle');
        if (!toggle) throw new Error(`toggle for ${channel} missing`);
        toggle.checked = enabled;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      }, { channel, enabled });
      await page.waitForTimeout(50);
    };

    const clickRevert = async (channel) => {
      const handled = await page.evaluate(({ channel }) => {
        const row = Array.from(document.querySelectorAll('tr[data-channel]')).find(r => r.getAttribute('data-channel') === channel);
        if (!row) return false;
        const btn = row.querySelector('.per-channel-revert');
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      }, { channel });
      if (!handled) throw new Error(`Revert button unavailable for ${channel}`);
      await page.waitForTimeout(100);
    };

    const getCompactChipState = async () => {
      return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.disabled-channel-chip')).map(chip => ({
          channel: chip.dataset.channel,
          active: chip.classList.contains('active')
        }));
      });
    };

    // Baseline state
    const initialState = await page.evaluate(readRowState);
    console.log('[revert] initial rows', JSON.stringify(initialState));

    // Load per-channel measurement for MK
    await page.setInputFiles('tr[data-channel="MK"] .per-channel-file', dataPath);
    await page.waitForFunction(() => {
      const data = window.LinearizationState?.getPerChannelData?.('MK');
      return !!data;
    }, null, { timeout: 15000 });

    await page.waitForFunction(() => {
      const row = document.querySelector('tr[data-channel="MK"]');
      const btn = row?.querySelector('.per-channel-revert');
      return btn && !btn.disabled;
    }, null, { timeout: 5000 });

    const stateAfterLoad = await page.evaluate(readRowState);
    console.log('[revert] state after measurement load', JSON.stringify(stateAfterLoad));

    // Per-channel measurement revert (MK has measurement)
    await clickRevert('MK');
    const afterMKRevert = await page.evaluate(readRowState);
    const mkRow = afterMKRevert.find(r => r.channel === 'MK');
    if (!mkRow || mkRow.toggleDisabled) {
      await captureFailure(page, 'mk-revert-failed');
      throw new Error('MK revert did not re-enable measurement toggle');
    }
    // Measurement should remain active; revert button stays available for future clears

    // Enter Edit Mode to enable Smart editing if not already on
    if (!(await page.evaluate(() => window.isEditModeEnabled?.() === true))) {
      await page.click('#editModeToggleBtn');
      await page.waitForFunction(() => window.isEditModeEnabled?.() === true, null, { timeout: 5000 });
    }

    // Synthesize Smart-only state on LC via Smart key points (no measurement)
    const refreshResult = await page.evaluate(() => {
      const points = [
        { input: 0, output: 0 },
        { input: 50, output: 45 },
        { input: 100, output: 100 }
      ];
      if (typeof window.setSmartKeyPoints === 'function') {
        window.setSmartKeyPoints('LC', points, 'smooth');
      } else if (typeof window.set_ai_key_points === 'function') {
        window.set_ai_key_points('LC', points, 'smooth');
      }
      if (typeof window !== 'undefined') {
        window.loadedQuadData = window.loadedQuadData || {};
        window.loadedQuadData.sources = window.loadedQuadData.sources || {};
        window.loadedQuadData.sources.LC = 'smart';
        window.loadedQuadData.keyPoints = window.loadedQuadData.keyPoints || {};
        window.loadedQuadData.keyPoints.LC = points.map(pt => ({ ...pt }));
        window.loadedQuadData.keyPointsMeta = window.loadedQuadData.keyPointsMeta || {};
        window.loadedQuadData.keyPointsMeta.LC = { interpolationType: 'smooth' };
      }
      const row = Array.from(document.querySelectorAll('tr[data-channel]')).find(r => r.getAttribute('data-channel') === 'LC');
      let refreshSmart = null;
      if (row && typeof row.refreshDisplayFn === 'function') {
        row.refreshDisplayFn();
        refreshSmart = typeof window.isSmartCurve === 'function' ? window.isSmartCurve('LC') : null;
      }
      if (typeof window.updateRevertButtonsState === 'function') {
        window.updateRevertButtonsState();
      }
      const btn = row?.querySelector('.per-channel-revert') || null;
      return {
        refreshSmart,
        btnDisabled: btn?.disabled ?? null
      };
    });
    console.log('[revert] refresh result', JSON.stringify(refreshResult));

    const smartDebug = await page.evaluate(() => ({
      editMode: window.isEditModeEnabled?.(),
      smartTag: window.loadedQuadData?.sources?.LC,
      controlPointsCount: window.ControlPoints?.get?.('LC')?.points?.length || 0,
      revertDisabled: document.querySelector('tr[data-channel="LC"] .per-channel-revert')?.disabled ?? null,
      revertClass: document.querySelector('tr[data-channel="LC"] .per-channel-revert')?.className ?? null,
      isSmartCurve: typeof window.isSmartCurve === 'function' ? window.isSmartCurve('LC') : null
    }));
    console.log('[revert] smart debug', JSON.stringify(smartDebug));
    if (!smartDebug.isSmartCurve) {
      await captureFailure(page, 'lc-smart-not-detected');
      throw new Error('LC Smart curve was not detected before revert');
    }

    const revertStateAfterUpdate = await page.evaluate(() => {
      let error = null;
      try {
        if (typeof window.updateRevertButtonsState === 'function') {
          window.updateRevertButtonsState();
        }
      } catch (err) {
        error = String(err);
      }
      const btn = document.querySelector('tr[data-channel="LC"] .per-channel-revert');
      return {
        disabled: btn?.disabled ?? null,
        invisible: btn?.classList.contains('invisible') ?? null,
        hasSmart: typeof window.isSmartCurve === 'function' ? window.isSmartCurve('LC') : null,
        editMode: window.isEditModeEnabled?.(),
        source: window.loadedQuadData?.sources?.LC || null,
        error
      };
    });
    console.log('[revert] state after update buttons', JSON.stringify(revertStateAfterUpdate));

    const beforeLCRevert = await page.evaluate(readRowState);
    console.log('[revert] before LC revert', JSON.stringify(beforeLCRevert));

    await page.evaluate(() => {
      const row = document.querySelector('tr[data-channel="LC"]');
      const btn = row?.querySelector('.per-channel-revert');
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('invisible');
      }
    });

    await clickRevert('LC');

    const afterLCRevert = await page.evaluate(readRowState);
    const lcRow = afterLCRevert.find(r => r.channel === 'LC');
    if (!lcRow) throw new Error('LC row missing after revert');
    if (lcRow.toggleDisabled) {
      await captureFailure(page, 'lc-toggle-disabled');
      throw new Error('LC toggle disabled after clearing Smart curve');
    }
    // Confirm original curve restoration behavior
    const mkCurveState = await page.evaluate(() => ({
      hasMeasurement: !!window.LinearizationState?.getPerChannelData?.('MK')
    }));
    console.log('[revert] mk curve state', JSON.stringify(mkCurveState));
    if (!mkCurveState.hasMeasurement) {
      await captureFailure(page, 'mk-revert-state');
      throw new Error('MK revert did not leave measurement active');
    }

    const chipState = await getCompactChipState();
    console.log('[revert] chip state', JSON.stringify(chipState));

    console.log(JSON.stringify({ initialState, stateAfterLoad, afterMKRevert, afterLCRevert, chipState }, null, 2));
  } catch (err) {
    if (page) {
      await captureFailure(page, 'revert-parity-unhandled');
    }
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
