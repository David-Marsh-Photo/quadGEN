# quadGEN Testing

Playwright patterns, smoke tests, E2E testing, and visual diagnosis.

## Quick Reference

```bash
# Smoke test (default regression gate)
npm run test:smoke

# Full E2E suite
npm run test:e2e

# Unit tests
npm run test
```

## Browser Testing Strategy

**Primary Method**: Playwright via Node.js scripts for all automated checks

**Installation**:
```bash
npm install --save-dev playwright && npx playwright install chromium
```

## Critical Playwright Rules

### 1. Inspect Before Interact
ALWAYS create a diagnostic script FIRST to examine actual DOM structure:
- Check what elements exist, their visibility, their structure
- Don't assume elements are accessible just because they exist in HTML
- Example: Check if inputs are invisible/disabled by default
- Use Bash tool to run diagnostic scripts yourself - don't ask user

### 2. Wait for Initialization Properly
Use `page.waitForFunction()` for app-specific readiness conditions:
- Wait for specific elements to exist AND be in expected state
- Check for app-specific markers (e.g., `_virtualCheckbox`, fully rendered rows)
- Don't use arbitrary timeouts

### 3. Match User Workflow
Interact with UI exactly as a user would:
- Use checkboxes, buttons, file pickers - not direct DOM manipulation
- Dispatch events the way the app expects them
- Respect virtual/proxy patterns (e.g., `_virtualCheckbox`)

### 4. One Working Test Beats Many Broken Ones
If a test fails, FIX IT before trying variations:
- Understand WHY it failed by examining DOM with a diagnostic script
- Don't create 10 similar tests hoping one will work

### 5. Better Error Messages
When elements aren't found, log what WAS found to help diagnose.

### 6. Know When to Escalate
After 2-3 failed test attempts:
- Provide clear manual test instructions
- Only escalate when automated testing is genuinely blocked
- Don't ask user to run diagnostic scripts - run them yourself

### 7. User's Time is Precious
Automated tests should save time, not waste it.

## Test Patterns

### Edit Mode State Check
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://\$PWD/index.html');
  await page.waitForTimeout(1000);
  const result = await page.evaluate(() => ({
    editModeEnabled: window.isEditModeEnabled?.(),
    panelDisabled: document.getElementById('editPanelBody')?.classList.contains('edit-panel-disabled')
  }));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
"
```

### Toggle Edit Mode and Verify
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://\$PWD/index.html');
  await page.waitForTimeout(1000);
  await page.click('#editModeToggleBtn');
  await page.waitForTimeout(500);
  const result = await page.evaluate(() => ({
    editMode: window.isEditModeEnabled?.(),
    panelDisabled: document.getElementById('editPanelBody')?.classList.contains('edit-panel-disabled'),
    selectedChannel: window.EDIT?.selectedChannel
  }));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
"
```

### Channel State Check
```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file://\$PWD/index.html');
  await page.waitForTimeout(1000);
  const channels = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-channel]');
    return Array.from(rows).map(row => ({
      channel: row.dataset.channel,
      percent: row.querySelector('.percent-input')?.value,
      end: row.querySelector('.end-input')?.value
    }));
  });
  console.log(JSON.stringify(channels, null, 2));
  await browser.close();
})();
"
```

## Specialized Test Harnesses

### Correction Analysis
For full correction analysis (e.g., loading LAB data and reviewing redistribution):
```bash
npx playwright test tests/e2e/triforce-correction-audit.spec.ts
```
Uses `tests/e2e/utils/lab-flow.ts` for snapshot capture.

### Composite Density Solver
Guards in `tests/lab/composite-density-ladder.test.js` and `tests/lab/composite-negative-ease.test.js` ensure solver behavior. Keep these tests green when touching the solver.

## Visual Bug Diagnosis

### Principles
- Trust user visual evidence first
- Screenshots often reveal real bugs that unit tests miss
- Test complete user workflows, not isolated functions
- Look for mathematical patterns in wrong outputs

### Pattern Recognition
| Symptom | Likely Cause |
|---------|-------------|
| 70% → 49% | Double application (70% × 70%) |
| Curve reverts to ramp | Per-channel guard skipping incorrectly |
| Scaling artifacts after revert | LAB data not fully cleared |

## Test File Organization

- `tests/e2e/` - End-to-end Playwright tests
- `tests/core/` - Unit tests for core modules
- `tests/lab/` - LAB/correction specific tests
- `tests/ui/` - UI component tests

## Performance Notes

- Shell Playwright is much faster than MCP (no snapshot overhead)
- Save common test patterns as `test-*.js` files in project root
- All `window.*` functions and console commands available in scripts
