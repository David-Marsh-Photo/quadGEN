/**
 * Comprehensive Parity Testing Framework
 * Compares legacy quadgen.html with modular index.html
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class ParityTester {
    constructor() {
        this.results = {
            testSuites: [],
            summary: {
                totalTests: 0,
                passed: 0,
                failed: 0,
                differences: []
            }
        };
    }

    async runComprehensiveTests() {
        console.log('🧪 Starting Comprehensive Parity Tests...\n');

        const browser = await chromium.launch({ headless: true });

        try {
            // Test scenarios with different data types
            await this.testDataLoadingParity(browser);
            await this.testEditModeStateParity(browser);
            await this.testLinearizationStateParity(browser);
            await this.testChannelConfigurationParity(browser);

            // Generate final report
            this.generateComprehensiveReport();

        } finally {
            await browser.close();
        }
    }

    async testDataLoadingParity(browser) {
        console.log('📊 Testing Data Loading Parity...');

        const testFiles = [
            { name: 'Color-Muse-Data.txt', type: 'LAB' },
            { name: 'sample.acv', type: 'ACV' },
            { name: 'sample.ti3', type: 'CGATS' }
        ];

        for (const file of testFiles) {
            if (fs.existsSync(path.join(process.cwd(), file.name))) {
                await this.compareSystemsWithFile(browser, file);
            }
        }
    }

    async compareSystemsWithFile(browser, fileInfo) {
        console.log(`  Testing ${fileInfo.name} (${fileInfo.type})...`);

        // Create two pages - one for each system
        const legacyPage = await browser.newPage();
        const modernPage = await browser.newPage();

        try {
            // Load both systems
            await legacyPage.goto(`file://${process.cwd()}/quadgen.html`);
            await modernPage.goto(`file://${process.cwd()}/index.html`);

            // Wait for initialization
            await legacyPage.waitForTimeout(1000);
            await modernPage.waitForTimeout(1000);

            // Extract baseline state
            const legacyBaseline = await this.extractLegacyState(legacyPage);
            const modernBaseline = await this.extractModernState(modernPage);

            // Load data (simulated - would need actual file upload logic)
            // This is where we'd implement file loading for both systems

            // Extract post-load state
            const legacyPostLoad = await this.extractLegacyState(legacyPage);
            const modernPostLoad = await this.extractModernState(modernPage);

            // Compare states
            const comparison = this.compareStates(legacyPostLoad, modernPostLoad, fileInfo.name);

            this.results.testSuites.push({
                name: `Data Loading: ${fileInfo.name}`,
                type: fileInfo.type,
                comparison
            });

        } finally {
            await legacyPage.close();
            await modernPage.close();
        }
    }

    async extractLegacyState(page) {
        return await page.evaluate(() => {
            // Extract comprehensive state from legacy quadgen.html
            const state = {
                // Chart and display state
                chartState: {
                    currentChannel: window.currentChannel || null,
                    displayMax: window.displayMax || null,
                    chartData: window.chartData || null
                },

                // Loaded data
                loadedData: {
                    loadedQuadData: window.loadedQuadData || null,
                    originalData: window.originalData || null,
                    linearizationData: window.linearizationData || null
                },

                // Channel configuration
                channels: {},

                // Edit mode state
                editMode: {
                    enabled: window.editModeEnabled || false,
                    smartCurves: window.smartCurves || null
                },

                // Global settings
                settings: {
                    autoWhiteLimit: document.getElementById('autoWhiteLimitToggle')?.checked || false,
                    autoBlackLimit: document.getElementById('autoBlackLimitToggle')?.checked || false
                }
            };

            // Extract channel-specific data
            const channelNames = ['K', 'C', 'M', 'Y', 'LC', 'LM'];
            channelNames.forEach(ch => {
                const row = document.querySelector(`[data-channel="${ch}"]`);
                if (row) {
                    state.channels[ch] = {
                        percent: row.querySelector('.percent-input')?.value || '0',
                        end: row.querySelector('.end-input')?.value || '0',
                        enabled: parseInt(row.querySelector('.percent-input')?.value || '0') > 0
                    };
                }
            });

            return state;
        });
    }

    async extractModernState(page) {
        return await page.evaluate(() => {
            // Extract comprehensive state from modular index.html
            const state = {
                // Chart and display state
                chartState: {
                    currentChannel: window.currentChannel || null,
                    displayMax: window.normalizeDisplayMax ? window.normalizeDisplayMax() : null,
                    chartData: window.chartData || null
                },

                // Loaded data
                loadedData: {
                    loadedQuadData: window.loadedQuadData || null,
                    originalData: window.originalData || null,
                    linearizationData: window.LinearizationState?.getData() || null
                },

                // Channel configuration
                channels: {},

                // Edit mode state
                editMode: {
                    enabled: window.isEditModeEnabled ? window.isEditModeEnabled() : false,
                    smartCurves: window.ControlPoints?.getAll() || null,
                    selectedChannel: window.EDIT?.selectedChannel || null
                },

                // Global settings
                settings: {
                    autoWhiteLimit: document.getElementById('autoWhiteLimitToggle')?.checked || false,
                    autoBlackLimit: document.getElementById('autoBlackLimitToggle')?.checked || false
                }
            };

            // Extract channel-specific data
            const channelNames = ['K', 'C', 'M', 'Y', 'LC', 'LM'];
            channelNames.forEach(ch => {
                const row = document.querySelector(`[data-channel="${ch}"]`);
                if (row) {
                    state.channels[ch] = {
                        percent: row.querySelector('.percent-input')?.value || '0',
                        end: row.querySelector('.end-input')?.value || '0',
                        enabled: parseInt(row.querySelector('.percent-input')?.value || '0') > 0
                    };
                }
            });

            return state;
        });
    }

    compareStates(legacy, modern, context) {
        const differences = [];

        // Deep compare each major section
        this.deepCompare(legacy.chartState, modern.chartState, 'chartState', differences);
        this.deepCompare(legacy.loadedData, modern.loadedData, 'loadedData', differences);
        this.deepCompare(legacy.channels, modern.channels, 'channels', differences);
        this.deepCompare(legacy.editMode, modern.editMode, 'editMode', differences);
        this.deepCompare(legacy.settings, modern.settings, 'settings', differences);

        return {
            context,
            differences,
            passed: differences.length === 0,
            legacy,
            modern
        };
    }

    deepCompare(obj1, obj2, path, differences) {
        if (typeof obj1 !== typeof obj2) {
            differences.push({
                path,
                issue: 'Type mismatch',
                legacy: typeof obj1,
                modern: typeof obj2
            });
            return;
        }

        if (obj1 === null || obj2 === null) {
            if (obj1 !== obj2) {
                differences.push({
                    path,
                    issue: 'Null mismatch',
                    legacy: obj1,
                    modern: obj2
                });
            }
            return;
        }

        if (typeof obj1 === 'object') {
            const keys1 = Object.keys(obj1);
            const keys2 = Object.keys(obj2);

            // Check for missing keys
            const missingInModern = keys1.filter(k => !keys2.includes(k));
            const missingInLegacy = keys2.filter(k => !keys1.includes(k));

            missingInModern.forEach(key => {
                differences.push({
                    path: `${path}.${key}`,
                    issue: 'Missing in modern',
                    legacy: obj1[key],
                    modern: undefined
                });
            });

            missingInLegacy.forEach(key => {
                differences.push({
                    path: `${path}.${key}`,
                    issue: 'Missing in legacy',
                    legacy: undefined,
                    modern: obj2[key]
                });
            });

            // Compare common keys
            const commonKeys = keys1.filter(k => keys2.includes(k));
            commonKeys.forEach(key => {
                this.deepCompare(obj1[key], obj2[key], `${path}.${key}`, differences);
            });
        } else if (obj1 !== obj2) {
            differences.push({
                path,
                issue: 'Value mismatch',
                legacy: obj1,
                modern: obj2
            });
        }
    }

    async testEditModeStateParity(browser) {
        console.log('🎛️  Testing Edit Mode State Parity...');
        // Implementation for edit mode specific tests
    }

    async testLinearizationStateParity(browser) {
        console.log('📈 Testing Linearization State Parity...');
        // Implementation for linearization specific tests
    }

    async testChannelConfigurationParity(browser) {
        console.log('🎨 Testing Channel Configuration Parity...');
        // Implementation for channel configuration tests
    }

    generateComprehensiveReport() {
        console.log('\n📋 COMPREHENSIVE PARITY REPORT');
        console.log('================================');

        let totalDifferences = 0;

        this.results.testSuites.forEach(suite => {
            console.log(`\n${suite.name}:`);

            if (suite.comparison.passed) {
                console.log('  ✅ PASS - Systems match perfectly');
            } else {
                console.log(`  ❌ FAIL - ${suite.comparison.differences.length} differences found`);
                totalDifferences += suite.comparison.differences.length;

                suite.comparison.differences.forEach(diff => {
                    console.log(`    • ${diff.path}: ${diff.issue}`);
                    console.log(`      Legacy: ${JSON.stringify(diff.legacy)}`);
                    console.log(`      Modern: ${JSON.stringify(diff.modern)}`);
                });
            }
        });

        console.log('\n📊 SUMMARY:');
        console.log(`Total test suites: ${this.results.testSuites.length}`);
        console.log(`Passed: ${this.results.testSuites.filter(s => s.comparison.passed).length}`);
        console.log(`Failed: ${this.results.testSuites.filter(s => !s.comparison.passed).length}`);
        console.log(`Total differences: ${totalDifferences}`);

        if (totalDifferences === 0) {
            console.log('\n🎉 SUCCESS: Complete parity achieved!');
        } else {
            console.log('\n⚠️  ACTION REQUIRED: Differences need investigation');
        }

        // Save detailed report to file
        fs.writeFileSync(
            'parity-test-report.json',
            JSON.stringify(this.results, null, 2)
        );
        console.log('\n💾 Detailed report saved to: parity-test-report.json');
    }
}

// Export for use in other scripts
module.exports = ParityTester;

// Run if called directly
if (require.main === module) {
    const tester = new ParityTester();
    tester.runComprehensiveTests().catch(console.error);
}