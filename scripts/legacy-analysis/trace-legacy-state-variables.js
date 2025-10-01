const { chromium } = require('playwright');

(async () => {
  console.log('=== LEGACY SYSTEM STATE VARIABLE INVESTIGATION ===');
  console.log('Finding ALL linearization-related variables and state in legacy system\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('file://' + process.cwd() + '/quadgen.html');
  await page.waitForTimeout(2000);

  const stateInvestigation = await page.evaluate(() => {
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

      console.log('=== SCANNING ALL WINDOW VARIABLES FOR LINEARIZATION ===');

      // Get all window properties that might be related to linearization
      const allWindowProps = Object.getOwnPropertyNames(window);
      const linearizationProps = allWindowProps.filter(prop =>
        prop.toLowerCase().includes('linear') ||
        prop.toLowerCase().includes('lab') ||
        prop.toLowerCase().includes('correction') ||
        prop.toLowerCase().includes('global')
      );

      console.log('Linearization-related window properties:', linearizationProps);

      const beforeState = {};
      linearizationProps.forEach(prop => {
        try {
          const value = window[prop];
          beforeState[prop] = {
            type: typeof value,
            exists: value !== undefined && value !== null,
            isFunction: typeof value === 'function',
            hasData: value && typeof value === 'object' && Object.keys(value).length > 0
          };
        } catch (e) {
          beforeState[prop] = { error: e.message };
        }
      });

      console.log('=== BEFORE LOADING LAB DATA ===');
      console.log('State before:', beforeState);

      // Load LAB data
      const parsed = await window.parseLinearizationFile(testData, 'Color-Muse-Data.txt');
      const normalized = window.normalizeLinearizationEntry(parsed);
      window.linearizationData = normalized;
      window.linearizationApplied = true;

      console.log('=== AFTER LOADING LAB DATA ===');

      const afterState = {};
      linearizationProps.forEach(prop => {
        try {
          const value = window[prop];
          afterState[prop] = {
            type: typeof value,
            exists: value !== undefined && value !== null,
            isFunction: typeof value === 'function',
            hasData: value && typeof value === 'object' && Object.keys(value).length > 0,
            changed: JSON.stringify(beforeState[prop]) !== JSON.stringify({
              type: typeof value,
              exists: value !== undefined && value !== null,
              isFunction: typeof value === 'function',
              hasData: value && typeof value === 'object' && Object.keys(value).length > 0
            })
          };
        } catch (e) {
          afterState[prop] = { error: e.message };
        }
      });

      console.log('State after:', afterState);

      // Check specific known variables
      console.log('=== CHECKING SPECIFIC VARIABLES ===');
      const specificChecks = {
        'window.linearizationData': !!window.linearizationData,
        'window.linearizationApplied': window.linearizationApplied,
        'window.globalLinearizationData': !!window.globalLinearizationData,
        'window.globalLinearizationApplied': window.globalLinearizationApplied,
        'window.labData': !!window.labData,
        'window.labApplied': window.labApplied,
        'window.correctionData': !!window.correctionData,
        'window.correctionApplied': window.correctionApplied
      };

      Object.entries(specificChecks).forEach(([varName, value]) => {
        console.log(`${varName}: ${value}`);
      });

      // Check for state objects or modules
      console.log('=== CHECKING FOR STATE OBJECTS ===');
      const stateObjects = ['LinearizationState', 'GlobalState', 'AppState', 'CurveState'];
      const stateChecks = {};
      stateObjects.forEach(obj => {
        if (window[obj]) {
          stateChecks[obj] = {
            exists: true,
            type: typeof window[obj],
            properties: Object.keys(window[obj] || {})
          };
          console.log(`${obj}:`, stateChecks[obj]);
        } else {
          stateChecks[obj] = { exists: false };
        }
      });

      // Now check what make256 sees
      console.log('=== CHECKING WHAT make256 INTERNAL LOGIC SEES ===');

      // Try to access the internal state that make256 uses
      console.log('Calling make256 and checking its internal state detection...');
      window.DEBUG_LOGS = true;
      const curve = window.make256(65535, 'K', true);

      resolve({
        linearizationProps,
        beforeState,
        afterState,
        specificChecks,
        stateChecks,
        curveResult: curve ? [curve[0], curve[64], curve[128], curve[192], curve[255]] : null
      });
    });
  });

  console.log('\n=== LEGACY SYSTEM STATE INVESTIGATION RESULTS ===\n');

  console.log('🔍 LINEARIZATION-RELATED PROPERTIES FOUND:');
  stateInvestigation.linearizationProps.forEach(prop => {
    console.log(`  ${prop}`);
  });

  console.log('\n📊 SPECIFIC VARIABLE CHECKS:');
  Object.entries(stateInvestigation.specificChecks).forEach(([variable, value]) => {
    const status = value ? '✅' : '❌';
    console.log(`  ${status} ${variable}: ${value}`);
  });

  console.log('\n🏗️ STATE OBJECT CHECKS:');
  Object.entries(stateInvestigation.stateChecks).forEach(([obj, data]) => {
    if (data.exists) {
      console.log(`  ✅ ${obj}: ${data.type}, properties: [${data.properties?.join(', ')}]`);
    } else {
      console.log(`  ❌ ${obj}: not found`);
    }
  });

  console.log('\n📈 FINAL CURVE RESULT:');
  console.log(`  ${JSON.stringify(stateInvestigation.curveResult)}`);

  console.log('\n🔎 VARIABLE CHANGES ANALYSIS:');
  const changedVars = Object.entries(stateInvestigation.afterState)
    .filter(([prop, data]) => data.changed)
    .map(([prop]) => prop);

  if (changedVars.length > 0) {
    console.log('  Variables that changed after loading LAB data:');
    changedVars.forEach(prop => {
      console.log(`    📝 ${prop}`);
    });
  } else {
    console.log('  ⚠️  No linearization variables changed after loading LAB data');
  }

  console.log('\n🚨 KEY FINDINGS:');
  const hasLinearizationData = stateInvestigation.specificChecks['window.linearizationData'];
  const hasLinearizationApplied = stateInvestigation.specificChecks['window.linearizationApplied'];
  const hasGlobalLinearizationData = stateInvestigation.specificChecks['window.globalLinearizationData'];
  const hasGlobalLinearizationApplied = stateInvestigation.specificChecks['window.globalLinearizationApplied'];

  if (hasLinearizationData && hasLinearizationApplied) {
    console.log('  ✅ Standard linearization variables are set correctly');
  }

  if (hasGlobalLinearizationData || hasGlobalLinearizationApplied) {
    console.log('  🔍 Found separate global linearization variables');
    console.log('  ⚠️  This might be the disconnect - make256 may be checking global* variables');
  } else {
    console.log('  🔍 No separate global linearization variables found');
    console.log('  ⚠️  make256 internal logic may be using different variable names');
  }

  await browser.close();
})();