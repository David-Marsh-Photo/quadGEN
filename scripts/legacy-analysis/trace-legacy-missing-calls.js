const { chromium } = require('playwright');

(async () => {
  console.log('=== TRACING MISSING FUNCTION CALLS IN LEGACY make256 ===');
  console.log('Intercepting all linearization functions to see what should be called but isnt\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('file://' + process.cwd() + '/quadgen.html');
  await page.waitForTimeout(2000);

  const missingCallsTrace = await page.evaluate(() => {
    return new Promise(async (resolve) => {
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

      console.log('=== INTERCEPTING ALL LINEARIZATION FUNCTIONS ===');

      const interceptedCalls = [];
      const functionsToIntercept = [
        'hasAnyLinearization',
        'applyGlobalLinearizationStep',
        'applyPerChannelLinearizationStep',
        'apply1DLUT',
        'refreshGlobalLinearizationDisplay',
        'getGlobalLinearizationInterpolationType'
      ];

      // Store original functions and create interceptors
      const originalFunctions = {};
      functionsToIntercept.forEach(funcName => {
        if (typeof window[funcName] === 'function') {
          originalFunctions[funcName] = window[funcName];
          window[funcName] = function(...args) {
            interceptedCalls.push({
              function: funcName,
              arguments: args.map(arg => {
                if (typeof arg === 'object' && arg !== null) {
                  if (Array.isArray(arg)) return `Array(${arg.length})`;
                  return `Object(${Object.keys(arg).length} props)`;
                }
                return String(arg);
              }),
              timestamp: Date.now()
            });
            console.log(`INTERCEPTED: ${funcName}(${args.map(a => typeof a).join(', ')})`);
            return originalFunctions[funcName].apply(this, args);
          };
        } else {
          console.log(`Function ${funcName} not found on window`);
        }
      });

      console.log('=== TESTING LINEARIZATION FUNCTIONS MANUALLY ===');

      // Test key functions manually to see what they return
      const manualTests = {};

      if (typeof originalFunctions.hasAnyLinearization === 'function') {
        manualTests.hasAnyLinearization = originalFunctions.hasAnyLinearization();
        console.log('Manual hasAnyLinearization():', manualTests.hasAnyLinearization);
      }

      console.log('=== CALLING make256 WITH INTERCEPTION ===');
      window.DEBUG_LOGS = true;
      const curve = window.make256(65535, 'K', true);

      // Restore original functions
      functionsToIntercept.forEach(funcName => {
        if (originalFunctions[funcName]) {
          window[funcName] = originalFunctions[funcName];
        }
      });

      console.log('=== POST-make256 ANALYSIS ===');
      console.log('Intercepted calls count:', interceptedCalls.length);
      console.log('Functions called:', interceptedCalls.map(call => call.function));

      // Test what functions SHOULD return after loading LAB data
      const postLoadTests = {};
      if (typeof window.hasAnyLinearization === 'function') {
        postLoadTests.hasAnyLinearization = window.hasAnyLinearization();
        console.log('Post-load hasAnyLinearization():', postLoadTests.hasAnyLinearization);
      }

      // Check if we can manually apply linearization steps
      console.log('=== TESTING MANUAL LINEARIZATION APPLICATION ===');
      if (typeof window.applyGlobalLinearizationStep === 'function') {
        console.log('Attempting manual applyGlobalLinearizationStep...');
        try {
          // Create a test array to see if applyGlobalLinearizationStep works
          const testArray = [0, 16448, 32896, 49344, 65535];
          const manualResult = window.applyGlobalLinearizationStep(testArray, {
            channelName: 'K',
            endValue: 65535,
            applyLinearization: true
          });
          console.log('Manual applyGlobalLinearizationStep result:', manualResult?.slice(0, 5));
          manualTests.manualGlobalLinearization = manualResult;
        } catch (error) {
          console.log('Manual applyGlobalLinearizationStep error:', error.message);
          manualTests.manualGlobalLinearizationError = error.message;
        }
      }

      resolve({
        interceptedCalls,
        functionsFound: Object.keys(originalFunctions),
        manualTests,
        postLoadTests,
        curveResult: curve ? [curve[0], curve[64], curve[128], curve[192], curve[255]] : null,
        curveIsLinear: curve && curve[0] === 0 && curve[255] === 65535 && Math.abs(curve[128] - 32896) < 10
      });
    });
  });

  console.log('\n=== MISSING FUNCTION CALLS ANALYSIS ===\n');

  console.log('🔧 FUNCTIONS FOUND AND INTERCEPTED:');
  missingCallsTrace.functionsFound.forEach(func => {
    console.log(`  ✅ ${func}`);
  });

  console.log('\n📞 FUNCTION CALLS DURING make256:');
  if (missingCallsTrace.interceptedCalls.length > 0) {
    missingCallsTrace.interceptedCalls.forEach((call, i) => {
      console.log(`  ${i + 1}. ${call.function}(${call.arguments.join(', ')})`);
    });
  } else {
    console.log('  ❌ NO linearization functions were called during make256');
  }

  console.log('\n🧪 MANUAL FUNCTION TESTS:');
  Object.entries(missingCallsTrace.manualTests).forEach(([test, result]) => {
    console.log(`  ${test}: ${JSON.stringify(result)}`);
  });

  console.log('\n📊 POST-LOAD TESTS:');
  Object.entries(missingCallsTrace.postLoadTests).forEach(([test, result]) => {
    console.log(`  ${test}: ${JSON.stringify(result)}`);
  });

  console.log('\n📈 CURVE RESULT:');
  console.log(`  Values: ${JSON.stringify(missingCallsTrace.curveResult)}`);
  console.log(`  Is Linear: ${missingCallsTrace.curveIsLinear}`);

  console.log('\n🚨 CRITICAL DIAGNOSIS:');

  const hasAnyLinearizationResult = missingCallsTrace.postLoadTests.hasAnyLinearization;
  const wasHasAnyLinearizationCalled = missingCallsTrace.interceptedCalls.some(call => call.function === 'hasAnyLinearization');
  const wasApplyGlobalCalled = missingCallsTrace.interceptedCalls.some(call => call.function === 'applyGlobalLinearizationStep');

  if (hasAnyLinearizationResult === true) {
    console.log('  ✅ hasAnyLinearization() returns TRUE - LAB data is detected correctly');
  } else {
    console.log('  ❌ hasAnyLinearization() returns FALSE - LAB data detection is broken');
  }

  if (!wasHasAnyLinearizationCalled) {
    console.log('  ❌ CRITICAL BUG: make256 is NOT calling hasAnyLinearization()');
    console.log('     This is why make256 thinks there is no linearization data');
  }

  if (!wasApplyGlobalCalled) {
    console.log('  ❌ CRITICAL BUG: make256 is NOT calling applyGlobalLinearizationStep()');
    console.log('     This is why LAB corrections are never applied to curves');
  }

  if (missingCallsTrace.manualTests.manualGlobalLinearization) {
    console.log('  ✅ Manual applyGlobalLinearizationStep() works correctly');
    console.log('  ✅ The linearization processing logic itself is functional');
    console.log('  ✅ The bug is in make256 not calling the right functions');
  }

  await browser.close();
})();