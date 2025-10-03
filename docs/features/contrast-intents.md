# Contrast Intents Specification

## Purpose
- Provide tone-shaping presets and custom targets that redefine the desired output curve without altering measurement ingestion.
- Support creative fine-tuning (gamma, filmic, bespoke curves) while keeping the base linearization pipeline and ink limits intact.

## User-Facing Entry Points
- Global Correction card → `Intent` dropdown (`#contrastIntentSelect`).
- Intent modal (`#contrastIntentModal`) with Presets, Custom sliders, and Paste tabs.
- Lab Tech commands: `set_contrast_intent`, `apply_custom_intent_sliders`, `apply_custom_intent_paste`.

## Core State & Helpers
- State module: `src/js/ui/intent-system.js` (dropdown initialization, enable/disable rules).
- Data helpers: `src/js/core/intent-math.js` (gamma/filmic evaluators), `src/js/core/state.js` (persistence of custom prefs), `src/js/ai/ai-actions.js` (assistant integration).
- Local storage keys: `contrastIntentCustomPrefsV1` (sliders/paste text), `contrastIntentLastCustomId` (session-level recall).

## Expected Behavior
1. **Preset Selection**
   - Dropdown always defaults to Linear on load.
   - Choosing Soft/Hard/Filmic applies the preset instantly and triggers a global correction re-solve against the selected target.
   - Selecting `Custom (saved)` applies the most recent user-defined intent (pasted curve preferred over sliders).

2. **Modal Interactions**
   - Presets tab exposes gamma and filmic controls; `Apply Intent` closes the modal and updates the target function.
   - Custom tab offers gamma and filmic-style sliders; `Apply Sliders` commits the generated curve and stores slider values.
   - Paste tab validates CSV/JSON/CGATS-style inputs on the fly; `Apply Pasted` compiles to a monotone target function with pinned endpoints.
   - `Reset to Linear` reverts to the base target and clears session-specific selections (stored preferences remain).

3. **Correction Pipeline**
   - Measurement ingestion (CIE L*→density, smoothing, interpolation) is unchanged.
   - Target selection injects the chosen intent function `T(t)` into the solver; endpoints remain at 0 and 1.
   - Delta readouts display Δ vs target; exported `.quad` comments and filenames include compact intent tags (e.g., `LIN`, `G085`, `FILM`, `CUST`).

4. **Undo/Redo & History**
   - Every intent change records a history action (`history.recordIntentChange`). Undo restores the prior target, including custom parameters.

5. **Apply Intent to .quad**
   - When no global measurement is active, the Apply button bakes the current target into the plotted `.quad` while respecting ink limits. Switching back to Linear restores the original curve cached on load.

## Edge Cases & Constraints
- Custom data must be monotone and cover [0,1]; parser clamps and interpolates sparse points but rejects invalid ranges.
- Intent selection is disabled when global measurement data is active and a remap would conflict (managed via `updateIntentDropdownState`).
- Applying intents never shifts ink endpoints; use channel End values for black/white point changes.
- Lab Tech commands follow the same guardrails; errors are surfaced via status toasts.

## Testing
- Playwright regression: `tests/e2e/intent-presets.spec.ts` (future addition) should cover preset application, custom slider persistence, and paste validation.
- Manual matrix: `docs/manual_tests.md` → Contrast Intent section (dropdown enable/disable, undo behavior, filename tags).

## Debugging Aids
- Dev helpers exposed via `registerDebugNamespace('intentSystem', …)`; inspect with `window.__quadDebug.intentSystem`.
- Enable `DEBUG_LOGS` to trace preset initialization, dropdown guards, and modal apply events.

## References
- Math utilities: `src/js/core/intent-math.js`.
- UI wiring: `src/js/ui/intent-system.js`, `src/js/ui/help-content-data.js` (release notes).
- Assistant commands: `src/js/ai/ai-actions.js`, `src/js/ai/ai-functions.js`.
