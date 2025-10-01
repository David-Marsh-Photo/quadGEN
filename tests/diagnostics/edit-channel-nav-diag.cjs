const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const projectRoot = process.cwd();
  const fileUrl = `file://${path.join(projectRoot, 'index.html')}`;
  const quadPath = path.join(projectRoot, 'testdata', 'humped_shadow_dip.quad');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(fileUrl);

    await page.waitForFunction(() => window.elements?.rows?.children?.length > 0);

    await page.setInputFiles('#quadFile', quadPath);

    await page.waitForFunction(() => window.loadedQuadData?.channels?.length > 1);

    await page.waitForFunction(() => window.setEditMode && window.isEditModeEnabled !== undefined);

    await page.click('#editModeToggleBtn');

    await page.waitForFunction(() => window.isEditModeEnabled && window.isEditModeEnabled());

    await page.waitForFunction(() => {
      const select = document.getElementById('editChannelSelect');
      return select && select.options && select.options.length > 1 && select.value;
    });

    const before = await page.evaluate(() => {
      const select = document.getElementById('editChannelSelect');
      const options = Array.from(select.options).map(opt => ({ value: opt.value, text: opt.textContent, selected: opt.selected }));
      return {
        editEnabled: window.isEditModeEnabled?.() ?? null,
        selectedChannel: window.EDIT?.selectedChannel ?? null,
        dropdownValue: select.value,
        optionCount: options.length,
        options
      };
    });

    console.log('Before navigation:\n', JSON.stringify(before, null, 2));

    await page.click('#editChannelNext');

    const after = await page.evaluate(() => {
      const select = document.getElementById('editChannelSelect');
      const options = Array.from(select.options).map(opt => ({ value: opt.value, text: opt.textContent, selected: opt.selected }));
      return {
        editEnabled: window.isEditModeEnabled?.() ?? null,
        selectedChannel: window.EDIT?.selectedChannel ?? null,
        dropdownValue: select.value,
        optionCount: options.length,
        options
      };
    });

    console.log('After clicking Next:\n', JSON.stringify(after, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

