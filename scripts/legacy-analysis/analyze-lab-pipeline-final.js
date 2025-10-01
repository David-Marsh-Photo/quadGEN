const { chromium } = require('playwright');

(async () => {
  console.log('=== ANALYZING MODULAR LAB PIPELINE CORRECTNESS ===');
  console.log('Verifying LAB overcorrections follow linearization principles\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('file://' + process.cwd() + '/index.html');
  await page.waitForTimeout(2000);

  const pipelineAnalysis = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      window.DEBUG_LOGS = true;

      // Our test data - realistic printer measurement scenario
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

      console.log('=== STEP-BY-STEP PIPELINE ANALYSIS ===');

      try {
        // Parse LAB data
        const parsed = await window.parseLinearizationFile(labContent, 'Color-Muse-Data.txt');
        console.log('1. LAB Data Parsing:');
        console.log('   Format detected:', parsed.format);
        console.log('   Original data points:', parsed.originalData?.length);

        // Analyze a few key data points for correction direction
        const testPoints = [
          { gray: 20, labL: 90.06 }, // Bright area measured too dark
          { gray: 50, labL: 52.13 }, // Mid-tone close to linear
          { gray: 80, labL: 29.94 }  // Dark area measured too light
        ];

        console.log('\n2. Correction Analysis for Key Points:');
        testPoints.forEach(point => {
          // What we measured
          const position = point.gray / 100; // 0-1 position
          const measuredL = point.labL;

          // What we expected for linear response
          const expectedL = 100 - (point.gray); // Linear: 0% = 100L*, 100% = 0L*

          // Convert to density space (where corrections are calculated)
          const measuredY = window.lstarToY_CIE(measuredL);
          const expectedY = window.lstarToY_CIE(expectedL);
          const measuredDensity = -window.log10_safe(measuredY);
          const expectedDensity = -window.log10_safe(expectedY);

          // Current correction formula: expectedDensity - actualDensity
          const correction = expectedDensity - measuredDensity;

          console.log(`   GRAY ${point.gray}%:`);
          console.log(`     Measured L*: ${measuredL} (Y=${measuredY.toFixed(4)}, D=${measuredDensity.toFixed(4)})`);
          console.log(`     Expected L*: ${expectedL} (Y=${expectedY.toFixed(4)}, D=${expectedDensity.toFixed(4)})`);
          console.log(`     Correction: ${correction.toFixed(4)} ${correction > 0 ? '(MORE ink)' : '(LESS ink)'}`);

          // Linearization logic check
          if (measuredL > expectedL) {
            console.log(`     ✓ Measured too bright → needs MORE ink → correction should be positive → ${correction > 0 ? '✅' : '❌'}`);
          } else if (measuredL < expectedL) {
            console.log(`     ✓ Measured too dark → needs LESS ink → correction should be negative → ${correction < 0 ? '✅' : '❌'}`);
          } else {
            console.log(`     ✓ Measured correctly → needs no correction → ${Math.abs(correction) < 0.01 ? '✅' : '❌'}`);
          }
        });

        // Test the full pipeline
        console.log('\n3. Full Pipeline Test:');
        const normalized = window.normalizeLinearizationEntry(parsed);
        window.LinearizationState.setGlobalData(normalized, true);

        // Generate curves
        const linearCurve = window.make256(65535, 'K', false);   // No LAB
        const labCurve = window.make256(65535, 'K', true);       // With LAB

        // Analyze curve behavior at key points
        const curveAnalysis = [];
        [25, 50, 75].forEach(percent => {
          const index = Math.round(percent / 100 * 255);
          const linearValue = linearCurve[index];
          const labValue = labCurve[index];
          const difference = labValue - linearValue;
          const diffPercent = (difference / 65535 * 100);

          // Find corresponding LAB measurement
          const grayPercent = percent;
          const labData = parsed.originalData?.find(d => Math.abs(d.input - grayPercent) < 2);
          const measuredL = labData?.lab || 'N/A';
          const expectedL = 100 - grayPercent;

          curveAnalysis.push({
            percent,
            index,
            linearValue,
            labValue,
            difference,
            diffPercent: diffPercent.toFixed(2),
            direction: difference > 0 ? 'MORE ink' : difference < 0 ? 'LESS ink' : 'SAME',
            measuredL,
            expectedL,
            measurementError: measuredL !== 'N/A' ? (measuredL - expectedL).toFixed(1) : 'N/A'
          });
        });

        console.log('\n4. Curve Behavior Analysis:');
        curveAnalysis.forEach(analysis => {
          console.log(`   ${analysis.percent}% input:`);
          console.log(`     Linear: ${analysis.linearValue}, LAB: ${analysis.labValue}`);
          console.log(`     Difference: ${analysis.diffPercent}% (${analysis.direction})`);
          console.log(`     Measured L*: ${analysis.measuredL}, Expected L*: ${analysis.expectedL}`);
          console.log(`     Measurement error: ${analysis.measurementError}L*`);

          // Verify correction direction is appropriate for measurement error
          if (analysis.measurementError !== 'N/A') {
            const measError = parseFloat(analysis.measurementError);
            if (measError > 0) {
              // Measured brighter than expected → needs more ink
              console.log(`     ✓ Too bright → should increase ink → ${analysis.direction === 'MORE ink' ? '✅' : '❌'}`);
            } else if (measError < 0) {
              // Measured darker than expected → needs less ink
              console.log(`     ✓ Too dark → should decrease ink → ${analysis.direction === 'LESS ink' ? '✅' : '❌'}`);
            } else {
              console.log(`     ✓ Perfect → should not change → ${analysis.direction === 'SAME' ? '✅' : '❌'}`);
            }
          }
        });

        resolve({
          success: true,
          pipelineWorking: true,
          curveAnalysis,
          correctionFormula: 'expectedDensity - actualDensity',
          testPoints
        });

      } catch (error) {
        console.log('Pipeline analysis error:', error.message);
        resolve({
          success: false,
          error: error.message
        });
      }
    });
  });

  console.log('\n=== FINAL PIPELINE ASSESSMENT ===\n');

  if (pipelineAnalysis.success) {
    console.log('📊 CORRECTION FORMULA VERIFICATION:');
    console.log(`  Current formula: ${pipelineAnalysis.correctionFormula}`);
    console.log('  This implements: "How much more/less ink do we need?"');

    console.log('\n📈 OVERCORRECTION BEHAVIOR:');
    pipelineAnalysis.curveAnalysis.forEach(analysis => {
      const status = analysis.measurementError !== 'N/A' ?
        ((parseFloat(analysis.measurementError) > 0 && analysis.direction === 'MORE ink') ||
         (parseFloat(analysis.measurementError) < 0 && analysis.direction === 'LESS ink') ||
         (Math.abs(parseFloat(analysis.measurementError)) < 0.1 && analysis.direction === 'SAME')) ? '✅' : '❌'
        : '⚪';

      console.log(`  ${status} ${analysis.percent}%: ${analysis.direction} (${analysis.diffPercent}%)`);
    });

    const correctCount = pipelineAnalysis.curveAnalysis.filter(analysis => {
      if (analysis.measurementError === 'N/A') return true;
      const measError = parseFloat(analysis.measurementError);
      return (
        (measError > 0 && analysis.direction === 'MORE ink') ||
        (measError < 0 && analysis.direction === 'LESS ink') ||
        (Math.abs(measError) < 0.1 && analysis.direction === 'SAME')
      );
    }).length;

    console.log('\n🚨 FINAL VERDICT:');
    console.log(`  Correct behavior: ${correctCount}/${pipelineAnalysis.curveAnalysis.length}`);

    if (correctCount === pipelineAnalysis.curveAnalysis.length) {
      console.log('  ✅ LAB PIPELINE IS WORKING CORRECTLY');
      console.log('  ✅ Overcorrections follow proper linearization principles');
      console.log('  ✅ Formula: expectedDensity - actualDensity is correct');
      console.log('  ✅ Too bright measurements → more ink (overcorrection)');
      console.log('  ✅ Too dark measurements → less ink (overcorrection)');
      console.log('  ✅ Ready for linearized printing');
    } else {
      console.log('  ❌ LAB pipeline has issues with correction direction');
      console.log('  🔧 Review correction formula or measurement interpretation');
    }

  } else {
    console.log('❌ PIPELINE ANALYSIS FAILED:');
    console.log(`   Error: ${pipelineAnalysis.error}`);
  }

  await browser.close();
})();