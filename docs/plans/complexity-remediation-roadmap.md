# Complexity Remediation Roadmap

Status: active
Started: 2026-07-14
Goal: restore trustworthy verification and reduce unnecessary code, tests, dual paths, and generated context without changing supported calibration behavior.

## Operating Rules

- Work in checkpointed, behavior-complete slices.
- Declare allowed files, non-goals, and verification before each slice.
- Prefer deletion or consolidation; do not set LOC or test-count growth targets.
- Pause before adding a dependency, abstraction, cache, feature flag, compatibility bridge, telemetry path, or persistent setting.
- Preserve PCHIP, numerical semantics, user data, and existing working-tree changes.
- Finish one verification and diff-review pass, record follow-ups, then stop.

## Checkpoint 0 — Working Contract

Status: complete

Deliverables:

- add anti-bloat defaults to the quadGEN Builder identity
- add scope and change-budget rules to repo and shared agent guidance
- make testing and logging guidance truthful and proportionate

Exit check:

- guidance is concise, non-duplicative, and adds no new process machinery

## Checkpoint 1 — Honest Unit Baseline

Status: complete

Budget:

- existing shared Vitest setup and the seven failing test files
- production pipeline code only if a focused reproduction proves a product defect
- no dependencies, abstractions, feature flags, diagnostic scripts, or new test files
- no increase in total test count; prefer net-negative test LOC

Work:

- supply the missing animation-frame test primitive
- repair or remove the brittle full-module UI mock
- align correction/LUT assertions with the current gain-based PCHIP contract
- isolate composite state and determine whether the `make256` cache causes a real product defect

Exit check:

- all retained Vitest tests pass
- smoke and the focused E2E gate pass
- source is rebuilt if production code changes
- diff remains within the bug-fix tripwire or has an explicit exception

Result (2026-07-14): 334/334 retained Vitest tests, smoke 1/1, and focused E2E 3/3 passed. Production changed by one net line; the redundant mocked UI suite was removed for a net reduction of 328 test lines.

## Checkpoint 2 — Truthful Test Gates

Status: complete

Work:

- give the focused E2E gate and full Playwright inventory unambiguous command names
- run the full inventory and classify failures as active contract, stale contract, or dead feature
- merge or delete duplicate and absent-UI tests

Exit check:

- every retained E2E file maps to a supported user workflow
- command names accurately describe coverage
- test runtime and file count are recorded; no arbitrary coverage target is introduced

Result (2026-07-14): `test:e2e` now runs the full retained Playwright suite and `test:e2e:gate` names the focused gate. The inventory moved from 99 files / 159 tests (88 passed, 71 failed, about 2 minutes) to 72 files / 108 tests (108 passed in 41.8 seconds). Dead UI experiments, stale contracts, hard-coded diagnostics, and duplicate workflows were deleted or consolidated for a net reduction of 5,213 E2E/helper lines. The focused E2E gate, smoke test, 334-test Vitest suite, and build also passed. One retained export workflow exposed and received a one-line filename-selector fix.

## Checkpoint 3 — Canonical Production Paths

Status: active

Work:

- benchmark and preferably delete the incomplete `make256` cache
- remove dormant composite modes/debug capture unless they are confirmed product surface
- promote or remove the default-off scaling coordinator, then delete the dual path and migration scaffolding

Exit check:

- one canonical path per retained behavior
- no migration flag without a concrete removal criterion
- behavior and export contracts remain green
- net production and test LOC do not increase

Slice 3A result (2026-07-14): complete. The `make256` memoization cache and its invalidation bridge were removed after an uncached LAB benchmark measured 1.74 ms for the real three-channel workload and 2.09 ms for a synthetic ten-channel pass. The cache-free bundle measured 0.90 ms and 2.38 ms respectively, kept deterministic output, and removed 61 net production lines plus two test lines. Focused tests (19/19), Vitest (334/334), smoke (1/1), focused E2E (3/3), full E2E (108/108), and the production build passed. Slice 3B will assess dormant composite modes and debug capture without changing the supported solver behavior.

## Checkpoint 4 — Workspace Hygiene and Review

Status: queued

Work:

- extract durable findings from raw agent/Aider artifacts
- with user approval, archive raw material outside the repository and add appropriate ignore rules
- compare source LOC, test LOC, E2E files, gate runtime, feature flags, and dual paths with the starting inventory

Exit check:

- no user material is deleted without approval
- retained context is concise and durable
- remaining cleanup is either justified by measured value or explicitly declined
