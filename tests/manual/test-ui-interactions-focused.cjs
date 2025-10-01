/**
 * Focused UI Interaction Test
 * Tests critical UI elements for broken functionality
 */

const { chromium } = require('playwright');
const fs = require('fs');

class FocusedUITester {
    constructor() {
        this.criticalElements = [
            // Edit Mode Controls
            { id: 'editModeToggleBtn', description: 'Edit Mode Toggle', critical: true },

            // Channel Controls (using actual structure from modern system)
            { selector: '[data-channel="MK"] .per-channel-btn', description: 'MK Channel Load File', critical: true },
            { selector: '[data-channel="K"] .per-channel-btn', description: 'K Channel Load File', critical: true },
            { selector: '[data-channel="C"] .per-channel-btn', description: 'C Channel Load File', critical: true },
            { selector: '[data-channel="M"] .per-channel-btn', description: 'M Channel Load File', critical: true },
            { selector: '[data-channel="Y"] .per-channel-btn', description: 'Y Channel Load File', critical: true },

            // Channel Inputs
            { selector: '[data-channel="K"] .percent-input', description: 'K Channel Percent', critical: true },
            { selector: '[data-channel="K"] .end-input', description: 'K Channel End', critical: true },

            // Global Controls (using actual IDs)
            { id: 'globalLinearizationBtn', description: 'Global Linearization Load', critical: true },
            { id: 'revertGlobalToMeasurementBtn', description: 'Revert to Measurement', critical: true },
            { id: 'manualLstarBtn', description: 'Manual L* Entry', critical: true },

            // Main quad controls
            { id: 'loadQuadBtn', description: 'Load Quad File', critical: true },
            { id: 'downloadBtn', description: 'Download Quad', critical: true },

            // Edit Mode Controls
            { id: 'editRecomputeBtn', description: 'Edit Recompute', critical: false },
            { id: 'editChannelPrev', description: 'Previous Channel', critical: false },
            { id: 'editChannelNext', description: 'Next Channel', critical: false },

            // Auto Limit Toggles (these need to be found in the UI)
            { id: 'autoWhiteLimitToggle', description: 'Auto White Limit Toggle', critical: false },
            { id: 'autoBlackLimitToggle', description: 'Auto Black Limit Toggle', critical: false },

            // Additional critical buttons
            { id: 'undoBtn', description: 'Undo Button', critical: true },
            { id: 'redoBtn', description: 'Redo Button', critical: true }
        ];

        this.results = {
            timestamp: new Date().toISOString(),
            summary: {
                totalTested: 0,
                workingInBoth: 0,
                brokenInModern: 0,
                notFoundInModern: 0,
                criticalIssues: 0
            },
            elementResults: [],
            criticalIssues: []
        };
    }

    async runFocusedTest() {
        console.log('🎯 Focused UI Interaction Test');
        console.log('==============================');
        console.log('Testing critical UI elements for broken functionality\n');

        const browser = await chromium.launch({ headless: true });

        try {
            for (const elementDef of this.criticalElements) {
                await this.testCriticalElement(browser, elementDef);
            }

            this.generateFocusedReport();

        } finally {
            await browser.close();
        }
    }

    async testCriticalElement(browser, elementDef) {
        console.log(`🔍 Testing: ${elementDef.description}`);

        try {
            // Test in legacy system
            const legacyResult = await this.testElementInSystem(browser, 'quadgen.html', elementDef, 'legacy');

            // Test in modern system
            const modernResult = await this.testElementInSystem(browser, 'index.html', elementDef, 'modern');

            // Compare results
            const comparison = this.compareElementResults(legacyResult, modernResult, elementDef);

            this.results.elementResults.push(comparison);
            this.updateSummary(comparison);

            // Log result
            const status = this.getStatusEmoji(comparison.status);
            console.log(`  ${status} ${comparison.status.toUpperCase()}: ${comparison.summary}`);

            if (comparison.status === 'broken' && elementDef.critical) {
                this.results.criticalIssues.push(comparison);
            }

        } catch (error) {
            console.log(`  ❌ ERROR: ${error.message}`);

            this.results.elementResults.push({
                element: elementDef,
                status: 'error',
                error: error.message,
                summary: `Test failed: ${error.message}`
            });
        }
    }

    async testElementInSystem(browser, filename, elementDef, systemType) {
        const page = await browser.newPage();

        try {
            await page.goto(`file://${process.cwd()}/${filename}`);
            await page.waitForTimeout(1500);

            // Find the element
            const selector = elementDef.id ? `#${elementDef.id}` : elementDef.selector;
            const elementExists = await page.$(selector) !== null;

            if (!elementExists) {
                return {
                    system: systemType,
                    elementExists: false,
                    error: 'Element not found'
                };
            }

            // Check if element is enabled and visible
            const elementState = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;

                const rect = el.getBoundingClientRect();
                return {
                    visible: rect.width > 0 && rect.height > 0 && !el.hidden,
                    enabled: !el.disabled,
                    clickable: !el.disabled && rect.width > 0,
                    tag: el.tagName.toLowerCase(),
                    type: el.type || null
                };
            }, selector);

            if (!elementState) {
                return {
                    system: systemType,
                    elementExists: false,
                    error: 'Element evaluation failed'
                };
            }

            // Capture state before interaction
            const beforeState = await this.captureQuickState(page);

            // Try to interact with the element
            let interactionResult = null;
            try {
                if (elementState.clickable) {
                    await page.click(selector);
                    await page.waitForTimeout(500);
                }

                // Capture state after interaction
                const afterState = await this.captureQuickState(page);

                // Detect changes
                const changes = this.detectQuickChanges(beforeState, afterState);

                interactionResult = {
                    successful: true,
                    changes: changes.length,
                    changeTypes: changes.map(c => c.type)
                };

            } catch (clickError) {
                interactionResult = {
                    successful: false,
                    error: clickError.message
                };
            }

            return {
                system: systemType,
                elementExists: true,
                elementState,
                interaction: interactionResult
            };

        } finally {
            await page.close();
        }
    }

    async captureQuickState(page) {
        return await page.evaluate(() => {
            const state = {
                // Edit mode state
                editMode: window.isEditModeEnabled?.() || window.editModeEnabled || false,

                // Data loading state
                hasQuadData: !!(window.loadedQuadData?.curves),
                hasLinearization: !!(window.LinearizationState?.getData?.() || window.linearizationData),

                // UI state
                modalVisible: document.querySelectorAll('.modal:not(.hidden), .popup:not(.hidden)').length > 0,

                // Channel sample (K channel)
                kChannelPercent: document.querySelector('[data-channel="K"] .percent-input')?.value || '0',

                // File input state
                fileDialogsOpen: Array.from(document.querySelectorAll('input[type="file"]'))
                    .some(input => document.activeElement === input)
            };

            return state;
        });
    }

    detectQuickChanges(before, after) {
        const changes = [];

        if (before.editMode !== after.editMode) {
            changes.push({ type: 'edit-mode', description: `Edit mode: ${before.editMode} → ${after.editMode}` });
        }

        if (before.hasQuadData !== after.hasQuadData) {
            changes.push({ type: 'quad-data', description: `Quad data: ${before.hasQuadData} → ${after.hasQuadData}` });
        }

        if (before.hasLinearization !== after.hasLinearization) {
            changes.push({ type: 'linearization', description: `Linearization: ${before.hasLinearization} → ${after.hasLinearization}` });
        }

        if (before.modalVisible !== after.modalVisible) {
            changes.push({ type: 'modal', description: `Modal visible: ${before.modalVisible} → ${after.modalVisible}` });
        }

        if (before.kChannelPercent !== after.kChannelPercent) {
            changes.push({ type: 'channel-change', description: `K channel: ${before.kChannelPercent} → ${after.kChannelPercent}` });
        }

        if (before.fileDialogsOpen !== after.fileDialogsOpen) {
            changes.push({ type: 'file-dialog', description: `File dialog: ${before.fileDialogsOpen} → ${after.fileDialogsOpen}` });
        }

        return changes;
    }

    compareElementResults(legacyResult, modernResult, elementDef) {
        const comparison = {
            element: elementDef,
            legacy: legacyResult,
            modern: modernResult,
            status: 'unknown',
            summary: '',
            issue: null
        };

        // Check if element exists in both
        if (!legacyResult.elementExists && !modernResult.elementExists) {
            comparison.status = 'both-missing';
            comparison.summary = 'Element not found in either system';
            return comparison;
        }

        if (!modernResult.elementExists) {
            comparison.status = 'missing';
            comparison.summary = 'Element missing in modern system';
            comparison.issue = 'Modern system missing this UI element';
            return comparison;
        }

        if (!legacyResult.elementExists) {
            comparison.status = 'modern-only';
            comparison.summary = 'Element only exists in modern system';
            return comparison;
        }

        // Both elements exist, compare functionality
        const legacyWorks = legacyResult.interaction?.successful !== false;
        const modernWorks = modernResult.interaction?.successful !== false;

        if (legacyWorks && modernWorks) {
            // Compare response patterns
            const legacyChanges = legacyResult.interaction?.changes || 0;
            const modernChanges = modernResult.interaction?.changes || 0;

            if (legacyChanges > 0 && modernChanges > 0) {
                comparison.status = 'working';
                comparison.summary = 'Both systems respond to interaction';
            } else if (legacyChanges === 0 && modernChanges === 0) {
                comparison.status = 'passive';
                comparison.summary = 'No state changes detected in either system';
            } else {
                comparison.status = 'different';
                comparison.summary = `Different response patterns (Legacy: ${legacyChanges} changes, Modern: ${modernChanges} changes)`;
            }
        } else if (legacyWorks && !modernWorks) {
            comparison.status = 'broken';
            comparison.summary = 'Works in legacy but broken in modern';
            comparison.issue = modernResult.interaction?.error || 'Modern element does not respond';
        } else if (!legacyWorks && modernWorks) {
            comparison.status = 'improved';
            comparison.summary = 'Broken in legacy but works in modern';
        } else {
            comparison.status = 'both-broken';
            comparison.summary = 'Non-functional in both systems';
        }

        return comparison;
    }

    updateSummary(comparison) {
        this.results.summary.totalTested++;

        switch (comparison.status) {
            case 'working':
            case 'passive':
                this.results.summary.workingInBoth++;
                break;
            case 'broken':
                this.results.summary.brokenInModern++;
                if (comparison.element.critical) {
                    this.results.summary.criticalIssues++;
                }
                break;
            case 'missing':
                this.results.summary.notFoundInModern++;
                if (comparison.element.critical) {
                    this.results.summary.criticalIssues++;
                }
                break;
        }
    }

    getStatusEmoji(status) {
        const emojis = {
            'working': '✅',
            'passive': '⚪',
            'different': '🔄',
            'broken': '❌',
            'missing': '🚫',
            'improved': '🆙',
            'both-broken': '💥',
            'both-missing': '❓',
            'modern-only': '🆕',
            'error': '💀'
        };
        return emojis[status] || '❓';
    }

    generateFocusedReport() {
        console.log('\n📊 FOCUSED UI TEST REPORT');
        console.log('==========================');

        const s = this.results.summary;
        console.log(`Total Elements Tested: ${s.totalTested}`);
        console.log(`Working in Both: ${s.workingInBoth}`);
        console.log(`Broken in Modern: ${s.brokenInModern}`);
        console.log(`Missing in Modern: ${s.notFoundInModern}`);
        console.log(`Critical Issues: ${s.criticalIssues}`);

        // Show all results
        console.log('\n📋 DETAILED RESULTS:');
        this.results.elementResults.forEach((result, i) => {
            const emoji = this.getStatusEmoji(result.status);
            console.log(`  ${i + 1}. ${emoji} ${result.element.description}`);
            console.log(`     ${result.summary}`);
            if (result.issue) {
                console.log(`     Issue: ${result.issue}`);
            }
        });

        // Critical issues
        if (this.results.criticalIssues.length > 0) {
            console.log('\n🚨 CRITICAL ISSUES:');
            this.results.criticalIssues.forEach((issue, i) => {
                console.log(`  ${i + 1}. ${issue.element.description}`);
                console.log(`     Problem: ${issue.summary}`);
                console.log(`     Fix needed: ${issue.issue}`);
            });
        }

        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        if (s.criticalIssues === 0) {
            console.log('  🎉 No critical UI issues found!');
        } else {
            console.log(`  🔧 Fix ${s.criticalIssues} critical UI elements that are broken in modern system`);
        }

        if (s.brokenInModern > s.criticalIssues) {
            console.log(`  ⚠️  Address ${s.brokenInModern - s.criticalIssues} non-critical broken elements`);
        }

        if (s.notFoundInModern > 0) {
            console.log(`  🔍 Review ${s.notFoundInModern} missing elements - verify they were intentionally removed`);
        }

        // Save detailed report
        fs.writeFileSync('focused-ui-test-report.json', JSON.stringify(this.results, null, 2));
        console.log('\n💾 Detailed report saved: focused-ui-test-report.json');

        // Overall assessment
        const successRate = s.totalTested > 0 ? ((s.workingInBoth / s.totalTested) * 100).toFixed(1) : '0.0';
        console.log(`\n📈 Overall UI Health: ${successRate}% of tested elements working properly`);

        if (s.criticalIssues === 0 && successRate >= 80) {
            console.log('🎯 Excellent UI parity - ready for production!');
        } else if (s.criticalIssues <= 2) {
            console.log('⚠️  Good progress - address remaining critical issues');
        } else {
            console.log('🔧 Significant UI work needed before release');
        }
    }
}

// Quick test runner
async function quickUITest() {
    console.log('⚡ Running Quick UI Test (Critical Elements Only)...\n');

    const tester = new FocusedUITester();
    // Test only the most critical elements
    tester.criticalElements = tester.criticalElements.filter(el => el.critical);

    await tester.runFocusedTest();
}

// Run the test
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--quick')) {
        quickUITest().catch(console.error);
    } else {
        const tester = new FocusedUITester();
        tester.runFocusedTest().catch(console.error);
    }
}

module.exports = { FocusedUITester, quickUITest };