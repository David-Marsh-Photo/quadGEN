# LAB Linearization Investigation Summary

**Date**: 2025-01-04
**Status**: Initial findings documented
**Next Steps**: Awaiting user decision on correct behavior

## The Question

*"How should LAB linearization corrections be applied to .quad files with delayed ink onset (channels that remain at 0 for part of the input range)?"*

## Test Case

**Original .quad**: 3-ink neutral grayscale (K + C + LK)
- **K channel**: Outputs 0 ink for inputs 0-60%, then ramps to 37% limit
- **C channel**: Starts at 6% input, ramps to 25.6% limit
- **LK channel**: Starts at 0.4% input, ramps to 24.94% limit

**LAB correction**: 25-point L* measurement from 0-100% gray, applied globally

## Key Findings

### 1. quadGEN's Current Behavior

**Strategy**: Apply linearization correction at fixed input positions

```
Input Position → Correction Applied
0% input      → 0% of LUT
50% input     → 50% of LUT
100% input    → 100% of LUT
```

**Effect on delayed onset channels**:
- K channel at 50% input has value=0, so correction sees 0 → outputs 0
- K channel onset position **preserved** at 61% input
- Correction only affects the active portion (61-100%)

**Result**: Onset positions unchanged, ink limits preserved

### 2. DNPRO's Behavior (Industry Standard)

**Strategy**: Remap each channel's active ink range to achieve corrected tonality

**K Channel Transformation**:
- Original active range: indices 169-255 (39.2% of domain)
- Corrected active range: indices 231-255 (9.4% of domain)
- **Compression ratio: 0.24** (76% compression!)
- Onset shifted from 61% → 91% input (+76 indices)

**LK Channel Transformation**:
- Original active range: indices 1-177 (69% of domain)
- Corrected active range: indices 1-242 (94.5% of domain)
- **Expansion ratio: 1.37** (37% expansion)
- Onset preserved at 0.4% input

**Result**: Channels independently compressed/expanded to distribute tonality

### 3. Visual Comparison

At **75% input** (midpoint of K channel's active range):

| Tool | K Output | Behavior |
|------|----------|----------|
| Original | 7,458 | K ink flowing |
| quadGEN | 13,683 | K boosted, still at 75% input |
| **DNPRO** | **0** | K hasn't started yet - delayed to 91%! |

At **50% input** (LK channel active):

| Tool | LK Output | Correction Factor |
|------|-----------|-------------------|
| Original | 2,058 | Baseline |
| quadGEN | 6,820 | 3.3x boost |
| **DNPRO** | **11,192** | **5.4x boost** |

## The Core Difference

### quadGEN Approach
- **Corrects values** at their existing positions
- Preserves onset timing and ink distribution patterns
- Applies the same LUT correction at the same input % across all channels

### DNPRO Approach
- **Remaps active ranges** to achieve linear L* output
- Changes onset timing and compression ratio per channel
- Channels shift independently to distribute tonal load

## Practical Implications

**quadGEN's approach might:**
- ✅ Preserve the original multi-ink transition behavior
- ✅ Maintain balanced ink layering where originally designed
- ❌ Not achieve true L* linearization in delayed-onset regions
- ❌ Under-utilize delayed onset inks in shadows/midtones

**DNPRO's approach might:**
- ✅ Achieve more accurate L* linearization across the full tonal range
- ✅ Optimize ink usage by remapping channels where needed
- ❌ Change multi-ink transitions from the original design
- ❌ Potentially introduce discontinuities or banding if not smoothed

## Technical Details

### Current quadGEN Code
**File**: `src/js/core/processing-pipeline.js:955`

```javascript
// Current implementation: normalize by current curve value
const normalized = clamp01(maxOutput > 0 ? value / maxOutput : 0);
const t = lutDomainMin + normalized * domainSpan;
const lutValue = clamp01(interpolationFunction(t));
```

**Problem**: For a delayed-onset channel, `value` is 0 in the early range, so `normalized` is always 0 until ink flows. The LUT correction at 0-60% input is sampled from t=0 (white point) only.

### What DNPRO Likely Does

```javascript
// Hypothesis: normalize by input position, not curve value
const inputNormalized = i / 255; // 0-1 based on input position
const t = lutDomainMin + inputNormalized * domainSpan;
const targetOutput = interpolationFunction(t) * channelMaxValue;

// Then remap the channel's curve to hit these targets
// (details of remapping algorithm unknown)
```

## Questions Requiring User Expertise

1. **Which behavior is correct for QTR linearization?**
   - Should onset positions be preserved (quadGEN)?
   - Or should channels remap to achieve L* target (DNPRO)?

2. **Multi-ink balance considerations:**
   - Does changing K onset from 61% → 91% break the original ink split strategy?
   - Or is this expected when linearizing?

3. **Print quality impact:**
   - Would quadGEN's approach produce visible tonal errors?
   - Is DNPRO's compression safe, or could it cause banding?

4. **QTR documentation:**
   - Is there official guidance on how .quad linearization should work?
   - What does the original QTR software (if any) do?

## Files Generated

1. **Investigation doc**: `docs/investigation/LINEARIZATION_DOMAIN_MAPPING_BUG.md`
2. **Analysis scripts**:
   - `analysis-correction-comparison.cjs` - Side-by-side comparison
   - `analysis-dnpro-domain-mapping.cjs` - DNPRO reverse engineering
3. **Test data** (in `data/`):
   - Original .quad, LAB correction, quadGEN output, DNPRO output

## ✅ CONFIRMED: DNPRO Approach is Correct

### Evidence: Prints on Paper Studio Profiler v1.24.xlsx

**Source**: Professional QTR profiling tool used in print studios

**Analysis findings**:
1. **Active-range normalization**: Correction calculations normalize values between each channel's minimum nonzero output and maximum output
2. **Zero-region exclusion**: Formulas begin interpolation from the first measurable ink point, NOT from the full 0-100% domain
3. **Relative scaling**: Interpolation coordinates are scaled to the active range fraction, not absolute input position
4. **Per-channel independence**: Each channel's correction is computed within its own active bounds

**Conclusion**: The POPS spreadsheet implements **per-channel active-range normalization**, matching DNPRO behavior exactly.

This is **authoritative evidence** that DNPRO's approach represents the QTR industry standard.

## Required Changes to quadGEN

**quadGEN must be modified** to implement active-range domain mapping:

### 1. Redesign `apply1DLUT()` Domain Mapping
**Current** (src/js/core/processing-pipeline.js:955):
```javascript
// WRONG: Maps by current curve value
const normalized = clamp01(maxOutput > 0 ? value / maxOutput : 0);
const t = lutDomainMin + normalized * domainSpan;
```

**Required**:
```javascript
// CORRECT: Map by input position within active range
const inputPosition = i / 255; // 0-1 across full input domain
const t = lutDomainMin + inputPosition * domainSpan;
// Then remap channel's active range to match corrected target values
```

### 2. Implement Per-Channel Active Range Detection
- Find first non-zero ink output (onset position)
- Find last non-zero ink output (end position)
- Calculate active span for each channel
- Apply correction only within active range

### 3. Implement Range Compression/Expansion
- Calculate target output values for all 256 input positions
- Redistribute channel's active ink range to match targets
- Preserve endpoint values (ink limits)
- Ensure monotonic output (no reversals)

### 4. Handle Edge Cases
- Channels with zero output everywhere (disabled channels)
- Channels with immediate onset (index 0 or 1)
- Channels with delayed onset (>50% input)
- Ensure smooth transitions to avoid banding

### 5. Extensive Testing Required
- Multi-ink delayed-onset scenarios
- Verify against DNPRO output
- Compare with POPS spreadsheet calculations
- Test with various ink split strategies
