# Testing Patterns

**Analysis Date:** 2026-01-22

## Test Framework

**Runner:**
- Vitest 3.2.4 - Unit and integration tests
- Playwright 1.55.1 - E2E and browser testing
- Config: `vitest.config.js` and `playwright.config.ts`

**Assertion Library:**
- Vitest built-in assertions (expect, describe, it)
- Playwright assertions (expect from @playwright/test)

**Run Commands:**
```bash
npm run test              # Unit tests via vitest
npm run test:smoke       # Smoke test (default regression gate)
npm run test:e2e         # Full E2E suite
npm run test:history     # History-related Playwright tests
npm run test:scaling:baseline  # Scaling baseline comparisons
```

## Test File Organization

**Location:**
- `tests/` directory at project root
- Unit tests co-located by feature area under `tests/[feature]/`
- E2E tests under `tests/e2e/` (Playwright)
- History tests under `tests/history/` (Playwright with fixtures)
- Lab/LAB-specific tests under `tests/lab/`

**Naming:**
- Unit test files: `*.test.js` (Vitest)
- E2E test files: `*.spec.ts` (Playwright)
- Pattern: `[feature]-[concern].test.js`, e.g., `state-manager.test.js`, `scaling-coordinator.test.js`

**Structure:**
```
tests/
├── core/              # Core logic tests (state-manager, scaling-coordinator)
├── e2e/              # Playwright E2E tests
├── history/          # Playwright history/undo-redo tests
├── lab/              # LAB linearization specific tests
├── ui/               # UI component tests
├── setup/            # Test configuration and shims
├── fixtures/         # Test fixtures and data
├── utils/            # Test helpers (history-helpers, lab-flow)
└── testdata/         # Sample data files (CGATS, LAB files)
```

## Test Structure

**Suite Organization:**
```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ScalingCoordinator', () => {
  let coordinator;

  beforeEach(() => {
    // Setup shared state
    coordinator = new ScalingCoordinator({ ... });
    coordinator.setEnabled(true);
  });

  afterEach(() => {
    // Cleanup
    coordinator.flushQueue('test teardown');
  });

  it('processes a single scale operation through a transaction', async () => {
    const result = await coordinator.scale(80, 'ui');
    expect(result.success).toBe(true);
  });
});
```

**Patterns:**
- `describe()` blocks for logical grouping
- `beforeEach()` for common setup
- `afterEach()` for cleanup/teardown
- `it()` for individual test cases
- Async/await for promise handling

## Mocking

**Framework:** Vitest's `vi` mock utilities

**Patterns:**
```javascript
vi.mock('../../src/js/ui/status-service.js', () => ({
  showStatus: vi.fn()
}));

// For partial mocks with actual imports:
vi.mock('../../src/js/ui/ui-hooks.js', async () => {
  const actual = await vi.importActual('../../src/js/ui/ui-hooks.js');
  return {
    ...actual,
    triggerInkChartUpdate: vi.fn(),
    triggerPreviewUpdate: vi.fn()
  };
});
```

**What to Mock:**
- UI state services: `status-service.js`, `chart-manager.js`
- Chart update triggers: `triggerInkChartUpdate()`, `triggerPreviewUpdate()`
- Telemetry recording: `recordCoordinatorEvent()`
- Format functions used in assertions: `formatScalePercent()`

**What NOT to Mock:**
- Core business logic (state managers, processors)
- Mathematical functions (interpolation, validation)
- Data structures and domain objects
- Keep mocks to infrastructure/UI boundaries only

**Telemetry Recording Mock Pattern:**
```javascript
const telemetryEvents = [];
let telemetryIdCounter = 0;

vi.mock('../../src/js/core/scaling-telemetry.js', () => ({
  recordCoordinatorEvent: vi.fn((event) => {
    telemetryEvents.push(event);
  }),
  getTelemetryBuffer: vi.fn(() => telemetryEvents),
  clearTelemetryBuffer: vi.fn(() => {
    telemetryEvents.length = 0;
  }),
  generateOperationId: vi.fn(() => {
    telemetryIdCounter += 1;
    return `test-op-${telemetryIdCounter}`;
  })
}), { virtual: true });
```

## Fixtures and Factories

**Test Data:**
- Fixture loading pattern in E2E tests:
```javascript
import { loadHistoryFixture } from '../fixtures/history-state.fixture';

test('test with loaded state', async ({ page }) => {
  await loadHistoryFixture(page);
  // Page now has fixture state loaded
});
```

- Sample file loading with file system:
```javascript
import fs from 'node:fs';
import path from 'node:path';

const samplePath = path.resolve(__dirname, '..', 'testdata', 'cgats17_21step_lab.txt');
const contents = fs.readFileSync(samplePath, 'utf8');
const parsed = parseCGATS17(contents, samplePath);
```

**Location:**
- `tests/fixtures/` - Reusable fixture loaders
- `tests/testdata/` - Sample data files (CGATS, LAB, CUBE files)
- Fixtures provide pre-configured DOM/state for E2E tests

## Coverage

**Requirements:** Not enforced, no coverage threshold configured

**View Coverage:**
```bash
# Vitest coverage report
npm run test -- --coverage
```

## Test Types

**Unit Tests:**
- Scope: Individual functions and classes in isolation
- Approach: Mock external dependencies, test pure logic
- Files: `tests/core/*.test.js`, `tests/ui/*.test.js`
- Example: Testing `InputValidator.clampPercent()`, `feature-flags` state getters
- Result shape testing: `{ success: true, message: '...', details: {} }`

**Integration Tests:**
- Scope: State manager with subscriptions, multiple modules together
- Approach: Mock only UI/IO boundaries, keep domain logic real
- Files: `tests/core/state-manager.test.js`, `tests/core/scaling-coordinator.test.js`
- Verifies: Transaction flow, event ordering, state consistency

**E2E Tests:**
- Scope: Full application workflow via Playwright
- Approach: Navigate to page, interact via UI, verify DOM/window state
- Files: `tests/e2e/*.spec.ts`, `tests/history/*.spec.ts`
- Commands: `npm run test:e2e`, `npm run test:history`
- Verify: User workflows like "load LAB → edit mode → bake data"

## Common Patterns

**Async Testing:**
```typescript
// Playwright: Wait for app ready
test('test name', async ({ page }) => {
  await navigateToApp(page);
  await waitForAppReady(page);

  // Wait for specific condition
  await page.waitForFunction(() => {
    const controlPoints = window.ControlPoints?.get?.('MK')?.points;
    return Array.isArray(controlPoints) && controlPoints.length >= 20;
  }, null, { timeout: 15000 });
});
```

```javascript
// Vitest: Async function handling
it('processes scale operation', async () => {
  const result = await coordinator.scale(80, 'ui');
  expect(result.success).toBe(true);
});
```

**Error Testing:**
```javascript
// Expecting errors to be caught
it('validates file format correctly', () => {
  const invalidFile = { name: 'test.exe', size: 1024 };
  const result = validateFile(invalidFile);
  expect(result.valid).toBe(false);
  expect(result.message).toBeTruthy();
});

// Expecting exceptions
it('throws on missing required parameter', () => {
  expect(() => {
    scaleInput = undefined;
    if (!scaleInput) throw new Error('Scale input not found');
  }).toThrow('Scale input not found');
});
```

**DOM Interaction in E2E:**
```typescript
// File input with validation
await page.setInputFiles('#linearizationFile', LAB_FIXTURE);
await page.waitForFunction(() => !!window.linearizationData, null, { timeout: 15000 });

// Click and verify state
await page.click('#editModeToggleBtn');
const result = await page.evaluate(() => ({
  editModeEnabled: window.isEditModeEnabled?.(),
  selectedChannel: window.EDIT?.selectedChannel
}));
expect(result.editModeEnabled).toBe(true);
```

**Screenshot Attachment for Debugging:**
```typescript
const screenshotPath = testInfo.outputPath('smart-baked-status.png');
await page.screenshot({ path: screenshotPath, fullPage: false });
await testInfo.attach('baked-status', { path: screenshotPath, contentType: 'image/png' });
```

## Setup & Configuration

**Vitest Config** (`vitest.config.js`):
```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.js'],
    setupFiles: ['tests/setup/vitest-env-shim.js'],
  },
});
```

**Playwright Config** (`playwright.config.ts`):
```typescript
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: { headless: true },
});
```

**Setup Shim** (`tests/setup/vitest-env-shim.js`):
- Mocks Vite environment variables
- Provides `import.meta.env` shim for Node.js tests
- Intercepts fetch for @vite/env requests

## Test Helpers

**History Flow Helpers** (`tests/utils/history-helpers.ts`):
- `navigateToApp(page)` - Navigate to index.html with file:// URL
- `waitForAppReady(page)` - Wait for initial DOM readiness
- `getHistoryStackCounts(page)` - Query undo/redo stack size

**LAB Flow Helpers** (`tests/e2e/utils/lab-flow.ts`):
- Load LAB/CGATS files and wait for linearization data
- Verify measurement seeding into Smart curves
- Snapshot capture for correction analysis

## Critical Testing Rules

1. **Inspect Before Interact** - Write diagnostic scripts to examine DOM structure before automated interaction
2. **Wait for Readiness** - Use `waitForFunction()` with app-specific conditions, not arbitrary timeouts
3. **Match User Workflow** - Interact via UI (click, file pick) not direct DOM manipulation
4. **One Working Test Beats Many Broken** - Fix broken tests before trying variations
5. **User Time is Precious** - Automated tests should save time, escalate only when truly blocked

---

*Testing analysis: 2026-01-22*
