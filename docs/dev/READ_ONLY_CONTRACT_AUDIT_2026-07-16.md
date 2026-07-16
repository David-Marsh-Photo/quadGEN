# quadGEN Read-Only Contract Audit

Audit date: July 16, 2026

Source: Houston workspace `quadGEN`, session `dev`, session ID `84199578-bdc7-4e8b-96e4-32053ef04c77`, final report event sequence 5490.

> **Post-audit remediation status (July 16, 2026):** Findings 1–3, 5, and 7 are
> resolved for the audited contracts by mandatory PCHIP enforcement, an isolated
> zero-skip history gate, preflight validation that preserves all prior state
> when a correction import is rejected, a deterministic network-free portable
> bundle, and complete dialog behavior for the three remaining audited surfaces.
> Findings 4 and 6 are operationally contained while Lab Tech remains shelved
> and its public Worker route remains disabled. Findings 8–10 remain active.
> Credential rotation is intentionally deferred to a separate session.

All ten compound questions resolve to “No,” though several contain healthy subpaths. The highest-risk confirmed defects are the live cubic interpolation fallback, non-atomic correction imports, dormant history tests, false-success Lab Tech results, and non-atomic Worker quotas.

| # | Contract | Verdict |
|---:|---|---|
| 1 | Mandatory PCHIP everywhere | No |
| 2 | Effective validation gates | No |
| 3 | Atomic correction imports | No; global partial |
| 4 | Lab Tech tool integrity | No |
| 5 | Truly offline deterministic bundle | No; deterministic build only |
| 6 | Worker trust/privacy boundary | No |
| 7 | Remaining modal contract | No |
| 8 | Canonical `.quad` semantics | No |
| 9 | CUBE declaration/domain conformance | No; 3D counts work |
| 10 | Manual L* reversible action | No |

## 1. Live PCHIP contract

Density Solver, CUBE/ACV correction, opt-in active-range correction, and Lab Tech summaries can all use cubic interpolation in the shipped application. The expected `#curveSmoothingMethod` control is absent, so [processing-pipeline.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/core/processing-pipeline.js:4766) and [labtech-summaries.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/ui/labtech-summaries.js:67) fall back to `cubic`.

A monotone five-knot probe produced:

- PCHIP: zero descending steps, exact knots, range `[0,1]`.
- Cubic: 3,281 descending steps over 10,001 evaluations, range `[-0.0759,1.0092]`.
- A representative CUBE path had 29 descending output steps under the shipped default; 187 of 256 samples differed from explicit PCHIP.

Canonical fixed-domain LAB reconstruction and Smart smooth curves do use PCHIP. Technical 3D LUT evaluation deliberately uses trilinear interpolation. Chart, preview, and export all call `make256()`, so they agree with one another, but can agree on the wrong cubic result.

This violates the mandatory policy in [/home/davidmarsh/Dropbox/Photography/quadGEN/.context/data-pipeline.md](/home/davidmarsh/Dropbox/Photography/quadGEN/.context/data-pipeline.md:13).

Focused interpolation tests passed: 4 files, 7 tests. They explicitly pass PCHIP metadata and therefore miss the shipped fallback.

## 2. Validation-gate effectiveness

Discovery is not reproducible or complete:

| Command | Clean-checkout discovery |
|---|---:|
| `npm test` | 74 files / 294 tests |
| `npm run test:smoke` | 1 / 1 |
| `npm run test:e2e:gate` | 4 / 4 |
| `npm run test:e2e` | 63 files / 94 tests |
| `npm run test:history` | 0; exits 1 |

[playwright.config.ts](/home/davidmarsh/Dropbox/Photography/quadGEN/playwright.config.ts:3) restricts discovery to `tests/e2e`, so the history command in [package.json](/home/davidmarsh/Dropbox/Photography/quadGEN/package.json:18) cannot reach `tests/history`.

An isolated temporary configuration ran the 11 Playwright history files successfully: 10 passes and 5 intentional skips. Several unique contracts are therefore dormant, including channel-slider undo, Smart-point undo/redo, per-channel measurement unload/restore, and snapshot pairing. One diagnostic has no assertion, helper/fixture specs are low-value duplicates, and `undo_migration.spec.ts` is entirely skipped. The separate `restore_snapshot_rebase.test.js` is active once under Vitest.

An ignored local [lab-debug-registry.test.js](/home/davidmarsh/Dropbox/Photography/quadGEN/tests/data/lab-debug-registry.test.js:1) raises this workspace to 75 files / 295 tests, while clean CI remains 74 / 294.

## 3. Correction-import validity and atomicity

Global imports are only partially safe. They gate on the truthiness of `parsed.samples`, not validity, finiteness, count, or domain correctness, before mutating state at [event-handlers.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/ui/event-handlers.js:4780). A completely empty import preserves the previous global correction, but a duplicate-point ACV was accepted with 254 non-finite samples and changed state/history/UI.

Per-channel imports are worse:

- “Before” history is captured before parsing.
- Invalid parser results are normalized to `samples: []`.
- State, baselines, maps, and UI are mutated unconditionally.
- The catch path deletes the prior correction rather than restoring it.

In a browser probe, loading an empty per-K file replaced the prior valid correction and increased history from 10 to 12. The existing validator in [linearization-utils.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/data/linearization-utils.js:749) would reject empty/non-finite samples, but neither loader calls it.

**Post-audit remediation:** Both loaders now require explicit parser success and
shared validation before history capture or mutation. Focused browser coverage
proves that a duplicate-anchor ACV and an empty per-channel file preserve the
active correction, curves, baselines, controls, and history while reporting the
rejection. This remediation addresses invalid-file rejection; it does not claim
transactional rollback for an unrelated exception after valid data begins
applying.

## 4. Lab Tech tool/result integrity

The live catalog advertises 68 tools from [ai-functions.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/ai/ai-functions.js:9), while [chat-interface.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/ai/chat-interface.js:487) routes only 20:

- 20 are routed.
- 8 have action methods but no route.
- 40 have neither route nor matching action.

A second, divergent eight-tool catalog remains in [ai-config.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/ai/ai-config.js:27). Its validator checks required-key presence only and is not used by the live router.

Confirmed runtime failures include:

- Missing required percentage silently sets K to 0%.
- `set_channel_end_value` calls a nonexistent validator method.
- The advertised download action expects the wrong `buildFile()` return type.
- Key-point, undo, and history-summary tools are advertised but unrouted.

Most importantly, local tool results are never returned to the provider as `tool_result`. A mocked failed action produced one provider call, top-level `success:true`, `actionsPerformed:true`, and the operator message “Actions completed successfully.” A never-resolving fetch also remains pending indefinitely because there is no request timeout.

Focused existing AI tests passed 4/4, but they do not cover catalog parity, routing, truthful failures, provider roundtrips, or timeouts.

## 5. Portable bundle

The strict answer is no, with two positive qualifications:

- Core offline workflows worked in the exercised probe: initialization, `.quad` import, chart rendering, End/percentage synchronization, and Help.
- Two isolated builds were byte-identical to both committed artifacts.

All four outputs were 1,021,088 bytes with SHA-256:

```text
43e4b119f97d819fc87f715525fe21fd7f1d91cfcb87bf766027bb36c44937f2
```

However, [src/index.template.html](/home/davidmarsh/Dropbox/Photography/quadGEN/src/index.template.html:35) automatically requests `https://cdn.tailwindcss.com`. Denying network produced a console error and loss of Tailwind utility layout. Lab Tech also requires the Worker, although I treated offline Lab Tech as separate from the core calibration workflow.

Template ownership is ambiguous: the build uses `/home/davidmarsh/Dropbox/Photography/quadGEN/src/index.template.html`, while the stale tracked `/home/davidmarsh/Dropbox/Photography/quadGEN/index.template.html` differs by roughly 1,750 diff lines. [/home/davidmarsh/Dropbox/Photography/quadGEN/docs/dev/BUILD_INSTRUCTIONS.md](/home/davidmarsh/Dropbox/Photography/quadGEN/docs/dev/BUILD_INSTRUCTIONS.md:73) also describes template ownership inconsistently.

**Post-audit remediation:** Tailwind now compiles locally from the canonical
template and runtime UI sources, and Vite inlines the generated utilities with
the authored CSS. The smoke gate blocks every HTTP(S) request while checking
initialization, locally generated dynamic utilities, modal/form compatibility,
and desktop/narrow light/dark layout; both tests pass. A side-by-side browser
comparison against the prior CDN build matched all measured geometry,
visibility, spacing, form, border, and theme values. Two consecutive builds
produced identical 1,003,519-byte root and `dist` artifacts with SHA-256
`8dc8c7be11f4059c65ff8ad5bf6213ef13444438135cb268377e058c568fb624`.
The unused root template was removed, leaving `src/index.template.html` as the
sole source. This remediation resolves the shipped quadGEN bundle contract;
standalone repository tools remain outside that artifact.

## 6. AI Worker boundary

The committed [cloudflare-worker.js](/home/davidmarsh/Dropbox/Photography/quadGEN/cloudflare-worker.js:19) does not adequately constrain the boundary:

- Wildcard CORS and no caller authentication.
- Arbitrary model and payload fields forwarded upstream.
- Unknown providers silently route to Anthropic.
- No request-size, token, tool-count, timeout, or in-flight limits.
- Missing KV disables quotas entirely.
- Quota checking and recording are separate non-atomic operations.
- Malformed requests consume quota before validation.
- Raw IPs appear in logs and KV keys; KV retention is 25 hours.
- Complete upstream error bodies are logged.
- No Worker-focused tests or committed deployment manifest exist.

A mock burst of 11 concurrent same-IP requests returned 11 successes while final KV state contained only one timestamp. An arbitrary provider/model payload was also forwarded successfully.

These are committed-code findings only. The deployed Worker, Cloudflare access controls, bindings, WAF rules, and logging retention remain unknown.

## 7. Modal/accessibility contract

Manual L*, Channel Builder, and Intent Help fail the dialog contract:

- None exposes `role="dialog"`, `aria-modal`, or a programmatic name.
- Opening leaves focus on the obscured trigger.
- Forward and reverse Tab escape into the page.
- Manual L* and Channel Builder ignore Escape.
- Intent Help handles Escape but does not restore the opener.
- Clicking a close button leaves focus on that now-hidden button.
- Dynamic validation is not announced through `aria-live` or an alert role.

Scroll locking and basic 390×844 panel fit work. Close controls are only 11–24 px wide, below the 44 px touch-target guidance.

The old [Global Correction popup](/home/davidmarsh/Dropbox/Photography/quadGEN/src/index.template.html:768) is dead markup: it has no opener and its close control is unwired. The former help path now opens Main Help’s workflow tab.

The frontend-design audit contract shaped this check: semantics, focus containment/restoration, close paths, error announcement, touch targets, and desktop/mobile geometry were all exercised.

**Post-audit remediation:** Manual L*, Channel Builder, and Intent Help now
expose named modal semantics, focus their visible close control on entry, contain
forward and reverse Tab navigation, close through Escape, the close control, or
the backdrop, and restore the exact connected opener. Manual L* and both Channel
Builder validation regions expose polite atomic live status semantics. Each
audited close control is 44×44 px with a visible focus treatment. The dead Global
Correction popup and its sample-only wiring, cached state, modal-peer entry, and
theme selector were removed; supported correction guidance remains available
through Main Help's workflow. A 12-case light/dark browser matrix at 390×844 and
1280×900 confirmed initial focus, panel fit, target size, and zero console/page
errors, with visual inspection at narrow light and desktop dark. The focused
browser contract passed 3/3, Vitest passed 297/297, the 100-module build passed,
smoke passed 2/2, the focused gate passed 4/4, history passed 7/7, the full
Playwright inventory passed 100/100, and the pre-commit guard passed 12/12. This
resolves the three surfaces named by Finding 7; it is not a blanket claim about
every overlay in the application.

## 8. Canonical `.quad` parsing

Editable and reference workflows use separate parsers: [file-parsers.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/parsers/file-parsers.js:46) and [quad-parser.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/data/quad-parser.js:15).

Exact headered/headerless 8- and 10-channel files work, and exported files re-import bit-for-bit. But:

- One extra numeric value is silently ignored.
- A complete extra headered channel block is ignored.
- Headerless extra data changes inferred channel count.
- Headerless short/remainder data can become fewer generic channels.
- Trailing non-comment text is accepted with only a warning.
- Reference import adds size and current-printer filtering that editable import lacks.

Export always canonicalizes to the current printer with 256 values per channel, so tolerated trailing imported data is discarded. This does not meet the exact-count contract in [/home/davidmarsh/Dropbox/Photography/quadGEN/docs/File_Specs/QTR_QUAD_SPEC_SUMMARY.md](/home/davidmarsh/Dropbox/Photography/quadGEN/docs/File_Specs/QTR_QUAD_SPEC_SUMMARY.md:14).

## 9. CUBE conformance

Ordinary finite scalar domains work, and 3D LUTs correctly enforce exactly `N³` rows. Identity 3D neutral-axis extraction had a maximum numerical error of `1.665e-16`.

The strict contract still fails:

- A declared 1D size larger than the data is accepted.
- Extra 1D samples are silently truncated.
- Non-finite row components can shift columns and become valid samples.
- Vector domains retain only their first component.
- Equal/invalid scalar domains silently reset to `0..1`.
- 3D rows containing `Infinity` can be accepted and collapsed into plausible finite output.

The relevant parsing branches are in [file-parsers.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/parsers/file-parsers.js:295).

## 10. Manual L* history convergence

Manual L* Apply updates `LinearizationState`, compatibility state, UI, chart, preview, and export in [manual-lstar.js](/home/davidmarsh/Dropbox/Photography/quadGEN/src/js/ui/manual-lstar.js:365), but records no history action and leaves StateManager’s history-visible linearization state stale.

A focused nonlinear browser probe found:

- History remained at zero.
- Undo stayed disabled.
- `undo()` returned “No actions to undo.”
- The applied correction remained after the undo attempt.
- Chart and export agreed after application, but neither reverted.

The existing [manual-lstar-apply.spec.ts](/home/davidmarsh/Dropbox/Photography/quadGEN/tests/e2e/manual-lstar-apply.spec.ts:36) verifies application only.

No repository files, branches, commits, dependencies, deployments, or external systems were changed during the audit. Final `git status` and `git diff` were clean, and root/dist artifacts remained byte-identical. The question set was recovered from Houston workspace `quadGEN`, session `dev`, session ID `84199578-bdc7-4e8b-96e4-32053ef04c77`, event sequence 5390.
