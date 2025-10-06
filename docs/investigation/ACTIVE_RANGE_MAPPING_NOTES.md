# Active-Range Mapping Overview

## Fixed-Domain vs Active-Range Mapping
- **Fixed-domain mapping** samples the linearization LUT at the same input percent for every channel, regardless of when that channel actually starts printing ink. Delayed-onset channels keep reading the LUT's white-point correction while they still report zero ink, so their curves barely change and L* linearization remains bent.
- **Active-range mapping** first detects the portion of the curve where a channel produces ink, then maps the LUT's 0–100% sweep over just that active span. Channels expand or compress inside their own ink-bearing region to hit the LAB targets, while their fully-zero regions stay untouched.

## Why Active-Range Mapping Fits Linearization
- Linearization's goal is to match the measured LAB ramp, not to preserve the original ink split. Active-range remapping lets each channel shift or compress as required to align with the target, which is why industry tools (DNPRO, POPS Profiler) follow this approach.
- Fixed-domain mapping is better if you need to maintain the designer's original onset timing, but it cannot straighten a multi-ink L* curve once any channel has a delayed start.

## Onset Behavior and Zero Plateaus
- Detecting the active range means we only renormalize indices where the channel already prints ink. The 0% plateaus before the onset remain true zero values, so highlights stay clean.
- If the LAB data shows that shadows still need more density, the solver can shift the onset later or earlier as needed. In the DNPRO example, the K channel actually moves from 61% to 91% input because the other inks already cover the mids; there is no premature ink.

## When a Channel Starts Earlier
- Earlier onset happens only when the measurement demands it—e.g., the print is too light even with other inks at capacity. Active-range mapping allocates the necessary contribution by expanding that channel's active span.
- Those adjustments are deliberate, not side effects of normalization. They reflect the correction required to achieve a neutral ramp.

## Net Effect
- Active-range mapping keeps zero-output regions intact, redistributes ink only where it flows, and solves directly against the measured LAB targets. That makes it the logical linearization strategy when accuracy takes priority over preserving the original multi-ink choreography.
