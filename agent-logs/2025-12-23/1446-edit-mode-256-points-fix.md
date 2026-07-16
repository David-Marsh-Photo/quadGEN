# Context
Fixed bug where entering edit mode with the default linear ramp created 256 key points instead of just 2 (start and end).

# Problem
When enabling edit mode on a fresh app state with no .quad file loaded, the status showed "Smart Curve (256 key points)" instead of the expected 2 points for a simple linear ramp.

# Root Cause
`deriveSeedPointsFromSamples()` in `src/js/ui/edit-mode.js` had fallback logic that actively tried to generate more points when ≤2 were returned:
1. `extractAdaptiveKeyPointsFromValues()` correctly detected linear ramp → returned 2 points
2. Code considered ≤2 points "insufficient" and retried with tighter tolerance
3. Fell back to `buildInflectionPointsFromSamples()` which created ~255 points (one per sample value change)

# Changes Made
- `src/js/ui/edit-mode.js`: Added `isSampleApproximatelyLinear()` check in `deriveSeedPointsFromSamples()` to skip fallback logic when samples represent a linear ramp
- `src/js/ui/edit-mode.js`: Fixed a pre-existing undefined `options` reference in `seedChannelFromSamples()` that affected quad loading into Edit Mode

# Commands Run
- `npm run build:agent` - Build succeeded
- `npm run test:smoke` - 1/1 passed

# Verification
- Before fix: "→ Smart Curve (256 key points)"
- After fix: "→ Smart Curve (2 key points)"
- Verified via Claude in Chrome browser automation with screenshots

# Files Modified
- `src/js/ui/edit-mode.js`
