import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const targetHtml = process.env.LEGACY_HTML || process.argv[2] || 'quadgen.html';
  const legacyUrl = 'file://' + process.cwd() + '/' + targetHtml;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(legacyUrl);
  await page.waitForTimeout(1000);

  const manualLabPath = resolve('data-samples/Manual-LAB-Data.txt');
  const manualLabContent = await readFile(manualLabPath, 'utf8');

const baseline = await page.evaluate(async ({ manualLabContent }) => {
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    const summarize = (arr) => ({
      min: Math.min(...arr),
      max: Math.max(...arr),
      mid: arr[128],
      q1: arr[64],
      q3: arr[192],
    });

    const ensureArray = (maybeArr) => Array.from(maybeArr || [], Number);

    const manualPairs = [
      { x: 0, l: 90 },
      { x: 25, l: 75 },
      { x: 50, l: 50 },
      { x: 75, l: 25 },
      { x: 100, l: 10 },
    ];

    const results = {};

    try {
      const parsedPoints = manualLabContent.split(/\r?\n/).reduce((acc, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.toUpperCase().includes('GRAY')) return acc;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) return acc;
        const grayPercent = parseFloat(parts[0]);
        const labL = parseFloat(parts[1]);
        if (!Number.isFinite(grayPercent) || !Number.isFinite(labL)) return acc;
        const normalized = grayPercent > 100 ? (grayPercent / 255) * 100 : grayPercent;
        acc.push({ input: normalized, lab: labL });
        return acc;
      }, []);

      const corrected = normalizeLinearizationEntry(buildLabLinearizationFromOriginal(parsedPoints));
      const samples = corrected.samples ? corrected.samples.map(v => Math.round(clamp01(v) * 65535)) : [];
      results.manualLabData = {
        samples,
        summary: samples.length === 256 ? summarize(samples) : null
      };
    } catch (err) {
      results.manualLabData = { error: err?.message || String(err) };
    }

    try {
      const manualData = normalizeLinearizationEntry(buildManualLinearizationFromOriginal(manualPairs.map(pair => ({ input: pair.x, lab: pair.l }))));
      const samples = manualData.samples ? manualData.samples.map(v => Math.round(clamp01(v) * 65535)) : [];
      results.manualFiveStep = {
        samples,
        summary: samples.length === 256 ? summarize(samples) : null
      };
    } catch (err) {
      results.manualFiveStep = { error: err?.message || String(err) };
    }

    return results;
  }, { manualLabContent });

  await browser.close();

  const outputDir = process.env.OUTPUT_DIR || 'test-results/legacy-before';
  const outDir = resolve(outputDir);
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `baseline_${targetHtml.replace(/[^a-z0-9_-]/gi, '_')}.json`);
  await writeFile(outPath, JSON.stringify(baseline, null, 2), 'utf8');

  const manualStats = baseline.manualLabData?.summary;
  const manualFiveStats = baseline.manualFiveStep?.summary;

  console.log('Manual LAB baseline summary:', manualStats);
  console.log('Manual 5-step baseline summary:', manualFiveStats);
  console.log(`Wrote baseline data to ${outPath}`);
}

main().catch(err => {
  console.error('Baseline capture failed:', err);
  process.exitCode = 1;
});
