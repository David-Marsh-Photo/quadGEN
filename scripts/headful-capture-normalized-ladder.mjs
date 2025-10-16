#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const INDEX_URL = pathToFileURL(resolve(__dirname, '..', 'index.html')).href;

const DEFAULT_OPTIONS = {
  quad: 'data/P800_K36C26LK25_V6.quad',
  lab: 'data/P800_K36C26LK25_V6.txt',
  output: 'analysis/headful/p800_normalized_ladder_before_fix.json',
  snapshots: 26,
  start: 0,
  wait: 5000
};

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--output':
        if (typeof next === 'string') {
          options.output = next;
          i += 1;
        }
        break;
      case '--quad':
        if (typeof next === 'string') {
          options.quad = next;
          i += 1;
        }
        break;
      case '--lab':
        if (typeof next === 'string') {
          options.lab = next;
          i += 1;
        }
        break;
      case '--snapshots':
        if (typeof next === 'string') {
          const parsed = Number.parseInt(next, 10);
          if (Number.isFinite(parsed) && parsed > 0) {
            options.snapshots = parsed;
          }
          i += 1;
        }
        break;
      case '--start':
        if (typeof next === 'string') {
          const parsed = Number.parseInt(next, 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            options.start = parsed;
          }
          i += 1;
        }
        break;
      case '--wait':
        if (typeof next === 'string') {
          const parsed = Number.parseInt(next, 10);
          if (Number.isFinite(parsed) && parsed >= 0) {
            options.wait = parsed;
          }
          i += 1;
        }
        break;
      default:
        break;
    }
  }
  return {
    ...options,
    quad: resolve(__dirname, '..', options.quad),
    lab: resolve(__dirname, '..', options.lab),
    output: resolve(__dirname, '..', options.output)
  };
}

const runtimeOptions = parseArgs(process.argv.slice(2));

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto(INDEX_URL);

    await Promise.all([
      page.waitForSelector('#quadFile', { state: 'attached', timeout: 15000 }),
      page.waitForSelector('#linearizationFile', { state: 'attached', timeout: 15000 })
    ]);

    await page.setInputFiles('#quadFile', runtimeOptions.quad);
    await page.waitForFunction(
      () => {
        const data = window.getLoadedQuadData?.();
        return !!(data && data.curves && data.curves.K && data.curves.C && data.curves.LK);
      },
      null,
      { timeout: 20000 }
    );

    await page.setInputFiles('#linearizationFile', runtimeOptions.lab);
    await page.waitForFunction(
      () => window.LinearizationState?.globalApplied === true,
      null,
      { timeout: 20000 }
    );

    await page.waitForTimeout(runtimeOptions.wait);

    const debugState = await page.evaluate(
      ({ start, snapshots }) => {
        const state = window.getCompositeDebugState?.();
        if (!state || !Array.isArray(state.snapshots)) return null;
        const clampedStart = Math.max(0, Math.min(start, state.snapshots.length));
        const focus = state.snapshots.slice(
          clampedStart,
          Math.min(clampedStart + snapshots, state.snapshots.length)
        );
        return {
          summary: state.summary,
          focusSnapshots: focus
        };
      },
      { start: runtimeOptions.start, snapshots: runtimeOptions.snapshots }
    );

    if (!debugState) {
      throw new Error('Unable to capture composite debug state in headful session');
    }

    mkdirSync(dirname(runtimeOptions.output), { recursive: true });
    writeFileSync(runtimeOptions.output, JSON.stringify(debugState, null, 2), 'utf8');
    console.log(`Headful ladder capture written to ${runtimeOptions.output}`);

    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
