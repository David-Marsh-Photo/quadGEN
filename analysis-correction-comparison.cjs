// Comparison analysis: quadGEN vs DNPRO linearization corrections
// Examining how each tool handles channels with delayed ink onset

const fs = require('fs');

// Parse .quad file
function parseQuad(filename) {
    const content = fs.readFileSync(filename, 'utf8');
    const allLines = content.split('\n');

    // Find header line
    const headerLine = allLines.find(l => l.startsWith('## QuadToneRIP'));
    if (!headerLine) throw new Error('No header found in ' + filename);

    const channels = headerLine.replace('## QuadToneRIP ', '').trim().split(',');

    // Extract only numeric lines (curve data)
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

// Analyze curve characteristics
function analyzeCurve(curve, channelName) {
    if (!curve || !Array.isArray(curve)) {
        console.error(`ERROR: Invalid curve for ${channelName}:`, curve);
        return null;
    }
    const firstNonZero = curve.findIndex(v => v > 0);
    const lastNonZero = curve.map((v,i) => v > 0 ? i : -1).reduce((a,b) => Math.max(a,b), -1);
    const max = Math.max(...curve);

    // Find the steepest region
    const diffs = [];
    for (let i = 1; i < curve.length; i++) {
        diffs.push(curve[i] - curve[i-1]);
    }
    const maxDiff = Math.max(...diffs);
    const maxDiffIdx = diffs.indexOf(maxDiff);

    return {
        channelName,
        firstNonZero,
        lastNonZero,
        activeRange: lastNonZero - firstNonZero + 1,
        max,
        maxDiff,
        maxDiffIdx: maxDiffIdx + 1,
        // Sample key points
        at0: curve[0],
        at25: curve[63],
        at50: curve[127],
        at75: curve[191],
        at100: curve[255]
    };
}

console.log('=== Linearization Correction Comparison ===\n');

// Load all files
const original = parseQuad('data/P800_K37_C26_LK25_V1.quad');
const quadgen = parseQuad('data/QUADGEN.quad');
const dnpro = parseQuad('data/DNPRO.quad');

console.log('Available channels in original:', Object.keys(original.curves));
console.log('Original .quad ink limits:');
['K', 'C', 'LK'].forEach(ch => {
    if (original.curves[ch]) {
        const orig = analyzeCurve(original.curves[ch], ch);
        if (orig) {
            console.log(`  ${ch}: max=${orig.max}, onset=index ${orig.firstNonZero} (${(orig.firstNonZero/255*100).toFixed(1)}% input)`);
        }
    } else {
        console.log(`  ${ch}: NOT FOUND in original.curves`);
    }
});

console.log('\n=== K CHANNEL (delayed onset at 66% input) ===');
const kOrig = analyzeCurve(original.curves.K, 'K-original');
const kQuadgen = analyzeCurve(quadgen.curves.K, 'K-quadgen');
const kDnpro = analyzeCurve(dnpro.curves.K, 'K-dnpro');

console.log('Original K curve:');
console.log(`  First ink: index ${kOrig.firstNonZero} (${(kOrig.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${kOrig.max}`);
console.log(`  Key samples: [0]=${kOrig.at0}, [127]=${kOrig.at50}, [169]=${original.curves.K[169]}, [255]=${kOrig.at100}`);

console.log('\nQuadGEN corrected K:');
console.log(`  First ink: index ${kQuadgen.firstNonZero} (${(kQuadgen.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${kQuadgen.max}`);
console.log(`  Key samples: [0]=${kQuadgen.at0}, [127]=${kQuadgen.at50}, [174]=${quadgen.curves.K[174]}, [255]=${kQuadgen.at100}`);
console.log(`  Onset shift: ${kQuadgen.firstNonZero - kOrig.firstNonZero} indices`);

console.log('\nDNPRO corrected K:');
console.log(`  First ink: index ${kDnpro.firstNonZero} (${(kDnpro.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${kDnpro.max}`);
console.log(`  Key samples: [0]=${kDnpro.at0}, [127]=${kDnpro.at50}, [245]=${dnpro.curves.K[245]}, [255]=${kDnpro.at100}`);
console.log(`  Onset shift: ${kDnpro.firstNonZero - kOrig.firstNonZero} indices`);

console.log('\n=== C CHANNEL (delayed onset at 24% input) ===');
const cOrig = analyzeCurve(original.curves.C, 'C-original');
const cQuadgen = analyzeCurve(quadgen.curves.C, 'C-quadgen');
const cDnpro = analyzeCurve(dnpro.curves.C, 'C-dnpro');

console.log('Original C curve:');
console.log(`  First ink: index ${cOrig.firstNonZero} (${(cOrig.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${cOrig.max}`);

console.log('\nQuadGEN corrected C:');
console.log(`  First ink: index ${cQuadgen.firstNonZero} (${(cQuadgen.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${cQuadgen.max}`);
console.log(`  Onset shift: ${cQuadgen.firstNonZero - cOrig.firstNonZero} indices`);

console.log('\nDNPRO corrected C:');
console.log(`  First ink: index ${cDnpro.firstNonZero} (${(cDnpro.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${cDnpro.max}`);
console.log(`  Onset shift: ${cDnpro.firstNonZero - cOrig.firstNonZero} indices`);

console.log('\n=== LK CHANNEL (immediate onset at 0.4% input) ===');
const lkOrig = analyzeCurve(original.curves.LK, 'LK-original');
const lkQuadgen = analyzeCurve(quadgen.curves.LK, 'LK-quadgen');
const lkDnpro = analyzeCurve(dnpro.curves.LK, 'LK-dnpro');

console.log('Original LK curve:');
console.log(`  First ink: index ${lkOrig.firstNonZero} (${(lkOrig.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${lkOrig.max}`);

console.log('\nQuadGEN corrected LK:');
console.log(`  First ink: index ${lkQuadgen.firstNonZero} (${(lkQuadgen.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${lkQuadgen.max}`);
console.log(`  Onset shift: ${lkQuadgen.firstNonZero - lkOrig.firstNonZero} indices`);

console.log('\nDNPRO corrected LK:');
console.log(`  First ink: index ${lkDnpro.firstNonZero} (${(lkDnpro.firstNonZero/255*100).toFixed(1)}% input)`);
console.log(`  Max value: ${lkDnpro.max}`);
console.log(`  Onset shift: ${lkDnpro.firstNonZero - lkOrig.firstNonZero} indices`);

// Critical comparison at specific input positions
console.log('\n=== CRITICAL COMPARISON: Same Input → Different Correction? ===');
console.log('\nAt 50% input (index 127):');
console.log(`  K original: ${original.curves.K[127]}, quadGEN: ${quadgen.curves.K[127]}, DNPRO: ${dnpro.curves.K[127]}`);
console.log(`  C original: ${original.curves.C[127]}, quadGEN: ${quadgen.curves.C[127]}, DNPRO: ${dnpro.curves.C[127]}`);
console.log(`  LK original: ${original.curves.LK[127]}, quadGEN: ${quadgen.curves.LK[127]}, DNPRO: ${dnpro.curves.LK[127]}`);

console.log('\nAt 75% input (index 191):');
console.log(`  K original: ${original.curves.K[191]}, quadGEN: ${quadgen.curves.K[191]}, DNPRO: ${dnpro.curves.K[191]}`);
console.log(`  C original: ${original.curves.C[191]}, quadGEN: ${quadgen.curves.C[191]}, DNPRO: ${dnpro.curves.C[191]}`);
console.log(`  LK original: ${original.curves.LK[191]}, quadGEN: ${quadgen.curves.LK[191]}, DNPRO: ${dnpro.curves.LK[191]}`);

// Show where K channel actually starts flowing
console.log('\n=== K Channel Onset Detail ===');
const kOnsetRegion = [];
for (let i = 165; i <= 180; i++) {
    kOnsetRegion.push(`[${i}]: orig=${original.curves.K[i]}, QG=${quadgen.curves.K[i]}, DN=${dnpro.curves.K[i]}`);
}
console.log(kOnsetRegion.join('\n'));
