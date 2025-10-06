// Deep analysis of DNPRO's domain mapping strategy
// Attempting to reverse-engineer how it applies linearization to delayed-onset channels

const fs = require('fs');

// Parse .quad file (same as before)
function parseQuad(filename) {
    const content = fs.readFileSync(filename, 'utf8');
    const allLines = content.split('\n');
    const headerLine = allLines.find(l => l.startsWith('## QuadToneRIP'));
    if (!headerLine) throw new Error('No header found in ' + filename);
    const channels = headerLine.replace('## QuadToneRIP ', '').trim().split(',');
    const dataLines = allLines.filter(l => {
        const trimmed = l.trim();
        return trimmed && !trimmed.startsWith('#') && /^\d+$/.test(trimmed);
    });
    const curves = {};
    let lineIdx = 0;
    channels.forEach(ch => {
        curves[ch] = [];
        for (let i = 0; i < 256; i++) {
            if (lineIdx < dataLines.length) {
                curves[ch].push(parseInt(dataLines[lineIdx++]) || 0);
            } else {
                curves[ch].push(0);
            }
        }
    });
    return { channels, curves };
}

// Parse LAB correction data
function parseLabData(filename) {
    const content = fs.readFileSync(filename, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('GRAY'));
    return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
            gray: parseFloat(parts[0]),
            labL: parseFloat(parts[1]),
            labA: parseFloat(parts[2]),
            labB: parseFloat(parts[3])
        };
    });
}

// Analyze where each channel becomes active
function findActiveRange(curve) {
    const firstNonZero = curve.findIndex(v => v > 0);
    const lastNonZero = curve.reduce((acc, v, i) => v > 0 ? i : acc, -1);
    const max = Math.max(...curve);

    // Find where curve reaches certain thresholds
    const thresholds = [0.01, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.99];
    const thresholdIndices = thresholds.map(pct => {
        const target = max * pct;
        return curve.findIndex(v => v >= target);
    });

    return {
        firstNonZero,
        lastNonZero,
        max,
        thresholds: thresholds.map((pct, i) => ({
            percent: pct,
            index: thresholdIndices[i],
            value: curve[thresholdIndices[i]] || 0
        }))
    };
}

// Attempt to infer domain mapping from original → corrected transformation
function inferDomainMapping(original, corrected, channelName) {
    console.log(`\n=== ${channelName} Domain Mapping Analysis ===`);

    const origRange = findActiveRange(original);
    const corrRange = findActiveRange(corrected);

    console.log('\nOriginal curve active range:');
    console.log(`  First ink: index ${origRange.firstNonZero} (${(origRange.firstNonZero/255*100).toFixed(1)}%)`);
    console.log(`  Last ink: index ${origRange.lastNonZero} (${(origRange.lastNonZero/255*100).toFixed(1)}%)`);
    console.log(`  Max value: ${origRange.max}`);

    console.log('\nCorrected curve active range:');
    console.log(`  First ink: index ${corrRange.firstNonZero} (${(corrRange.firstNonZero/255*100).toFixed(1)}%)`);
    console.log(`  Last ink: index ${corrRange.lastNonZero} (${(corrRange.lastNonZero/255*100).toFixed(1)}%)`);
    console.log(`  Max value: ${corrRange.max}`);
    console.log(`  Onset shift: ${corrRange.firstNonZero - origRange.firstNonZero} indices`);

    // Analyze threshold positions
    console.log('\nThreshold position mapping (% of max value):');
    console.log('Pct    Orig→Corr Index    Shift');
    origRange.thresholds.forEach((orig, i) => {
        const corr = corrRange.thresholds[i];
        const shift = corr.index - orig.index;
        if (orig.index >= 0 && corr.index >= 0) {
            console.log(`${(orig.percent*100).toFixed(0).padStart(3)}%   ${orig.index}→${corr.index}  ${shift > 0 ? '+' : ''}${shift}`);
        }
    });

    // Try to find the transformation pattern
    console.log('\nAttempting to find transformation pattern:');

    // Hypothesis 1: Does DNPRO compress the active range?
    const origActiveSpan = origRange.lastNonZero - origRange.firstNonZero;
    const corrActiveSpan = corrRange.lastNonZero - corrRange.firstNonZero;
    const compressionRatio = origActiveSpan > 0 ? corrActiveSpan / origActiveSpan : 1;

    console.log(`  Original active span: ${origActiveSpan} indices (${(origActiveSpan/255*100).toFixed(1)}% of domain)`);
    console.log(`  Corrected active span: ${corrActiveSpan} indices (${(corrActiveSpan/255*100).toFixed(1)}% of domain)`);
    console.log(`  Compression ratio: ${compressionRatio.toFixed(3)}`);

    // Hypothesis 2: Sample some specific points and see the value transformation
    console.log('\nValue transformation at key positions:');
    const sampleIndices = [0, 63, 127, 191, 255];
    sampleIndices.forEach(idx => {
        const origVal = original[idx];
        const corrVal = corrected[idx];
        const ratio = origVal > 0 ? corrVal / origVal : 0;
        console.log(`  [${idx}] (${(idx/255*100).toFixed(0)}% input): ${origVal} → ${corrVal} (${ratio.toFixed(2)}x)`);
    });

    return {
        origRange,
        corrRange,
        compressionRatio
    };
}

// Load data
console.log('=== DNPRO Domain Mapping Reverse Engineering ===\n');

const original = parseQuad('data/P800_K37_C26_LK25_V1.quad');
const dnpro = parseQuad('data/DNPRO.quad');
const labData = parseLabData('data/P800_K37_C26_LK25_V1_correction.txt');

console.log('LAB Correction Data:');
console.log(`  ${labData.length} measurement points`);
console.log(`  L* range: ${labData[0].labL.toFixed(2)} (white) → ${labData[labData.length-1].labL.toFixed(2)} (black)`);
console.log(`  Gray range: ${labData[0].gray}% → ${labData[labData.length-1].gray}%`);

// Analyze each active channel
const activeChannels = ['K', 'C', 'LK'];

activeChannels.forEach(ch => {
    inferDomainMapping(original.curves[ch], dnpro.curves[ch], ch);
});

// Specific deep dive on K channel transformation
console.log('\n\n=== K CHANNEL DEEP DIVE ===');
console.log('\nDetailed sample points (every 16 indices around onset):');
console.log('Index  Input%  Original  DNPRO    Delta    Notes');

for (let i = 144; i <= 255; i += 8) {
    const inputPct = (i / 255 * 100).toFixed(1);
    const orig = original.curves.K[i];
    const dnp = dnpro.curves.K[i];
    const delta = dnp - orig;
    let note = '';
    if (orig === 0 && dnp === 0) note = '(both zero)';
    else if (orig === 0 && dnp > 0) note = '(DNPRO onset)';
    else if (orig > 0 && dnp === 0) note = '(DNPRO delayed)';
    else if (delta > 0) note = '(boosted)';
    else if (delta < 0) note = '(reduced)';

    console.log(`${i.toString().padStart(3)}    ${inputPct.padStart(5)}  ${orig.toString().padStart(8)}  ${dnp.toString().padStart(7)}  ${(delta >= 0 ? '+' : '')}${delta.toString().padStart(6)}  ${note}`);
}

// Try to infer the mapping function
console.log('\n\n=== MAPPING HYPOTHESIS ===');
console.log('\nTrying to determine: If original curve value X maps to corrected value Y,');
console.log('what is the relationship between X and Y?\n');

// Find matching values between original and DNPRO
const kOrig = original.curves.K;
const kDnpro = dnpro.curves.K;

// For each non-zero value in DNPRO, find where that output level appears
console.log('DNPRO output value → Original position → DNPRO position:');
const matches = [];
for (let dnpIdx = 0; dnpIdx < 256; dnpIdx++) {
    const dnpVal = kDnpro[dnpIdx];
    if (dnpVal > 100) { // Ignore very small values
        // Find where this value appears in original
        const origIdx = kOrig.findIndex(v => Math.abs(v - dnpVal) < 50);
        if (origIdx >= 0) {
            matches.push({
                dnpVal,
                origIdx,
                dnpIdx,
                shift: dnpIdx - origIdx
            });
        }
    }
}

if (matches.length > 0) {
    matches.slice(0, 15).forEach(m => {
        console.log(`  Value ${m.dnpVal}: original[${m.origIdx}] → dnpro[${m.dnpIdx}] (shift: ${m.shift > 0 ? '+' : ''}${m.shift})`);
    });
}
