const { chromium } = require('playwright');

(async () => {
  console.log('=== DEBUGGING hasAnyLinearization() FUNCTION ===');
  console.log('Finding why hasAnyLinearization returns false when LAB data is loaded\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('file://' + process.cwd() + '/quadgen.html');
  await page.waitForTimeout(2000);

  const hasAnyLinearizationDebug = await page.evaluate(() => {
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

      console.log('=== BEFORE LOADING LAB DATA ===');
      console.log('hasAnyLinearization() before:', window.hasAnyLinearization ? window.hasAnyLinearization() : 'function not found');

      // Check all variables that hasAnyLinearization might be checking
      const variablesBefore = {
        'window.linearizationData': !!window.linearizationData,
        'window.linearizationApplied': window.linearizationApplied,
        'window.globalLinearizationData': !!window.globalLinearizationData,
        'window.globalLinearizationApplied': window.globalLinearizationApplied,
        'window.labData': !!window.labData,
        'window.perChannelLinearization': !!window.perChannelLinearization
      };

      console.log('Variables before loading:', variablesBefore);

      // Load LAB data
      const parsed = await window.parseLinearizationFile(testData, 'Color-Muse-Data.txt');
      const normalized = window.normalizeLinearizationEntry(parsed);
      window.linearizationData = normalized;
      window.linearizationApplied = true;

      console.log('=== AFTER LOADING LAB DATA ===');

      const variablesAfter = {
        'window.linearizationData': !!window.linearizationData,
        'window.linearizationApplied': window.linearizationApplied,
        'window.globalLinearizationData': !!window.globalLinearizationData,
        'window.globalLinearizationApplied': window.globalLinearizationApplied,
        'window.labData': !!window.labData,
        'window.perChannelLinearization': !!window.perChannelLinearization
      };

      console.log('Variables after loading:', variablesAfter);
      console.log('hasAnyLinearization() after:', window.hasAnyLinearization ? window.hasAnyLinearization() : 'function not found');

      // Try to inspect the hasAnyLinearization function source
      console.log('=== ANALYZING hasAnyLinearization FUNCTION ===');
      let functionSource = '';
      if (window.hasAnyLinearization) {
        functionSource = window.hasAnyLinearization.toString();
        console.log('hasAnyLinearization source length:', functionSource.length);

        // Look for specific variable names in the function
        const checksForVariables = [
          'linearizationData',
          'linearizationApplied',
          'globalLinearizationData',
          'globalLinearizationApplied',
          'labData',
          'perChannelLinearization'
        ];

        const foundChecks = {};
        checksForVariables.forEach(varName => {
          foundChecks[varName] = functionSource.includes(varName);
        });

        console.log('Variables checked by hasAnyLinearization:', foundChecks);

        // Look for specific patterns that might cause false negatives
        const problematicPatterns = [
          'globalLinearizationData',  // Wrong variable name
          'globalLinearizationApplied', // Wrong variable name
          'labData',  // Wrong variable name
          '&&',  // Multiple conditions that might fail
          'perChannelLinearization'  // Per-channel vs global confusion
        ];

        const foundPatterns = {};
        problematicPatterns.forEach(pattern => {
          foundPatterns[pattern] = functionSource.includes(pattern);
        });

        console.log('Potentially problematic patterns found:', foundPatterns);
      }

      // Test what conditions would make hasAnyLinearization return true
      console.log('=== TESTING DIFFERENT VARIABLE COMBINATIONS ===');

      const testConditions = [];

      // Test if setting globalLinearizationData helps
      if (!window.globalLinearizationData) {
        window.globalLinearizationData = normalized;
        testConditions.push({
          test: 'Set globalLinearizationData',
          result: window.hasAnyLinearization ? window.hasAnyLinearization() : false
        });
        window.globalLinearizationData = null; // Reset
      }

      // Test if setting globalLinearizationApplied helps
      if (!window.globalLinearizationApplied) {
        window.globalLinearizationApplied = true;
        testConditions.push({
          test: 'Set globalLinearizationApplied',
          result: window.hasAnyLinearization ? window.hasAnyLinearization() : false
        });
        window.globalLinearizationApplied = false; // Reset
      }

      // Test both together
      window.globalLinearizationData = normalized;
      window.globalLinearizationApplied = true;
      testConditions.push({
        test: 'Set both globalLinearizationData AND globalLinearizationApplied',
        result: window.hasAnyLinearization ? window.hasAnyLinearization() : false
      });

      console.log('Test conditions results:', testConditions);

      resolve({
        variablesBefore,
        variablesAfter,
        functionSource: functionSource.substring(0, 500), // First 500 chars
        testConditions,
        finalResult: window.hasAnyLinearization ? window.hasAnyLinearization() : false
      });
    });
  });

  console.log('\n=== hasAnyLinearization() DEBUG RESULTS ===\n');

  console.log('📊 VARIABLES BEFORE LOADING:');
  Object.entries(hasAnyLinearizationDebug.variablesBefore).forEach(([variable, value]) => {
    const status = value ? '✅' : '❌';
    console.log(`  ${status} ${variable}: ${value}`);
  });

  console.log('\n📊 VARIABLES AFTER LOADING:');
  Object.entries(hasAnyLinearizationDebug.variablesAfter).forEach(([variable, value]) => {
    const status = value ? '✅' : '❌';
    console.log(`  ${status} ${variable}: ${value}`);
  });

  console.log('\n🧪 TEST CONDITIONS:');
  hasAnyLinearizationDebug.testConditions.forEach((test, i) => {
    const status = test.result ? '✅' : '❌';
    console.log(`  ${status} ${test.test}: ${test.result}`);
  });

  console.log('\n💡 FUNCTION SOURCE (first 500 chars):');
  console.log(`  ${hasAnyLinearizationDebug.functionSource}...`);

  console.log('\n🚨 CRITICAL DIAGNOSIS:');

  const hasCorrectStandardVars = hasAnyLinearizationDebug.variablesAfter['window.linearizationData'] &&
                                 hasAnyLinearizationDebug.variablesAfter['window.linearizationApplied'];

  const workingTestFound = hasAnyLinearizationDebug.testConditions.some(test => test.result === true);

  if (hasCorrectStandardVars && !hasAnyLinearizationDebug.finalResult) {
    console.log('  ❌ BUG CONFIRMED: hasAnyLinearization() ignores standard variables');
    console.log('  ❌ Standard linearizationData and linearizationApplied are set correctly');
    console.log('  ❌ But hasAnyLinearization() returns false anyway');
  }

  if (workingTestFound) {
    const workingTest = hasAnyLinearizationDebug.testConditions.find(test => test.result === true);
    console.log(`  🔧 SOLUTION FOUND: ${workingTest.test} makes hasAnyLinearization() return true`);
    console.log('  🔧 This reveals which variables hasAnyLinearization() actually checks');
  } else {
    console.log('  ⚠️  No test conditions made hasAnyLinearization() return true');
    console.log('  ⚠️  The function may have deeper logic issues');
  }

  await browser.close();
})();