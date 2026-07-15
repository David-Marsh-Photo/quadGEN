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

Status: complete

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

Slice 3B1 result (2026-07-14): implementation complete. The composite overlay, chart flags/selection marker, and debug/weighting option listeners had no controls in the shipped template after the October 2025 tabbed-layout rewrite. Removing that unreachable UI layer deleted about 1,279 net production lines and one bundled module. Normalized TRIFORCE diagnostics remained byte-identical apart from a runtime timestamp; the single-file bundle fell by 25,823 bytes raw and 7,858 bytes gzipped. Focused composite tests passed (28/28). The retained headless snapshot data still participates in slope-kernel locking and solver tests, so capture removal is deferred until that behavior can be separated from presentation telemetry. Slice 3B2 will decide whether to collapse the hidden persisted weighting modes to the documented normalized path.

Slice 3B2 result (2026-07-14): complete. The shipped UI had no weighting control, but an old `quadgen.compositeWeightingMode` browser value could still silently select Equal, Momentum, or Isolated redistribution. The persisted setting, three alternate branches, momentum helper, and mode-only telemetry were removed so every LAB redistribution uses the documented normalized solver. TRIFORCE V4 and P800 fixture curves remained byte-identical across all six active channels. The slice removed 570 net production-source lines, 320 net test lines, eight mode-only tests, and two bundled modules; the clean bundle fell by 8,191 bytes raw and 2,451 bytes gzipped. Focused composite checks (24/24), Vitest (326/326), smoke (1/1), focused E2E (3/3), full E2E (108/108), and the production build passed. Slice 3C will decide the scaling coordinator's canonical path without adding another migration layer.

Slice 3C result (2026-07-14): complete. All shipped Scale-field and Lab Tech requests already used the coordinator even though its enable flag still defaulted off; the flag no longer selected behavior. Historical randomized parity evidence recorded zero endpoint differences across ten coordinator/direct runs, while the core scaler was synchronous and the UI already debounced input. The coordinator was therefore collapsed to one promise-returning, rollback-safe history transaction with the existing refresh behavior. The inert flag, queue/priorities, telemetry module, duplicate direct window bridge, seven diagnostics scripts, and coordinator-vs-direct harnesses were removed. The slice deleted 446 net production-source lines, 1,573 diagnostic-script lines, and 783 net test lines; Vitest moved from 326 to 305 tests and Playwright from 108 to 105 while retaining one Scale-field/resync workflow. The clean bundle lost one module and 7,367 raw / 1,751 gzip bytes. Build, focused scaling checks (29/29), Vitest (305/305), smoke (1/1), focused global-scale E2E (4/4), additional lock/undo checks (7/7), and full E2E (105/105) passed. Slice 3D will assess the separate default-on scaling-state dual-read/write flag and audit scaffolding.

Slice 3D result (2026-07-14): complete. Repository usage showed that the centralized scaling keys were read only by the default-on migration mirror, its UI subscriptions, and its parity tests; endpoint math and baseline restoration still depended on the module-local Scale percent and baseline cache. That existing pair is now canonical. The mirror keys, computed selector, flag/events, audit counters, UI/chart subscriptions, compatibility exports, rollout diagnostics, and comparison-only tests were removed. Existing batch history entries now carry before/after Scale snapshots, so undo and redo restore the canonical percent and cached baselines together with channel endpoints. The slice removed 878 net production-source lines, 1,202 net test lines (including a 292-line diagnostic), seven migration/duplicate browser cases, and one bundled module. The clean bundle fell by 13,443 raw / 3,582 gzip bytes. Focused unit checks (41/41), Vitest in the development workspace (298/298), smoke (1/1), the focused scaling gate (4/4), targeted scaling/history/lock browser checks (10/10), and the full development-workspace Playwright inventory (99/99) passed. A clean intended checkout also passed its build, focused checks, and smoke test.

Build-reproducibility prerequisite (2026-07-14): complete. The broad `data/` ignore rule had omitted ten modules under `src/js/data/` even though tracked code imports them in the shipped application. An explicit source-directory exception now tracks the existing 4,148-line implementation without editing it. A clean staged checkout built a byte-identical bundle and passed smoke; the normal workspace also passed Vitest (334/334), focused E2E (3/3), and full E2E (108/108). Clean-checkout Vitest still has 31 pre-existing failures and the tracked Playwright inventory has 40 failures because tests reference ignored root `data/` measurement fixtures. Fixture provenance and privacy require a separate decision before any are added.

## Checkpoint 4 — Workspace Hygiene and Review

Status: inventory complete; user approval required before archive/delete/ignore actions

Work:

- extract durable findings from raw agent/Aider artifacts
- with user approval, archive raw material outside the repository and add appropriate ignore rules
- compare source LOC, test LOC, E2E files, gate runtime, feature flags, and dual paths with the starting inventory

Exit check:

- no user material is deleted without approval
- retained context is concise and durable
- remaining cleanup is either justified by measured value or explicitly declined

Inventory result (2026-07-14):

- Raw Aider history occupies 15.08 MB and its disposable tag cache another 1.22 MB. None is ignored today.
- `agent-logs/compare/` contains 23 raw multi-agent transcripts totaling 14.46 MB. Five separate curated logs total only 7 KB; two describe shipped behavior, two describe local Claude tooling, and one records this development-session bootstrap.
- The superseded `AGENTS.md.bak` and `CLAUDE.md.bak` files total 66.8 KB and are roughly ten times longer than their current counterparts.
- Nine untracked engineering/domain drafts total 2,425 lines / 95 KB. They should not be bulk-added: the three LAB-correction analyses overlap, the 941-line Channel Builder plan describes an already-built feature, the state-access note references retired cache guidance, and the photogravure workflow needs owner review as domain documentation.
- Ten untracked test/diagnostic source files, one generated 203 KB screenshot, and two scratch helpers add 1,715 text lines. The uppercase-label checks, zoom audit, KCLK plateau browser case, LAB direction diagnostic, and plot-smoothing experiment are presentation checks, diagnostics, or duplicates of retained contracts. The end/percent synchronization and measurement-reseed cases may contain unique behavior and need a focused consolidation review rather than wholesale adoption.
- The ignored root `data/` directory occupies about 632 KB on disk. Tracked tests name 27 fixtures; 22 are locally present (88.8 KB total) and five are missing. This explains the remaining 40 clean-checkout browser failures and is a provenance/privacy decision, not a reason to commit the whole directory.
- Generated `test-results/` output occupies about 519 KB and is already ignored.

Proposed disposition, pending approval:

- retain the two concise shipped-behavior logs; archive the three tooling/session logs outside the repository
- archive raw Aider histories and comparison transcripts outside the repository, delete the reproducible Aider cache, then ignore those local artifact paths
- archive or delete the two superseded instruction backups and scratch helpers
- review draft documentation by topic, extracting only current contracts into existing feature/context documents
- consolidate only the unique end/percent and measurement-reseed assertions at the lowest stable layer; archive the remaining diagnostic and duplicate test material
- decide whether the 22 referenced local measurement fixtures may be published, replaced with synthetic fixtures, or kept private with an explicitly local-only test tier

Measured comparison with the starting commit (`4b84e5c`):

- tracked production JavaScript: 57,117 → 58,033 lines; excluding the 4,148 existing-but-previously-ignored data-pipeline lines recovered for clean builds, remediation removed 3,232 production lines
- tracked test JavaScript/TypeScript: 25,191 → 17,343 lines (−7,848, or 31%)
- tracked test files: 204 → 160; Playwright inventory: 99 files / 159 tests → 61 files / 87 tests
- the full development-workspace browser run fell from about two minutes with 71 failures to 19.4 seconds with 99 passing cases, including 12 still-untracked cases under review

Durable conclusions extracted from the raw audits:

- Do not split large modules, introduce constants/debug frameworks, or deduplicate small helpers merely to improve structural metrics; require a measured defect or change bottleneck.
- The legacy bridge modules still have production callers. Remove a bridge only with a caller inventory and a behavior-complete replacement, not as a naming cleanup.
- Default-on/off runtime branches and diagnostic adapters remain a better deletion target than broad refactoring. The centralized flag module currently defines 12 flags; `compositeClampGuard` has no production reader, while `simpleScalingCorrection` is set by Lab Tech but never read by processing. Those two warrant a focused behavior/API decision before further cleanup.
- Existing feature documents already capture the durable bell-curve, edit-mode, correction, and solver contracts; raw multi-agent outputs are provenance, not runtime context.

Explicitly declined for this checkpoint:

- broad `event-handlers.js` or `chart-manager.js` decomposition without a concrete bug or active change bottleneck
- a new constants, logging, telemetry, fixture-management, or compatibility abstraction
- adding every historical diagnostic as a regression test
- committing the entire local calibration-data directory merely to make all tests hermetic
