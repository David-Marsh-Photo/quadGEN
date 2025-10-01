import { chromium } from 'playwright';

async function run() {
  // Force IPv4 loopback (avoid ::1)
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com');
  console.log('Title:', await page.title());
  await context.close(); // don’t browser.close(); it would kill external Chrome
}
run().catch(err => { console.error('Playwright connection failed:', err); process.exit(1); });