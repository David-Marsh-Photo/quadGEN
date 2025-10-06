# LAB Linearization Bug Investigation - Complete Documentation

**Investigation Date**: January 4, 2025
**Status**: ✅ Root cause identified, solution confirmed
**Priority**: Critical - Affects all multi-ink .quad linearizations

## Executive Summary

quadGEN applies LAB linearization using **fixed-domain mapping** (same input position → same correction across all channels), but the QTR industry standard uses **active-range mapping** (each channel's correction normalized within its ink-flowing region).

This bug causes **incorrect linearization** for multi-ink .quad files where channels have delayed ink onset.

## Evidence

### 1. DNPRO Comparison
Industry-standard tool DNPRO produces significantly different output:
- K channel (delayed onset at 61% input) → compressed to 91% onset (76% compression)
- LK channel (immediate onset) → expanded 37% to fill more domain
- Different correction magnitudes applied to same input position

### 2. Prints on Paper Studio Profiler v1.24.xlsx
**Authoritative confirmation** that active-range mapping is the industry standard:
- Excel formulas normalize corrections between each channel's min/max active output
- Zero regions excluded from normalization
- Interpolation scaled to active range fraction, not absolute input position
- Per-channel independent correction

### 3. Test Case Data
Files in `/media/psf/quadGEN/data/`:
- `P800_K37_C26_LK25_V1.quad` - Original 3-ink .quad
- `P800_K37_C26_LK25_V1_correction.txt` - LAB measurement
- `QUADGEN.quad` - quadGEN's incorrect output
- `DNPRO.quad` - DNPRO's correct output

## Investigation Documents

All documentation in this directory:

### Primary Documents
1. **`INVESTIGATION_SUMMARY.md`** - Complete technical analysis and findings
2. **`IMPLEMENTATION_PLAN.md`** - Detailed fix implementation plan (~12 hours)
3. **`LINEARIZATION_DOMAIN_MAPPING_BUG.md`** - Original deep-dive technical investigation
4. **`WHERE_TO_LOOK_NEXT.md`** - Resources and guidance sources
5. **`GUIDANCE_SOURCES.md`** - Inventory of available documentation

### Analysis Scripts
- `analysis-correction-comparison.cjs` - Side-by-side quadGEN vs DNPRO comparison
- `analysis-dnpro-domain-mapping.cjs` - Reverse engineering DNPRO's algorithm

## The Bug

### Current Behavior (WRONG)
```javascript
// src/js/core/processing-pipeline.js:955
const normalized = clamp01(maxOutput > 0 ? value / maxOutput : 0);
const t = lutDomainMin + normalized * domainSpan;
```

**Problem**: Maps by current curve VALUE, not input POSITION.
- For delayed-onset K channel at 50% input: value=0 → t=0 (white point only)
- Correction only affects the active portion (61-100% input)
- Onset position preserved at 61%

### Required Behavior (CORRECT)
```javascript
// Map by input POSITION
const inputPosition = i / 255;
const t = lutDomainMin + inputPosition * domainSpan;
// Then REMAP channel's active range to match corrected targets
```

**Effect**:
- Calculate what ALL input positions should output (0-100%)
- Redistribute each channel's active ink range to match targets
- K channel onset shifts to 91% to achieve linearization
- LK channel expands to fill shadow detail

## Impact

### Affected Workflows
- ❌ Multi-ink .quad linearization with delayed onset channels
- ✅ Single-ink .quad linearization (works correctly by accident)
- ✅ Full-range channels (no delayed onset) - minimal difference

### Real-World Impact
- Incorrect tonal distribution in shadows/midtones
- Multi-ink balance disrupted
- Linearization targets not achieved
- Prints won't match measurement expectations

## Solution

Implement active-range domain mapping per `IMPLEMENTATION_PLAN.md`:

### Core Algorithm Changes
1. **Detect active range** for each channel (first/last non-zero ink)
2. **Calculate targets** for all 256 input positions based on linearization LUT
3. **Remap active range** to redistribute ink across domain matching targets
4. **Preserve endpoints** (ink limits unchanged)
5. **Enforce monotonic** output (no reversals)

### Estimated Effort
~12 hours total:
- Design & pseudocode: 2 hours
- Core implementation: 4 hours
- Testing & debugging: 3 hours
- Edge case handling: 2 hours
- Documentation: 1 hour

## Test Plan

### Primary Success Criterion
✅ quadGEN output for test case matches DNPRO within 5% tolerance

### Test Cases
1. **K channel delayed onset** (primary bug) - compare with DNPRO
2. **Single-ink regression** - verify unchanged behavior
3. **Multi-ink immediate onset** - verify expansion/compression
4. **Edge cases** - all zeros, single point, tiny active range

### Validation
- All Playwright tests pass
- DNPRO comparison shows match
- POPS spreadsheet calculations align
- No visual banding in output curves

## Next Steps

1. **Review & approve** implementation plan
2. **Implement** core algorithm (Phase 2)
3. **Test** against DNPRO output
4. **Refine** until tolerance met
5. **Document** fix in CHANGELOG.md
6. **Archive** investigation docs

## Files Modified

### Core Changes Required
- `src/js/core/processing-pipeline.js` - `apply1DLUT()` function
  - Add `detectActiveRange()`
  - Add `calculateLinearizationTargets()`
  - Add `remapActiveRange()`
  - Modify main `apply1DLUT()` logic

### Testing
- New Playwright test for multi-ink delayed onset
- Regression tests for existing behavior
- Unit tests for new functions

### Documentation
- `CLAUDE.md` - Update linearization behavior description
- `CHANGELOG.md` - Document fix
- `CLAUDE_RECENT_FIXES.md` - Add to recent fixes

## Questions?

All technical details, evidence, and implementation guidance are in the documents in this directory. The investigation is complete and solution is confirmed.

Ready to proceed with implementation when approved.
