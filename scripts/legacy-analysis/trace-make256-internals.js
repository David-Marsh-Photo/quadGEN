const { chromium } = require('playwright');

(async () => {
  console.log('=== TRACING make256 INTERNAL LOGIC - LEGACY SYSTEM ===');
  console.log('Deep dive into make256 function to find where LAB data should be applied\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('MAKE256 TRACE:', msg.text());
  });

  await page.goto('file://' + process.cwd() + '/quadgen.html');
  await page.waitForTimeout(2000);

  const internalTrace = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      window.DEBUG_LOGS = true;

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

      // Load LAB data
      const parsed = await window.parseLinearizationFile(testData, 'Color-Muse-Data.txt');
      const normalized = window.normalizeLinearizationEntry(parsed);
      window.linearizationData = normalized;
      window.linearizationApplied = true;

      console.log('=== PRE-MAKE256 STATE INSPECTION ===');
      console.log('window.linearizationData exists:', !!window.linearizationData);
      console.log('window.linearizationApplied:', window.linearizationApplied);
      console.log('linearizationData.format:', window.linearizationData?.format);
      console.log('linearizationData.samples.length:', window.linearizationData?.samples?.length);

      // Check if there are any conditions that might cause LAB data to be ignored
      console.log('=== CHECKING POTENTIAL BYPASS CONDITIONS ===');

      // Check for LAB bypass detection
      if (typeof window.isLabLinearizationData === 'function') {
        const isLabDetected = window.isLabLinearizationData(window.linearizationData);
        console.log('isLabLinearizationData() result:', isLabDetected);
      } else {
        console.log('isLabLinearizationData function not found');
      }

      // Check for format-based bypasses
      const format = window.linearizationData?.format;
      console.log('Data format check:', format);
      if (format === 'LAB Data') {
        console.log('Format is LAB Data - checking if this triggers bypass logic');
      }

      console.log('=== INTERCEPTING make256 INTERNAL CALLS ===');

      // Try to intercept apply1DLUT calls if they happen
      let apply1DLUTCalls = [];
      const originalApply1DLUT = window.apply1DLUT;
      if (originalApply1DLUT) {
        window.apply1DLUT = function(...args) {
          apply1DLUTCalls.push({
            arguments: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg),
            timestamp: Date.now()
          });
          console.log('apply1DLUT INTERCEPTED:', {
            argTypes: args.map(arg => typeof arg),
            valuesLength: Array.isArray(args[0]) ? args[0].length : 'not array',
            lutData: args[1] ? 'has lut data' : 'no lut data'
          });
          return originalApply1DLUT.apply(this, args);
        };
      }

      console.log('=== CALLING make256 WITH FULL TRACING ===');
      const curve = window.make256(65535, 'K', true);

      // Restore original function
      if (originalApply1DLUT) {
        window.apply1DLUT = originalApply1DLUT;
      }

      console.log('=== POST-MAKE256 ANALYSIS ===');
      console.log('Curve generated:', !!curve);
      console.log('Curve length:', curve?.length);
      console.log('apply1DLUT calls intercepted:', apply1DLUTCalls.length);
      console.log('First few curve values:', curve?.slice(0, 5));
      console.log('Last few curve values:', curve?.slice(-5));

      // Check if the curve is linear (which would indicate no processing)
      const isLinear = curve && curve.length === 256 &&
        curve[0] === 0 &&
        curve[255] === 65535 &&
        Math.abs(curve[128] - 32896) < 10; // Allow small rounding

      console.log('Curve appears linear (no processing):', isLinear);

      resolve({
        preState: {
          linearizationDataExists: !!window.linearizationData,
          linearizationApplied: window.linearizationApplied,
          dataFormat: window.linearizationData?.format,
          samplesLength: window.linearizationData?.samples?.length
        },
        apply1DLUTCalls: apply1DLUTCalls.length,
        curveGenerated: !!curve,
        curveIsLinear: isLinear,
        curveSample: curve ? [curve[0], curve[64], curve[128], curve[192], curve[255]] : null,
        interceptedCalls: apply1DLUTCalls
      });
    });
  });

  console.log('\n=== make256 INTERNAL ANALYSIS RESULTS ===\n');

  console.log('📊 PRE-MAKE256 STATE:');
  Object.entries(internalTrace.preState).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });

  console.log('\n🔧 FUNCTION CALL ANALYSIS:');
  console.log(`  apply1DLUT calls intercepted: ${internalTrace.apply1DLUTCalls}`);
  console.log(`  Curve generated: ${internalTrace.curveGenerated}`);
  console.log(`  Curve is linear: ${internalTrace.curveIsLinear}`);

  console.log('\n📈 CURVE OUTPUT:');
  console.log(`  Sample values: ${JSON.stringify(internalTrace.curveSample)}`);

  if (internalTrace.interceptedCalls.length > 0) {
    console.log('\n🔍 INTERCEPTED apply1DLUT CALLS:');
    internalTrace.interceptedCalls.forEach((call, i) => {
      console.log(`  Call ${i + 1}:`, call);
    });
  }

  console.log('\n🚨 CRITICAL FINDINGS:');
  if (internalTrace.apply1DLUTCalls === 0) {
    console.log('  ❌ MAJOR ISSUE: apply1DLUT was NEVER called during make256');
    console.log('  ❌ This means LAB data processing is completely bypassed');
    console.log('  ❌ The linearization pipeline is not being executed');
  } else {
    console.log(`  ✅ apply1DLUT was called ${internalTrace.apply1DLUTCalls} times`);
    if (internalTrace.curveIsLinear) {
      console.log('  ⚠️  But curve is still linear - check apply1DLUT implementation');
    } else {
      console.log('  ✅ Curve shows processing effects');
    }
  }

  console.log('\n🔍 NEXT INVESTIGATION:');
  if (internalTrace.apply1DLUTCalls === 0) {
    console.log('  1. Check make256 source code for linearization application logic');
    console.log('  2. Look for format-based bypasses in make256');
    console.log('  3. Check if applyLinearization parameter is being ignored');
    console.log('  4. Verify if legacy system has different linearization entry points');
  }

  await browser.close();
})();