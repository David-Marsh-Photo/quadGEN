# Complexity Remediation Roadmap

Status: complete
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

Status: complete

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
- The ignored root `data/` directory occupies about 632 KB on disk. A caller-level audit finds 23 active fixtures there, all locally present (98,940 normalized bytes). The initial literal scan reported 27 paths because it falsely matched six `testdata/` paths and missed two root paths constructed programmatically. The 23 genuinely ignored fixtures explain the clean-checkout missing-file failures and require a provenance/privacy decision rather than committing the whole directory.
- Generated `test-results/` output occupies about 519 KB and is already ignored.

Approved disposition result (2026-07-14):

- User approval was received. Fifty-two source artifacts totaling about 29 MB were moved to `/home/davidmarsh/Dropbox/Photography/quadGEN-archive/2026-07-14-workspace-hygiene/`; a manifest there records the disposition and restoration context.
- The reproducible 1.22 MB Aider tag cache was deleted. Generated Playwright output was deleted after verification. Narrow ignore rules now cover those local histories, caches, backups, comparison transcripts, and one-off helpers without hiding future docs or tests.
- The two concise shipped-behavior logs remain in the repository. Three tooling/session logs, raw comparison transcripts, superseded instruction backups, and scratch helpers were archived.
- The historical Channel Builder plan was distilled into a concise current feature contract. Overlapping LAB/bell drafts, retired state guidance, and the owner-unreviewed photogravure workflow were archived rather than bulk-added.
- Bidirectional End/% synchronization was added to the existing quad ink-limit browser case. Measurement-based Smart reseeding was merged into the existing Edit Mode unit suite and converted from a private quad fixture to synthetic samples. The remaining duplicate, diagnostic, and presentation-only local tests were archived.
- The ignored root `data/` directory was deliberately left untouched. Publication, synthetic replacement, or an explicitly local-only fixture tier remains a separate provenance/privacy decision.

Measured comparison with the starting commit (`4b84e5c`):

- tracked production JavaScript: 57,117 → 58,033 lines; excluding the 4,148 existing-but-previously-ignored data-pipeline lines recovered for clean builds, remediation removed 3,232 production lines
- tracked test JavaScript/TypeScript: 25,191 → 17,395 lines (−7,796, or 31%)
- tracked test files: 204 → 160; Playwright inventory: 99 files / 159 tests → 61 files / 87 tests
- the full active-workspace browser run fell from about two minutes with 71 failures to 18.9 seconds with 87 retained passing cases; 12 untracked cases were archived after consolidation review

Durable conclusions extracted from the raw audits:

- Do not split large modules, introduce constants/debug frameworks, or deduplicate small helpers merely to improve structural metrics; require a measured defect or change bottleneck.
- The legacy bridge modules still have production callers. Remove a bridge only with a caller inventory and a behavior-complete replacement, not as a naming cleanup.
- Default-on/off runtime branches and diagnostic adapters remain a better deletion target than broad refactoring. The centralized flag module now defines ten flags after removing the unread `compositeClampGuard` and `simpleScalingCorrection` entries; Lab Tech's correction-method action now selects the existing canonical persisted preference instead of toggling the no-op flag.
- Existing feature documents already capture the durable bell-curve, edit-mode, correction, and solver contracts; raw multi-agent outputs are provenance, not runtime context.

Focused flag follow-up (2026-07-14): complete. The `compositeClampGuard` adapter had no production reader, and Lab Tech's `simpleScalingCorrection` flag changed no processing decision despite reporting success. Both flag entries and their window/debug/reset machinery were removed. Lab Tech now maps `simple` and `density_solver` onto the existing persisted correction-method preference used by the Options UI. The slice removed 43 net production-source lines and added one 18-line assertion to an existing AI-actions test file. Focused unit checks (6/6), Vitest in the development workspace (299/299), build (103 modules), smoke (1/1), and the focused browser gate (4/4) passed.

Checkpoint 4 verification (2026-07-14): complete. This slice changed no production source. Channel Builder and Edit Mode focused unit checks passed (67/67), the consolidated ink-limit workflow passed (1/1), Vitest passed (296/296), smoke passed (1/1), the focused browser gate passed (4/4), the full retained Playwright inventory passed (87/87 in 18.9 seconds), and the production build completed with 103 modules. Final diff review and whitespace validation passed.

Fixture publication follow-up (2026-07-15): owner approval received. The 23 root fixtures used by retained tests—14 `.quad` files, eight `.txt` measurement files, and one `.cube` LUT totaling 98,940 normalized bytes—are tracked explicitly while the broad `data/` ignore rule continues to protect the other 75 local calibration files from accidental addition. The earlier path discrepancy was the scan error described above, not missing data. This follow-up adds no production code, dependencies, abstractions, or tests.

Clean indexed-checkout verification passed Vitest (295/295) and smoke (1/1). The full Playwright inventory found no missing-fixture errors and passed 84/87; its three remaining deterministic failures also reproduce in a clean committed-code checkout without the owner's pre-existing, unstaged auto-black-default change, while the same focused set passes 4/4 in the working tree containing that change. The behavior change remains separate from this fixture-only commit. One ignored local test under `tests/data/` accounts for the working tree's 296-test Vitest count and was likewise left untouched.

Auto Black opt-in follow-up (2026-07-15): complete. New browser profiles now start with Auto Black Limit OFF, avoiding an implicit curve transformation; an existing stored preference still wins. Current help and user-guide text were updated without rewriting historical release notes, and one assertion was added to the existing smoke case rather than creating another test. A clean indexed checkout passed Vitest (295/295), smoke (1/1), the four previously affected browser cases (4/4), and the full Playwright inventory (87/87 in 18.9 seconds); the 103-module production build also passed.

Scaling diagnostic-noise follow-up (2026-07-15): caller review found three unconditional debug writes and a new stack trace on every global-scale request. Removing those ten diagnostic-only source lines left error reporting and the existing debug registry intact. The focused 12-test output fell from 262 lines / 13,144 bytes to 10 lines / 436 bytes (96.7% fewer bytes); the production bundle fell by 408 raw / 118 gzip bytes. No scaling behavior, test, dependency, flag, or abstraction changed.

Clean verification also exposed that `test:e2e:gate` still ran a 181-line custom measurement-seeding script against an ignored private fixture before reaching its four documented scaling cases. The measurement-seeding contract had already been consolidated into a retained synthetic unit test, so the duplicate script was deleted and the gate now defaults directly to the four `global-scale-*` specs; optional external-runner script arguments remain supported. A clean indexed checkout passed the 103-module build, Vitest (295/295), smoke (1/1), the focused gate (4/4 in 1.8 seconds), and the full Playwright inventory (87/87 in 19.5 seconds).

Hidden highlight-guard follow-up (2026-07-15): complete. Caller inventory found that the default-off `compositeHighlightGuard` had no shipped control, persistence, test caller, or production setter; one solver branch and its console/debug adapters were the entire live surface. Removing them makes normalized density shares canonical across the full ramp without changing default behavior. The timestamp-normalized TRIFORCE composite capture remained byte-identical (SHA-256 `275e49ddeb62f2e5007d6406f10150613f883666a55278db99f0c26f8029b1b9`). The slice removed 30 net production-source lines and reduced the bundle by 523 raw / 137 deterministic gzip bytes. Focused composite checks (17/17), Vitest (296/296), the 103-module build, smoke (1/1), the focused gate (4/4), and the full Playwright inventory (87/87 in 20.3 seconds) passed; no test, dependency, abstraction, or replacement flag was added.

Canonical per-sample ceiling follow-up (2026-07-15): complete. Caller inventory found that the default-on `compositePerSampleCeiling` had no shipped control or persistence, its only test setter redundantly set it on, and its off path was documented as diagnostic-only. Removing the flag, console/debug adapters, dead off branch, and obsolete boolean telemetry makes the buffered coverage clamp an invariant. Normalized captures (timestamps and the intentionally retired boolean omitted) remained byte-identical for TRIFORCE (SHA-256 `568411ba3876a39f79b34e0ea2bce1953ee94f0ae537d360ba058012cde11ad7`) and P800 (SHA-256 `eb9f72d4c83395969e22c06df9bae37f26ac942467a17118e21efd3627784b53`). The slice removed 44 net production-source lines and four redundant test lines, reducing the bundle by 852 raw / 241 deterministic gzip bytes. Focused composite checks (17/17), the targeted ceiling workflow (1/1), Vitest (296/296), the 103-module build, smoke (1/1), the focused gate (4/4), and the full Playwright inventory (87/87 in 18.6 seconds) passed; no test, dependency, abstraction, or replacement flag was added.

Canonical fixed-domain LUT follow-up (2026-07-15): complete. Caller inventory found that the default-off `useLegacyLUTMapping` branch had no UI, persistence, production caller, or test caller; its only external description was a console-toggle listing. Removing the toggle state, setter/getter, unconditional setter log, direct-interpolation branch, and debug registration leaves the existing measurement PCHIP composition and gain-corrected CUBE/ACV paths canonical. A representative capture covering two CUBE inputs, ACV, and LAB remained byte-identical (SHA-256 `2d96e92f372d07be3432bcc833b2fa5bdead371999ad14137731b22708128b7f`). The slice removed 36 net production-source lines and reduced the bundle by 298 raw / 119 deterministic gzip bytes. Focused linearization checks (13/13), targeted CUBE/ACV/LAB browser workflows (3/3), Vitest (296/296), the 103-module build, smoke (1/1), and the full Playwright inventory (87/87 in 20.0 seconds) passed; no interpolation, PCHIP, test, dependency, abstraction, or replacement flag changed.

Canonical Density Solver entry follow-up (2026-07-15): complete. Caller inventory found that `compositeLabRedistribution` defaulted on with no UI or persistence, no production code disabled it, and the only automated setter redundantly enabled it through a one-use helper option. Its off state bypassed the selected Density Solver in favor of legacy per-channel application. Removing the flag, console/debug adapters, reset branch, and redundant E2E option makes composite redistribution invariant whenever Density Solver receives valid LAB data; missing-LAB reset handling and Simple Scaling remain unchanged. Timestamp-normalized TRIFORCE (SHA-256 `f3a50437acbf6d05f64083f4daa20c75e0428a507bc68444232fd1c76a34dd24`) and P800 (SHA-256 `0236e835df2a8c7b312b34271613e80c0090e324141dd9d0391d31e1bba6eeee`) captures remained byte-identical. The slice removed 25 net production-source lines and 11 redundant test-helper lines, reducing the bundle by 487 raw / 128 deterministic gzip bytes. Focused composite checks (17/17), targeted browser workflows (2/2), Vitest (296/296), the 103-module build, smoke (1/1), and the full Playwright inventory (87/87 in 20.1 seconds) passed; no solver math, interpolation, PCHIP, test contract, dependency, abstraction, or replacement flag changed.

Canonical LAB baseline smoothing follow-up (2026-07-15): complete. Caller inventory found that `labBaselineSmoothing` defaulted on with no UI, persistence, or production setter; its only off caller was a legacy flag test, and the composite reader returned widen factor 1 in both branches. Removing the flag, settings proxy, console/debug adapters, reset branch, and dead off-path test makes the documented baseline widen ×1 pass invariant while the visible 0–600% smoothing control and `useBaselineWidenFactor` path remain unchanged. Parser output at both 0% and 300% smoothing remained byte-identical (SHA-256 `cb18f4a496fa97b872e36a383e13185fd9dba2352409629dbf811cf79b442f20`); timestamp-normalized TRIFORCE (SHA-256 `f3a50437acbf6d05f64083f4daa20c75e0428a507bc68444232fd1c76a34dd24`) and P800 (SHA-256 `0236e835df2a8c7b312b34271613e80c0090e324141dd9d0391d31e1bba6eeee`) composite captures also remained byte-identical. The slice removed 35 net production-source lines and 27 redundant test lines, reducing the bundle by 550 raw / 86 deterministic gzip bytes. Focused LAB checks (4/4), the smoothing-control browser workflow (1/1), Vitest (295/295), the 103-module build, smoke (1/1), and the full Playwright inventory (87/87 in 26.5 seconds) passed; no smoothing control, kernel math, normalization, interpolation, PCHIP, dependency, abstraction, or replacement flag changed.

Dormant redistribution smoothing-window follow-up (2026-07-15): complete. Caller inventory found that `redistributionSmoothingWindow` defaulted off with no shipped control, persistence, or test caller; the October 2025 options rewrite had left only a null element handler plus console/debug adapters able to enable its post-allocation share-rewriting branch. Removing the flag/config surface, unreachable solver machinery, synthetic-window telemetry, dead UI state, and two obsolete test mocks leaves ladder order, reserve release, blend caps, the 7% limiter, and the default-on snapshot slope kernel as the canonical handoff controls. Timestamp-normalized captures with only the intentionally retired smoothing fields omitted remained byte-identical for TRIFORCE (SHA-256 `2b9631c78d40fa4a65f2d669b9ff63bfb040aac535ddc88d9fda98afa53cae7d`) and P800 (SHA-256 `64dbaa47d8eb688562ba4864cf12adf50ef9a61e60282713bf8e0ed47d0db75e`). The slice removed 855 net production-source lines and two obsolete test-mock lines, reducing the bundle by 14,935 raw / 4,476 deterministic gzip bytes. Focused composite/UI checks (23/23), targeted Auto Raise and ceiling workflows (3/3), Vitest (295/295), the 103-module build, smoke (1/1), and the full Playwright inventory (87/87 in 20.2 seconds) passed; no allocation, clamp, Auto Raise, slope-kernel, interpolation, PCHIP, dependency, abstraction, or replacement flag changed.

Always-available composite diagnostics follow-up (2026-07-15): complete. Caller inventory found that composite summaries and snapshots were already captured and exposed on every solver run, while the persisted enable switch could not suppress capture or access and its selection, subscription, replay, and duplicate global-cache APIs had no production consumer after the debug panel's removal. Removing those inert layers leaves one in-memory diagnostic state and one capture path while preserving summaries, snapshots, flags, Auto Raise context, slope-kernel inputs, and console access. Timestamp-normalized TRIFORCE (SHA-256 `690d8603f1d1cf3fa804e0061b399cfb0f8bd511978871fd3b555f62d3f560b8`) and P800 (SHA-256 `28bfdc0a4f188575ddcd2bca7ee5dc8e86d38a3269caf4a976cfe3d26225d894`) captures remained byte-identical. The slice removed 289 net production-source lines and 185 net test lines, including one redundant diagnostic case and one excluded, broken private-fixture test, reducing the bundle by 4,392 raw / 1,227 deterministic gzip bytes. Focused diagnostics/solver checks (27/27), Vitest (294/294), the 103-module build, smoke (1/1), the focused gate (4/4), targeted Auto Raise/coverage workflows (3/3), and the full Playwright inventory (87/87 in 19.7 seconds) passed. The separate no-production-caller `analysisOnly` branch remains unchanged for a future caller-audited decision; no solver math, allocation, limits, Auto Raise policy, interpolation, PCHIP, dependency, abstraction, or replacement flag changed.

Explicitly declined for this checkpoint:

- broad `event-handlers.js` or `chart-manager.js` decomposition without a concrete bug or active change bottleneck
- a new constants, logging, telemetry, fixture-management, or compatibility abstraction
- adding every historical diagnostic as a regression test
- committing the entire local calibration-data directory merely to make all tests hermetic
