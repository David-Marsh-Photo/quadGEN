#!/usr/bin/env node

/**
 * Main Parity Test Runner
 * Orchestrates all parity tests between legacy quadgen.html and modular index.html
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ParityTestRunner {
    constructor() {
        this.testFiles = [
            path.join('tests', 'manual', 'test-critical-variables.cjs'),
            path.join('tests', 'manual', 'test-originaldata-workflow.cjs'),
            path.join('tests', 'manual', 'test-ui-interactions-focused.cjs'),
            path.join('tests', 'manual', 'test-ui-broken-elements.cjs'),
            path.join('tests', 'manual', 'test-parity-framework.cjs')
        ];

        this.requiredFiles = [
            path.join('archives', 'legacy-singlefile', 'quadgen.html'),
            'index.html',
            'package.json'
        ];

        this.sampleFiles = [
            path.join('data-samples', 'critical-vars-default-state.json')
        ];

        this.testResults = [];
    }

    async runAllTests() {
        console.log('🧪 quadGEN Parity Test Suite');
        console.log('============================');
        console.log('Comparing legacy quadgen.html with modular index.html\n');

        try {
            // Pre-flight checks
            await this.preflightChecks();

            // Install dependencies if needed
            await this.ensureDependencies();

            // Run test suites
            await this.runTestSuites();

            // Generate comprehensive report
            await this.generateFinalReport();

            // Show quick results
            this.showQuickResults();

        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            process.exit(1);
        }
    }

    async preflightChecks() {
        console.log('🔍 Running pre-flight checks...');

        // Check required files exist
        const missingFiles = this.requiredFiles.filter(file => !fs.existsSync(file));
        if (missingFiles.length > 0) {
            throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
        }

        const missingSamples = (this.sampleFiles || []).filter(file => !fs.existsSync(file));
        if (missingSamples.length > 0) {
            throw new Error(`Missing sample data files: ${missingSamples.join(', ')}`);
        }

        // Check test files exist
        const missingTestFiles = this.testFiles.filter(file => !fs.existsSync(file));
        if (missingTestFiles.length > 0) {
            throw new Error(`Missing test files: ${missingTestFiles.join(', ')}`);
        }

        // Check for LAB test data
        const labSearchDirs = ['.', path.join('.', 'data')];
        const labFiles = labSearchDirs.flatMap(dir => {
            try {
                return fs.readdirSync(dir)
                    .filter(f => f.endsWith('.txt') && f.includes('Color-Muse'))
                    .map(f => path.join(dir, f));
            } catch (err) {
                return [];
            }
        });

        if (labFiles.length === 0) {
            console.log('  ⚠️  No LAB test files found (Color-Muse-Data.txt)');
            console.log('     Some tests will require manual data loading');
        } else {
            console.log(`  ✓ Found LAB test file: ${labFiles[0]}`);
        }

        console.log('  ✓ Pre-flight checks passed');
    }

    async ensureDependencies() {
        console.log('📦 Checking dependencies...');

        try {
            // Check if playwright is installed
            execSync('npx playwright --version', { stdio: 'pipe' });
            console.log('  ✓ Playwright available');
        } catch (error) {
            console.log('  📥 Installing Playwright...');
            try {
                execSync('npm install --save-dev playwright', { stdio: 'inherit' });
                execSync('npx playwright install chromium', { stdio: 'inherit' });
                console.log('  ✓ Playwright installed');
            } catch (installError) {
                throw new Error('Failed to install Playwright dependencies');
            }
        }
    }

    async runTestSuites() {
        console.log('\n🚀 Running test suites...');

        for (const testFile of this.testFiles) {
            const displayName = path.basename(testFile);
            console.log(`\n📊 Running ${displayName}...`);

            try {
                const result = await this.runSingleTest(testFile);
                this.testResults.push({
                    testFile: displayName,
                    success: true,
                    output: result,
                    timestamp: new Date().toISOString()
                });
                console.log(`  ✅ ${displayName} completed`);
            } catch (error) {
                console.log(`  ❌ ${displayName} failed: ${error.message}`);
                this.testResults.push({
                    testFile: displayName,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    async runSingleTest(testFile) {
        return new Promise((resolve, reject) => {
            const process = spawn('node', [testFile], {
                stdio: ['inherit', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
                // Show real-time output for immediate feedback
                console.log(data.toString().trim());
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Process exited with code ${code}: ${stderr}`));
                }
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                process.kill();
                reject(new Error('Test timeout after 5 minutes'));
            }, 300000);
        });
    }

    async generateFinalReport() {
        console.log('\n📋 Generating comprehensive report...');

        try {
            const reportGenerator = require('./tests/manual/test-report-generator.cjs');
            const generator = new reportGenerator();
            await generator.generateComprehensiveReport();
        } catch (error) {
            console.log(`  ⚠️  Report generation failed: ${error.message}`);
            console.log('  Individual test results are still available');
        }
    }

    showQuickResults() {
        console.log('\n🎯 QUICK RESULTS SUMMARY');
        console.log('========================');

        const successful = this.testResults.filter(r => r.success).length;
        const total = this.testResults.length;
        const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '0.0';

        console.log(`Test Suites: ${successful}/${total} passed (${successRate}%)`);

        this.testResults.forEach(result => {
            const status = result.success ? '✅' : '❌';
            console.log(`  ${status} ${result.testFile}`);
            if (!result.success) {
                console.log(`     Error: ${result.error}`);
            }
        });

        // Check for generated reports
        const reportFiles = [
            'comprehensive-parity-report.json',
            'parity-report.html',
            'critical-vars-default-state.json',
            'originaldata-workflow-report.json'
        ];

        const availableReports = reportFiles.filter(file => fs.existsSync(file));
        if (availableReports.length > 0) {
            console.log('\n📄 Generated Reports:');
            availableReports.forEach(report => {
                console.log(`  • ${report}`);
            });
        }

        // Next steps
        console.log('\n📝 NEXT STEPS:');
        if (successRate >= 95) {
            console.log('✨ Excellent! Systems show high parity');
            console.log('   • Review parity-report.html for details');
            console.log('   • Address any remaining minor issues');
        } else if (successRate >= 80) {
            console.log('⚠️  Good progress, some issues to address');
            console.log('   • Check comprehensive-parity-report.json');
            console.log('   • Focus on critical issues first');
        } else {
            console.log('🔧 Significant work needed');
            console.log('   • Review individual test outputs');
            console.log('   • Address critical variable differences');
            console.log('   • Re-run tests after fixes');
        }

        console.log('\n🧪 MANUAL TESTING:');
        console.log('For complete verification, perform these manual tests:');
        console.log('1. Load Color-Muse-Data.txt into both systems');
        console.log('2. Enable edit mode and compare Smart Curve ordinals');
        console.log('3. Test the Edit Mode ON → OFF → Load LAB → ON workflow');
        console.log('4. Verify 21 ordinal points appear at measurement locations');
    }
}

// Command line interface
function runCli() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
quadGEN Parity Test Runner

Usage:
  node scripts/test-tools/run-parity-tests.js [options]

Options:
  --help, -h        Show this help message
  --quick, -q       Run only critical variable tests
  --report-only     Generate report from existing test results
  --clean           Remove all test result files

Examples:
  node scripts/test-tools/run-parity-tests.js               # Run all tests
  node scripts/test-tools/run-parity-tests.js --quick       # Quick test only
  node scripts/test-tools/run-parity-tests.js --report-only # Just generate report
        `);
        return;
    }

    if (args.includes('--clean')) {
        console.log('🧹 Cleaning test result files...');
        const cleanFiles = [
            'comprehensive-parity-report.json',
            'parity-report.html',
            'critical-vars-*.json',
            'originaldata-workflow-report.json',
            'parity-test-report.json'
        ];

        cleanFiles.forEach(pattern => {
            if (pattern.includes('*')) {
                const files = fs.readdirSync('.').filter(f =>
                    f.match(pattern.replace('*', '.*')));
                files.forEach(file => {
                    fs.unlinkSync(file);
                    console.log(`  Removed: ${file}`);
                });
            } else if (fs.existsSync(pattern)) {
                fs.unlinkSync(pattern);
                console.log(`  Removed: ${pattern}`);
            }
        });
        console.log('✅ Cleanup complete');
        return;
    }

    if (args.includes('--report-only')) {
        console.log('📊 Generating report from existing test results...');
        const TestReportGenerator = require('./tests/manual/test-report-generator.cjs');
        const generator = new TestReportGenerator();
        generator.generateComprehensiveReport().catch(console.error);
        return;
    }

    if (args.includes('--quick') || args.includes('-q')) {
        console.log('⚡ Running quick parity test...');
        const runner = new ParityTestRunner();
        runner.testFiles = [path.join('tests', 'manual', 'test-critical-variables.cjs')];
        runner.runAllTests().catch(console.error);
        return;
    }

    const runner = new ParityTestRunner();
    runner.runAllTests().catch(console.error);
}

runCli();

export default ParityTestRunner;
