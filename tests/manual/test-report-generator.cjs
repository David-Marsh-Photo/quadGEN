/**
 * Comprehensive Test Report Generator
 * Aggregates and analyzes all parity test results
 */

const fs = require('fs');
const path = require('path');

class TestReportGenerator {
    constructor() {
        this.reportData = {
            timestamp: new Date().toISOString(),
            summary: {
                totalTests: 0,
                passed: 0,
                failed: 0,
                criticalIssues: [],
                minorIssues: [],
                recommendations: []
            },
            testSuites: {},
            analysis: {}
        };

        this.criticalVariables = [
            'originalData',
            'loadedQuadData',
            'linearizationData',
            'smartCurves',
            'editMode'
        ];
    }

    async generateComprehensiveReport() {
        console.log('📊 Generating Comprehensive Parity Report...');
        console.log('==============================================\n');

        // Collect all test results
        await this.collectTestResults();

        // Analyze findings
        this.analyzeResults();

        // Generate actionable recommendations
        this.generateRecommendations();

        // Output report
        this.outputReport();

        // Save consolidated report
        this.saveConsolidatedReport();
    }

    async collectTestResults() {
        console.log('📁 Collecting test results...');

        const resultFiles = [
            path.join('data-samples', 'critical-vars-default-state.json'),
            path.join('data-samples', 'critical-vars-lab-data-loaded.json'),
            path.join('archives', 'logs', 'originaldata-workflow-report.json'),
            path.join('archives', 'logs', 'parity-test-report.json'),
            path.join('archives', 'logs', 'comprehensive-parity-report.json'),
            path.join('archives', 'logs', 'broken-elements-report.json'),
            path.join('archives', 'logs', 'focused-ui-test-report.json')
        ];

        resultFiles.forEach(filename => {
            if (fs.existsSync(filename)) {
                try {
                    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
                    const suiteName = this.extractSuiteName(filename);
                    this.reportData.testSuites[suiteName] = data;
                    console.log(`  ✓ Loaded: ${filename}`);
                } catch (error) {
                    console.log(`  ❌ Failed to load: ${filename} - ${error.message}`);
                }
            } else {
                console.log(`  ⚠️  Missing: ${filename}`);
            }
        });
    }

    extractSuiteName(filename) {
        return filename
            .replace(/\.json$/, '')
            .replace(/critical-vars-/, '')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    analyzeResults() {
        console.log('🔍 Analyzing test results...');

        let totalTests = 0;
        let passedTests = 0;
        let failedTests = 0;

        // Analyze each test suite
        Object.entries(this.reportData.testSuites).forEach(([suiteName, suiteData]) => {
            const analysis = this.analyzeSuite(suiteName, suiteData);
            this.reportData.analysis[suiteName] = analysis;

            totalTests += analysis.totalTests;
            passedTests += analysis.passedTests;
            failedTests += analysis.failedTests;

            // Collect critical and minor issues
            analysis.issues.forEach(issue => {
                if (this.isCriticalIssue(issue)) {
                    this.reportData.summary.criticalIssues.push({
                        suite: suiteName,
                        issue: issue
                    });
                } else {
                    this.reportData.summary.minorIssues.push({
                        suite: suiteName,
                        issue: issue
                    });
                }
            });
        });

        this.reportData.summary.totalTests = totalTests;
        this.reportData.summary.passed = passedTests;
        this.reportData.summary.failed = failedTests;
        this.reportData.summary.successRate = totalTests > 0 ?
            ((passedTests / totalTests) * 100).toFixed(1) : '0.0';
    }

    analyzeSuite(suiteName, suiteData) {
        const analysis = {
            suiteName,
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            issues: [],
            highlights: []
        };

        // Handle different suite data structures
        if (suiteData.summary) {
            analysis.totalTests = suiteData.summary.total || 0;
            analysis.passedTests = suiteData.summary.passed || 0;
            analysis.failedTests = suiteData.summary.failed || 0;
        }

        if (suiteData.issues) {
            analysis.issues = Array.isArray(suiteData.issues) ? suiteData.issues : [suiteData.issues];
        }

        if (suiteData.differences) {
            analysis.issues.push(...suiteData.differences);
        }

        if (suiteData.tests) {
            const testResults = Array.isArray(suiteData.tests) ? suiteData.tests : Object.values(suiteData.tests);
            testResults.forEach(test => {
                if (test.passed !== undefined) {
                    analysis.totalTests++;
                    if (test.passed) {
                        analysis.passedTests++;
                        analysis.highlights.push(test.name || 'Unnamed test');
                    } else {
                        analysis.failedTests++;
                        analysis.issues.push(test.name || 'Unnamed test failed');
                    }
                }
            });
        }

        return analysis;
    }

    isCriticalIssue(issue) {
        const issueText = typeof issue === 'string' ? issue : JSON.stringify(issue);
        return this.criticalVariables.some(criticalVar =>
            issueText.toLowerCase().includes(criticalVar.toLowerCase())
        );
    }

    generateRecommendations() {
        console.log('💡 Generating recommendations...');

        const recommendations = [];

        // Critical issues recommendations
        if (this.reportData.summary.criticalIssues.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'Critical Issues',
                action: 'Immediate attention required for core functionality',
                details: this.reportData.summary.criticalIssues.map(ci => ci.issue)
            });
        }

        // OriginalData specific recommendations
        const originalDataIssues = this.reportData.summary.criticalIssues
            .filter(issue => JSON.stringify(issue).includes('originalData'));

        if (originalDataIssues.length > 0) {
            recommendations.push({
                priority: 'HIGH',
                category: 'OriginalData Parity',
                action: 'Review LAB data parsing and Smart Curves generation',
                details: ['Check parseLabData function', 'Verify getSmoothingControlPoints', 'Test edit mode initialization']
            });
        }

        // Edit mode recommendations
        const editModeIssues = this.reportData.summary.criticalIssues
            .filter(issue => JSON.stringify(issue).includes('editMode'));

        if (editModeIssues.length > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Edit Mode',
                action: 'Review edit mode state management',
                details: ['Check toggle functionality', 'Verify Smart Curves initialization', 'Test channel selection']
            });
        }

        // Success rate recommendations
        const successRate = parseFloat(this.reportData.summary.successRate);
        if (successRate < 90) {
            recommendations.push({
                priority: 'MEDIUM',
                category: 'Overall Parity',
                action: `Success rate is ${successRate}% - investigate failing tests`,
                details: ['Run individual test suites', 'Compare variable extraction logic', 'Check timing issues']
            });
        } else if (successRate >= 95) {
            recommendations.push({
                priority: 'LOW',
                category: 'Success',
                action: 'Excellent parity achieved - minor cleanup only',
                details: ['Address remaining minor issues', 'Document any acceptable differences']
            });
        }

        this.reportData.summary.recommendations = recommendations;
    }

    outputReport() {
        console.log('\n📋 COMPREHENSIVE PARITY REPORT');
        console.log('================================');
        console.log(`Generated: ${this.reportData.timestamp}`);
        console.log(`Success Rate: ${this.reportData.summary.successRate}%`);
        console.log(`Total Tests: ${this.reportData.summary.totalTests}`);
        console.log(`Passed: ${this.reportData.summary.passed}`);
        console.log(`Failed: ${this.reportData.summary.failed}`);

        // Critical Issues
        if (this.reportData.summary.criticalIssues.length > 0) {
            console.log('\n🚨 CRITICAL ISSUES:');
            this.reportData.summary.criticalIssues.forEach((issue, i) => {
                console.log(`  ${i + 1}. [${issue.suite}] ${issue.issue}`);
            });
        }

        // Minor Issues
        if (this.reportData.summary.minorIssues.length > 0) {
            console.log('\n⚠️  MINOR ISSUES:');
            this.reportData.summary.minorIssues.slice(0, 5).forEach((issue, i) => {
                console.log(`  ${i + 1}. [${issue.suite}] ${issue.issue}`);
            });
            if (this.reportData.summary.minorIssues.length > 5) {
                console.log(`  ... and ${this.reportData.summary.minorIssues.length - 5} more`);
            }
        }

        // Recommendations
        if (this.reportData.summary.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            this.reportData.summary.recommendations.forEach(rec => {
                console.log(`\n  ${rec.priority}: ${rec.category}`);
                console.log(`  Action: ${rec.action}`);
                if (rec.details.length > 0) {
                    console.log(`  Details:`);
                    rec.details.forEach(detail => {
                        console.log(`    • ${detail}`);
                    });
                }
            });
        }

        // Test Suite Breakdown
        console.log('\n📊 TEST SUITE BREAKDOWN:');
        Object.entries(this.reportData.analysis).forEach(([suiteName, analysis]) => {
            const passRate = analysis.totalTests > 0 ?
                ((analysis.passedTests / analysis.totalTests) * 100).toFixed(1) : '0.0';
            const status = passRate >= 90 ? '✅' : passRate >= 70 ? '⚠️' : '❌';
            console.log(`  ${status} ${suiteName}: ${passRate}% (${analysis.passedTests}/${analysis.totalTests})`);
        });
    }

    saveConsolidatedReport() {
        const filename = 'comprehensive-parity-report.json';
        fs.writeFileSync(filename, JSON.stringify(this.reportData, null, 2));
        console.log(`\n💾 Comprehensive report saved: ${filename}`);

        // Also create a summary HTML report
        this.generateHtmlReport();
    }

    generateHtmlReport() {
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>quadGEN Parity Test Report</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 40px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .metric { background: white; padding: 15px; border-radius: 8px; border-left: 4px solid #007AFF; }
        .critical { border-left-color: #FF3B30; }
        .warning { border-left-color: #FF9500; }
        .success { border-left-color: #34C759; }
        .issues { margin-bottom: 30px; }
        .issue-item { padding: 10px; margin: 5px 0; background: #fff3cd; border-radius: 4px; }
        .recommendations { margin-bottom: 30px; }
        .rec-item { padding: 15px; margin: 10px 0; border-radius: 8px; }
        .rec-high { background: #fff5f5; border-left: 4px solid #FF3B30; }
        .rec-medium { background: #fff8e1; border-left: 4px solid #FF9500; }
        .rec-low { background: #f0f9ff; border-left: 4px solid #007AFF; }
    </style>
</head>
<body>
    <div class="header">
        <h1>quadGEN Parity Test Report</h1>
        <p>Generated: ${this.reportData.timestamp}</p>
        <p>Comparing legacy quadgen.html with modular index.html</p>
    </div>

    <div class="summary">
        <div class="metric ${parseFloat(this.reportData.summary.successRate) >= 90 ? 'success' : 'warning'}">
            <h3>Success Rate</h3>
            <div style="font-size: 2em; font-weight: bold;">${this.reportData.summary.successRate}%</div>
        </div>
        <div class="metric">
            <h3>Total Tests</h3>
            <div style="font-size: 2em; font-weight: bold;">${this.reportData.summary.totalTests}</div>
        </div>
        <div class="metric success">
            <h3>Passed</h3>
            <div style="font-size: 2em; font-weight: bold;">${this.reportData.summary.passed}</div>
        </div>
        <div class="metric ${this.reportData.summary.failed > 0 ? 'critical' : 'success'}">
            <h3>Failed</h3>
            <div style="font-size: 2em; font-weight: bold;">${this.reportData.summary.failed}</div>
        </div>
    </div>

    ${this.reportData.summary.criticalIssues.length > 0 ? `
    <div class="issues">
        <h2>🚨 Critical Issues</h2>
        ${this.reportData.summary.criticalIssues.map(issue =>
            `<div class="issue-item"><strong>[${issue.suite}]</strong> ${issue.issue}</div>`
        ).join('')}
    </div>
    ` : ''}

    <div class="recommendations">
        <h2>💡 Recommendations</h2>
        ${this.reportData.summary.recommendations.map(rec => `
            <div class="rec-item rec-${rec.priority.toLowerCase()}">
                <h3>${rec.priority}: ${rec.category}</h3>
                <p><strong>Action:</strong> ${rec.action}</p>
                <ul>
                    ${rec.details.map(detail => `<li>${detail}</li>`).join('')}
                </ul>
            </div>
        `).join('')}
    </div>

    <div>
        <h2>📊 Test Suite Breakdown</h2>
        ${Object.entries(this.reportData.analysis).map(([suiteName, analysis]) => {
            const passRate = analysis.totalTests > 0 ?
                ((analysis.passedTests / analysis.totalTests) * 100).toFixed(1) : '0.0';
            const status = passRate >= 90 ? '✅' : passRate >= 70 ? '⚠️' : '❌';
            return `
                <div class="metric">
                    <h4>${status} ${suiteName}</h4>
                    <p>${passRate}% success rate (${analysis.passedTests}/${analysis.totalTests} tests passed)</p>
                </div>
            `;
        }).join('')}
    </div>
</body>
</html>`;

        fs.writeFileSync('parity-report.html', htmlContent);
        console.log('📄 HTML report saved: parity-report.html');
    }
}

// Run the report generator
if (require.main === module) {
    const generator = new TestReportGenerator();
    generator.generateComprehensiveReport().catch(console.error);
}

module.exports = TestReportGenerator;
