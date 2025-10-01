const { chromium } = require('playwright');

(async () => {
  console.log('=== LAB SPACE CONVERSION VERIFICATION ===');
  console.log('Verifying LAB data follows correct image→printer space conversion\n');
  console.log('LAB Input: Image space (100 L* = pure white)');
  console.log('QuadGEN Output: Printer space (100% ink = full black)\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('LAB') || text.includes('space') || text.includes('conversion') || text.includes('invert')) {
      console.log('CONVERSION TRACE:', text);
    }
  });

  await page.goto('file://' + process.cwd() + '/quadgen.html');
  await page.waitForTimeout(2000);

  const spaceConversionTrace = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      window.DEBUG_LOGS = true;

      // Our test data: LAB values in image space
      const testData = `GRAY\tLAB_L\tLAB_A\tLAB_B
0\t97.15\t0.00\t0.00
10\t95.90\t0.00\t0.00
20\t90.06\t0.00\t0.00
30\t79.22\t0.00\t0.00
40\t64.43\t0.00\t0.00
50\t52.13\t0.00\t0.00
60\t41.83\t0.00\t0.00
70\t35.63\t0.00\t0.00
80\t29.94\t0.00\t0.00
90\t25.91\t0.00\t0.00
100\t21.33\t0.00\t0.00`;

      console.log('=== ORIGINAL LAB DATA ANALYSIS ===');

      // Parse the raw data to see what we're starting with
      const lines = testData.split('\n').slice(1); // Skip header
      const originalData = lines.map(line => {
        const parts = line.split('\t');
        return {
          grayPercent: parseFloat(parts[0]),
          labL: parseFloat(parts[1])
        };
      }).filter(d => !isNaN(d.grayPercent) && !isNaN(d.labL));

      console.log('Original LAB data (image space):');
      originalData.forEach(d => {
        console.log(`  GRAY ${d.grayPercent}% → LAB_L ${d.labL} (${d.labL}% brightness)`);
      });

      // Expected behavior: Higher GRAY % should have LOWER LAB_L values (more ink = darker)
      const isMonotonic = originalData.every((d, i) => {
        if (i === 0) return true;
        return d.labL <= originalData[i-1].labL; // LAB_L should decrease as GRAY% increases
      });

      console.log('LAB data is monotonic (darker as GRAY increases):', isMonotonic);

      console.log('=== PARSING AND NORMALIZATION TRACE ===');

      const parsed = await window.parseLinearizationFile(testData, 'Color-Muse-Data.txt');
      console.log('Parsed result structure:', {
        format: parsed?.format,
        sourceSpace: parsed?.sourceSpace,
        originalDataCount: parsed?.originalData?.length,
        samplesCount: parsed?.samples?.length
      });

      if (parsed?.originalData) {
        console.log('Parsed originalData sample:');
        parsed.originalData.slice(0, 5).forEach(d => {
          console.log(`  Input: ${d.input}, LAB: ${d.lab}`);
        });
      }

      if (parsed?.samples) {
        console.log('Parsed samples (normalized) sample:');
        console.log(`  First 5: [${parsed.samples.slice(0, 5).map(s => s.toFixed(4)).join(', ')}]`);
        console.log(`  Last 5:  [${parsed.samples.slice(-5).map(s => s.toFixed(4)).join(', ')}]`);
      }

      const normalized = window.normalizeLinearizationEntry(parsed);
      console.log('Normalized result structure:', {
        format: normalized?.format,
        sourceSpace: normalized?.sourceSpace,
        samplesCount: normalized?.samples?.length
      });

      if (normalized?.samples) {
        console.log('Normalized samples sample:');
        console.log(`  First 5: [${normalized.samples.slice(0, 5).map(s => s.toFixed(4)).join(', ')}]`);
        console.log(`  Last 5:  [${normalized.samples.slice(-5).map(s => s.toFixed(4)).join(', ')}]`);
      }

      // Check what the processed data looks like
      window.linearizationData = normalized;
      window.linearizationApplied = true;

      console.log('=== MANUAL SPACE CONVERSION TEST ===');

      // Test what happens if we manually call apply1DLUT with debug
      if (typeof window.apply1DLUT === 'function') {
        console.log('Testing manual apply1DLUT with linearization data...');

        // Create a test input array (printer space values 0-65535)
        const testInput = [0, 16448, 32896, 49344, 65535]; // 0%, 25%, 50%, 75%, 100%

        try {
          const manualResult = window.apply1DLUT(testInput, normalized, 0, 1, 65535, 'linear');
          console.log('Manual apply1DLUT result:', manualResult);

          // Check the mapping direction
          console.log('Input vs Output mapping:');
          testInput.forEach((input, i) => {
            const output = manualResult[i];
            const inputPercent = (input / 65535 * 100).toFixed(1);
            const outputPercent = (output / 65535 * 100).toFixed(1);
            const direction = output > input ? 'MORE ink' : output < input ? 'LESS ink' : 'SAME';
            console.log(`  ${inputPercent}% → ${outputPercent}% (${direction})`);
          });

        } catch (error) {
          console.log('Manual apply1DLUT error:', error.message);
        }
      }

      console.log('=== EXPECTED CONVERSION BEHAVIOR ===');
      console.log('LAB Image Space → Printer Space conversion should:');
      console.log('  - High LAB_L* (bright) → Low ink % (less ink)');
      console.log('  - Low LAB_L* (dark) → High ink % (more ink)');
      console.log('  - This is an INVERSION: bright image = less printer ink');

      // Analyze if our data follows this pattern
      const sampleMapping = [];
      if (normalized?.originalData) {
        normalized.originalData.forEach(d => {
          const inputPercent = d.input * 100; // Convert 0-1 to 0-100%
          const labL = d.lab;

          // In proper conversion:
          // High LAB_L should result in LESS ink correction (curve goes down)
          // Low LAB_L should result in MORE ink correction (curve goes up)

          sampleMapping.push({
            inputPercent: inputPercent.toFixed(1),
            labL: labL.toFixed(1),
            expected: labL > 50 ? 'should reduce ink' : 'should increase ink'
          });
        });
      }

      console.log('Expected behavior analysis:');
      sampleMapping.slice(0, 5).forEach(m => {
        console.log(`  Input ${m.inputPercent}% has LAB_L ${m.labL} → ${m.expected}`);
      });

      resolve({
        originalData,
        isMonotonic,
        parsedSamples: parsed?.samples?.slice(0, 10) || [],
        normalizedSamples: normalized?.samples?.slice(0, 10) || [],
        sampleMapping: sampleMapping.slice(0, 5),
        spaceInfo: {
          parsedSourceSpace: parsed?.sourceSpace,
          normalizedSourceSpace: normalized?.sourceSpace
        }
      });
    });
  });

  console.log('\n=== LAB SPACE CONVERSION VERIFICATION RESULTS ===\n');

  console.log('📊 ORIGINAL LAB DATA ANALYSIS:');
  console.log(`  Is monotonic (darker as GRAY increases): ${spaceConversionTrace.isMonotonic ? '✅' : '❌'}`);

  spaceConversionTrace.originalData.slice(0, 5).forEach(d => {
    console.log(`    GRAY ${d.grayPercent}% → LAB_L ${d.labL}`);
  });

  console.log('\n🔄 PROCESSING PIPELINE:');
  console.log('  Parsed samples (first 10):');
  console.log(`    [${spaceConversionTrace.parsedSamples.map(s => s.toFixed(3)).join(', ')}]`);
  console.log('  Normalized samples (first 10):');
  console.log(`    [${spaceConversionTrace.normalizedSamples.map(s => s.toFixed(3)).join(', ')}]`);

  console.log('\n🔄 SOURCE SPACE TRACKING:');
  console.log(`  Parsed source space: ${spaceConversionTrace.spaceInfo.parsedSourceSpace}`);
  console.log(`  Normalized source space: ${spaceConversionTrace.spaceInfo.normalizedSourceSpace}`);

  console.log('\n📈 EXPECTED BEHAVIOR ANALYSIS:');
  spaceConversionTrace.sampleMapping.forEach(m => {
    console.log(`    Input ${m.inputPercent}% (LAB_L ${m.labL}) → ${m.expected}`);
  });

  console.log('\n🚨 CRITICAL VALIDATION QUESTIONS:');

  if (spaceConversionTrace.isMonotonic) {
    console.log('  ✅ LAB data follows expected pattern (higher GRAY% = lower LAB_L)');
  } else {
    console.log('  ❌ LAB data does NOT follow expected pattern');
  }

  console.log('\n🔍 NEXT VERIFICATION STEPS:');
  console.log('  1. Check if processed samples show correct inversion');
  console.log('  2. Verify no double-inversion is happening in space conversion');
  console.log('  3. Confirm final curve respects LAB→printer space mapping');
  console.log('  4. Test that bright LAB areas result in less ink, dark LAB areas in more ink');

  await browser.close();
})();