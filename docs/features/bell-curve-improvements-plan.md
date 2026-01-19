# Bell Curve Handling Audit Report

Multi-agent comparison of quadGEN's implementation vs industry solutions (HDR imaging, chromatography, audio processing).

**Date:** 2025-12-22
**Agents:** 7 (Claude Opus, Gemini 3 Pro, Codex GPT-5.2, DeepSeek V3, Mistral Large 3, Grok 4.1, Llama 4 Maverick)

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Gaussian falloff | ✅ Complete | `bell-shift.js`, `bell-width-scale.js` |
| Phase 2: PCHIP resampling | ✅ Complete | `bell-curve-utils.js`, both bell files |
| Phase 3: Asymmetry metrics | ✅ Complete | `curve-shape-detector.js` |
| Phase 5: Savitzky-Golay | ✅ Complete | `curve-shape-detector.js` |
| Phase 6: Fit quality | ✅ Complete | `curve-shape-detector.js` |
| Phase 4: Adaptive anchor | 🔄 Deferred | Optional, available for future work |

---

## Agent Summary Table

| Agent | Key Points |
|-------|------------|
| **Claude Opus** | Gaussian falloff (`exp(-d²/2σ²)`) better than linear exponential for locality; Adaptive anchor via log-average (Reinhard-style); Add asymmetry ratio to classifier output |
| **Gemini 3 Pro** | Second derivative zero-crossing for peak detection; Savitzky-Golay filtering preserves peak height; "Energy centroid" as adaptive anchor |
| **Codex GPT-5.2** | Replace linear resampling with **PCHIP** (matches project mandate); EMG fitting for skewness/tailing detection; Log-domain gain processing (audio-style) |
| **DeepSeek V3** | Add EMG tailing parameters (μ, σ, λ); Gaussian convolution mode; Savitzky-Golay advanced smoothing |
| **Mistral Large 3** | Asymmetry metrics (area ratio, span ratio); Secondary peak detection; Cubic interpolation instead of linear |
| **Grok 4.1** | ~85-90% accuracy on clean data, ~70% on noisy; EMG τ = log(rightSpan/leftSpan) for asymmetry; Quantile-based adaptive anchor [0.3, 0.6] |
| **Llama 4 Maverick** | Hybrid slope + fitting approach; Configurable interpolation methods; EMG-style tailing factors |

---

## Consensus Analysis

### Strong Agreement (6-7 agents)

1. **Switch to Gaussian falloff** for bell-shift/width-scale
   - Current: `exp(-|d| / falloff)` (cusp at apex)
   - Recommended: `exp(-d² / (2 × falloff²))` (smooth, better locality)

2. **Replace linear resampling with PCHIP**
   - Linear introduces kinks and shape loss
   - PCHIP preserves monotonicity and curve shape
   - **Already mandated** in project guardrails

3. **Adaptive neutral anchor** instead of fixed 0.45
   - Reinhard-style: log-average of input
   - Percentile/quantile-based (median in [0.3, 0.6])
   - Adapts to curve characteristics

4. **Savitzky-Golay smoothing** instead of moving average
   - Better peak height preservation
   - Standard in chromatography
   - Polynomial fitting vs simple boxcar

5. **Add asymmetry metrics** to classification
   - Left/right span ratio
   - Area asymmetry
   - EMG-style τ parameter

### Moderate Agreement (4-5 agents)

6. **Goodness-of-fit scoring**
   - Current confidence (slope fraction) is crude
   - Add R², RMSE, or residual analysis
   - Helps distinguish true bells from edge cases

7. **EMG fitting for bell candidates**
   - Model asymmetric peaks explicitly
   - Parameters: μ (center), σ (width), τ (tailing)
   - Use as validation, not primary detection

### Edge Cases Identified

All agents identified these scenarios as potentially missed:
- **Flat-topped/plateau peaks** (ink saturation)
- **Asymmetric tailing** (fronting/trailing)
- **Shoulder/overlapping peaks** (multi-modal)
- **Baseline drift** (measurement artifacts)
- **Truncated peaks near edges** (10-index rule)
- **Noise-induced slope variations**

---

## Priority Recommendations

### High Priority (Immediate)

| Change | Location | Effort | Impact |
|--------|----------|--------|--------|
| Gaussian falloff | `bell-shift.js`, `bell-width-scale.js` | Low | Better peak shape preservation |
| PCHIP resampling | `bell-curve-utils.js` | Medium | Eliminates linear interpolation artifacts |
| Asymmetry ratio output | `curve-shape-detector.js` | Low | Diagnostic value |

### Medium Priority (Near-term)

| Change | Location | Effort | Impact |
|--------|----------|--------|--------|
| Adaptive anchor | `processing-pipeline.js` | Medium | Handles diverse curve types |
| Savitzky-Golay smoothing | `curve-shape-detector.js` | Medium | Better noise handling |
| Confidence metric improvement | `curve-shape-detector.js` | Medium | Better edge case detection |

### Lower Priority (Future)

| Change | Location | Effort | Impact |
|--------|----------|--------|--------|
| EMG fitting option | New file | High | Asymmetric peak handling |
| Multi-peak detection | `curve-shape-detector.js` | Medium | Overlap handling |
| Baseline correction | New file | High | Drift compensation |

---

## Implementation Snippets

### 1. Gaussian Falloff (Quick Win)

```javascript
// Current (bell-shift.js, bell-width-scale.js)
const weight = Math.exp(-distance / falloff);

// Recommended
const weight = Math.exp(-(distance * distance) / (2 * falloff * falloff));
```

### 2. Asymmetry Ratio (Quick Win)

```javascript
// Add to classifyCurve() return object
asymmetryRatio: apexSpan?.leftSamples && apexSpan?.rightSamples
    ? apexSpan.leftSamples / apexSpan.rightSamples
    : null,
isLeftSkewed: (apexSpan?.leftSamples ?? 0) < (apexSpan?.rightSamples ?? 0),
isRightSkewed: (apexSpan?.leftSamples ?? 0) > (apexSpan?.rightSamples ?? 0),
```

### 3. Adaptive Anchor

```javascript
// processing-pipeline.js - replace fixed GAIN_TARGET_NEUTRAL

function computeAdaptiveAnchor(samples) {
    const logSum = samples.reduce((sum, v) => sum + Math.log(Math.max(v, 1e-6)), 0);
    const geometricMean = Math.exp(logSum / samples.length);
    const normalized = geometricMean / Math.max(...samples);
    // Clamp to reasonable range
    return Math.max(0.25, Math.min(0.65, normalized));
}
```

### 4. PCHIP Resampling

```javascript
// bell-curve-utils.js - replace linearSample

import { pchipInterpolate } from '../utils/pchip.js';

export function pchipSample(samples, index) {
    return pchipInterpolate(samples, index);
}
```

---

## Unique Insights

| Agent | Unique Point |
|-------|--------------|
| **Claude Opus** | 0.45 × span falloff multiplier is "empirically derived, not theoretically grounded" |
| **Gemini 3 Pro** | Moving average "systematically reduces peak height" (destructive for bells) |
| **Codex GPT-5.2** | `exp(-|d|)` kernel has a "cusp at apex" causing curvature changes |
| **Grok 4.1** | Accuracy estimate: ~85-90% clean data, drops to ~70% on noisy measurements |
| **Mistral Large 3** | Provided full code for `cubicInterpolate()` helper function |

---

## Conclusion

**Overall Assessment:** quadGEN's bell curve handling is **fundamentally sound** for its domain (print calibration). The heuristic approach prioritizes speed and user comprehension over mathematical sophistication - appropriate for the target audience.

**Primary Gaps:**
1. Falloff function could be smoother (Gaussian > linear exponential)
2. Fixed anchor doesn't adapt to diverse curves
3. Linear interpolation loses shape fidelity (PCHIP already mandated)
4. No asymmetry quantification for diagnostics

**Recommended Action:** Implement the three "Quick Win" changes first:
- Gaussian falloff
- Asymmetry ratio output
- PCHIP resampling

These provide the most value with minimal disruption to existing behavior.

---

## Files Modified

| File | Recommended Changes |
|------|---------------------|
| `src/js/core/bell-shift.js` | Gaussian falloff, PCHIP resampling |
| `src/js/core/bell-width-scale.js` | Gaussian falloff, PCHIP resampling |
| `src/js/core/bell-curve-utils.js` | Add PCHIP import/wrapper |
| `src/js/data/curve-shape-detector.js` | Asymmetry metrics, improved confidence |
| `src/js/core/processing-pipeline.js` | Adaptive anchor (optional) |

---

## Full Report

See: `agent-logs/compare/20251222-1945-audit-and-compare-quadgen-s-bell-curve-handling-implementati.md`

---

# Implementation Plan

Based on multi-agent audit, implement all high and medium priority improvements.

## Phase 1: Gaussian Falloff (High Priority)

### Task 1.1: Update `bell-shift.js`

**File:** `src/js/core/bell-shift.js`
**Line ~53:** Replace falloff calculation

```javascript
// BEFORE
const weight = Math.exp(-distance / falloff) * strength;

// AFTER
const weight = Math.exp(-(distance * distance) / (2 * falloff * falloff)) * strength;
```

### Task 1.2: Update `bell-width-scale.js`

**File:** `src/js/core/bell-width-scale.js`
**Line ~127:** Replace falloff calculation

```javascript
// BEFORE
const weight = Math.exp(-Math.abs(distance) / falloff);

// AFTER
const weight = Math.exp(-(distance * distance) / (2 * falloff * falloff));
```

---

## Phase 2: PCHIP Resampling (High Priority)

### Task 2.1: Add PCHIP helper to utils

**File:** `src/js/core/bell-curve-utils.js`

Add new function after `linearSample`:

```javascript
/**
 * PCHIP (monotone cubic) interpolation for smooth resampling
 * Preserves curve shape better than linear interpolation
 * @param {number[]} samples - Source samples
 * @param {number} index - Fractional index to sample
 * @returns {number} Interpolated value
 */
export function pchipSample(samples, index) {
    if (!Array.isArray(samples) || samples.length === 0) return 0;
    if (samples.length === 1) return samples[0];

    const clamped = clamp(index, 0, samples.length - 1);
    const i = Math.floor(clamped);
    const t = clamped - i;

    if (t < 1e-9) return samples[i];
    if (i >= samples.length - 1) return samples[samples.length - 1];

    // Get 4 points for cubic interpolation (clamp at boundaries)
    const p0 = samples[Math.max(0, i - 1)];
    const p1 = samples[i];
    const p2 = samples[Math.min(samples.length - 1, i + 1)];
    const p3 = samples[Math.min(samples.length - 1, i + 2)];

    // PCHIP slopes (monotone-preserving)
    const d1 = pchipSlope(p0, p1, p2);
    const d2 = pchipSlope(p1, p2, p3);

    // Hermite interpolation
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return h00 * p1 + h10 * d1 + h01 * p2 + h11 * d2;
}

function pchipSlope(p0, p1, p2) {
    const d0 = p1 - p0;
    const d1 = p2 - p1;

    // Monotonicity-preserving slope
    if (d0 * d1 <= 0) return 0;

    const w0 = 2 + 1;  // Simplified PCHIP weights
    const w1 = 1 + 2;
    return (w0 + w1) / (w0 / d0 + w1 / d1);
}
```

### Task 2.2: Update bell-shift.js to use PCHIP

**File:** `src/js/core/bell-shift.js`
**Line ~4:** Update import

```javascript
// BEFORE
import { sanitizeSamples, linearSample, clamp, estimateFalloff } from './bell-curve-utils.js';

// AFTER
import { sanitizeSamples, pchipSample, clamp, estimateFalloff } from './bell-curve-utils.js';
```

**Line ~56:** Update sample call

```javascript
// BEFORE
result[i] = Math.round(linearSample(sanitized, sourceIndex));

// AFTER
result[i] = Math.round(pchipSample(sanitized, sourceIndex));
```

### Task 2.3: Update bell-width-scale.js to use PCHIP

**File:** `src/js/core/bell-width-scale.js`
**Line ~4:** Update import

```javascript
// BEFORE (includes linearSample)
import {
    sanitizeSamples,
    linearSample,
    clamp,
    ...
} from './bell-curve-utils.js';

// AFTER
import {
    sanitizeSamples,
    pchipSample,
    clamp,
    ...
} from './bell-curve-utils.js';
```

**Line ~141:** Update sample call

```javascript
// BEFORE
result[i] = Math.round(linearSample(sanitized, sourceIndex));

// AFTER
result[i] = Math.round(pchipSample(sanitized, sourceIndex));
```

---

## Phase 3: Asymmetry Metrics (High Priority)

### Task 3.1: Add asymmetry to classifier output

**File:** `src/js/data/curve-shape-detector.js`
**Function:** `buildBaseResult()` (around line 117)

Add to return object after `apexSpanRightPercent`:

```javascript
// Asymmetry metrics (added per audit recommendation)
asymmetryRatio: apexSpan?.leftSamples && apexSpan?.rightSamples
    ? apexSpan.leftSamples / apexSpan.rightSamples
    : null,
isLeftSkewed: (apexSpan?.leftSamples ?? 0) < (apexSpan?.rightSamples ?? 0) * 0.8,
isRightSkewed: (apexSpan?.leftSamples ?? 0) > (apexSpan?.rightSamples ?? 0) * 1.2,
```

---

## Phase 4: Adaptive Anchor (Medium Priority)

### Task 4.1: Add adaptive anchor calculation

**File:** `src/js/core/processing-pipeline.js`
**After line ~53:** Add helper function

```javascript
/**
 * Compute adaptive neutral anchor based on LUT characteristics
 * Inspired by Reinhard HDR tone mapping log-average approach
 * @param {number[]} lutSamples - LUT values to analyze
 * @returns {number} Adaptive anchor in 0-1 range
 */
function computeAdaptiveAnchor(lutSamples) {
    if (!Array.isArray(lutSamples) || lutSamples.length < 2) {
        return GAIN_TARGET_NEUTRAL;
    }

    // Compute geometric mean (log-average)
    let logSum = 0;
    let count = 0;
    for (let i = 0; i < lutSamples.length; i++) {
        const v = lutSamples[i];
        if (v > 1e-6) {
            logSum += Math.log(v);
            count++;
        }
    }

    if (count === 0) return GAIN_TARGET_NEUTRAL;

    const geometricMean = Math.exp(logSum / count);
    const maxVal = Math.max(...lutSamples);
    const normalized = maxVal > 0 ? geometricMean / maxVal : 0.5;

    // Clamp to reasonable midtone range
    return Math.max(0.25, Math.min(0.65, normalized));
}
```

### Task 4.2: Use adaptive anchor in `apply1DLUTFixedDomain`

**Line ~6250 (inside the function):** Add adaptive calculation

```javascript
// After: const span = Math.abs(domainSpan) > 1e-9 ? domainSpan : 1;

// Compute adaptive anchor if enabled
const adaptiveAnchor = computeAdaptiveAnchor(
    Array.from({ length: CURVE_RESOLUTION }, (_, i) => {
        const t = start + (i / (CURVE_RESOLUTION - 1)) * span;
        return interpolationFunction(t);
    })
);
const anchorTarget = adaptiveAnchor || GAIN_TARGET_NEUTRAL;
const windowMin = Math.max(0, anchorTarget - GAIN_WINDOW_WIDTH);
const windowMax = Math.min(1, anchorTarget + GAIN_WINDOW_WIDTH);
```

---

## Phase 5: Savitzky-Golay Smoothing (Medium Priority)

### Task 5.1: Add Savitzky-Golay helper

**File:** `src/js/data/curve-shape-detector.js`
**After line ~75:** Add new function

```javascript
/**
 * Savitzky-Golay smoothing (2nd order, window=5)
 * Better peak preservation than moving average
 * @param {number[]} values - Input values
 * @returns {number[]} Smoothed values
 */
function savitzkyGolay5(values) {
    if (!Array.isArray(values) || values.length < 5) {
        return values.slice();
    }

    // Savitzky-Golay coefficients for window=5, polynomial=2
    // Coefficients: [-3, 12, 17, 12, -3] / 35
    const coeffs = [-3/35, 12/35, 17/35, 12/35, -3/35];
    const result = new Array(values.length);

    for (let i = 0; i < values.length; i++) {
        let sum = 0;
        for (let j = -2; j <= 2; j++) {
            const idx = Math.min(values.length - 1, Math.max(0, i + j));
            sum += values[idx] * coeffs[j + 2];
        }
        result[i] = sum;
    }

    return result;
}
```

### Task 5.2: Use Savitzky-Golay in classification

**Line ~250:** Update smoothing call

```javascript
// BEFORE
const smoothed = movingAverage(normalized, mergedOptions.smoothingWindow);

// AFTER
const smoothed = mergedOptions.useSavitzkyGolay
    ? savitzkyGolay5(normalized)
    : movingAverage(normalized, mergedOptions.smoothingWindow);
```

### Task 5.3: Add option default

**Line ~22 (DEFAULTS object):** Add new option

```javascript
const DEFAULTS = {
    smoothingWindow: 5,
    useSavitzkyGolay: true,  // NEW: Use S-G by default
    slopeTolerance: 150 / MAX_VALUE,
    // ... rest unchanged
};
```

---

## Phase 6: Improved Confidence (Medium Priority)

### Task 6.1: Add Gaussian fit quality metric

**File:** `src/js/data/curve-shape-detector.js`
**After asymmetry metrics:** Add fit quality

```javascript
/**
 * Compute R² (coefficient of determination) vs ideal Gaussian
 */
function computeGaussianFitQuality(samples, peakIndex) {
    if (!Array.isArray(samples) || samples.length < 10) return null;

    const peakValue = samples[peakIndex];
    if (peakValue <= 0) return null;

    // Estimate sigma from FWHM
    const halfMax = peakValue * 0.5;
    let leftHalf = peakIndex, rightHalf = peakIndex;
    while (leftHalf > 0 && samples[leftHalf] > halfMax) leftHalf--;
    while (rightHalf < samples.length - 1 && samples[rightHalf] > halfMax) rightHalf++;
    const fwhm = rightHalf - leftHalf;
    const sigma = fwhm / 2.355;  // FWHM to sigma

    if (sigma < 1) return null;

    // Compute sum of squared errors vs Gaussian model
    let ssRes = 0, ssTot = 0;
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

    for (let i = 0; i < samples.length; i++) {
        const d = i - peakIndex;
        const gaussian = peakValue * Math.exp(-(d * d) / (2 * sigma * sigma));
        ssRes += (samples[i] - gaussian) ** 2;
        ssTot += (samples[i] - mean) ** 2;
    }

    const rSquared = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
    return Math.max(0, Math.min(1, rSquared));
}
```

### Task 6.2: Include fit quality in output

In `buildBaseResult()`, add:

```javascript
gaussianFitQuality: peakIndex != null
    ? computeGaussianFitQuality(sanitized, peakIndex)
    : null,
```

---

## Verification Steps

1. Run build: `npm run build:agent`
2. Run smoke tests: `npm run test:smoke`
3. Run unit tests: `npm run test`
4. Manual verification:
   - Load `data/KCLK.quad` (has bell curves)
   - Check console for new asymmetry metrics
   - Verify bell shift/width still work smoothly
   - Compare curve shapes before/after

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1. Gaussian falloff | Low | Pure math change, no API change |
| 2. PCHIP resampling | Medium | Test on edge cases (near endpoints) |
| 3. Asymmetry metrics | Low | Additive only, no behavior change |
| 4. Adaptive anchor | Medium | Keep fixed anchor as fallback |
| 5. Savitzky-Golay | Low | Configurable, can disable |
| 6. Fit quality | Low | Informational only |

---

## Execution Order

1. Phase 1 (Gaussian falloff) - simplest, immediate benefit
2. Phase 3 (Asymmetry metrics) - additive, no risk
3. Phase 2 (PCHIP) - most impactful for curve quality
4. Phase 5 (Savitzky-Golay) - improves classification
5. Phase 6 (Fit quality) - diagnostic value
6. Phase 4 (Adaptive anchor) - most complex, optional
