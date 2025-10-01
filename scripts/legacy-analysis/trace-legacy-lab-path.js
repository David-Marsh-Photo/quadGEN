const { chromium } = require('playwright');

(async () => {
  console.log('=== COMPLETE LAB DATA PATH TRACING - LEGACY SYSTEM ===');
  console.log('Following LAB data from file loading to final curve output\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Capture ALL console messages to trace the complete path
  page.on('console', msg => {
    console.log('LEGACY TRACE:', msg.text());
  });

  await page.goto('file://' + process.cwd() + '/quadgen.html');
  await page.waitForTimeout(2000);

  const pathTrace = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      // Enable comprehensive debugging
      window.DEBUG_LOGS = true;

      const trace = {
        steps: [],
        functions: {},
        variables: {},
        dataFlow: []
      };

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

      console.log('=== STEP 1: INITIAL STATE CHECK ===');
      trace.steps.push('STEP 1: Initial state check');
      trace.variables.initialLinearizationData = window.linearizationData;
      trace.variables.initialLinearizationApplied = window.linearizationApplied;
      console.log('Initial linearizationData:', !!window.linearizationData);
      console.log('Initial linearizationApplied:', window.linearizationApplied);

      console.log('=== STEP 2: PARSING LAB FILE DATA ===');
      trace.steps.push('STEP 2: Parse LAB file data');
      console.log('Calling parseLinearizationFile...');
      const parsed = await window.parseLinearizationFile(testData, 'Color-Muse-Data.txt');

      trace.dataFlow.push({
        stage: 'parsed',
        format: parsed?.format,
        originalDataCount: parsed?.originalData?.length,
        samplesCount: parsed?.samples?.length,
        firstFewSamples: parsed?.samples?.slice(0, 3),
        sourceSpace: parsed?.sourceSpace
      });

      console.log('Parsed result:', {
        format: parsed?.format,
        originalData: parsed?.originalData?.length,
        samples: parsed?.samples?.length,
        sourceSpace: parsed?.sourceSpace
      });

      console.log('=== STEP 3: NORMALIZING LAB DATA ===');
      trace.steps.push('STEP 3: Normalize LAB data');
      console.log('Calling normalizeLinearizationEntry...');
      const normalized = window.normalizeLinearizationEntry(parsed);

      trace.dataFlow.push({
        stage: 'normalized',
        format: normalized?.format,
        originalDataCount: normalized?.originalData?.length,
        samplesCount: normalized?.samples?.length,
        firstFewSamples: normalized?.samples?.slice(0, 3),
        sourceSpace: normalized?.sourceSpace,
        needsDualTransformation: normalized?.needsDualTransformation
      });

      console.log('Normalized result:', {
        format: normalized?.format,
        originalData: normalized?.originalData?.length,
        samples: normalized?.samples?.length,
        sourceSpace: normalized?.sourceSpace,
        needsDualTransformation: normalized?.needsDualTransformation
      });

      console.log('=== STEP 4: SETTING GLOBAL LINEARIZATION STATE ===');
      trace.steps.push('STEP 4: Set global linearization state');
      window.linearizationData = normalized;
      window.linearizationApplied = true;

      trace.variables.finalLinearizationData = !!window.linearizationData;
      trace.variables.finalLinearizationApplied = window.linearizationApplied;

      console.log('After setting:');
      console.log('  linearizationData set:', !!window.linearizationData);
      console.log('  linearizationApplied:', window.linearizationApplied);

      console.log('=== STEP 5: TRACING make256 CALL PATH ===');
      trace.steps.push('STEP 5: Trace make256 call path');

      // Check what functions are available for processing
      trace.functions = {
        make256: typeof window.make256,
        apply1DLUT: typeof window.apply1DLUT,
        applyGlobalLinearization: typeof window.applyGlobalLinearization,
        applyPerChannelLinearization: typeof window.applyPerChannelLinearization,
        updateInkChart: typeof window.updateInkChart,
        processLinearizationData: typeof window.processLinearizationData
      };

      console.log('Available functions:', trace.functions);

      console.log('=== STEP 6: GENERATING CURVE WITHOUT LAB (BASELINE) ===');
      trace.steps.push('STEP 6: Generate baseline curve without LAB');

      // Temporarily disable LAB to get baseline
      const tempData = window.linearizationData;
      const tempApplied = window.linearizationApplied;
      window.linearizationData = null;
      window.linearizationApplied = false;

      console.log('Calling make256(65535, "K", false) for baseline...');
      const baselineCurve = window.make256(65535, 'K', false);

      trace.dataFlow.push({
        stage: 'baseline_curve',
        curveLength: baselineCurve?.length,
        curveSample: baselineCurve ? [baselineCurve[0], baselineCurve[64], baselineCurve[128], baselineCurve[192], baselineCurve[255]] : null
      });

      // Restore LAB data
      window.linearizationData = tempData;
      window.linearizationApplied = tempApplied;

      console.log('=== STEP 7: GENERATING CURVE WITH LAB (CORRECTED) ===');
      trace.steps.push('STEP 7: Generate curve with LAB corrections');

      console.log('Calling make256(65535, "K", true) with LAB data...');
      const correctedCurve = window.make256(65535, 'K', true);

      trace.dataFlow.push({
        stage: 'corrected_curve',
        curveLength: correctedCurve?.length,
        curveSample: correctedCurve ? [correctedCurve[0], correctedCurve[64], correctedCurve[128], correctedCurve[192], correctedCurve[255]] : null,
        identicalToBaseline: JSON.stringify(baselineCurve) === JSON.stringify(correctedCurve)
      });

      console.log('=== STEP 8: ANALYZING CURVE DIFFERENCES ===');
      trace.steps.push('STEP 8: Analyze curve differences');

      if (baselineCurve && correctedCurve) {
        let differences = [];
        for (let i = 0; i < Math.min(baselineCurve.length, correctedCurve.length); i++) {
          const diff = Math.abs(baselineCurve[i] - correctedCurve[i]);
          if (diff > 0 && differences.length < 10) {
            differences.push({ index: i, baseline: baselineCurve[i], corrected: correctedCurve[i], diff });
          }
        }
        trace.dataFlow.push({
          stage: 'differences_analysis',
          totalDifferences: differences.length,
          sampleDifferences: differences.slice(0, 5),
          hasAnyDifferences: differences.length > 0
        });
      }

      console.log('=== STEP 9: CHECKING CHART UPDATE PATH ===');
      trace.steps.push('STEP 9: Check chart update path');

      // Check if chart update applies corrections
      console.log('Calling updateInkChart to trace chart rendering path...');
      if (typeof window.updateInkChart === 'function') {
        window.updateInkChart();
        trace.functions.updateInkChartCalled = true;
      }

      console.log('=== STEP 10: FINAL STATE VERIFICATION ===');
      trace.steps.push('STEP 10: Final state verification');

      trace.variables.finalState = {
        linearizationDataExists: !!window.linearizationData,
        linearizationApplied: window.linearizationApplied,
        dataFormat: window.linearizationData?.format,
        dataSamples: window.linearizationData?.samples?.length
      };

      resolve(trace);
    });
  });

  console.log('\n=== COMPLETE LAB DATA PATH ANALYSIS ===\n');

  console.log('📋 EXECUTION STEPS:');
  pathTrace.steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step}`);
  });

  console.log('\n🔧 AVAILABLE FUNCTIONS:');
  Object.entries(pathTrace.functions).forEach(([func, type]) => {
    console.log(`  ${func}: ${type}`);
  });

  console.log('\n📊 DATA FLOW TRACE:');
  pathTrace.dataFlow.forEach((flow, i) => {
    console.log(`  ${i + 1}. ${flow.stage.toUpperCase()}:`);
    Object.entries(flow).forEach(([key, value]) => {
      if (key !== 'stage') {
        console.log(`     ${key}: ${JSON.stringify(value)}`);
      }
    });
    console.log('');
  });

  console.log('📝 VARIABLES STATE:');
  Object.entries(pathTrace.variables).forEach(([variable, value]) => {
    console.log(`  ${variable}: ${JSON.stringify(value)}`);
  });

  // Critical analysis
  const baselineFlow = pathTrace.dataFlow.find(f => f.stage === 'baseline_curve');
  const correctedFlow = pathTrace.dataFlow.find(f => f.stage === 'corrected_curve');
  const diffFlow = pathTrace.dataFlow.find(f => f.stage === 'differences_analysis');

  console.log('\n🚨 CRITICAL ANALYSIS:');
  if (correctedFlow?.identicalToBaseline === true) {
    console.log('  ❌ MAJOR ISSUE: LAB data is NOT affecting curve generation');
    console.log('  ❌ Baseline and corrected curves are IDENTICAL');
    console.log('  ❌ LAB corrections are not being applied anywhere in the pipeline');
  } else if (diffFlow?.hasAnyDifferences === true) {
    console.log('  ✅ LAB corrections ARE being applied');
    console.log(`  ✅ Found ${diffFlow.totalDifferences} differences between curves`);
    console.log('  ✅ LAB data path is working correctly');
  } else {
    console.log('  ❓ Unable to determine if LAB corrections are working');
  }

  console.log('\n🔍 NEXT INVESTIGATION STEPS:');
  if (correctedFlow?.identicalToBaseline === true) {
    console.log('  1. Check if apply1DLUT function is being called during make256');
    console.log('  2. Trace internal make256 logic to find where LAB should be applied');
    console.log('  3. Check if linearization is bypassed for LAB format data');
    console.log('  4. Investigate manual L* entry vs file loading differences');
  }

  await browser.close();
})();