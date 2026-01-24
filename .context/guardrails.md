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

## Debugging Strategy

### Test-Driven Bug Fixing
1. **Always start by building a test** that replicates the bug before attempting any fix
2. Use Playwright scripts to create reproducible test cases
3. Write the test to fail initially (confirming the bug exists)
4. After implementing the fix, verify the test passes
5. This ensures: bug is real, fix works, regression protection exists

### Visual Bug Diagnosis
- **For bugs with visible components**: include screenshots using Playwright's `page.screenshot()`
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
- Risk: Revert must clear `linearizationData = null` completely or LAB data remains active causing scaling artifacts
- Test: After load LAB → scale → revert, verify curves return to baseline not scaled state

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

- Walk through thought process step by step
- Before starting a prompt, ask for any information needed to do a good job
- When a major bug is fixed, ask if user wants it documented
- Minor UI-only tweaks (simple layout/style adjustments) don't require plan, doc updates, or tests unless explicitly asked
