#!/usr/bin/env node
import { chromium } from 'playwright';
import { resolve } from 'path';

const INTERESTING = [/\[MAKE256]/, /\[SMART CURVES]/, /\[buildBaseCurve]/, /Selected channel/, /Loaded curve snapshot/, /Overlay marker/, /DEBUG_LOGS enabled/, /\[per-channel]/, /\[global]/];

function shouldPrint(text) {
  return INTERESTING.some((rx) => rx.test(text));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', (msg) => {
    const text = msg.text();
    if (shouldPrint(text)) {
      console.log('[console]', text);
    }
  });

  await page.goto(`file://${resolve('index.html')}`);

  await page.waitForSelector('#globalLinearizationBtn');

  await page.evaluate(() => {
    window.DEBUG_LOGS = true;
    console.log('DEBUG_LOGS enabled in page context');
  });

  const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');
  await page.setInputFiles('input#linearizationFile', manualLabPath);
  await page.waitForFunction(
    () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
    null,
    { timeout: 15000 },
  );

  await page.locator('#editModeToggleBtn').click();
  await page.waitForFunction(() => window.isEditModeEnabled?.(), null, { timeout: 10000 });

  await page.locator('#editPointRight').click();
  await page.waitForTimeout(100);

  await page.evaluate(() => {
    if (typeof window.setSelectedChannel === 'function') {
      window.setSelectedChannel('MK');
    }
    if (typeof window.reinitializeChannelSmartCurves === 'function') {
      window.reinitializeChannelSmartCurves('MK', { forceIfEditModeEnabling: true });
    }
    if (typeof window.updateInkChart === 'function') {
      window.updateInkChart();
    }
  });

  await page.waitForTimeout(200);

  console.log('--- BEFORE NUDGE ---');

  await page.evaluate(() => {
    const channel = window.EDIT?.selectedChannel;
    const ord = window.EDIT?.selectedOrdinal;
    const pts = window.ControlPoints?.get(channel)?.points || [];
    console.log('Selected channel before', channel, 'ordinal', ord, 'point', pts[ord - 1]);
    console.log('Loaded curve snapshot before', {
      source: window.loadedQuadData?.sources?.[channel],
      first: window.loadedQuadData?.curves?.[channel]?.[0],
      mid: window.loadedQuadData?.curves?.[channel]?.[128],
      last: window.loadedQuadData?.curves?.[channel]?.[255],
      idx64: window.loadedQuadData?.curves?.[channel]?.[64]
    });
    const overlay = window.__LAST_SMART_OVERLAY_DETAILS;
    if (overlay) {
      const debugPoint = overlay.points?.[ord - 1];
      console.log('Overlay marker before', overlay);
      console.log('Selected overlay point before', debugPoint);
    } else {
      console.log('Overlay marker before', null);
    }
  });

  await page.locator('#editNudgeYUp').click();
  await page.waitForTimeout(200);

  console.log('--- AFTER NUDGE ---');

  await page.waitForFunction(() => {
    const details = window.__LAST_SMART_OVERLAY_DETAILS;
    const channel = window.EDIT?.selectedChannel;
    return !!details && details.channelName === channel && Array.isArray(details.points) && details.points.length > 1;
  }, null, { timeout: 5000 });
  await page.evaluate(() => {
    const channel = window.EDIT?.selectedChannel;
    const ord = window.EDIT?.selectedOrdinal;
    const pts = window.ControlPoints?.get(channel)?.points || [];
    console.log('Selected channel after', channel, 'ordinal', ord, 'point', pts[ord - 1]);
    console.log('Loaded curve snapshot after', {
      source: window.loadedQuadData?.sources?.[channel],
      first: window.loadedQuadData?.curves?.[channel]?.[0],
      mid: window.loadedQuadData?.curves?.[channel]?.[128],
      last: window.loadedQuadData?.curves?.[channel]?.[255],
      idx64: window.loadedQuadData?.curves?.[channel]?.[64]
    });
    const overlay = window.__LAST_SMART_OVERLAY_DETAILS;
    if (overlay) {
      const debugPoint = overlay.points?.[ord - 1];
      console.log('Overlay marker after', overlay);
      console.log('Selected overlay point after', debugPoint);
    } else {
      console.log('Overlay marker after', null);
    }
  });

  await browser.close();
}

main().catch((err) => {
  console.error('[debug-edit-nudge] Failure:', err);
  process.exitCode = 1;
});
