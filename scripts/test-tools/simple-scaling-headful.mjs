#!/usr/bin/env node

/**
 * Simple Scaling Headful Capture
 *
 * Launches quadGEN in a headful Chromium session, loads the supplied quad/LAB
 * files, switches to the Simple Scaling correction method, waits for the
 * correction to finish, then captures a JSON snapshot and optional screenshot.
 *
 * Usage:
 *   node scripts/test-tools/simple-scaling-headful.mjs --quad data/*.quad --lab data/*.txt
 *     [--json analysis/output.json] [--screenshot artifacts/simple-scaling/out.png]
 *     [--range 0.6,0.87] [--headless]
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EPSILON = 1e-6;

function parseArgs(argv) {
    const options = {
        quad: null,
        lab: null,
        json: null,
        screenshot: null,
        range: [0.6, 0.87],
        headless: false
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--quad' && argv[i + 1]) {
            options.quad = argv[++i];
        } else if (arg === '--lab' && argv[i + 1]) {
            options.lab = argv[++i];
        } else if (arg === '--json' && argv[i + 1]) {
            options.json = argv[++i];
        } else if (arg === '--screenshot' && argv[i + 1]) {
            options.screenshot = argv[++i];
        } else if (arg === '--range' && argv[i + 1]) {
            const raw = argv[++i];
            const parts = raw.split(',').map((value) => Number(value.trim()));
            if (parts.length === 2 && parts.every((value) => Number.isFinite(value))) {
                options.range = parts;
            }
        } else if (arg === '--headless') {
            options.headless = true;
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
    }

    if (!options.quad || !options.lab) {
        printUsage('Both --quad and --lab are required.');
        process.exit(1);
    }

    return options;
}

function printUsage(errorMessage) {
    if (errorMessage) {
        console.error(`Error: ${errorMessage}\n`);
    }
    console.log(`Simple Scaling Headful Capture

Usage:
  node ${path.relative(process.cwd(), path.join(__dirname, 'simple-scaling-headful.mjs'))} \\
    --quad data/P800_K36C26LK25_V6.quad --lab data/P800_K36C26LK25_V6.txt \\
    [--json analysis/simple-scaling-snapshot.json] \\
    [--screenshot artifacts/simple-scaling/simple-scaling.png] \\
    [--range 0.6,0.87] [--headless]

Options:
  --quad         Path to the QuadToneRIP .quad file to load (required)
  --lab          Path to the LAB/CGATS measurement file (required)
  --json         Output JSON snapshot path (defaults to analysis/simple-scaling-<timestamp>.json)
  --screenshot   Output PNG path (defaults to artifacts/simple-scaling/simple-scaling-<timestamp>.png)
  --range        Input range (start,end) to summarize in the JSON diff (default 0.6,0.87)
  --headless     Launch Chromium headless instead of headful
  --help         Show this message
`);
}

function ensureDirectory(targetPath) {
    const directory = path.dirname(targetPath);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
}

function makeTimestampSlug() {
    const now = new Date();
    const iso = now.toISOString();
    return iso.replace(/[:.]/g, '-');
}

function clampPercent(value) {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function indexForPercent(percent) {
    return Math.round(clampPercent(percent) * 255);
}

function sanitizePath(inputPath) {
    if (!inputPath) return null;
    return path.resolve(process.cwd(), inputPath);
}

function summarizeDiff(baselineCurves, correctedCurves, startPercent, endPercent) {
    if (!baselineCurves || !correctedCurves) {
        return null;
    }
    const startIndex = indexForPercent(startPercent);
    const endIndex = indexForPercent(endPercent);
    const perChannel = {};
    Object.keys(baselineCurves).forEach((channel) => {
        const baseSeries = baselineCurves[channel];
        const correctedSeries = correctedCurves[channel];
        if (!Array.isArray(baseSeries) || !Array.isArray(correctedSeries)) {
            return;
        }
        const diffs = [];
        let baseSum = 0;
        let correctedSum = 0;
        for (let index = startIndex; index <= endIndex; index += 1) {
            const baseValue = Number(baseSeries[index]) || 0;
            const correctedValue = Number(correctedSeries[index]) || 0;
            baseSum += baseValue;
            correctedSum += correctedValue;
            diffs.push(correctedValue - baseValue);
        }
        if (!diffs.length) {
            return;
        }
        const minDiff = Math.min(...diffs);
        const maxDiff = Math.max(...diffs);
        const avgDiff = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
        perChannel[channel] = {
            minDiff,
            maxDiff,
            avgDiff,
            totalBaseline: baseSum,
            totalCorrected: correctedSum,
            totalDelta: correctedSum - baseSum
        };
    });

    const totals = Object.keys(perChannel).reduce((acc, channel) => {
        acc.totalBaseline += perChannel[channel].totalBaseline || 0;
        acc.totalCorrected += perChannel[channel].totalCorrected || 0;
        return acc;
    }, { totalBaseline: 0, totalCorrected: 0 });

    const rangeSize = Math.max(1, endIndex - startIndex + 1);
    const avgBaselinePerIndex = totals.totalBaseline / rangeSize;
    const avgCorrectedPerIndex = totals.totalCorrected / rangeSize;

    return {
        range: {
            startPercent: startPercent * 100,
            endPercent: endPercent * 100,
            startIndex,
            endIndex,
            count: rangeSize
        },
        perChannel,
        totals: {
            baseline: totals.totalBaseline,
            corrected: totals.totalCorrected,
            delta: totals.totalCorrected - totals.totalBaseline,
            avgBaselinePerIndex,
            avgCorrectedPerIndex,
            avgDeltaPerIndex: avgCorrectedPerIndex - avgBaselinePerIndex
        }
    };
}

async function captureSimpleScaling(options) {
    const quadPath = sanitizePath(options.quad);
    const labPath = sanitizePath(options.lab);
    if (!fs.existsSync(quadPath)) {
        throw new Error(`Quad file not found: ${quadPath}`);
    }
    if (!fs.existsSync(labPath)) {
        throw new Error(`LAB file not found: ${labPath}`);
    }

    const timestamp = makeTimestampSlug();
    const defaultJson = path.resolve(`analysis/simple-scaling-${timestamp}.json`);
    const defaultScreenshot = path.resolve(`artifacts/simple-scaling/simple-scaling-${timestamp}.png`);
    const jsonPath = sanitizePath(options.json || defaultJson);
    const screenshotPath = sanitizePath(options.screenshot || defaultScreenshot);

    ensureDirectory(jsonPath);
    ensureDirectory(screenshotPath);

    const browser = await chromium.launch({ headless: options.headless !== false ? options.headless : false });
    const context = await browser.newContext();

    await context.addInitScript(() => {
        try {
            const storage = window.localStorage;
            storage.removeItem('quadgen.correctionMethod.v1');
            storage.removeItem('quadgen.labNormalizationMode');
            storage.removeItem('quadgen.labSmoothingPercent');
            storage.removeItem('quadgen.plotSmoothingPercent');
            storage.setItem('quadgen.labNormalizationMode', 'lstar');
        } catch (err) {
            console.warn('Init script failed to access localStorage', err);
        }
    });

    const page = await context.newPage();
    const indexUrl = pathToFileURL(path.resolve('index.html')).href;
    await page.goto(indexUrl);

    const consoleErrors = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        consoleErrors.push(error.message);
    });

    await page.waitForSelector('#optionsBtn', { timeout: 15000 });
    await page.click('#optionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'visible', timeout: 10000 });
    await page.locator('#correctionMethodSimple').scrollIntoViewIfNeeded();
    await page.click('#correctionMethodSimple');
    await page.waitForFunction(() => {
        const radio = document.querySelector('#correctionMethodSimple');
        return !!radio && radio.checked;
    }, null, { timeout: 5000 });
    await page.click('#closeOptionsBtn');
    await page.waitForSelector('#optionsModal', { state: 'hidden', timeout: 10000 });

    await page.setInputFiles('#quadFile', quadPath);
    await page.waitForFunction(() => {
        if (typeof window.getLoadedQuadData !== 'function') {
            return false;
        }
        const data = window.getLoadedQuadData();
        return !!(data && data.curves && Object.keys(data.curves).length > 0);
    }, null, { timeout: 20000 });

    const baseline = await page.evaluate(() => {
        if (typeof window.getLoadedQuadData !== 'function') {
            return null;
        }
        const data = window.getLoadedQuadData();
        return {
            curves: JSON.parse(JSON.stringify(data?.curves || {})),
            baselineEnd: { ...(data?.baselineEnd || {}) }
        };
    });

    await page.setInputFiles('#linearizationFile', labPath);
    await page.waitForFunction(() => {
        const ready = !!(window.LinearizationState && window.LinearizationState.globalApplied);
        const summary = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData()?.simpleScalingSummary : null;
        return ready && !!summary;
    }, null, { timeout: 30000 });

    await page.waitForTimeout(1000);

    const snapshot = await page.evaluate(() => {
        const corrected = window.LinearizationState?.getGlobalCorrectedCurves?.() || null;
        const loaded = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
        const compositeReady = !!(window.LinearizationState && window.LinearizationState.globalApplied);
        return {
            corrected,
            loadedCurves: loaded?.curves || null,
            baselineEnd: loaded?.baselineEnd || null,
            simpleScalingSummary: loaded?.simpleScalingSummary || null,
            correctionMethod: loaded?.correctionMethod || null,
            globalApplied: compositeReady
        };
    });

    const chartComparison = await page.evaluate(() => {
        const summary = {
            available: typeof window.make256 === 'function',
            applyLinearization: !!(window.LinearizationState &&
                window.LinearizationState.globalApplied &&
                typeof window.LinearizationState.getGlobalData === 'function' &&
                window.LinearizationState.getGlobalData()),
            totalConstant: typeof window.TOTAL === 'number' ? window.TOTAL : 65535,
            channels: {}
        };

        if (!summary.available) {
            return summary;
        }

        const corrected = window.LinearizationState?.getGlobalCorrectedCurves?.() || null;
        const loaded = typeof window.getLoadedQuadData === 'function' ? window.getLoadedQuadData() : null;
        if (!corrected || !loaded) {
            return summary;
        }

        const baselineEnd = loaded.baselineEnd || {};
        const normalizeFn = typeof window.isChannelNormalizedToEnd === 'function'
            ? window.isChannelNormalizedToEnd
            : () => false;

        Object.keys(corrected).forEach((channel) => {
            const correctedCurve = Array.isArray(corrected[channel]) ? corrected[channel] : [];
            const endValueCandidates = [
                Number(baselineEnd?.[channel]) || 0,
                correctedCurve.reduce((max, value) => {
                    const numeric = Number(value) || 0;
                    return numeric > max ? numeric : max;
                }, 0)
            ];
            const computedEndValue = endValueCandidates.reduce((max, value) => (value > max ? value : max), 0);
            const endValue = Math.max(1, Math.round(computedEndValue));
            const normalizeToEnd = !!normalizeFn(channel);

            let renderedCurve = [];
            try {
                const rawRender = window.make256(endValue, channel, summary.applyLinearization, { normalizeToEnd });
                renderedCurve = Array.isArray(rawRender) ? rawRender.map((value) => Number(value) || 0) : [];
            } catch (err) {
                console.warn('[simple-scaling-headful] Failed to sample make256 for channel', channel, err);
                renderedCurve = [];
            }

            const length = Math.min(renderedCurve.length, correctedCurve.length);
            let maxAbsDiff = 0;
            let maxIndex = -1;
            let sumAbsDiff = 0;
            for (let i = 0; i < length; i += 1) {
                const diff = (renderedCurve[i] || 0) - (Number(correctedCurve[i]) || 0);
                const absDiff = Math.abs(diff);
                if (absDiff > maxAbsDiff) {
                    maxAbsDiff = absDiff;
                    maxIndex = i;
                }
                sumAbsDiff += absDiff;
            }

            summary.channels[channel] = {
                normalizeToEnd,
                endValue,
                renderedLength: renderedCurve.length,
                correctedLength: correctedCurve.length,
                maxAbsDiff,
                maxAbsDiffPercentOfEnd: endValue > 0 ? maxAbsDiff / endValue : 0,
                meanAbsDiff: length > 0 ? sumAbsDiff / length : 0,
                sampleIndexOfMaxDiff: maxIndex,
                renderedHead: renderedCurve.slice(0, 8),
                renderedTail: renderedCurve.slice(-8)
            };
        });

        return summary;
    });

    const [rangeStart, rangeEnd] = options.range || [0, 1];
    const diffSummary = summarizeDiff(
        baseline?.curves || null,
        snapshot.corrected || null,
        clampPercent(rangeStart),
        clampPercent(rangeEnd)
    );

    const output = {
        timestamp: new Date().toISOString(),
        dataset: {
            quad: path.relative(process.cwd(), quadPath),
            lab: path.relative(process.cwd(), labPath)
        },
        options: {
            headless: options.headless,
            range: [clampPercent(rangeStart), clampPercent(rangeEnd)]
        },
        baseline,
        snapshot,
        diffSummary,
        chartComparison,
        consoleErrors
    };

    fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));

    await page.screenshot({
        path: screenshotPath,
        fullPage: false,
        clip: { x: 160, y: 140, width: 920, height: 560 }
    });

    await context.close();
    await browser.close();

    const totalBaseline = diffSummary?.totals?.baseline ?? 0;
    const totalCorrected = diffSummary?.totals?.corrected ?? 0;
    const delta = diffSummary?.totals?.delta ?? 0;

    console.log('Simple Scaling headful capture complete.');
    console.log(`  Quad file:       ${path.relative(process.cwd(), quadPath)}`);
    console.log(`  LAB file:        ${path.relative(process.cwd(), labPath)}`);
    console.log(`  JSON snapshot:   ${path.relative(process.cwd(), jsonPath)}`);
    console.log(`  Screenshot:      ${path.relative(process.cwd(), screenshotPath)}`);
    console.log(`  Range:           ${(options.range[0] * 100).toFixed(1)}% – ${(options.range[1] * 100).toFixed(1)}%`);
    console.log(`  Totals baseline: ${totalBaseline.toFixed(3)}`);
    console.log(`  Totals corrected:${totalCorrected.toFixed(3)}`);
    console.log(`  Delta:           ${delta.toFixed(3)} (avg ${(diffSummary?.totals?.avgDeltaPerIndex ?? 0).toFixed(3)})`);

    if (chartComparison?.channels && Object.keys(chartComparison.channels).length > 0) {
        let worstChannel = null;
        Object.entries(chartComparison.channels).forEach(([channel, summary]) => {
            if (!worstChannel || summary.maxAbsDiff > worstChannel.maxAbsDiff) {
                worstChannel = { channel, ...summary };
            }
        });
        if (worstChannel) {
            console.log(
                `  Chart vs model:  max |Δ| = ${worstChannel.maxAbsDiff} ` +
                `(channel ${worstChannel.channel}, index ${worstChannel.sampleIndexOfMaxDiff})`
            );
        }
    }

    if (consoleErrors.length) {
        console.warn(`⚠️  Browser console emitted ${consoleErrors.length} error(s) during capture. See JSON for details.`);
    }

    return { jsonPath, screenshotPath, diffSummary, chartComparison, consoleErrors };
}

(async () => {
    const options = parseArgs(process.argv.slice(2));
    await captureSimpleScaling(options);
})().catch((error) => {
    console.error('Simple Scaling headful capture failed:', error);
    process.exit(1);
});
