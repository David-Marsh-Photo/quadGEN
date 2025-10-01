# quadGEN Parity Testing Framework

A comprehensive Playwright-based testing framework to ensure the modular `index.html` system matches the legacy `quadgen.html` functionality.

## Overview

This framework compares internal variables and state between the two systems after loading identical data, ensuring complete functional parity.

## Quick Start

```bash
# Run all parity tests
node scripts/test-tools/run-parity-tests.js

# Quick test (critical variables only)
node scripts/test-tools/run-parity-tests.js --quick

# Generate report from existing results
node scripts/test-tools/run-parity-tests.js --report-only

# Clean all test files
node scripts/test-tools/run-parity-tests.js --clean
```

## Test Components

### 1. Main Test Runner (`scripts/test-tools/run-parity-tests.js`)
- Orchestrates all test suites
- Handles dependency installation
- Generates final reports
- Provides command-line interface

### 2. Critical Variables Test (`test-critical-variables.js`)
- Tests core variables: `originalData`, `loadedQuadData`, `linearizationData`
- Compares edit mode state and Smart Curves
- Validates channel configuration
- Quick 2-3 minute runtime

### 3. OriginalData Workflow Test (`test-originaldata-workflow.js`)
- Focuses on LAB data → Smart Curves workflow
- Tests the edit mode toggle sequence that was recently fixed
- Validates function availability
- Specific to the ordinal positioning issue

### 4. Comprehensive Framework (`test-parity-framework.js`)
- Deep comparison of all system variables
- Extensible architecture for future tests
- Detailed difference reporting
- Production-ready test suite

### 5. Report Generator (`test-report-generator.js`)
- Aggregates results from all test suites
- Generates HTML and JSON reports
- Provides actionable recommendations
- Categorizes issues by priority

## Generated Reports

After running tests, you'll get:

- **`parity-report.html`** - Visual dashboard with metrics and recommendations
- **`comprehensive-parity-report.json`** - Detailed JSON data for analysis
- **`critical-vars-*.json`** - Individual test suite results
- **`originaldata-workflow-report.json`** - Workflow-specific findings

## Test Scenarios

### Automated Tests
- Default state comparison
- Function availability checks
- Variable structure validation
- Edit mode state management

### Manual Tests (Required)
1. Load `Color-Muse-Data.txt` into both systems
2. Enable edit mode and compare ordinal counts
3. Test the workflow: Edit ON → OFF → Load LAB → ON
4. Verify 21 ordinals appear at measurement points (not clustered)

## Understanding Results

### Success Rates
- **95%+** - Excellent parity, minor cleanup only
- **80-94%** - Good progress, address critical issues
- **<80%** - Significant work needed

### Issue Categories
- **Critical** - Core functionality differences (originalData, Smart Curves)
- **Minor** - UI or display differences that don't affect functionality

### Recommendations
The framework generates specific action items based on findings:
- **HIGH** priority - Immediate attention required
- **MEDIUM** priority - Should be addressed soon
- **LOW** priority - Nice to have improvements

## Dependencies

The framework automatically installs required dependencies:
- `playwright` - Browser automation
- `chromium` - Browser engine

## Test Helpers

The project includes `test-helpers.js` with utility functions for reliable Playwright tests:
- `createStablePage()` - Initialize page with disabled animations
- `loadQuadGen()` - Load app and wait for proper initialization
- `clickWhenReady()` - Safely click elements with proper waits
- `setChannelPercent()` - Set channel values programmatically
- `getButtonState()` - Check button state without timing issues

See `playwright-timeout-fixes.md` for best practices on avoiding timeout errors.

## File Structure

```
quadGEN/
├── run-parity-tests.js              # Main test runner
├── test-critical-variables.js       # Core variable tests
├── test-originaldata-workflow.js    # Workflow-specific tests
├── test-parity-framework.js         # Comprehensive framework
├── test-report-generator.js         # Report generation
├── test-helpers.js                  # Reusable Playwright utilities
├── playwright-timeout-fixes.md      # Best practices guide
├── parity-report.html              # Generated HTML report
├── comprehensive-parity-report.json # Generated JSON report
└── TESTING-FRAMEWORK-README.md     # This file
```

## Development Workflow

1. **Run tests** - `node scripts/test-tools/run-parity-tests.js`
2. **Review reports** - Open `parity-report.html` in browser
3. **Address issues** - Focus on critical issues first
4. **Re-test** - Run tests again to verify fixes
5. **Document** - Update `CHANGELOG.md` with fixes

## Troubleshooting

### Common Issues

**"Missing required files"**
- Ensure `index.html` exists (legacy `quadgen.html` snapshots now live under `archives/legacy-singlefile/` when parity investigation is required)
- Check that `package.json` is present

**"Playwright installation failed"**
- Run manually: `npm install --save-dev playwright`
- Install browser: `npx playwright install chromium`

**"Test timeout"**
- Check browser console for JavaScript errors
- Verify files load correctly in browser
- Increase timeout in test files if needed

### Manual Debugging

If automated tests fail, debug manually:

```javascript
// In browser console (both systems)
console.log('originalData:', window.originalData);
console.log('loadedQuadData:', window.loadedQuadData);
console.log('editMode:', window.isEditModeEnabled?.());
console.log('smartCurves:', window.ControlPoints?.getAll());
```

### Avoiding Playwright Timeouts

Common timeout issues and solutions:

1. **Button not clickable** - Use `clickWhenReady()` helper or wait for proper state
2. **Disabled buttons** - Use `{ force: true }` or `clickDisabledButton()` helper
3. **Race conditions** - Wait for `networkidle` instead of arbitrary timeouts
4. **Animations** - Use `createStablePage()` to disable CSS transitions

See `playwright-timeout-fixes.md` for comprehensive troubleshooting guide.

## Extending Tests

To add new test scenarios:

1. Create new test file: `test-your-feature.js`
2. Follow existing patterns for variable extraction
3. Add to `testFiles` array in `run-parity-tests.js`
4. Update report generator to handle new result format

## Integration with Development

This framework is designed to be run:
- **After major changes** - Verify no regressions
- **Before releases** - Ensure complete parity
- **During debugging** - Isolate differences between systems
- **For validation** - Confirm bug fixes work correctly

The testing framework validates the recently implemented originalData parity work and will catch any future regressions in the LAB data → Smart Curves workflow.
