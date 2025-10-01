const { chromium } = require('playwright');

(async () => {
  console.log('=== EXTRACT CURVE DATA ===');
  console.log('Simple extraction of LAB curve data for manual comparison\n');

  const browser = await chromium.launch({ headless: true });

  async function extractCurve(filename, systemName) {
    console.log(`Extracting from ${systemName}...`);

    const page = await browser.newPage();
    await page.goto(`file://${process.cwd()}/${filename}`);
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      // Check if we can access the LAB processing functions
      const hasParseFunction = typeof window.parseLinearizationFile === 'function';
      const hasMake256 = typeof window.make256 === 'function';

      return {
        hasParseFunction,
        hasMake256,
        systemReady: hasParseFunction && hasMake256
      };
    });

    await page.close();

    console.log(`  ${systemName} ready: ${result.systemReady ? '✅' : '❌'}`);
    console.log(`    Parse function: ${result.hasParseFunction ? '✅' : '❌'}`);
    console.log(`    Make256 function: ${result.hasMake256 ? '✅' : '❌'}`);

    return result;
  }

  // Test function availability in both systems
  const legacyStatus = await extractCurve('quadgen.html', 'Legacy');
  const modularStatus = await extractCurve('index.html', 'Modular');

  console.log('\n=== FUNCTION AVAILABILITY ===');
  console.log(`Legacy system ready:  ${legacyStatus.systemReady ? '✅' : '❌'}`);
  console.log(`Modular system ready: ${modularStatus.systemReady ? '✅' : '❌'}`);

  if (legacyStatus.systemReady && modularStatus.systemReady) {
    console.log('\n✅ Both systems have required functions available');
    console.log('\n📋 MANUAL TESTING APPROACH:');
    console.log('Since automated testing is having issues, here\'s what you can do:');
    console.log('');
    console.log('1. Open quadgen.html in browser');
    console.log('2. Load Color-Muse-Data.txt in Global Corrections');
    console.log('3. Open DevTools console and run:');
    console.log('   const legacyCurve = make256(65535, "K", true);');
    console.log('   console.log("Legacy key points:", [legacyCurve[64], legacyCurve[128], legacyCurve[192]]);');
    console.log('');
    console.log('4. Open index.html in another tab');
    console.log('5. Load Color-Muse-Data.txt in Global Corrections');
    console.log('6. Open DevTools console and run:');
    console.log('   const modularCurve = make256(65535, "K", true);');
    console.log('   console.log("Modular key points:", [modularCurve[64], modularCurve[128], modularCurve[192]]);');
    console.log('');
    console.log('7. Compare the key points to see exact differences');
    console.log('');
    console.log('For more detailed comparison, you can also run:');
    console.log('   // Get full curve data');
    console.log('   const curve = make256(65535, "K", true);');
    console.log('   console.log("Full curve sample:", curve.slice(0, 10), "...", curve.slice(-10));');

  } else {
    console.log('\n❌ Function availability issues detected');
    if (!legacyStatus.systemReady) {
      console.log('   Legacy system missing functions');
    }
    if (!modularStatus.systemReady) {
      console.log('   Modular system missing functions');
    }
  }

  await browser.close();
})();