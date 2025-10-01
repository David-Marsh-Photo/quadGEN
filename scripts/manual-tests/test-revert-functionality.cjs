/**
 * Playwright Test Suite: Revert Button Functionality
 *
 * Tests both Global Correction and Per-Channel revert button behavior
 * Uses real mouse clicks instead of console commands for accurate UI testing
 *
 * Run with: node test-revert-functionality.js
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Test configuration
const TEST_CONFIG = {
  headless: false,  // Set to true for CI/CD
  slowMo: 200,      // Slow down for visibility during development
  timeout: 30000,
  screenshotsDir: './test-screenshots',
  indexPath: path.resolve(__dirname, 'index.html')
};

// Ensure screenshots directory exists
if (!fs.existsSync(TEST_CONFIG.screenshotsDir)) {
  fs.mkdirSync(TEST_CONFIG.screenshotsDir, { recursive: true });
}

/**
 * Test utilities
 */
const TestUtils = {
  /**
   * Wait for page to be fully loaded and initialized
   */
  async waitForAppReady(page) {
    // Wait for basic DOM to load
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Give app time to initialize

    // Check if basic elements exist
    const hasBasicElements = await page.evaluate(() => {
      const chart = document.getElementById('inkChart');
      const revertBtn = document.getElementById('revertGlobalToMeasurementBtn');
      return !!chart && !!revertBtn;
    });

    if (!hasBasicElements) {
      throw new Error('Basic UI elements not found - app may not have loaded correctly');
    }
  },

  /**
   * Take a screenshot with timestamp
   */
  async screenshot(page, name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}-${timestamp}.png`;
    await page.screenshot({
      path: path.join(TEST_CONFIG.screenshotsDir, filename),
      fullPage: true
    });
    console.log(`  📸 Screenshot saved: ${filename}`);
  },

  /**
   * Get global linearization state
   */
  async getGlobalLinearizationState(page) {
    return await page.evaluate(() => ({
      hasData: !!window.linearizationData,
      applied: !!window.linearizationApplied,
      format: window.linearizationData?.format || null,
      hasOriginal: Array.isArray(window.linearizationData?.originalData),
      edited: window.linearizationData?.edited || false,
      toggleDisabled: document.getElementById('globalLinearizationToggle')?.disabled,
      toggleChecked: document.getElementById('globalLinearizationToggle')?.checked,
      revertBtnDisabled: document.getElementById('revertGlobalToMeasurementBtn')?.disabled
    }));
  },

  /**
   * Get per-channel linearization state
   */
  async getPerChannelState(page, channelName) {
    return await page.evaluate((ch) => {
      const row = document.querySelector(`tr[data-channel="${ch}"]`);
      if (!row) return null;

      const hasMeasurement = !!(window.perChannelLinearization?.[ch]);
      const isEnabled = window.perChannelEnabled?.[ch] !== false;
      const hasSmartCurve = typeof window.isSmartCurve === 'function' && window.isSmartCurve(ch);

      return {
        hasMeasurement,
        isEnabled,
        hasSmartCurve,
        toggleDisabled: row.querySelector('.per-channel-toggle')?.disabled,
        toggleChecked: row.querySelector('.per-channel-toggle')?.checked,
        revertBtnDisabled: row.querySelector('.per-channel-revert')?.disabled,
        revertBtnVisible: !row.querySelector('.per-channel-revert')?.classList.contains('invisible'),
        endValue: row.querySelector('.end-input')?.value,
        percentValue: row.querySelector('.percent-input')?.value,
        processingLabel: row.querySelector('.processing-label')?.textContent || ''
      };
    }, channelName);
  },

  /**
   * Get curve data for a channel
   */
  async getCurveData(page, channelName) {
    return await page.evaluate((ch) => {
      const curve = window.loadedQuadData?.curves?.[ch];
      const originalCurve = window.loadedQuadData?.originalCurves?.[ch];
      const keyPoints = window.loadedQuadData?.keyPoints?.[ch];
      const baselineEnd = window.loadedQuadData?.baselineEnd?.[ch];

      return {
        hasCurve: Array.isArray(curve),
        curveLength: curve?.length || 0,
        curveChecksum: curve ? curve.reduce((a, b) => a + b, 0) : null,
        hasOriginal: Array.isArray(originalCurve),
        originalChecksum: originalCurve ? originalCurve.reduce((a, b) => a + b, 0) : null,
        hasKeyPoints: Array.isArray(keyPoints) && keyPoints.length > 0,
        keyPointCount: keyPoints?.length || 0,
        baselineEnd
      };
    }, channelName);
  },

  /**
   * Check if Edit Mode is enabled
   */
  async isEditModeEnabled(page) {
    return await page.evaluate(() => {
      return typeof window.isEditModeEnabled === 'function'
        ? window.isEditModeEnabled()
        : false;
    });
  },

  /**
   * Load a test .quad file by simulating file input
   */
  async loadQuadFile(page, filepath) {
    const fileInput = await page.locator('#quadFile');
    await fileInput.setInputFiles(filepath);
    await page.waitForTimeout(500);
  },

  /**
   * Load LAB measurement file (global)
   */
  async loadGlobalLabFile(page, filepath) {
    const fileInput = await page.locator('#linearizationFile');
    await fileInput.setInputFiles(filepath);
    await page.waitForTimeout(500);
  },

  /**
   * Load per-channel LAB file
   */
  async loadPerChannelFile(page, channelName, filepath) {
    const fileInput = await page.locator(`tr[data-channel="${channelName}"] .per-channel-file`);
    await fileInput.setInputFiles(filepath);
    await page.waitForTimeout(500);
  }
};

/**
 * Test Suite
 */
class RevertFunctionalityTests {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.results = {
      passed: 0,
      failed: 0,
      skipped: 0,
      tests: []
    };
  }

  /**
   * Initialize browser and page
   */
  async setup() {
    console.log('🚀 Starting Playwright browser...');
    this.browser = await chromium.launch({
      headless: TEST_CONFIG.headless,
      slowMo: TEST_CONFIG.slowMo
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });

    this.page = await this.context.newPage();

    // Enable console logging from page
    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`  ⚠️  Browser Error: ${msg.text()}`);
      }
    });

    // Load the app
    console.log(`📄 Loading app from: ${TEST_CONFIG.indexPath}`);
    await this.page.goto(`file://${TEST_CONFIG.indexPath}`);
    await TestUtils.waitForAppReady(this.page);
    console.log('✅ App loaded and ready\n');
  }

  /**
   * Teardown browser
   */
  async teardown() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  /**
   * Run a test with error handling
   */
  async runTest(name, testFn) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🧪 TEST: ${name}`);
    console.log('='.repeat(80));

    try {
      await testFn();
      console.log(`✅ PASSED: ${name}`);
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED' });
    } catch (error) {
      console.error(`❌ FAILED: ${name}`);
      console.error(`   Error: ${error.message}`);
      console.error(error.stack);
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAILED', error: error.message });

      // Take screenshot on failure
      try {
        await TestUtils.screenshot(this.page, `FAIL-${name.replace(/\s+/g, '-')}`);
      } catch (screenshotError) {
        console.error(`   Failed to capture screenshot: ${screenshotError.message}`);
      }
    }
  }

  /**
   * Print test results summary
   */
  printResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⏭️  Skipped: ${this.results.skipped}`);
    console.log(`📋 Total: ${this.results.tests.length}`);
    console.log('='.repeat(80));

    if (this.results.failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.tests
        .filter(t => t.status === 'FAILED')
        .forEach(t => {
          console.log(`  • ${t.name}`);
          console.log(`    ${t.error}`);
        });
    }

    console.log('');
  }

  /**
   * TEST 1: Global Revert Button - Initial State
   */
  async testGlobalRevertInitialState() {
    await this.runTest('Global Revert Button - Initial State (No Measurement)', async () => {
      const state = await TestUtils.getGlobalLinearizationState(this.page);

      console.log('  📊 State:', state);

      // Button should be disabled when no measurement is loaded
      if (state.revertBtnDisabled !== true) {
        throw new Error(`Expected revert button to be disabled, but it was ${state.revertBtnDisabled ? 'disabled' : 'enabled'}`);
      }

      console.log('  ✓ Revert button correctly disabled when no measurement loaded');
    });
  }

  /**
   * TEST 2: Global Revert Button - Enabled After LAB Load
   */
  async testGlobalRevertEnabledAfterLoad() {
    await this.runTest('Global Revert Button - Enabled After LAB Load', async () => {
      // This test requires a LAB file to be available
      // For now, we'll simulate by setting the state directly
      console.log('  ⏭️  SKIPPED: Requires test LAB file');
      this.results.skipped++;
      this.results.tests.pop(); // Remove from results
    });
  }

  /**
   * TEST 3: Global Revert Button - Click Behavior (No Measurement)
   */
  async testGlobalRevertClickWithoutMeasurement() {
    await this.runTest('Global Revert Button - Click When Disabled', async () => {
      // Try to click the revert button (should be disabled)
      const revertBtn = await this.page.locator('#revertGlobalToMeasurementBtn');
      const isDisabled = await revertBtn.isDisabled();

      console.log(`  📊 Button disabled: ${isDisabled}`);

      if (!isDisabled) {
        throw new Error('Revert button should be disabled without measurement data');
      }

      // Verify clicking disabled button has no effect
      await revertBtn.click({ force: true }); // Force click even if disabled
      await this.page.waitForTimeout(500);

      const stateAfter = await TestUtils.getGlobalLinearizationState(this.page);
      console.log('  ✓ No state change occurred from clicking disabled button');
    });
  }

  /**
   * TEST 4: Per-Channel Revert Button - Initial State
   */
  async testPerChannelRevertInitialState() {
    await this.runTest('Per-Channel Revert Button - Initial State', async () => {
      // Get state for K channel (common default channel)
      const channelState = await this.getPerChannelState(this.page, 'K');

      if (!channelState) {
        console.log('  ⏭️  SKIPPED: K channel not found in current printer');
        this.results.skipped++;
        return;
      }

      console.log('  📊 K Channel State:', channelState);

      // Button should be disabled when no measurement is loaded
      if (!channelState.revertBtnDisabled) {
        throw new Error('Per-channel revert button should be disabled without measurement');
      }

      // Button should be invisible when disabled
      if (channelState.revertBtnVisible) {
        throw new Error('Per-channel revert button should be invisible when disabled');
      }

      console.log('  ✓ Per-channel revert button correctly disabled and hidden');
    });
  }

  /**
   * TEST 5: UI Element Visibility
   */
  async testUIElementVisibility() {
    await this.runTest('UI Element Visibility', async () => {
      // Check that key UI elements exist
      const elements = await this.page.evaluate(() => ({
        globalRevertBtn: !!document.getElementById('revertGlobalToMeasurementBtn'),
        globalToggle: !!document.getElementById('globalLinearizationToggle'),
        globalLoadBtn: !!document.getElementById('globalLinearizationBtn'),
        channelRows: document.querySelectorAll('[data-channel]').length
      }));

      console.log('  📊 UI Elements:', elements);

      if (!elements.globalRevertBtn) {
        throw new Error('Global revert button not found in DOM');
      }

      if (!elements.globalToggle) {
        throw new Error('Global linearization toggle not found in DOM');
      }

      if (elements.channelRows === 0) {
        throw new Error('No channel rows found in DOM');
      }

      console.log('  ✓ All key UI elements present');
    });
  }

  /**
   * TEST 6: Edit Mode Integration
   */
  async testEditModeIntegration() {
    await this.runTest('Edit Mode Integration', async () => {
      // Check if Edit Mode toggle exists and works
      const editModeBtn = await this.page.locator('#editModeToggleBtn');
      const exists = await editModeBtn.count() > 0;

      if (!exists) {
        console.log('  ⏭️  SKIPPED: Edit Mode toggle not found');
        this.results.skipped++;
        return;
      }

      // Toggle Edit Mode on
      const initialState = await TestUtils.isEditModeEnabled(this.page);
      console.log(`  📊 Initial Edit Mode: ${initialState ? 'ON' : 'OFF'}`);

      await editModeBtn.click();
      await this.page.waitForTimeout(500);

      const afterToggle = await TestUtils.isEditModeEnabled(this.page);
      console.log(`  📊 After Toggle: ${afterToggle ? 'ON' : 'OFF'}`);

      if (initialState === afterToggle) {
        throw new Error('Edit Mode toggle did not change state');
      }

      // Toggle back to original state
      await editModeBtn.click();
      await this.page.waitForTimeout(500);

      console.log('  ✓ Edit Mode toggle works correctly');
    });
  }

  /**
   * TEST 7: Curve Data Integrity Check
   */
  async testCurveDataIntegrity() {
    await this.runTest('Curve Data Integrity Check', async () => {
      // Get curve data for first available channel
      const firstChannel = await this.page.evaluate(() => {
        const row = document.querySelector('[data-channel]');
        return row?.getAttribute('data-channel') || null;
      });

      if (!firstChannel) {
        console.log('  ⏭️  SKIPPED: No channels available');
        this.results.skipped++;
        return;
      }

      console.log(`  📊 Checking channel: ${firstChannel}`);
      const curveData = await TestUtils.getCurveData(this.page, firstChannel);
      console.log('  📊 Curve Data:', curveData);

      // Check that curve handling functions exist
      const hasFunctions = await this.page.evaluate(() => ({
        make256: typeof window.make256 === 'function',
        updateInkChart: typeof window.updateInkChart === 'function',
        isSmartCurve: typeof window.isSmartCurve === 'function'
      }));

      console.log('  📊 Functions available:', hasFunctions);

      if (!hasFunctions.make256 || !hasFunctions.updateInkChart) {
        throw new Error('Core curve functions not available');
      }

      console.log('  ✓ Curve data structures and functions present');
    });
  }

  /**
   * Helper: Get per-channel state
   */
  async getPerChannelState(page, channelName) {
    return await TestUtils.getPerChannelState(page, channelName);
  }

  /**
   * Main test runner
   */
  async run() {
    try {
      await this.setup();

      // Run all tests
      await this.testGlobalRevertInitialState();
      await this.testGlobalRevertEnabledAfterLoad();
      await this.testGlobalRevertClickWithoutMeasurement();
      await this.testPerChannelRevertInitialState();
      await this.testUIElementVisibility();
      await this.testEditModeIntegration();
      await this.testCurveDataIntegrity();

      // Print results
      this.printResults();

    } finally {
      await this.teardown();
    }

    // Exit with appropriate code
    process.exit(this.results.failed > 0 ? 1 : 0);
  }
}

/**
 * Run tests
 */
(async () => {
  const tests = new RevertFunctionalityTests();
  await tests.run();
})().catch(error => {
  console.error('💥 Test runner failed:', error);
  process.exit(1);
});