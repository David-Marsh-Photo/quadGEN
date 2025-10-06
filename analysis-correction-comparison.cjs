// Comparison analysis: quadGEN vs DNPRO linearization corrections
// Extended to diff active-range baseline output against DNPRO references

const fs = require('fs');
const path = require('path');

function parseQuad(filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const allLines = content.split('\n');
  const headerLine = allLines.find((line) => line.startsWith('## QuadToneRIP '));
  if (!headerLine) {
    throw new Error(`No QuadToneRIP header found in ${filename}`);
  }

  const channels = headerLine.replace('## QuadToneRIP ', '').trim().split(',');
  const dataLines = allLines.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#') && /^\d+$/.test(trimmed);
  });

  const curves = {};
  let lineIdx = 0;

  channels.forEach((channel) => {
    const points = [];
    for (let i = 0; i < 256; i++) {
      if (lineIdx < dataLines.length) {
        points.push(parseInt(dataLines[lineIdx++], 10) || 0);
      } else {
        points.push(0);
      }
    }
    curves[channel] = points;
  });

  return {
    filename,
    channels,
    curves
  };
}

function analyzeCurve(curve, channelName) {
  if (!curve || !Array.isArray(curve)) {
    return null;
  }

  const firstNonZero = curve.findIndex((value) => value > 0);
  let lastNonZero = -1;
  for (let i = curve.length - 1; i >= 0; i--) {
    if (curve[i] > 0) {
      lastNonZero = i;
      break;
    }
  }

  const diffs = [];
  for (let i = 1; i < curve.length; i++) {
    diffs.push(curve[i] - curve[i - 1]);
  }
  const maxDiff = diffs.length ? Math.max(...diffs) : 0;
  const maxDiffIdx = diffs.indexOf(maxDiff) + 1;
  const maxValue = Math.max(...curve);

  return {
    channelName,
    firstNonZero,
    lastNonZero,
    activeRange: lastNonZero >= firstNonZero && firstNonZero >= 0 ? (lastNonZero - firstNonZero + 1) : 0,
    max: maxValue,
    maxDiff,
    maxDiffIdx,
    at0: curve[0],
    at25: curve[63],
    at50: curve[127],
    at75: curve[191],
    at100: curve[255]
  };
}

function compareCurves(reference, variant) {
  const length = Math.min(reference.length, variant.length);
  let maxAbsDelta = 0;
  let maxAbsIndex = -1;
  let sumAbs = 0;
  let sumSquares = 0;
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
      maxAbsIndex = i;
    }
    sumAbs += absDelta;
    sumSquares += delta * delta;
  }

  return {
    length,
    maxAbsDelta,
    maxAbsIndex,
    maxAbsPercent: maxAbsIndex >= 0 ? (maxAbsIndex / 255) * 100 : null,
    meanAbsDelta: length > 0 ? sumAbs / length : 0,
    rmsDelta: length > 0 ? Math.sqrt(sumSquares / length) : 0,
    firstDiffIndex,
    lastDiffIndex,
    firstDiffPercent: firstDiffIndex >= 0 ? (firstDiffIndex / 255) * 100 : null,
    lastDiffPercent: lastDiffIndex >= 0 ? (lastDiffIndex / 255) * 100 : null
  };
}

function formatPercent(index) {
  if (index === null || index === undefined || index < 0) {
    return 'n/a';
  }
  return `${(index / 255 * 100).toFixed(1)}%`;
}

function parseArgs(argv) {
  const options = {
    diffOnly: false,
    baseline: 'docs/investigation/baselines/P800_K37_C26_LK25_V1_baseline.json',
    original: 'data/P800_K37_C26_LK25_V1.quad',
    quadgen: 'data/QUADGEN.quad',
    dnpro: 'data/DNPRO.quad',
    outputJson: null,
    maxAbsThreshold: 1500,
    meanAbsThreshold: 150
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--diff-only') {
      options.diffOnly = true;
    } else if (arg === '--baseline' && argv[i + 1]) {
      options.baseline = argv[++i];
    } else if (arg === '--original' && argv[i + 1]) {
      options.original = argv[++i];
    } else if (arg === '--quadgen' && argv[i + 1]) {
      options.quadgen = argv[++i];
    } else if (arg === '--dnpro' && argv[i + 1]) {
      options.dnpro = argv[++i];
    } else if (arg === '--output-json' && argv[i + 1]) {
      options.outputJson = argv[++i];
    } else if (arg === '--max-abs-threshold' && argv[i + 1]) {
      options.maxAbsThreshold = parseFloat(argv[++i]);
    } else if (arg === '--mean-abs-threshold' && argv[i + 1]) {
      options.meanAbsThreshold = parseFloat(argv[++i]);
    }
  }

  return options;
}

function resolveInput(inputPath) {
  if (!inputPath) {
    return null;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

function loadBaseline(baselinePath) {
  const raw = fs.readFileSync(baselinePath, 'utf8');
  return JSON.parse(raw);
}

function generateDiffReport(baseline, dnpro, thresholds) {
  const channels = baseline?.channels ? Object.keys(baseline.channels) : [];
  const report = {
    generatedAt: new Date().toISOString(),
    fixture: baseline?.fixture || null,
    thresholds: {
      maxAbs: thresholds.maxAbsThreshold,
      meanAbs: thresholds.meanAbsThreshold
    },
    channels: {},
    exceeded: []
  };

  channels.forEach((channel) => {
    const baselineChannel = baseline.channels[channel];
    const activeValues = baselineChannel?.activeRange?.values || [];
    const fixedValues = baselineChannel?.fixedDomain?.values || [];
    const dnproValues = dnpro.curves[channel];

    if (!dnproValues || !activeValues.length) {
      report.channels[channel] = {
        status: 'missing',
        hasBaseline: !!activeValues.length,
        hasDnpro: !!dnproValues
      };
      return;
    }

    const activeSummary = analyzeCurve(activeValues, channel);
    const dnproSummary = analyzeCurve(dnproValues, channel);
    const diff = compareCurves(dnproValues, activeValues);
    const fixedDiff = fixedValues.length ? compareCurves(dnproValues, fixedValues) : null;

    const thresholdsExceeded = {
      maxAbs: thresholds.maxAbsThreshold >= 0 && diff.maxAbsDelta > thresholds.maxAbsThreshold,
      meanAbs: thresholds.meanAbsThreshold >= 0 && diff.meanAbsDelta > thresholds.meanAbsThreshold
    };

    if (thresholdsExceeded.maxAbs || thresholdsExceeded.meanAbs) {
      report.exceeded.push({ channel, thresholdsExceeded, diff });
    }

    report.channels[channel] = {
      status: 'ok',
      activeSummary,
      dnproSummary,
      diff,
      fixedDomainDiff: fixedDiff,
      thresholdsExceeded
    };
  });

  report.overall = Object.values(report.channels).reduce((acc, entry) => {
    if (!entry || entry.status !== 'ok') {
      return acc;
    }
    acc.maxAbsDelta = Math.max(acc.maxAbsDelta, entry.diff.maxAbsDelta);
    acc.meanAbsDelta = Math.max(acc.meanAbsDelta, entry.diff.meanAbsDelta);
    return acc;
  }, { maxAbsDelta: 0, meanAbsDelta: 0 });

  return report;
}

function printDiffReport(report) {
  console.log('\n=== Active-Range vs DNPRO Diff Summary ===');
  if (!report || !report.channels) {
    console.log('No diff data available.');
    return;
  }

  if (report.fixture) {
    console.log(`Fixture: ${report.fixture}`);
  }
  console.log(`Thresholds → maxAbs ≤ ${report.thresholds.maxAbs}, meanAbs ≤ ${report.thresholds.meanAbs}`);

  Object.entries(report.channels).forEach(([channel, data]) => {
    if (!data || data.status !== 'ok') {
      console.log(`  ${channel}: missing data (baseline=${data?.hasBaseline}, dnpro=${data?.hasDnpro})`);
      return;
    }

    const onsetShift = data.activeSummary && data.dnproSummary
      ? data.activeSummary.firstNonZero - data.dnproSummary.firstNonZero
      : null;

    console.log(`  ${channel}: maxΔ=${data.diff.maxAbsDelta} (at ${formatPercent(data.diff.maxAbsIndex)}), meanΔ=${data.diff.meanAbsDelta.toFixed(2)}, onset shift=${onsetShift}`);

    if (data.thresholdsExceeded.maxAbs || data.thresholdsExceeded.meanAbs) {
      console.log(`    ⚠ Channel ${channel} exceeds thresholds (maxAbs=${data.thresholdsExceeded.maxAbs}, meanAbs=${data.thresholdsExceeded.meanAbs})`);
    }
  });

  if (report.exceeded.length === 0) {
    console.log('✅ All channels within tolerance.');
  } else {
    console.log(`⚠ ${report.exceeded.length} channel(s) exceeded tolerance.`);
  }
}

function runLegacyComparison(original, quadgen, dnpro) {
  console.log('=== Linearization Correction Comparison ===\n');

  console.log('Available channels in original:', Object.keys(original.curves));
  console.log('Original .quad ink limits:');
  ['K', 'C', 'LK'].forEach((channel) => {
    if (original.curves[channel]) {
      const analysis = analyzeCurve(original.curves[channel], channel);
      if (analysis) {
        console.log(`  ${channel}: max=${analysis.max}, onset=index ${analysis.firstNonZero} (${formatPercent(analysis.firstNonZero)})`);
      }
    } else {
      console.log(`  ${channel}: NOT FOUND in original.curves`);
    }
  });

  console.log('\n=== K CHANNEL (delayed onset at 66% input) ===');
  const kOrig = analyzeCurve(original.curves.K, 'K-original');
  const kQuadgen = analyzeCurve(quadgen.curves.K, 'K-quadgen');
  const kDnpro = analyzeCurve(dnpro.curves.K, 'K-dnpro');

  console.log('Original K curve:');
  console.log(`  First ink: index ${kOrig.firstNonZero} (${formatPercent(kOrig.firstNonZero)})`);
  console.log(`  Max value: ${kOrig.max}`);
  console.log(`  Key samples: [0]=${kOrig.at0}, [127]=${kOrig.at50}, [169]=${original.curves.K[169]}, [255]=${kOrig.at100}`);

  console.log('\nQuadGEN corrected K:');
  console.log(`  First ink: index ${kQuadgen.firstNonZero} (${formatPercent(kQuadgen.firstNonZero)})`);
  console.log(`  Max value: ${kQuadgen.max}`);
  console.log(`  Key samples: [0]=${kQuadgen.at0}, [127]=${kQuadgen.at50}, [174]=${quadgen.curves.K[174]}, [255]=${kQuadgen.at100}`);
  console.log(`  Onset shift: ${kQuadgen.firstNonZero - kOrig.firstNonZero} indices`);

  console.log('\nDNPRO corrected K:');
  console.log(`  First ink: index ${kDnpro.firstNonZero} (${formatPercent(kDnpro.firstNonZero)})`);
  console.log(`  Max value: ${kDnpro.max}`);
  console.log(`  Key samples: [0]=${kDnpro.at0}, [127]=${kDnpro.at50}, [245]=${dnpro.curves.K[245]}, [255]=${kDnpro.at100}`);
  console.log(`  Onset shift: ${kDnpro.firstNonZero - kOrig.firstNonZero} indices`);

  console.log('\n=== C CHANNEL (delayed onset at 24% input) ===');
  const cOrig = analyzeCurve(original.curves.C, 'C-original');
  const cQuadgen = analyzeCurve(quadgen.curves.C, 'C-quadgen');
  const cDnpro = analyzeCurve(dnpro.curves.C, 'C-dnpro');

  console.log('Original C curve:');
  console.log(`  First ink: index ${cOrig.firstNonZero} (${formatPercent(cOrig.firstNonZero)})`);
  console.log(`  Max value: ${cOrig.max}`);

  console.log('\nQuadGEN corrected C:');
  console.log(`  First ink: index ${cQuadgen.firstNonZero} (${formatPercent(cQuadgen.firstNonZero)})`);
  console.log(`  Max value: ${cQuadgen.max}`);
  console.log(`  Onset shift: ${cQuadgen.firstNonZero - cOrig.firstNonZero} indices`);

  console.log('\nDNPRO corrected C:');
  console.log(`  First ink: index ${cDnpro.firstNonZero} (${formatPercent(cDnpro.firstNonZero)})`);
  console.log(`  Max value: ${cDnpro.max}`);
  console.log(`  Onset shift: ${cDnpro.firstNonZero - cOrig.firstNonZero} indices`);

  console.log('\n=== LK CHANNEL (immediate onset at 0.4% input) ===');
  const lkOrig = analyzeCurve(original.curves.LK, 'LK-original');
  const lkQuadgen = analyzeCurve(quadgen.curves.LK, 'LK-quadgen');
  const lkDnpro = analyzeCurve(dnpro.curves.LK, 'LK-dnpro');

  console.log('Original LK curve:');
  console.log(`  First ink: index ${lkOrig.firstNonZero} (${formatPercent(lkOrig.firstNonZero)})`);
  console.log(`  Max value: ${lkOrig.max}`);

  console.log('\nQuadGEN corrected LK:');
  console.log(`  First ink: index ${lkQuadgen.firstNonZero} (${formatPercent(lkQuadgen.firstNonZero)})`);
  console.log(`  Max value: ${lkQuadgen.max}`);
  console.log(`  Onset shift: ${lkQuadgen.firstNonZero - lkOrig.firstNonZero} indices`);

  console.log('\nDNPRO corrected LK:');
  console.log(`  First ink: index ${lkDnpro.firstNonZero} (${formatPercent(lkDnpro.firstNonZero)})`);
  console.log(`  Max value: ${lkDnpro.max}`);
  console.log(`  Onset shift: ${lkDnpro.firstNonZero - lkOrig.firstNonZero} indices`);

  console.log('\n=== CRITICAL COMPARISON: Same Input → Different Correction? ===');
  console.log('\nAt 50% input (index 127):');
  console.log(`  K original: ${original.curves.K[127]}, quadGEN: ${quadgen.curves.K[127]}, DNPRO: ${dnpro.curves.K[127]}`);
  console.log(`  C original: ${original.curves.C[127]}, quadGEN: ${quadgen.curves.C[127]}, DNPRO: ${dnpro.curves.C[127]}`);
  console.log(`  LK original: ${original.curves.LK[127]}, quadGEN: ${quadgen.curves.LK[127]}, DNPRO: ${dnpro.curves.LK[127]}`);

  console.log('\nAt 75% input (index 191):');
  console.log(`  K original: ${original.curves.K[191]}, quadGEN: ${quadgen.curves.K[191]}, DNPRO: ${dnpro.curves.K[191]}`);
  console.log(`  C original: ${original.curves.C[191]}, quadGEN: ${quadgen.curves.C[191]}, DNPRO: ${dnpro.curves.C[191]}`);
  console.log(`  LK original: ${original.curves.LK[191]}, quadGEN: ${quadgen.curves.LK[191]}, DNPRO: ${dnpro.curves.LK[191]}`);

  console.log('\n=== K Channel Onset Detail ===');
  const kOnsetRegion = [];
  for (let i = 165; i <= 180; i++) {
    kOnsetRegion.push(`[${i}]: orig=${original.curves.K[i]}, QG=${quadgen.curves.K[i]}, DN=${dnpro.curves.K[i]}`);
  }
  console.log(kOnsetRegion.join('\n'));
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    const resolvedPaths = {
      original: resolveInput(options.original),
      quadgen: resolveInput(options.quadgen),
      dnpro: resolveInput(options.dnpro),
      baseline: options.baseline ? resolveInput(options.baseline) : null,
      outputJson: options.outputJson ? resolveInput(options.outputJson) : null
    };

    if (!options.diffOnly) {
      const original = parseQuad(resolvedPaths.original);
      const quadgen = parseQuad(resolvedPaths.quadgen);
      const dnpro = parseQuad(resolvedPaths.dnpro);
      runLegacyComparison(original, quadgen, dnpro);
    }

    if (resolvedPaths.baseline) {
      try {
        const baseline = loadBaseline(resolvedPaths.baseline);
        const dnproForDiff = parseQuad(resolvedPaths.dnpro);
        const diffReport = generateDiffReport(baseline, dnproForDiff, options);
        printDiffReport(diffReport);

        if (resolvedPaths.outputJson) {
          fs.mkdirSync(path.dirname(resolvedPaths.outputJson), { recursive: true });
          fs.writeFileSync(resolvedPaths.outputJson, JSON.stringify(diffReport, null, 2), 'utf8');
          console.log(`Wrote diff summary to ${resolvedPaths.outputJson}`);
        }
      } catch (error) {
        console.error('Failed to compute active-range diff:', error.message || error);
      }
    }
  } catch (error) {
    console.error('analysis-correction-comparison failed:', error.message || error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
