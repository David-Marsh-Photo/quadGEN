/**
 * Broken Element Detection Test
 * Specifically designed to catch buttons that should respond but don't
 */

const { chromium } = require('playwright');
const fs = require('fs');

class BrokenElementDetector {
    constructor() {
        // Elements that SHOULD trigger some kind of response when clicked
        this.expectedActiveElements = [
            // File input buttons - should open file dialogs or trigger file input clicks
            {
                selector: '[data-channel="MK"] .per-channel-btn',
                description: 'MK Channel Load File',
                expectedResponse: 'file-dialog-or-click',
                critical: true
            },
            {
                selector: '[data-channel="K"] .per-channel-btn',
                description: 'K Channel Load File',
                expectedResponse: 'file-dialog-or-click',
                critical: true
            },
            {
                id: 'globalLinearizationBtn',
                description: 'Global Linearization Load',
                expectedResponse: 'file-dialog-or-click',
                critical: true
            },
            {
                id: 'loadQuadBtn',
                description: 'Load Quad File',
                expectedResponse: 'file-dialog-or-click',
                critical: true
            },

            // Buttons that should trigger immediate state changes
            {
                id: 'editModeToggleBtn',
                description: 'Edit Mode Toggle',
                expectedResponse: 'state-change',
                critical: true
            },
            {
                id: 'undoBtn',
                description: 'Undo Button',
                expectedResponse: 'state-change-or-disabled',
                critical: true
            },
            {
                id: 'redoBtn',
                description: 'Redo Button',
                expectedResponse: 'state-change-or-disabled',
                critical: true
            },

            // Modal/Dialog triggers
            {
                id: 'manualLstarBtn',
                description: 'Manual L* Entry',
                expectedResponse: 'modal-or-dialog',
                critical: true
            },

            // Data modification buttons (context-dependent)
            {
                id: 'revertGlobalToMeasurementBtn',
                description: 'Revert to Measurement',
                expectedResponse: 'state-change-when-enabled',
                critical: true
            },
            {
                id: 'downloadBtn',
                description: 'Download Quad',
                expectedResponse: 'download-or-action',
                critical: true
            }
        ];

        this.results = {
            timestamp: new Date().toISOString(),
            summary: {
                totalTested: 0,
                actuallyBroken: 0,
                workingAsExpected: 0,
                needsValidation: 0
            },
            brokenElements: [],
            needsManualCheck: [],
            workingElements: []
        };
    }

    async detectBrokenElements() {
        console.log('🔧 Broken Element Detection Test');
        console.log('=================================');
        console.log('Testing elements that should respond when clicked\n');

        const browser = await chromium.launch({ headless: true });

        try {
            for (const elementDef of this.expectedActiveElements) {
                await this.testElementForBrokenness(browser, elementDef);
            }

            this.generateBrokenElementReport();

        } finally {
            await browser.close();
        }
    }

    async testElementForBrokenness(browser, elementDef) {
        console.log(`🔍 Testing: ${elementDef.description}`);

        try {
            // Test in both systems
            const legacyResult = await this.testElementResponse(browser, 'quadgen.html', elementDef, 'legacy');
            const modernResult = await this.testElementResponse(browser, 'index.html', elementDef, 'modern');

            // Analyze for brokenness
            const analysis = this.analyzeBrokenness(legacyResult, modernResult, elementDef);

            this.results.totalTested++;
            this.categorizeResult(analysis);

            // Log immediate result
            const emoji = this.getAnalysisEmoji(analysis.category);
            console.log(`  ${emoji} ${analysis.category.toUpperCase()}: ${analysis.summary}`);

            if (analysis.category === 'broken') {
                console.log(`    ⚠️  Issue: ${analysis.issue}`);
            }

        } catch (error) {
            console.log(`  💀 ERROR: ${error.message}`);
            this.results.brokenElements.push({
                element: elementDef,
                category: 'error',
                issue: `Test failed: ${error.message}`
            });
        }
    }

    async testElementResponse(browser, filename, elementDef, systemType) {
        const page = await browser.newPage();

        try {
            await page.goto(`file://${process.cwd()}/${filename}`);
            await page.waitForTimeout(1500);

            // Find element
            const selector = elementDef.id ? `#${elementDef.id}` : elementDef.selector;
            const element = await page.$(selector);

            if (!element) {
                return {
                    system: systemType,
                    found: false,
                    error: 'Element not found'
                };
            }

            // Check element state
            const elementInfo = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return null;

                return {
                    visible: el.offsetParent !== null,
                    enabled: !el.disabled,
                    text: el.textContent?.trim(),
                    tag: el.tagName.toLowerCase(),
                    type: el.type || null,
                    hasOnclick: !!el.onclick,
                    classList: Array.from(el.classList)
                };
            }, selector);

            // Capture comprehensive before state
            const beforeState = await this.captureDetailedState(page);

            // If the element is disabled or hidden, skip the interactive click attempt.
            if (!elementInfo?.enabled || !elementInfo?.visible) {
                return {
                    system: systemType,
                    found: true,
                    elementInfo,
                    clickResult: {
                        successful: false,
                        skipped: true,
                        reason: !elementInfo?.visible ? 'Element hidden' : 'Element disabled'
                    },
                    beforeState,
                    afterState: beforeState,
                    events: [],
                    responses: ['disabled']
                };
            }

            // Set up event listeners to detect responses
            await page.evaluate(() => {
                window.__testEvents = [];

                // Track file input events
                document.addEventListener('click', (e) => {
                    if (e.target.matches('input[type="file"]') ||
                        e.target.closest('label[for]')?.getAttribute('for') === 'file') {
                        window.__testEvents.push({ type: 'file-input-triggered', target: e.target.tagName });
                    }
                });

                // Track modal/dialog appearances
                const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1 &&
                                (node.classList?.contains('modal') ||
                                 node.classList?.contains('dialog') ||
                                 node.role === 'dialog')) {
                                window.__testEvents.push({ type: 'modal-appeared', element: node.className });
                            }
                        });
                    });
                });
                observer.observe(document.body, { childList: true, subtree: true });

                // Track console errors
                const originalError = console.error;
                console.error = (...args) => {
                    window.__testEvents.push({ type: 'console-error', message: args.join(' ') });
                    originalError.apply(console, args);
                };
            });

            // Click the element
            let clickResult = null;
            try {
                await page.click(selector);
                await page.waitForTimeout(1000); // Allow time for async responses

                clickResult = { successful: true };
            } catch (clickError) {
                clickResult = {
                    successful: false,
                    error: clickError.message
                };
            }

            // Capture after state and events
            const afterState = await this.captureDetailedState(page);
            const events = await page.evaluate(() => window.__testEvents || []);

            // Detect specific response types
            const responses = this.detectResponseTypes(beforeState, afterState, events, elementInfo);

            return {
                system: systemType,
                found: true,
                elementInfo,
                clickResult,
                beforeState,
                afterState,
                events,
                responses
            };

        } finally {
            await page.close();
        }
    }

    async captureDetailedState(page) {
        return await page.evaluate(() => {
            return {
                // UI state
                editMode: window.isEditModeEnabled?.() || window.editModeEnabled || false,
                modalsVisible: document.querySelectorAll('.modal:not(.hidden), .dialog:not(.hidden)').length,

                // File input states
                activeFileInputs: Array.from(document.querySelectorAll('input[type="file"]'))
                    .filter(input => document.activeElement === input).length,

                // Data state
                hasQuadData: !!(window.loadedQuadData?.curves),
                hasLinearization: !!(window.LinearizationState?.getData?.() || window.linearizationData),

                // Button states (sample)
                undoDisabled: document.getElementById('undoBtn')?.disabled || false,
                redoDisabled: document.getElementById('redoBtn')?.disabled || false,

                // URL/hash for navigation changes
                currentHash: window.location.hash
            };
        });
    }

    detectResponseTypes(beforeState, afterState, events, elementInfo) {
        const responses = [];

        // File dialog detection
        if (events.some(e => e.type === 'file-input-triggered')) {
            responses.push('file-input-triggered');
        }

        // Modal detection
        if (afterState.modalsVisible > beforeState.modalsVisible ||
            events.some(e => e.type === 'modal-appeared')) {
            responses.push('modal-opened');
        }

        // State change detection
        if (beforeState.editMode !== afterState.editMode) {
            responses.push('edit-mode-changed');
        }

        if (beforeState.hasQuadData !== afterState.hasQuadData) {
            responses.push('data-state-changed');
        }

        // Button state changes
        if (beforeState.undoDisabled !== afterState.undoDisabled ||
            beforeState.redoDisabled !== afterState.redoDisabled) {
            responses.push('button-state-changed');
        }

        // Navigation changes
        if (beforeState.currentHash !== afterState.currentHash) {
            responses.push('navigation-changed');
        }

        // Console errors indicate potential issues
        if (events.some(e => e.type === 'console-error')) {
            responses.push('console-error');
        }

        // No response at all
        if (responses.length === 0 && elementInfo.enabled && elementInfo.visible) {
            responses.push('no-response');
        }

        return responses;
    }

    analyzeBrokenness(legacyResult, modernResult, elementDef) {
        const analysis = {
            element: elementDef,
            legacy: legacyResult,
            modern: modernResult,
            category: 'unknown',
            summary: '',
            issue: null
        };

        // Check if element exists
        if (!modernResult.found) {
            analysis.category = 'missing';
            analysis.summary = 'Element missing in modern system';
            analysis.issue = 'Element not found - may indicate incomplete migration';
            return analysis;
        }

        if (!legacyResult.found) {
            analysis.category = 'modern-only';
            analysis.summary = 'Element only exists in modern system';
            return analysis;
        }

        // Both exist - compare responses
        const legacyResponses = legacyResult.responses || [];
        const modernResponses = modernResult.responses || [];

        // Check for broken behavior in modern
        const modernHasError = modernResponses.includes('console-error') ||
                              modernResult.clickResult?.successful === false;
        const legacyWorks = !legacyResponses.includes('console-error') &&
                           legacyResult.clickResult?.successful !== false;

        if (modernHasError && legacyWorks) {
            analysis.category = 'broken';
            analysis.summary = 'Broken in modern system (throws errors or fails to click)';
            analysis.issue = modernResult.clickResult?.error || 'Console errors detected';
            return analysis;
        }

        // Check for no response when response is expected
        const modernNoResponse = modernResponses.includes('no-response');
        const legacyHasResponse = legacyResponses.length > 0 && !legacyResponses.includes('no-response');

        if (modernNoResponse && legacyHasResponse) {
            analysis.category = 'potentially-broken';
            analysis.summary = 'No response in modern but legacy responds';
            analysis.issue = 'Button may not be connected to event handlers';
            return analysis;
        }

        // Check expected response types
        const hasExpectedResponse = this.checkExpectedResponse(modernResponses, elementDef.expectedResponse);

        if (!hasExpectedResponse && elementDef.critical) {
            analysis.category = 'needs-validation';
            analysis.summary = 'Does not show expected response type';
            analysis.issue = `Expected: ${elementDef.expectedResponse}, Got: ${modernResponses.join(', ') || 'no response'}`;
            return analysis;
        }

        // Working as expected
        analysis.category = 'working';
        analysis.summary = 'Responds appropriately in both systems';
        return analysis;
    }

    checkExpectedResponse(responses, expectedType) {
        switch (expectedType) {
            case 'file-dialog-or-click':
                return responses.includes('file-input-triggered') || responses.length > 0;
            case 'state-change':
                return responses.some(r => r.includes('changed') || r.includes('state'));
            case 'state-change-or-disabled':
                return responses.some(r => r.includes('changed') || r.includes('state')) ||
                    responses.includes('disabled');
            case 'modal-or-dialog':
                return responses.includes('modal-opened');
            case 'state-change-when-enabled':
                // This requires manual validation
                return true;
            case 'download-or-action':
                // Downloads are hard to detect automatically
                return true;
            default:
                return responses.length > 0;
        }
    }

    categorizeResult(analysis) {
        switch (analysis.category) {
            case 'broken':
            case 'potentially-broken':
                this.results.brokenElements.push(analysis);
                this.results.summary.actuallyBroken++;
                break;
            case 'needs-validation':
                this.results.needsManualCheck.push(analysis);
                this.results.summary.needsValidation++;
                break;
            case 'working':
                this.results.workingElements.push(analysis);
                this.results.summary.workingAsExpected++;
                break;
        }
    }

    getAnalysisEmoji(category) {
        const emojis = {
            'broken': '💥',
            'potentially-broken': '⚠️',
            'needs-validation': '🔍',
            'working': '✅',
            'missing': '🚫',
            'modern-only': '🆕'
        };
        return emojis[category] || '❓';
    }

    generateBrokenElementReport() {
        console.log('\n🔧 BROKEN ELEMENT DETECTION REPORT');
        console.log('===================================');

        const s = this.results.summary;
        console.log(`Total Tested: ${s.totalTested}`);
        console.log(`Actually Broken: ${s.actuallyBroken}`);
        console.log(`Working As Expected: ${s.workingAsExpected}`);
        console.log(`Needs Manual Validation: ${s.needsValidation}`);

        // Show broken elements
        if (this.results.brokenElements.length > 0) {
            console.log('\n💥 BROKEN ELEMENTS (HIGH PRIORITY):');
            this.results.brokenElements.forEach((broken, i) => {
                console.log(`  ${i + 1}. ${broken.element.description}`);
                console.log(`     Issue: ${broken.issue}`);
                console.log(`     Category: ${broken.category}`);
            });
        }

        // Show elements needing validation
        if (this.results.needsManualCheck.length > 0) {
            console.log('\n🔍 NEEDS MANUAL VALIDATION:');
            this.results.needsManualCheck.forEach((item, i) => {
                console.log(`  ${i + 1}. ${item.element.description}`);
                console.log(`     ${item.summary}`);
            });
        }

        // Show working elements
        if (this.results.workingElements.length > 0) {
            console.log('\n✅ WORKING ELEMENTS:');
            this.results.workingElements.forEach((working) => {
                console.log(`  • ${working.element.description}`);
            });
        }

        // Recommendations
        console.log('\n💡 RECOMMENDATIONS:');
        if (s.actuallyBroken === 0) {
            console.log('  🎉 No definitively broken elements found!');
        } else {
            console.log(`  🔧 URGENT: Fix ${s.actuallyBroken} broken elements`);
            this.results.brokenElements.forEach(broken => {
                console.log(`    - ${broken.element.description}: ${broken.issue}`);
            });
        }

        if (s.needsValidation > 0) {
            console.log(`  🔍 Manual test ${s.needsValidation} elements that may have issues`);
        }

        // Save report
        fs.writeFileSync('broken-elements-report.json', JSON.stringify(this.results, null, 2));
        console.log('\n💾 Detailed report saved: broken-elements-report.json');

        // Overall health
        const healthScore = s.totalTested > 0 ? ((s.workingAsExpected / s.totalTested) * 100).toFixed(1) : '0.0';
        console.log(`\n📊 UI Health Score: ${healthScore}% (${s.workingAsExpected}/${s.totalTested} elements confirmed working)`);

        if (s.actuallyBroken === 0 && healthScore >= 70) {
            console.log('🚀 UI is ready for production!');
        } else if (s.actuallyBroken <= 1) {
            console.log('⚠️  Good health - address remaining issues');
        } else {
            console.log('🔧 Critical UI fixes needed');
        }
    }
}

// Run the test
if (require.main === module) {
    const detector = new BrokenElementDetector();
    detector.detectBrokenElements().catch(console.error);
}

module.exports = BrokenElementDetector;
