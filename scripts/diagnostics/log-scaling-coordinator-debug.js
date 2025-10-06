#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { chromium } from 'playwright';

const OUTPUT_DIR = path.resolve('artifacts/scaling-coordinator-debug');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  await ensureDir(OUTPUT_DIR);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`file://${path.resolve('index.html')}`);
    await page.waitForSelector('#scaleAllInput', { timeout: 20000 });

    const debugInfo = await page.evaluate(() => {
      const coordinator = window.scalingCoordinator;
      return coordinator ? coordinator.getDebugInfo?.() : null;
    });

    const payload = {
      capturedAt: new Date().toISOString(),
      debugInfo
    };

    const filePath = path.join(OUTPUT_DIR, `debug-${Date.now()}.json`);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Scaling coordinator debug snapshot written to', filePath);
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
