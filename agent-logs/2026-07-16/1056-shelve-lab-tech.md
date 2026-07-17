# Shelve Lab Tech

## Context

Lab Tech was removed from the shipped product while preserving its dormant
implementation for a possible future revival. Credential rotation was explicitly
deferred to a separate session.

## Decisions and changes

- Removed the Lab Tech tab, console, prompt, and controls from the source template.
- Detached AI configuration, chat-interface, and chat-UI startup imports and
  their compatibility globals from `src/main.js`.
- Retained `createQuadGenActions()` because core editing and compatibility callers
  use this network-free facade; retained dormant assistant source and unit tests.
- Disabled Cloudflare production Worker URL; preview URLs were already disabled.
  The public hostname now returns Cloudflare `404` / error `1042`.
- Preserved Worker source, deployment history, bindings, and credentials.
- Updated current-facing help, roadmap, architecture, changelog, and developer
  context. Historical release notes remain unchanged.

## Verification

- `npm run build:agent` — passed; bundle changed from 103 to 99 modules.
- Focused Playwright assistant/panel checks — 12/12 passed.
- `npm test -- --run` — 75 files, 295 tests passed.
- `npm run test:smoke` — 1/1 passed.
- Built artifacts contain no Lab Tech tab/panel IDs or Worker hostname.
- Desktop screenshot review confirmed the two-tab Channels / `.QUAD Preview`
  layout without an empty placeholder.
- `git diff --check` — passed.

## Revival gate

A future revival requires an explicit product decision, security and authentication
review, provider validation, deliberate route re-enablement, and a non-mutating
live canary before the assistant is restored to the UI.

## Follow-on: mandatory PCHIP remediation

- Reproduced the missing-selector fallback with `ImageAdjustment.cube`; omitted
  interpolation differed from PCHIP and introduced descending output steps.
- Made the processing boundary map every smooth, missing, legacy, or unknown
  label to PCHIP; explicit Linear remains the sole technical exception.
- Aligned Density Solver, generated-entry, retained-summary, and debug defaults.
- Verification: focused correction/solver 26/26, Vitest 295/295, build 99 modules,
  smoke 1/1, and focused browser gate 4/4 passed.

## Follow-on: atomic invalid-import rejection

- Global/per-channel preflight now preserves prior state; focused 2/2, Vitest
  297/297, history 7/7, and full Playwright 96/96 passed.
