/**
 * Critical Variable Comparison Test
 * Focuses on the most important variables for parity verification
 */

const { chromium } = require('playwright');
const fs = require('fs');

class CriticalVariableTester {
    constructor() {
        this.criticalVariables = [
            // Data loading and storage
            'loadedQuadData',
            'originalData',
            'linearizationData',

            // Smart Curves and Edit Mode
            'smartCurves',
            'editModeEnabled',
            'keyPointsMeta',

            // Channel state
            'channelConfiguration',
            'channelCurves',

            // Chart and display
            'chartData',
            'displayValues',
            'currentChannel'
        ];

        this.expectedDifferences = new Set([
            'functions.hasParseLabData',
            'functions.hasParseManualLstar',
            'functions.hasControlPoints',
            'functions.hasLinearizationState'
        ]);
    }

    async runTest() {
        console.log('🔍 Critical Variable Parity Test');
        console.log('=================================\n');

        const browser = await chromium.launch({ headless: true });

        try {
            // Test with default state
            await this.compareDefaultState(browser);

            // Test with LAB data loaded (if available)
            if (fs.existsSync('Color-Muse-Data.txt')) {
                await this.compareWithLabData(browser);
            }

        } finally {
            await browser.close();
        }
    }

    async compareDefaultState(browser) {
        console.log('📊 Comparing Default State...');

        const legacyPage = await browser.newPage();
        const modernPage = await browser.newPage();

        try {
            await legacyPage.goto(`file://${process.cwd()}/quadgen.html`);
            await modernPage.goto(`file://${process.cwd()}/index.html`);

            await legacyPage.waitForTimeout(1500);
            await modernPage.waitForTimeout(1500);

            const legacyVars = await this.extractCriticalVariables(legacyPage, 'legacy');
            const modernVars = await this.extractCriticalVariables(modernPage, 'modern');

            this.compareAndReport(legacyVars, modernVars, 'Default State');

        } finally {
            await legacyPage.close();
            await modernPage.close();
        }
    }

    async compareWithLabData(browser) {
        console.log('📈 Comparing with LAB Data Loaded...');

        const legacyPage = await browser.newPage();
        const modernPage = await browser.newPage();

        try {
            await legacyPage.goto(`file://${process.cwd()}/quadgen.html`);
            await modernPage.goto(`file://${process.cwd()}/index.html`);

            await legacyPage.waitForTimeout(1500);
            await modernPage.waitForTimeout(1500);

            // Simulate LAB data loading (manual step for now)
            console.log('  ⚠️  Manual step: Load Color-Muse-Data.txt in both systems');
            console.log('  Press Enter when both systems have loaded the data...');

            // In a full implementation, we'd automate file loading here

            const legacyVars = await this.extractCriticalVariables(legacyPage, 'legacy');
            const modernVars = await this.extractCriticalVariables(modernPage, 'modern');

            this.compareAndReport(legacyVars, modernVars, 'LAB Data Loaded');

        } finally {
            await legacyPage.close();
            await modernPage.close();
        }
    }

    async extractCriticalVariables(page, systemType) {
        return await page.evaluate((type) => {
            const vars = {
                system: type,
                timestamp: new Date().toISOString()
            };

            // Data Storage Variables
            vars.loadedQuadData = {
                exists: !!window.loadedQuadData,
                hasCurves: !!(window.loadedQuadData?.curves),
                hasBaselineEnd: !!(window.loadedQuadData?.baselineEnd),
                channelCount: window.loadedQuadData?.curves ? Object.keys(window.loadedQuadData.curves).length : 0
            };

            vars.originalData = {
                exists: !!window.originalData,
                type: typeof window.originalData,
                isArray: Array.isArray(window.originalData),
                length: Array.isArray(window.originalData) ? window.originalData.length : 0
            };

            // Linearization State (different APIs between systems)
            if (type === 'modern') {
                let linData = null;
                try {
                    linData = window.LinearizationState?.getData?.();
                } catch (e) {
                    // LinearizationState might not be available
                }

                vars.linearizationData = {
                    exists: !!linData,
                    hasGlobalData: !!(linData?.global),
                    isApplied: !!(window.LinearizationState?.isApplied?.()),
                    perChannelCount: linData?.perChannel ? Object.keys(linData.perChannel).length : 0
                };
            } else {
                vars.linearizationData = {
                    exists: !!window.linearizationData,
                    hasGlobalData: !!(window.linearizationData?.global),
                    isApplied: !!window.linearizationApplied,
                    perChannelCount: window.linearizationData?.perChannel ?
                        Object.keys(window.linearizationData.perChannel).length : 0
                };
            }

            // Edit Mode and Smart Curves
            if (type === 'modern') {
                let controlPoints = null;
                try {
                    controlPoints = window.ControlPoints?.getAll?.();
                } catch (e) {
                    // ControlPoints might not be available
                }

                vars.editMode = {
                    enabled: !!(window.isEditModeEnabled?.()),
                    smartCurvesCount: controlPoints ? Object.keys(controlPoints).length : 0,
                    selectedChannel: window.EDIT?.selectedChannel || null,
                    keyPointsMeta: !!(window.keyPointsMeta)
                };
            } else {
                vars.editMode = {
                    enabled: !!window.editModeEnabled,
                    smartCurvesCount: window.smartCurves ? Object.keys(window.smartCurves).length : 0,
                    selectedChannel: window.selectedChannel || null,
                    keyPointsMeta: !!(window.keyPointsMeta)
                };
            }

            // Channel Configuration
            vars.channels = {};
            const channelNames = ['K', 'C', 'M', 'Y', 'LC', 'LM'];
            channelNames.forEach(ch => {
                const row = document.querySelector(`[data-channel="${ch}"]`);
                if (row) {
                    vars.channels[ch] = {
                        percent: parseFloat(row.querySelector('.percent-input')?.value || '0'),
                        end: parseFloat(row.querySelector('.end-input')?.value || '0'),
                        visible: !row.classList.contains('hidden'),
                        enabled: parseFloat(row.querySelector('.percent-input')?.value || '0') > 0
                    };
                }
            });

            // Chart State
            vars.chart = {
                hasData: !!window.chartData,
                currentChannel: window.currentChannel || null,
                displayMax: type === 'modern' ?
                    (window.normalizeDisplayMax ? window.normalizeDisplayMax() : null) :
                    window.displayMax || null
            };

            // Function availability check
            vars.functions = {
                hasGetSmoothingControlPoints: !!(window.getSmoothingControlPoints),
                hasParseLabData: !!(window.parseLabData),
                hasParseManualLstar: !!(window.parseManualLstarData),
                hasControlPoints: type === 'modern' ? !!(window.ControlPoints) : false,
                hasLinearizationState: type === 'modern' ? !!(window.LinearizationState) : false
            };

            return vars;
        }, systemType);
    }

    compareAndReport(legacy, modern, context) {
        console.log(`\n📋 ${context} Comparison:`);
        console.log('─'.repeat(50));

        const issues = [];
        const successes = [];
        const expected = [];

        // Compare data storage
        this.compareSection(legacy.loadedQuadData, modern.loadedQuadData, 'loadedQuadData', issues, successes, expected);
        this.compareSection(legacy.originalData, modern.originalData, 'originalData', issues, successes, expected);
        this.compareSection(legacy.linearizationData, modern.linearizationData, 'linearizationData', issues, successes, expected);
        this.compareSection(legacy.editMode, modern.editMode, 'editMode', issues, successes, expected);
        this.compareSection(legacy.chart, modern.chart, 'chart', issues, successes, expected);
        this.compareSection(legacy.functions, modern.functions, 'functions', issues, successes, expected);

        // Compare channels
        const channelIssues = this.compareChannels(legacy.channels, modern.channels);
        issues.push(...channelIssues);

        // Report results
        console.log(`✅ Matches: ${successes.length}`);
        console.log(`❌ Issues: ${issues.length}`);

        if (expected.length > 0) {
            console.log('\nℹ️ Expected Differences:');
            expected.forEach(diff => {
                console.log(`  • ${diff}`);
            });
        }

        if (issues.length > 0) {
            console.log('\n🚨 Issues Found:');
            issues.forEach((issue, i) => {
                console.log(`  ${i + 1}. ${issue}`);
            });
        }

        if (successes.length > 0) {
            console.log('\n✅ Successful Matches:');
            successes.forEach(success => {
                console.log(`  • ${success}`);
            });
        }

        // Save detailed comparison
        const reportData = {
            context,
            timestamp: new Date().toISOString(),
            legacy,
            modern,
            issues,
            successes,
            summary: {
                total: issues.length + successes.length,
                passed: successes.length,
                failed: issues.length,
                successRate: ((successes.length / (issues.length + successes.length)) * 100).toFixed(1)
            },
            expected
        };

        const filename = `critical-vars-${context.toLowerCase().replace(/\s+/g, '-')}.json`;
        fs.writeFileSync(filename, JSON.stringify(reportData, null, 2));
        console.log(`\n💾 Detailed report: ${filename}`);
    }

    compareSection(legacySection, modernSection, sectionName, issues, successes, expected) {
        const keys = new Set([...Object.keys(legacySection), ...Object.keys(modernSection)]);

        keys.forEach(key => {
            const legacyVal = legacySection[key];
            const modernVal = modernSection[key];
            const diffKey = `${sectionName}.${key}`;

            if (JSON.stringify(legacyVal) === JSON.stringify(modernVal)) {
                successes.push(`${sectionName}.${key}`);
            } else {
                if (this.expectedDifferences.has(diffKey)) {
                    expected.push(`${diffKey}: Legacy(${JSON.stringify(legacyVal)}) vs Modern(${JSON.stringify(modernVal)})`);
                } else {
                    issues.push(`${diffKey}: Legacy(${JSON.stringify(legacyVal)}) ≠ Modern(${JSON.stringify(modernVal)})`);
                }
            }
        });
    }

    compareChannels(legacyChannels, modernChannels) {
        const issues = [];
        const channelNames = ['K', 'C', 'M', 'Y', 'LC', 'LM'];

        channelNames.forEach(ch => {
            const legacy = legacyChannels[ch];
            const modern = modernChannels[ch];

            if (!legacy && !modern) return;

            if (legacy?.percent !== modern?.percent) {
                issues.push(`${ch} percent: Legacy(${legacy?.percent}) ≠ Modern(${modern?.percent})`);
            }
            if (legacy?.end !== modern?.end) {
                issues.push(`${ch} end: Legacy(${legacy?.end}) ≠ Modern(${modern?.end})`);
            }
            if (legacy?.enabled !== modern?.enabled) {
                issues.push(`${ch} enabled: Legacy(${legacy?.enabled}) ≠ Modern(${modern?.enabled})`);
            }
        });

        return issues;
    }
}

// Run the test
if (require.main === module) {
    const tester = new CriticalVariableTester();
    tester.runTest().catch(console.error);
}

module.exports = CriticalVariableTester;
