import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseQuadFile } from '../src/js/parsers/file-parsers.js';
import { parseLabData } from '../src/js/data/lab-parser.js';
import {
  apply1DLUTFixedDomain,
  apply1DLUTActiveRange
} from '../src/js/core/processing-pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function clampIndex(index) {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(255, Math.round(index)));
}

function analyzeCurve(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      firstNonZeroIndex: -1,
      firstNonZeroPercent: null,
      lastNonZeroIndex: -1,
      lastNonZeroPercent: null,
      activeSpan: 0,
      maxValue: 0,
      maxIndex: -1,
      maxPercent: null,
      p0: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p100: 0
    };
  }

  const firstNonZero = values.findIndex((value) => value > 0);
  const lastNonZero = (() => {
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] > 0) return i;
    }
    return -1;
  })();

  const maxValue = values.reduce((acc, value) => (value > acc ? value : acc), 0);
  const maxIndex = values.indexOf(maxValue);

  const sampleAtPercent = (percent) => {
    const idx = clampIndex((percent / 100) * 255);
    return values[idx] ?? 0;
  };

  const percentFromIndex = (index) => {
    if (index < 0) return null;
    return Number(((index / 255) * 100).toFixed(3));
  };

  return {
    firstNonZeroIndex: firstNonZero,
    firstNonZeroPercent: percentFromIndex(firstNonZero),
    lastNonZeroIndex: lastNonZero,
    lastNonZeroPercent: percentFromIndex(lastNonZero),
    activeSpan: firstNonZero >= 0 && lastNonZero >= firstNonZero ? (lastNonZero - firstNonZero) : 0,
    maxValue,
    maxIndex,
    maxPercent: percentFromIndex(maxIndex),
    p0: values[0] ?? 0,
    p25: sampleAtPercent(25),
    p50: sampleAtPercent(50),
    p75: sampleAtPercent(75),
    p100: values[255] ?? 0
  };
}

function compareCurves(reference, variant) {
  const length = Math.min(reference.length, variant.length);
  let maxAbsDelta = 0;
  let sumAbsDelta = 0;
  let firstDiffIndex = -1;
  let lastDiffIndex = -1;

  for (let i = 0; i < length; i++) {
    const delta = (variant[i] ?? 0) - (reference[i] ?? 0);
    const absDelta = Math.abs(delta);
    if (absDelta > 0 && firstDiffIndex === -1) {
      firstDiffIndex = i;
    }
    if (absDelta > 0) {
      lastDiffIndex = i;
    }
    if (absDelta > maxAbsDelta) {
      maxAbsDelta = absDelta;
    }
    sumAbsDelta += absDelta;
  }

  return {
    maxAbsDelta,
    meanAbsDelta: length > 0 ? Number((sumAbsDelta / length).toFixed(3)) : 0,
    firstDiffIndex,
    lastDiffIndex,
    firstDiffPercent: firstDiffIndex >= 0 ? Number(((firstDiffIndex / 255) * 100).toFixed(3)) : null,
    lastDiffPercent: lastDiffIndex >= 0 ? Number(((lastDiffIndex / 255) * 100).toFixed(3)) : null
  };
}

function normalizeLabEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Invalid LAB entry received.');
  }

  const samples = Array.isArray(entry.samples) && entry.samples.length
    ? entry.samples.slice()
    : Array.isArray(entry.baseSamples) && entry.baseSamples.length
      ? entry.baseSamples.slice()
      : null;

  if (!samples) {
    throw new Error('LAB entry missing usable samples array.');
  }

  return {
    samples,
    domainMin: typeof entry.domainMin === 'number' ? entry.domainMin : 0,
    domainMax: typeof entry.domainMax === 'number' ? entry.domainMax : 1,
    smoothingAlgorithm: entry.smoothingAlgorithm,
    sourceSpace: entry.sourceSpace,
    originalData: Array.isArray(entry.originalData) ? entry.originalData.map((point) => ({ ...point })) : []
  };
}

function parseArgs(argv) {
  const options = {
    quad: 'data/P800_K37_C26_LK25_V1.quad',
    lab: 'data/P800_K37_C26_LK25_V1_correction.txt',
    out: 'docs/investigation/baselines/P800_K37_C26_LK25_V1_baseline.json',
    label: null
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quad' && argv[i + 1]) {
      options.quad = argv[++i];
    } else if (arg === '--lab' && argv[i + 1]) {
      options.lab = argv[++i];
    } else if (arg === '--out' && argv[i + 1]) {
      options.out = argv[++i];
    } else if (arg === '--label' && argv[i + 1]) {
      options.label = argv[++i];
    }
  }

  if (!options.label) {
    const baseLabel = basename(options.quad, '.quad');
    options.label = baseLabel || 'fixture';
  }

  return options;
}

async function captureBaseline({ quad, lab, out, label }) {
  const cwd = process.cwd();
  const quadPath = resolve(cwd, quad);
  const labPath = resolve(cwd, lab);
  const outputPath = resolve(cwd, out);

  const [quadContent, labContent] = await Promise.all([
    readFile(quadPath, 'utf8'),
    readFile(labPath, 'utf8')
  ]);

  const parsedQuad = parseQuadFile(quadContent);
  if (!parsedQuad || !parsedQuad.valid) {
    throw new Error(`Failed to parse base .quad: ${parsedQuad?.error || 'Unknown error'}`);
  }

  const labEntryRaw = parseLabData(labContent, basename(labPath));
  if (!labEntryRaw || !labEntryRaw.valid) {
    throw new Error(`Failed to parse LAB data: ${labEntryRaw?.error || 'Unknown error'}`);
  }

  const labEntry = normalizeLabEntry(labEntryRaw);
  const channels = Array.isArray(parsedQuad.channels) && parsedQuad.channels.length
    ? parsedQuad.channels
    : Object.keys(parsedQuad.curves || {});

  const results = {
    fixture: label,
    quadPath,
    labPath,
    generatedAt: new Date().toISOString(),
    channelCount: channels.length,
    channels: {}
  };

  for (const channelName of channels) {
    const baseCurve = (parsedQuad.curves && parsedQuad.curves[channelName]) ? parsedQuad.curves[channelName].slice() : null;
    if (!baseCurve) {
      continue;
    }

    const maxValue = parsedQuad.baselineEnd?.[channelName] ?? baseCurve.reduce((acc, value) => (value > acc ? value : acc), 0);

    const lutEntry = {
      ...labEntry,
      __debugChannelName: channelName
    };

    const fixed = apply1DLUTFixedDomain(baseCurve, lutEntry, labEntry.domainMin, labEntry.domainMax, maxValue, 'cubic', 0);
    const active = apply1DLUTActiveRange(baseCurve, lutEntry, labEntry.domainMin, labEntry.domainMax, maxValue, 'cubic', 0);

    const baseSummary = analyzeCurve(baseCurve);
    const fixedSummary = analyzeCurve(fixed);
    const activeSummary = analyzeCurve(active);
    const comparison = {
      activeVsFixed: compareCurves(fixed, active),
      onsetShift: activeSummary.firstNonZeroIndex - fixedSummary.firstNonZeroIndex,
      activeSpanShift: activeSummary.activeSpan - fixedSummary.activeSpan
    };

    results.channels[channelName] = {
      maxValue,
      base: {
        values: baseCurve,
        summary: baseSummary
      },
      fixedDomain: {
        values: fixed,
        summary: fixedSummary
      },
      activeRange: {
        values: active,
        summary: activeSummary
      },
      comparison
    };
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(results, null, 2), 'utf8');

  return {
    outputPath,
    fixture: label,
    channelsCaptured: Object.keys(results.channels).length
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const outcome = await captureBaseline(options);
    console.log(`Captured baseline for ${outcome.fixture} (${outcome.channelsCaptured} channels).`);
    console.log(`→ ${outcome.outputPath}`);
  } catch (error) {
    console.error('Failed to capture active-range baseline:', error);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${__filename}`) {
  main();
}
