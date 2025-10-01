const { chromium } = require('playwright');

(async () => {
  console.log('=== DEBUGGING LAB CURVE VISIBILITY ===');
  console.log('Investigating why LAB corrections dont show in plot\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Monitor all console output
  page.on('console', msg => {
    const text = msg.text();
    console.log('BROWSER:', text);
  });

  await page.goto('file://' + process.cwd() + '/index.html');
  await page.waitForTimeout(2000);

  const debugResult = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      window.DEBUG_LOGS = true;

      console.log('=== DEBUGGING LAB CURVE GENERATION ===');

      // Load Color Muse LAB data
      const labContent = `GRAY	LAB_L	LAB_A	LAB_B
0	97.15	0.00	0.00
10	95.90	0.00	0.00
20	90.06	0.00	0.00
30	79.22	0.00	0.00
40	64.43	0.00	0.00
50	52.13	0.00	0.00
60	41.83	0.00	0.00
70	35.63	0.00	0.00
80	29.94	0.00	0.00
90	25.91	0.00	0.00
100	21.33	0.00	0.00`;

      try {
        // Parse and load LAB data
        console.log('1. Parsing LAB data...');
        const parsed = await window.parseLinearizationFile(labContent, 'Color-Muse-Data.txt');
        console.log('Parsed:', {
          valid: parsed?.valid,
          format: parsed?.format,
          samplesLength: parsed?.samples?.length,
          firstSamples: parsed?.samples?.slice(0, 5)
        });

        const normalized = window.normalizeLinearizationEntry(parsed);
        console.log('Normalized:', {
          valid: normalized?.valid,
          format: normalized?.format,
          samplesLength: normalized?.samples?.length,
          firstSamples: normalized?.samples?.slice(0, 5)
        });

        // Set in LinearizationState
        console.log('2. Setting in LinearizationState...');
        window.LinearizationState.setGlobalData(normalized, true);

        console.log('LinearizationState after:', {
          globalApplied: window.LinearizationState.globalApplied,
          hasGlobalData: !!window.LinearizationState.globalData
        });

        // Test make256 directly to see what it produces
        console.log('3. Testing make256 directly...');
        console.log('About to call make256 with applyLinearization=true');

        const curveWithLAB = window.make256(65535, 'K', true);  // WITH linearization
        const curveWithoutLAB = window.make256(65535, 'K', false); // WITHOUT linearization

        console.log('make256 results:');
        console.log('  With LAB (first 10):', curveWithLAB?.slice(0, 10));
        console.log('  Without LAB (first 10):', curveWithoutLAB?.slice(0, 10));
        console.log('  With LAB (last 10):', curveWithLAB?.slice(-10));
        console.log('  Without LAB (last 10):', curveWithoutLAB?.slice(-10));

        // Check if curves are identical
        const identical = curveWithLAB && curveWithoutLAB &&
          curveWithLAB.every((val, i) => Math.abs(val - curveWithoutLAB[i]) < 1);
        console.log('  Curves are identical:', identical);

        // Check specific values for differences
        const differences = [];
        if (curveWithLAB && curveWithoutLAB) {
          for (let i = 0; i < curveWithLAB.length; i += 32) { // Sample every 32 points
            const diff = curveWithLAB[i] - curveWithoutLAB[i];
            if (Math.abs(diff) > 0.5) {
              differences.push({
                index: i,
                withLAB: curveWithLAB[i],
                withoutLAB: curveWithoutLAB[i],
                difference: diff
              });
            }
          }
        }
        console.log('  Significant differences:', differences);

        // Test if chart rendering detects LAB data
        console.log('4. Checking chart rendering state...');

        // Manually call updateInkChart to see what happens
        console.log('About to call updateInkChart()...');
        window.updateInkChart();

        console.log('5. Checking processed samples...');
        if (normalized?.samples) {
          // Check if samples show overcorrection pattern
          const samples = normalized.samples;
          const isLinear = samples.every((val, i) => Math.abs(val - (i / 255)) < 0.01);
          console.log('  LAB samples are linear:', isLinear);
          console.log('  Sample at 25%:', samples[64]?.toFixed(4), 'vs expected 0.2510');
          console.log('  Sample at 50%:', samples[128]?.toFixed(4), 'vs expected 0.5020');
          console.log('  Sample at 75%:', samples[192]?.toFixed(4), 'vs expected 0.7529');

          // Look for deviations from linear
          const deviations = [];
          for (let i = 0; i < samples.length; i += 32) {
            const expected = i / 255;
            const actual = samples[i];
            const deviation = actual - expected;
            if (Math.abs(deviation) > 0.02) { // More than 2% deviation
              deviations.push({
                index: i,
                percent: (i / 255 * 100).toFixed(1),
                expected: expected.toFixed(4),
                actual: actual.toFixed(4),
                deviation: deviation.toFixed(4)
              });
            }
          }
          console.log('  Non-linear deviations:', deviations);
        }

        resolve({
          success: true,
          labDataLoaded: !!normalized?.samples,
          curvesIdentical: identical,
          significantDifferences: differences,
          labSamplesLinear: normalized?.samples ?
            normalized.samples.every((val, i) => Math.abs(val - (i / 255)) < 0.01) : null
        });

      } catch (error) {
        console.log('Error in LAB debugging:', error.message);
        console.log('Error stack:', error.stack);
        resolve({
          success: false,
          error: error.message
        });
      }
    });
  });

  console.log('\n=== LAB CURVE VISIBILITY DEBUG RESULTS ===\n');

  if (debugResult.success) {
    console.log('📊 LAB DATA PROCESSING:');
    console.log(`  LAB data loaded: ${debugResult.labDataLoaded ? '✅' : '❌'}`);
    console.log(`  LAB samples are linear: ${debugResult.labSamplesLinear ? '❌' : '✅'}`);

    console.log('\n📈 CURVE COMPARISON:');
    console.log(`  make256 curves identical: ${debugResult.curvesIdentical ? '❌' : '✅'}`);
    console.log(`  Significant differences found: ${debugResult.significantDifferences?.length || 0}`);

    if (debugResult.significantDifferences?.length > 0) {
      console.log('\n🔍 CURVE DIFFERENCES:');
      debugResult.significantDifferences.forEach(diff => {
        console.log(`    Index ${diff.index}: ${diff.withLAB} vs ${diff.withoutLAB} (diff: ${diff.difference})`);
      });
    }

    console.log('\n🚨 DIAGNOSIS:');
    if (debugResult.curvesIdentical) {
      console.log('  ❌ PROBLEM: make256 produces identical curves with/without LAB data');
      console.log('  🔧 LAB corrections are not being applied in make256()');
    } else {
      console.log('  ✅ make256 produces different curves with LAB data');
      console.log('  🔧 Issue may be in chart rendering or curve visibility');
    }

    if (debugResult.labSamplesLinear) {
      console.log('  ❌ PROBLEM: LAB samples are perfectly linear');
      console.log('  🔧 LAB processing is not creating overcorrections');
    } else {
      console.log('  ✅ LAB samples show non-linear overcorrections');
    }

  } else {
    console.log('❌ DEBUG FAILED:');
    console.log(`   Error: ${debugResult.error}`);
  }

  await browser.close();
})();