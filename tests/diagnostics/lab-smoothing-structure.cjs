#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Diagnostic script: inspects key DOM nodes related to LAB smoothing workflow.
 * Run this before crafting interaction flows so we know the selectors/states.
 */

const { chromium } = require('playwright');
const { resolve } = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const indexUrl = pathToFileURL(resolve('index.html')).href;

  page.on('console', (msg) => {
    console.log(`[console:${msg.type()}] ${msg.text()}`);
  });

  await page.goto(indexUrl);

  await page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 });
  await page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 });
  await page.waitForSelector('#optionsBtn', { state: 'attached', timeout: 15000 });

  const domSummary = await page.evaluate(() => {
    const quadInput = document.querySelector('#quadFile');
    const labInput = document.querySelector('#linearizationFile');
    const optionsButton = document.querySelector('#optionsBtn');
    const smoothingSlider = document.querySelector('#labSmoothingPercentSlider');
    const smoothingLabel = document.querySelector('#labSmoothingPercentValue');

    return {
      quadInput: quadInput
        ? {
            tag: quadInput.tagName,
            type: quadInput.getAttribute('type'),
            accept: quadInput.getAttribute('accept'),
            hidden: quadInput.hasAttribute('hidden'),
            disabled: quadInput.disabled,
          }
        : null,
      labInput: labInput
        ? {
            tag: labInput.tagName,
            type: labInput.getAttribute('type'),
            accept: labInput.getAttribute('accept'),
            hidden: labInput.hasAttribute('hidden'),
            disabled: labInput.disabled,
          }
        : null,
      optionsButton: optionsButton
        ? {
            tag: optionsButton.tagName,
            text: optionsButton.textContent?.trim() ?? '',
            disabled: optionsButton.hasAttribute('disabled'),
          }
        : null,
      smoothingSlider: smoothingSlider
        ? {
            tag: smoothingSlider.tagName,
            type: smoothingSlider.getAttribute('type'),
            min: smoothingSlider.getAttribute('min'),
            max: smoothingSlider.getAttribute('max'),
            value: smoothingSlider.value,
            disabled: smoothingSlider.disabled,
            inDom: true,
          }
        : { inDom: false },
      smoothingLabel: smoothingLabel
        ? {
            tag: smoothingLabel.tagName,
            text: smoothingLabel.textContent?.trim() ?? '',
          }
        : null,
    };
  });

  console.log('[diagnostic] DOM summary:', JSON.stringify(domSummary, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error('Diagnostic script failed:', err);
  process.exitCode = 1;
});

