# Implementation Plan: Active-Range Linearization

**Priority**: Critical Bug Fix
**Complexity**: High
**Impact**: All multi-ink .quad linearizations

## Confirmed Problem

quadGEN currently applies linearization using **fixed-domain mapping** (correction at same input position across all channels), but the QTR industry standard (confirmed via POPS Profiler v1.24.xlsx analysis) uses **active-range mapping** (each channel's correction is normalized within its ink-flowing region).

This causes incorrect linearization for delayed-onset channels.

## Implementation Strategy

### Phase 1: Analysis & Preparation

**1.1 Document Current Behavior**
- [x] Analyze current `apply1DLUT()` implementation
- [x] Create test cases showing the bug (DNPRO comparison)
- [x] Document POPS spreadsheet behavior
- [ ] Create baseline test with current quadGEN output

**1.2 Design New Algorithm**
- [ ] Pseudocode for active-range detection
- [ ] Pseudocode for target value calculation
- [ ] Pseudocode for range remapping
- [ ] Edge case handling strategy

### Phase 2: Core Algorithm Implementation

**2.1 Active Range Detection** (`src/js/core/processing-pipeline.js`)

Add new function:
```javascript
/**
 * Detect the active ink range for a channel
 * @param {Array<number>} curve - 256-point curve
 * @returns {Object} { startIndex, endIndex, isActive }
 */
function detectActiveRange(curve) {
    const threshold = 10; // Ignore noise below this value

    let startIndex = -1;
    let endIndex = -1;

    // Find first significant ink
    for (let i = 0; i < curve.length; i++) {
        if (curve[i] > threshold) {
            startIndex = i;
            break;
        }
    }

    // Find last significant ink
    for (let i = curve.length - 1; i >= 0; i--) {
        if (curve[i] > threshold) {
            endIndex = i;
            break;
        }
    }

    return {
        startIndex,
        endIndex,
        isActive: startIndex >= 0 && endIndex >= 0,
        span: endIndex - startIndex + 1
    };
}
```

**2.2 Target Value Calculation**

New function to calculate what each input position SHOULD output after linearization:
```javascript
/**
 * Calculate target output values for linearization
 * @param {number} endValue - Channel end value (0-65535)
 * @param {Function} lutFunction - Linearization LUT interpolation function
 * @param {number} domainMin - LUT domain min (typically 0)
 * @param {number} domainMax - LUT domain max (typically 1)
 * @returns {Array<number>} 256 target values
 */
function calculateLinearizationTargets(endValue, lutFunction, domainMin = 0, domainMax = 1) {
    const targets = new Array(256);
    const domainSpan = domainMax - domainMin;

    for (let i = 0; i < 256; i++) {
        // Input position in 0-1 range
        const inputNormalized = i / 255;

        // Map to LUT domain
        const t = domainMin + inputNormalized * domainSpan;

        // Get correction factor from LUT
        const correctionFactor = clamp01(lutFunction(t));

        // Target output value
        targets[i] = Math.round(correctionFactor * endValue);
    }

    return targets;
}
```

**2.3 Range Remapping**

Core function to redistribute active ink range to match targets:
```javascript
/**
 * Remap channel's active range to match linearization targets
 * @param {Array<number>} baseCurve - Original 256-point curve
 * @param {Array<number>} targets - Target 256-point curve from linearization
 * @param {Object} activeRange - Active range info from detectActiveRange()
 * @returns {Array<number>} Remapped 256-point curve
 */
function remapActiveRange(baseCurve, targets, activeRange) {
    if (!activeRange.isActive) {
        return baseCurve.slice(); // No active range, return unchanged
    }

    const result = new Array(256).fill(0);
    const { startIndex, endIndex } = activeRange;

    // Find where in the target the active range should map to
    // by looking for the first and last significant target values
    const targetRange = detectActiveRange(targets);

    if (!targetRange.isActive) {
        return baseCurve.slice(); // Target has no active range
    }

    // Build mapping from original active indices to target active indices
    // This compresses or expands the active range
    const origSpan = endIndex - startIndex;
    const targetSpan = targetRange.endIndex - targetRange.startIndex;

    for (let i = 0; i < 256; i++) {
        if (i < targetRange.startIndex || i > targetRange.endIndex) {
            result[i] = 0; // Outside active range
        } else {
            // Position within target active range (0-1)
            const targetPos = (i - targetRange.startIndex) / targetSpan;

            // Map to original active range position
            const origIndex = startIndex + Math.round(targetPos * origSpan);
            const origIndexClamped = Math.max(startIndex, Math.min(endIndex, origIndex));

            // Use the base curve value from that position
            // but scale to match target magnitude
            const baseValue = baseCurve[origIndexClamped];
            const baseMax = Math.max(...baseCurve.slice(startIndex, endIndex + 1));
            const targetMax = Math.max(...targets.slice(targetRange.startIndex, targetRange.endIndex + 1));

            if (baseMax > 0) {
                result[i] = Math.round((baseValue / baseMax) * targetMax);
            } else {
                result[i] = targets[i];
            }
        }
    }

    return result;
}
```

**2.4 Modified `apply1DLUT()` Function**

Update the main function to use active-range logic:
```javascript
export function apply1DLUT(values, lutOrData, domainMin = 0, domainMax = 1, maxValue = TOTAL, interpolationType = 'cubic', smoothingPercent = 0) {
    // ... existing setup code ...

    // NEW: Calculate linearization targets based on input position
    const targets = calculateLinearizationTargets(maxValue, interpolationFunction, lutDomainMin, lutDomainMax);

    // NEW: Detect active ranges
    const baseActiveRange = detectActiveRange(values);
    const targetActiveRange = detectActiveRange(targets);

    // NEW: Remap base curve's active range to match targets
    const result = remapActiveRange(values, targets, baseActiveRange);

    return result;
}
```

### Phase 3: Testing & Validation

**3.1 Unit Tests**
- [ ] Test `detectActiveRange()` with various onset patterns
- [ ] Test `calculateLinearizationTargets()` with known LUTs
- [ ] Test `remapActiveRange()` with delayed onset
- [ ] Test `remapActiveRange()` with immediate onset
- [ ] Test edge cases (all zero, all non-zero, single active point)

**3.2 Integration Tests**
- [ ] Compare quadGEN output with DNPRO using test case data
- [ ] Verify K channel onset shifts from 61% → 91% (matches DNPRO)
- [ ] Verify LK channel expansion (matches DNPRO)
- [ ] Verify C channel behavior (matches DNPRO)
- [ ] Test with multiple multi-ink .quads from repository

**3.3 Regression Tests**
- [ ] Verify single-ink .quads still work correctly
- [ ] Verify full-range channels (no delayed onset) unchanged
- [ ] Verify existing Smart Curves integration still works
- [ ] Run full Playwright test suite

### Phase 4: Edge Case Handling

**4.1 Channel States to Handle**
- Disabled channel (all zeros)
- Immediate onset (index 0 or 1)
- Delayed onset (>50% input)
- Late-ending channel (drops to zero before 100%)
- Single active point
- Tiny active range (< 5 indices)

**4.2 Linearization Edge Cases**
- LUT with zero correction
- LUT that inverts (lighter → darker)
- LUT with plateau regions
- Very steep or very shallow LUTs

**4.3 Monotonicity Enforcement**
Add post-processing to ensure output is monotonic:
```javascript
function enforceMonotonic(curve) {
    const result = curve.slice();
    for (let i = 1; i < result.length; i++) {
        if (result[i] < result[i-1]) {
            result[i] = result[i-1]; // No reversals
        }
    }
    return result;
}
```

### Phase 5: Documentation & Cleanup

**5.1 Code Documentation**
- [ ] Add comprehensive JSDoc comments
- [ ] Explain active-range algorithm in detail
- [ ] Document edge case handling
- [ ] Add examples to function headers

**5.2 User Documentation**
- [ ] Update CLAUDE.md with new behavior
- [ ] Add note about POPS compatibility
- [ ] Explain difference from previous version
- [ ] Add troubleshooting section

**5.3 Investigation Archive**
- [ ] Move investigation docs to `docs/archive/linearization-bug-2025-01/`
- [ ] Add summary to CHANGELOG.md
- [ ] Update CLAUDE_RECENT_FIXES.md

## Testing Checklist

### Test Case 1: K Channel Delayed Onset (Primary Bug Case)
- [ ] Load `P800_K37_C26_LK25_V1.quad`
- [ ] Apply `P800_K37_C26_LK25_V1_correction.txt`
- [ ] Verify K channel onset shifts to ~91% input
- [ ] Verify K channel active span compresses to ~24 indices
- [ ] Compare output with `DNPRO.quad` - should match closely

### Test Case 2: Single Ink (Regression Test)
- [ ] Load single-ink .quad
- [ ] Apply linearization
- [ ] Verify output identical to previous quadGEN behavior

### Test Case 3: Multi-Ink Immediate Onset
- [ ] Load .quad with all channels starting at index 0-2
- [ ] Apply linearization
- [ ] Verify expansion/compression as needed

### Test Case 4: Edge Cases
- [ ] All zeros channel
- [ ] Single active point
- [ ] Very small active range (< 5 indices)

## Success Criteria

✅ **Primary Goal**: quadGEN output for `P800_K37_C26_LK25_V1.quad` + correction matches DNPRO output within 5% tolerance

✅ **Secondary Goals**:
- All existing Playwright tests pass
- Single-ink linearization unchanged (regression protection)
- Code well-documented with clear algorithm explanation
- Edge cases handled gracefully

## Estimated Effort

- **Phase 1**: 2 hours (design & pseudocode)
- **Phase 2**: 4 hours (core implementation)
- **Phase 3**: 3 hours (testing & debugging)
- **Phase 4**: 2 hours (edge cases)
- **Phase 5**: 1 hour (documentation)

**Total**: ~12 hours

## Risks & Mitigation

**Risk**: Breaking existing linearization behavior
- **Mitigation**: Comprehensive regression tests before/after

**Risk**: New algorithm introduces banding
- **Mitigation**: Monotonicity enforcement, smoothing post-processing

**Risk**: Performance impact
- **Mitigation**: Algorithm is O(n) with n=256, negligible overhead

**Risk**: Edge cases not fully handled
- **Mitigation**: Extensive test matrix, defensive coding

## Open Questions

1. Should we preserve the OLD behavior as a fallback/option?
   - Pros: Backward compatibility
   - Cons: More complexity, user confusion

2. How to handle very small active ranges (< 3 indices)?
   - Current plan: Treat as disabled channel

3. What if target range is larger than current maximum?
   - Current plan: Clamp to channel's ink limit (endValue)

## Next Steps

1. Get user approval for this implementation plan
2. Begin Phase 1 (design & pseudocode)
3. Implement Phase 2 (core algorithm)
4. Test against DNPRO output
5. Refine until match is within tolerance
