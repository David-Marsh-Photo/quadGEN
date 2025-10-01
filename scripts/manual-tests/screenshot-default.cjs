const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({
    path: 'default-state-chart.png',
    fullPage: false
  });

  console.log('Screenshot saved to default-state-chart.png');

  // Get info about what's displayed
  const info = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-channel]'));
    const channelInfo = rows.map(r => {
      const ch = r.getAttribute('data-channel');
      const percentInput = r.querySelector('.percent-input');
      const checkbox = r._virtualCheckbox;
      return {
        channel: ch,
        percent: percentInput?.value,
        enabled: checkbox?.checked,
        visible: !r.hasAttribute('data-compact') || r.getAttribute('data-compact') === 'false'
      };
    }).filter(c => c.visible);

    return {
      visibleChannels: channelInfo,
      hasChart: !!document.querySelector('#inkChart')
    };
  });

  console.log('Visible channels:', JSON.stringify(info, null, 2));

  await page.waitForTimeout(2000);
  await browser.close();
})();