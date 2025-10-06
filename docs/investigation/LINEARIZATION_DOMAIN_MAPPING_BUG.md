# Linearization Domain Mapping Investigation

**Date**: 2025-01-04
**Status**: Active Investigation
**Priority**: Critical - Affects multi-ink .quad linearization accuracy

## Executive Summary

We are investigating a fundamental discrepancy in how quadGEN applies LAB linearization corrections to .quad files with **delayed ink onset** (channels that remain at 0 ink for a portion of the input range before ramping up). Comparison with the industry-standard tool DNPRO reveals significantly different behavior that suggests quadGEN may be applying corrections incorrectly.

## Test Data Files

### 1. Original .quad File
**File**: `data/P800_K37_C26_LK25_V1.quad`
**Description**: 3-ink neutral grayscale print configuration for Epson P800
**Active Channels**:
- **K (Black)**: 37% ink limit, **delayed onset at 61% input** (index 169/255)
- **C (Cyan)**: 25.6% ink limit, delayed onset at 6% input (index 14/255)
- **LK (Light Black)**: 24.94% ink limit, immediate onset at 0.4% input (index 1/255)

**Key Characteristic**: The K channel outputs **zero ink** for inputs 0-60%, then ramps from 0→24,248 over inputs 61-100%.

### 2. Linearization Correction Data
**File**: `data/P800_K37_C26_LK25_V1_correction.txt`
**Format**: LAB measurement data (25 patches, 0-100% gray)
**Purpose**: Linearization target to correct printer tonality
**Data Structure**:
```
GRAY    LAB_L   LAB_A   LAB_B
0.00    95.26   0.00    0.00
2.50    95.33   0.00    0.00
...
100.00  18.99   0.00    0.00
```

### 3. Comparison Outputs
**File**: `data/QUADGEN.quad` - quadGEN's corrected output
**File**: `data/DNPRO.quad` - DNPRO's corrected output (industry standard)

## The Problem

### Observed Discrepancy: K Channel (Delayed Onset)

At **input position 75%** (index 191/255):

| Tool | Output Value | Behavior |
|------|--------------|----------|
| Original | 7,458 | K ink flowing at 75% input |
| **quadGEN** | 13,683 | Applies correction, increases ink |
| **DNPRO** | **0** | No ink - still in delayed region! |

**DNPRO has shifted the K channel onset from 61% → 96% input** (76 index positions later).

### Observed Discrepancy: LK Channel (Immediate Onset)

At **input position 50%** (index 127/255):

| Tool | Output Value | Correction Factor |
|------|--------------|-------------------|
| Original | 2,058 | Baseline |
| **quadGEN** | 6,820 | 3.3x boost |
| **DNPRO** | 11,192 | 5.4x boost |

**Different correction magnitudes** applied at the same input position.

### Visual Summary

```
K Channel (delayed onset at 61% input):
Input:    0%        50%        61%       75%       100%
          |----------|----------|---------|---------|
Original: [0000000000000000000] 7458 ---------> 24248
quadGEN:  [0000000000000000000] 13683 --------> 24248
DNPRO:    [0000000000000000000000000000] 0 ----> 24248
                                        ↑
                            DNPRO delays onset to 96%!
```

## Investigation Questions

### Primary Question
**How should LAB linearization corrections be mapped to the input domain when channels have delayed ink onset?**

### Option A: Fixed Input Mapping (quadGEN's current behavior)
- Linearization correction at 50% input → applies to curve value at input index 127
- Same input position gets same correction factor across all channels
- Delayed onset means early corrections apply to zero values (no effect)
- **Preserves ink onset positions** from original .quad

### Option B: Active Range Remapping (DNPRO's apparent behavior)
- Linearization correction maps to the **active ink range** of each channel
- 50% of correction domain → 50% of the channel's ink-flowing region
- Delayed onset channels get their active range **compressed or shifted**
- **Changes ink onset positions** to achieve linearization target

## Key Data Points

### K Channel Onset Detail (indices 165-180)
```
Index  Original  quadGEN   DNPRO    Notes
165    1015      5422      0        quadGEN boosts, DNPRO still zero
169    1779      8181      0        Original onset point
175    3182      10283     0
180    4501      11706     0
231    —         —         0→?      DNPRO onset begins here
245    —         5258      5258     DNPRO active region
```

### Cross-Channel Comparison at 50% Input
```
Channel  Original  quadGEN   DNPRO    Onset Position
K        0         0         0        61% (delayed)
C        10534     11991     4073     6% (early)
LK       2058      6820      11192    0.4% (immediate)
```

## Technical Context

### Current quadGEN Implementation
**File**: `src/js/core/processing-pipeline.js`, function `apply1DLUT()` lines 803-970

**Domain mapping** (line 955):
```javascript
const normalized = clamp01(maxOutput > 0 ? value / maxOutput : 0);
const t = lutDomainMin + normalized * domainSpan;
```

**Interpretation**:
- `value` = current curve value at index i (0-65535 range)
- `normalized` = value / maxOutput (0-1 range)
- `t` = position in LUT domain (typically 0-1)

**For a delayed onset channel**:
- Indices 0-168: value=0 → normalized=0 → t=0 → correction applied at LUT start
- Index 127 (50% input): value=0 → t=0 → no visible correction
- Index 191 (75% input): value=7458/24248 → t=0.31 → correction at 31% of LUT

**This means**: quadGEN maps based on **current curve output values**, not input positions.

## Next Steps

1. **Analyze DNPRO's domain mapping logic** - reverse engineer how it determines correction application
2. **Determine correct behavior** - consult print industry standards/QuadToneRIP documentation
3. **Assess impact** - how much does this affect real-world print linearization?
4. **Implement fix** - if quadGEN is wrong, correct the domain mapping logic
5. **Create test cases** - ensure delayed-onset channels linearize correctly

## Related Files

- Investigation script: `analysis-correction-comparison.cjs`
- Processing pipeline: `src/js/core/processing-pipeline.js`
- LAB parser: `src/js/data/lab-parser.js`
- Linearization utilities: `src/js/data/linearization-utils.js`

## Notes

- This bug would only manifest with:
  - Multi-ink .quad files with delayed onset channels
  - LAB linearization corrections applied globally
  - Visible as incorrect tonal distribution in shadows/midtones

- Single-ink or full-range channels might appear correct even with the bug

## DNPRO's Strategy (Reverse Engineered)

### Discovery: Value-Based Shifting

**Analysis file**: `analysis-dnpro-domain-mapping.cjs`

DNPRO appears to **shift curve values forward in the input domain** while preserving their relative magnitudes.

**K Channel Pattern**:
```
Original Value → Original Index → DNPRO Index → Shift
115            → 157            → 232         → +75 indices
318            → 160            → 233         → +73 indices
1741           → 169            → 238         → +69 indices
4778           → 181            → 244         → +63 indices
9558           → 199            → 253         → +54 indices
24248          → 255            → 255         → 0 indices (endpoint)
```

**Key Insight**: The shift decreases as you approach the endpoint. DNPRO is **compressing the active ink range** while maintaining the same endpoint value.

### Compression Ratios by Channel

| Channel | Original Active Span | DNPRO Active Span | Compression Ratio |
|---------|---------------------|-------------------|-------------------|
| **K**   | 100 indices (39.2%) | 24 indices (9.4%) | **0.240** (76% compression!) |
| **C**   | 240 indices (94.1%) | 250 indices (98.0%) | 1.042 (slight expansion) |
| **LK**  | 176 indices (69.0%) | 241 indices (94.5%) | 1.369 (37% expansion) |

**Critical Pattern**:
- K channel with **delayed onset** gets **heavily compressed** into the high input region
- LK channel with **immediate onset** gets **expanded** to fill more of the domain
- All three channels end at the same max value (preserving ink limits)

### Hypothesis: DNPRO's Linearization Strategy

1. **Apply LAB correction** to determine target output values at each input position
2. **Remap each channel's active range** to match the corrected tonality
3. **Compress delayed-onset channels** into the upper input range where they're needed
4. **Expand early-onset channels** to carry the shadow/midtone detail

**Effect on multi-ink balance**: Ink onset positions change to achieve the linearized L* target, rather than preserving original onset positions.

### Threshold Position Shifts - K Channel

At what input position does the K channel reach X% of its maximum ink?

| % of Max | Original Index | DNPRO Index | Shift |
|----------|----------------|-------------|-------|
| 1%       | 160 (62.7%)   | 233 (91.4%) | +73   |
| 10%      | 172 (67.5%)   | 240 (94.1%) | +68   |
| 25%      | 186 (72.9%)   | 248 (97.3%) | +62   |
| 50%      | 208 (81.6%)   | 254 (99.6%) | +46   |
| 75%      | 229 (89.8%)   | 255 (100%)  | +26   |

**Interpretation**: DNPRO pushes the K channel's tonal range into the extreme highlights (90-100% input), dramatically compressing it.

## Questions for Domain Expert

1. Should linearization corrections preserve the original ink onset positions? ❌ **DNPRO does NOT preserve onset**
2. Or should they remap the active range to achieve the target L* curve? ✅ **DNPRO remaps/compresses active ranges**
3. Is there QuadToneRIP documentation on expected linearization behavior?
4. Which approach is correct for photographic printing linearization?
5. Does multi-ink balance require preserving relative onset positions, or can they shift independently?
