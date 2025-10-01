const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const allRows = Array.from(document.querySelectorAll('[data-channel]'));
    const mkRow = document.querySelector('[data-channel="MK"]');

    return {
      rowCount: allRows.length,
      channels: allRows.map(r => r.getAttribute('data-channel')),
      mkExists: !!mkRow,
      mkInputs: mkRow ? {
        hasPercentInput: !!mkRow.querySelector('.percent-input'),
        hasEndInput: !!mkRow.querySelector('.end-input'),
        hasFileInput: !!mkRow.querySelector('input[type="file"]'),
        hasLoadBtn: !!mkRow.querySelector('.per-channel-btn')
      } : null
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await page.waitForTimeout(3000);
  await browser.close();
})();