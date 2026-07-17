# quadGEN Testing

Use the smallest reliable test layer that proves the behavior. Tests are maintained code; test count is not a goal.

## Commands

```bash
npm test                # Vitest suite
npm run test:smoke      # Default browser smoke gate
npm run test:history    # Focused history and undo/redo Playwright gate
npm run test:e2e:gate   # Focused global-scaling Playwright gate
npm run test:e2e        # Full retained Playwright suite
```

## Test-Value Check

Add or retain a test only when all are true:

- it would fail for a plausible regression in supported behavior
- it proves a unique contract rather than repeating another test's implementation detail
- it runs at the lowest stable layer that can prove that contract
- its maintenance and runtime cost are proportionate to the risk

Prefer updating an existing test over creating a new file. Delete or merge stale, contradictory, duplicate, or dead-feature tests.

## Layer Selection

- Unit: curve math, conversion rules, reducers, state transitions, serialization, and cache contracts.
- Integration: collaboration between modules where mocking would reproduce the implementation rather than behavior.
- Playwright: shipped browser workflows, DOM wiring, generated bundle behavior, persistence, history, and visual interactions.

Do not use Playwright for a pure function or create a diagnostic script before every browser test. Inspect the DOM when uncertainty makes it useful, and keep temporary diagnostics out of the permanent suite.

## Browser Rules

- Wait for application-specific readiness conditions, not arbitrary timeouts.
- Interact through the same controls and events as a user.
- Assert user-visible state or exported behavior, not incidental DOM structure.
- Capture screenshots when visual evidence materially helps diagnosis or review.
- After 2-3 failed approaches, reassess the premise before adding variants.

## Required Verification

Run focused tests while iterating. After a fix, run the complete Vitest suite and `npm run test:smoke`; run `npm run test:e2e:gate` for affected global-scaling workflows, `npm run test:history` for history capture or restoration changes, and the narrow relevant Playwright spec for other browser workflows. Run `npm run build:agent` after source changes and verify the generated artifact. Use `npm run test:e2e` when changing broad UI infrastructure or auditing the suite.

## Specialized Contracts

- Correction workflow: `tests/e2e/triforce-correction-audit.spec.ts`, using `tests/e2e/utils/lab-flow.ts`.
- Correction import rejection: `tests/e2e/correction-import-atomicity.spec.ts`.
- Composite solver: `tests/lab/composite-density-ladder.test.js` and `tests/lab/composite-negative-ease.test.js`.
- History and undo/redo: the seven retained Playwright contracts under `tests/history/`, run with `npm run test:history`.
- Smooth photography curves must retain PCHIP and monotonicity guarantees.

## Organization

- `tests/core/`: core unit tests
- `tests/lab/`: LAB and correction tests
- `tests/ui/`: UI/module tests
- `tests/e2e/`: Playwright workflows
- `tests/history/`: focused Playwright history contracts plus Vitest snapshot-rebase coverage
