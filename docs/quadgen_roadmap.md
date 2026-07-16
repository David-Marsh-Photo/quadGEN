# quadGEN Development Roadmap

Status: current

Last reviewed: 2026-07-16

quadGEN's roadmap is organized around operator outcomes, calibration fidelity, and
small verified checkpoints. It is not a list of speculative rewrites. Product
direction comes from [PRODUCT.md](../PRODUCT.md), and interface work follows
[DESIGN.md](../DESIGN.md).

## Completed Foundations

### Modular development and portable delivery — Complete

- Application source is organized under `src/` as ES modules.
- Vite and `vite-plugin-singlefile` produce the self-contained browser build.
- `npm run build:agent` rebuilds `dist/index.html` and the root `index.html`.
- The user-facing artifact remains a portable, offline-capable HTML file.

This replaces the original roadmap proposal to introduce a build step.

### Automated verification — Complete

- Vitest covers stable mathematical, parsing, state, and processing contracts.
- Playwright provides a one-test smoke check, a focused browser gate, and the
  complete retained browser inventory.
- `npm run test:history` provides an isolated, zero-skip gate for seven retained
  undo/redo and snapshot-restoration contracts.
- Relevant fixture-backed parity checks protect calibration behavior when
  production paths change.
- The completed
  [complexity-remediation roadmap](plans/complexity-remediation-roadmap.md)
  records the test-baseline, gate, canonical-path, and workspace-hygiene work.

This replaces the original roadmap proposal to introduce an automated test
suite. New tests are added only when they prove a unique supported contract.

### Product and visual contracts — Complete

- [PRODUCT.md](../PRODUCT.md) defines users, purpose, product principles, and the
  WCAG 2.2 AA accessibility baseline.
- [DESIGN.md](../DESIGN.md) defines the light-first “Calibration Bench” visual
  system and its component rules.
- Feature and format documents under `docs/features/` and `docs/File_Specs/`
  remain the durable behavior references.

### State ownership foundation — In use

The application already combines explicit module-owned state, `core/state.js`,
`core/state-manager.js`, and a legacy bridge with active callers. Replacing all
of that with one global object is not a standalone roadmap project. State is
consolidated only when a concrete feature or reproduced defect identifies an
ownership problem, and a bridge is removed only after a caller inventory and a
behavior-complete replacement.

## Current Roadmap

### 1. Release-readiness acceptance — Complete (2026-07-15)

**Outcome:** Confirm that the remediated `main` branch supports the complete
operator loop without a known release blocker.

**Work:**

- exercise the primary flow: create or import curves, ingest measurements,
  choose and apply correction, inspect or edit curves, undo or revert, and
  export the intended `.quad` file
- confirm a clean checkout builds the portable single-file artifact
- run the proportionate automated gates and the relevant checks from
  [manual_tests.md](manual_tests.md)
- align current user guidance, the Unreleased changelog, and version notes with
  behavior found during acceptance
- fix only reproduced blockers in separate bounded checkpoints

**Exit:** The primary flow is accepted, required automated checks pass, the
portable artifact opens correctly, and no known release-blocking discrepancy
remains undocumented.

**Acceptance result:** A composed browser flow imported a three-channel `.quad`,
applied a valid 256-sample LAB correction through Simple Scaling, changed Global
Scale from 100% to 90%, restored both states with one Undo and Redo, and
downloaded a valid 5,879-byte `.quad` containing 2,048 numeric samples without a
browser error. The exercise exposed one blocker: unchanged channel-enabled
refreshes followed the Scale transaction in history, so Undo consumed a no-op.
History now ignores only strict-equal `enabled` writes, keeping the Scale
transaction latest. The failing browser flow and focused unit case were
reproduced before the fix. Focused history checks passed (11/11), Vitest passed
(295/295), the 103-module build passed, smoke passed (1/1), the focused gate
passed (4/4), and the full Playwright inventory passed (93/93 in 18.9 seconds).
The fix adds four production lines and 25 raw / 10 deterministic-gzip bundle
bytes; no state owner, scaling or correction math, interpolation, or PCHIP path
changed.

### 2. Operator clarity and accessibility — Finding-driven

**Outcome:** Consequential calibration choices are visible, understandable, and
operable without a mouse.

**Work when evidence warrants it:**

- repair concrete WCAG 2.2 AA failures in semantics, keyboard operation, focus,
  text or control contrast, and non-color state communication
- keep correction methods and persistent preferences named and explained near
  their controls
- verify affected interfaces in light and dark themes and at the relevant
  narrow layout
- reuse the existing design tokens, native controls, and in-place guidance

This is incremental conformance work, not authorization for a broad visual
redesign or a new component framework.

**Completed slice (2026-07-15): Main Help keyboard contract.** A targeted
technical audit reproduced a WCAG modal failure in the shipped browser artifact:
Help had no dialog semantics, opening left focus on the page behind it, Tab could
escape to the document, and Escape left focus on the hidden close control. Help
now exposes a named modal, moves focus to its close control, contains forward and
reverse tabbing, and restores the actual opener. The regression failed before the
fix and passed afterward at a 390×844 viewport. The same contract passed in light
and dark desktop modes plus narrow light mode, with no browser errors or viewport
overflow. Vitest passed (295/295), the 103-module build passed, smoke passed
(1/1), the focused gate passed (4/4), and the full Playwright inventory passed
(94/94 in 18.8 seconds). The change adds 63 net production lines and 1,169 raw /
369 deterministic-gzip bundle bytes. The remaining audited dialog surfaces were
handled in the next finding-driven slice.

**Completed slice (2026-07-16): Remaining audited dialog contract.** Manual L*,
Channel Builder, and Intent Help now use one bounded focus controller to expose
named modal semantics, focus the visible close control, contain forward and
reverse Tab navigation, close by Escape, close control, or backdrop, and restore
the exact opener. Manual L* and Channel Builder validation regions are polite
atomic live statuses, and all three close controls are 44×44 px with visible
focus treatment. The dead Global Correction popup and its sample-only wiring,
state cache, peer entry, and theme selector were removed. A 12-case browser
matrix and visual review covered light/dark themes at 390×844 and 1280×900 with
no panel overflow or browser errors. The eight touched production source files
remove 18 net lines; the rebuilt artifact shrank 3,862 raw / 822 deterministic-
gzip bytes to 999,657 bytes. The focused dialog contract passed 3/3, Vitest
passed 297/297, the 100-module build passed, smoke passed 2/2, the focused gate
passed 4/4, history passed 7/7, the full Playwright inventory passed 100/100,
and the pre-commit guard passed 12/12. This closes only the three dialog surfaces
named by the audit; other overlays remain finding-driven work.

### 3. Lab Tech assistant — Shelved (2026-07-16)

**Current decision:** Lab Tech is not part of the shipped product. Its tab and
chat controls are removed, the app no longer starts the assistant configuration
or chat runtime, and the public Worker route is disabled. The network-free
programmatic action facade remains because core editing and compatibility callers
still use it; dormant assistant source is retained for possible future work.

**Historical completed slice (2026-07-15):** The Anthropic runtime moved from Claude Sonnet 4.5 to
Claude Sonnet 5. Adaptive thinking is explicitly disabled so the existing
1,000-token limit remains available for concise tool calls and operator guidance;
the request continues to omit `temperature`, `top_p`, and `top_k`. Unused
provider and model constants were removed from the version module, leaving
`AI_CONFIG` as the runtime owner. A request-payload contract failed on the old
model and passed after the migration. A live worker canary returned HTTP 200,
identified Anthropic and `claude-sonnet-5`, and stopped on exactly one
`get_current_state` tool call without executing it. The 103-module build passed,
focused AI checks passed (4/4), Vitest passed (295/295), smoke passed (1/1), the
focused browser gate passed (4/4), and Playwright passed (94/94 in 19.2 seconds).
Production source shrank by six net lines; the portable bundle changed by 25 raw
/ 9 deterministic-gzip bytes. Worker routing, provider selection, prompts, tool
schemas, calibration behavior, interpolation, and PCHIP paths did not change.

Any revival requires a fresh product decision, security and authentication
review, deliberate route re-enablement, current provider validation, and a
non-mutating live canary before the assistant returns to the UI.

### 4. Calibration fidelity and format compatibility — Ongoing

**Outcome:** Imported measurements and curves produce predictable, reversible,
and exportable results across supported formats.

**Rules:**

- preserve PCHIP wherever smooth interpolation is required
- protect monotonicity, endpoints, channel limits, history, and export semantics
- require a format specification and provenance-safe fixture for new parser or
  exporter behavior
- use deterministic or byte-level comparisons when consolidating equivalent
  processing paths
- document user-visible numerical changes before release

**Completed slice (2026-07-16): Mandatory PCHIP enforcement.** The shipped
template has no interpolation selector, so Density Solver, CUBE/ACV correction,
active-range correction, and retained summary paths had silently fallen back to
cubic interpolation. The processing boundary now preserves only explicit Linear
as a technical exception; missing, smooth, legacy Cubic/Catmull, and unknown
labels all converge to PCHIP. The regression failed on the former default and
passed after the fix. Focused correction/solver checks passed (26/26), Vitest
passed (295/295), the 99-module build passed, smoke passed (1/1), and the focused
browser gate passed (4/4).

### 5. State and architecture evolution — Triggered only

**Outcome:** A touched workflow has one understandable owner and no unnecessary
dual path.

**Entry criteria:** A supported feature, reproduced defect, or measured change
bottleneck demonstrates that the current ownership is inadequate.

**Rules:**

- inventory readers, writers, persistence, history, and compatibility callers
  before changing ownership
- migrate one behavior-complete slice at a time
- remove superseded bridges or flags in the same checkpoint when safe
- do not add a state framework, compatibility layer, cache, or telemetry path
  without a current measured need and removal criteria

Session save/load is a future product decision, not justification for a
speculative state rewrite.

### 6. Distribution and documentation integrity — Ongoing

**Outcome:** Source, tests, reference material, and the portable artifact agree.

**Rules:**

- rebuild both generated HTML files whenever source changes affect the bundle
- update the architecture map when module dependencies change
- keep feature documents current rather than treating historical plans as live
- publish only approved calibration fixtures; keep unrelated local process data
  ignored
- record user-facing changes under the Unreleased changelog before a release

## Not Currently Committed

The following require a new user outcome and explicit scope before entering the
roadmap:

- saveable or shareable calibration sessions
- cloud accounts, synchronization, hosted storage, or telemetry
- a framework migration or wholesale state-management rewrite
- a broad interface redesign
- additional correction modes, interpolation systems, or persistent settings

## Checkpoint Contract

Every implementation slice must state its intended behavior, allowed files,
non-goals, and verification before code changes. Work stops after its acceptance
criteria, required checks, documentation, and one final diff review. New work
enters this roadmap only when it advances a documented operator outcome or
repairs a reproduced defect.
