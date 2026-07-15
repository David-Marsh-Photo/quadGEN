# quadGEN Guardrails

Safety rules, working codebase policy, and debugging strategy.

## Critical Safety Rules

1. **Never push to GitHub** without explicit user approval in the current task
2. **Never assume a fix works** - Only state something is fixed after verifying through testing
3. **Don't change APP_VERSION** unless explicitly asked
4. **Present a plan** for big changes and ask for approval before implementing

## Working Codebase Policy

### Source Files
- Make app/UI changes in the `src/` directory
- The root `index.html` is build output (generated from `dist/index.html`)
- Do not modify historical variants (`quadgen copy*.html`) unless explicitly requested
- `src/index.template.html` is the source for all builds

### Build Discipline
- **Rebuild immediately** after every source change
- Run `npm run build:agent` right after editing `src/` files
- Call out the refreshed build in your response so user knows the artifact is current

### Documentation Before Code
- Search repository documentation (and embedded comments) before drawing conclusions about code purpose
- Match assumptions to published guidance

## Scope and Complexity Control

- For non-trivial work, declare the intended behavior, allowed files, explicit non-goals, and verification before editing.
- Default review tripwires are 3 production files or 150 net production LOC for a bug fix, and 6 production files or 400 net production LOC for a feature slice. These are prompts to pause and explain, not quality targets.
- Do not add a dependency, abstraction layer, cache, feature flag, compatibility bridge, telemetry path, or persistent setting without a current measured need.
- Prefer deletion and one canonical path. Every migration must have a promotion or removal criterion.
- Keep unrelated discoveries out of the active diff; report them as follow-ups.
- Stop when the requested behavior, required verification, and one diff review are complete.

## Debugging Strategy

### Test-Driven Bug Fixing
1. Reproduce the bug with the smallest reliable existing test or focused command.
2. Add a regression test only when the existing suite does not prove the behavior.
3. Use the lowest stable layer: unit for math/state contracts, integration for module boundaries, and Playwright for real browser workflows.
4. Confirm the reproduction fails for the expected reason, implement the smallest coherent fix, then run focused and required gates.
5. Do not duplicate the same implementation detail across several layers unless each test addresses a distinct risk.

### Visual Bug Diagnosis
- For bugs with visible components, capture screenshots when visual evidence materially helps diagnosis or review.
- Trust user visual evidence first - screenshots often reveal real bugs that unit tests miss
- Test complete user workflows, not isolated functions
- Look for mathematical patterns in wrong outputs (e.g., 70% → 49% suggests double application)
- Trace full data flow from user input to visual display

### When to Escalate
- After 2-3 failed test attempts, provide clear manual test instructions
- Only escalate to manual testing when automated testing is genuinely blocked
- Don't ask user to run diagnostic scripts - run them yourself with the Bash tool
- User's time is precious - every request for manual testing should be justified

## Critical Code Patterns

### PCHIP Interpolation (MANDATORY)
ALL smooth curve generation MUST use PCHIP (Piecewise Cubic Hermite Interpolating Polynomial):
- Never use smoothstep, cosine, Catmull-Rom, or cubic splines for photography curves
- PCHIP prevents overshooting and maintains monotonic curves
- Only exception: Linear interpolation for technical applications

### Smart Curves Scaling
```javascript
// NEVER DO THIS with .quad or Smart Curve data:
const scaleFactor = endValue / maxValue;
curve = curve.map(v => v * scaleFactor); // BUG!

// CORRECT: Use loaded curves with uniform scaling by End relative to baseline
if (window.loadedQuadData?.curves?.[channelName]) {
  const baseline = window.loadedQuadData.baselineEnd?.[channelName] ??
    Math.max(...window.loadedQuadData.curves[channelName]);
  const scale = baseline > 0 ? (endValue / baseline) : 0;
  arr = window.loadedQuadData.curves[channelName].map(v => Math.round(v * scale));
}
```

### Relative/Absolute Conversion
Control points are stored as "relative" percentages but presented as "absolute":
- `relative = (absolute / channelPercent) * 100`
- `absolute = (relative / 100) * channelPercent`
- Relative values can legitimately exceed 100% when channel ink limit < 100%
- Use `Math.max(0, value)` for clamping, NOT `ControlPolicy.clampY(value)`

## Fragile Areas (Proceed with Caution)

### Revert Control State Machine
- Files: `src/js/ui/revert-controls.js`, `src/js/ui/event-handlers.js`
- Risk: Revert must clear Smart/edited/baked state while preserving and re-enabling the loaded measurement; unloading `linearizationData` changes the operation into measurement removal
- Test: After load LAB → scale → edit → revert, verify curves return to the measurement state and the measurement remains applied

### Bell Curve Scaling Interactions
- Files: `src/js/core/bell-width-controller.js`, `src/js/core/bell-shift-controller.js`
- Risk: Bell apex shift + global scaling can reorder Smart-point ordinals unexpectedly
- Test: shift apex → scale globally → verify no point reordering

### Smart Curve Simplification After Edits
- Files: `src/js/curves/smart-curves.js`, `src/js/data/curve-simplification.js`
- Risk: Re-seeding after edits may shift point counts, breaking ordinal mapping

### Auto-Limit Endpoint Rolloff
- Files: `src/js/core/processing-pipeline.js`, `src/js/core/auto-limit-config.js`
- Risk: Curves with natural shallow slopes near endpoints may trigger false positives

## Assistant Behavior Guidelines

- Make reasonable, reversible assumptions when they preserve the requested scope; ask only when a choice would materially change behavior.
- Communicate evidence, decisions, and trade-offs without exposing a private chain of thought.
- Document durable behavior changes proportionately; do not create a document or log merely because a task had a plan.
- Perform one focused self-review, then stop when the agreed acceptance criteria are met.
- Minor UI-only tweaks (simple layout/style adjustments) don't require plan, doc updates, or tests unless explicitly asked
