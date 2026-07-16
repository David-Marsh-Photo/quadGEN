# Channel Builder

Status: shipped

The Channel Builder creates secondary-channel curves from measured L* ramps and reduces the reference K curve where those channels provide coverage. It is a four-step tool: Reference K, Add Channels, Preview, and Apply.

## Workflow

1. Set a reference K from the ink limit used for its test print and measured input/L* pairs. The builder converts L* to paper-relative density and generates a 256-point linear K ramp at that ink limit.
2. Add each secondary channel with its test-print ink limit and measured input/L* pairs. Measurements can be pasted as comma- or tab-separated pairs, or entered manually in 3–15 rows. Secondary channels require at least five points, including values near 0% and 100% input.
3. Review the computed channel summaries, K carve-out start, and total-ink warnings.
4. Apply the computed curves to the loaded quad. This replaces the loaded K curve with the reduced version, writes each secondary curve, updates channel baselines, and records measured dMax values in the density solver.

An existing loaded K curve can be imported as a shortcut, but measured K data is the primary path because a curve alone cannot supply observed density.

## Computation Contract

- L* is converted to relative luminance and then paper-relative optical density; the first measurement is the paper-white reference.
- The secondary apex defaults to the channel/reference dMax ratio, clamped away from the curve edges. Optional L* matching places it where K reaches the secondary channel's darkest measured L*.
- Measured slope estimates the width factor. Apex position assigns a highlight, midtone, or shadow role, which selects the bell asymmetry.
- Bell curves and the K transition mask are generated with PCHIP and contain 256 integer samples.
- Recommended End is limited by the test-print ink limit and the secondary/reference density ratio.
- The K start uses the later of the midtone bracket and aggregate secondary-coverage threshold, then applies a smooth transition to preserve the calibrated K shape.

## Validation and State

- Pasted pairs are sorted by input. L* values outside 0–100, insufficient endpoint coverage, or fewer than five secondary points block calibration; large input gaps and non-monotonic measurements produce warnings.
- Preview warns when aggregate channel ink exceeds the configured warning or maximum thresholds; it does not silently rescale the curves.
- The current session, wizard step, entry mode, and calculation options persist in local storage under `quadgen.channelBuilder.session`. Clearing the builder removes that saved session.
- Apply requires a loaded quad and mutates only that in-memory working document; normal quad export remains a separate action.

## Ownership

- Calculations: `src/js/core/channel-builder.js`
- Session state: `src/js/core/channel-builder-state.js`
- Wizard UI and apply behavior: `src/js/ui/channel-builder-modal.js`
- Core contract tests: `tests/core/channel-builder.test.js`

This document describes the current product contract. Historical implementation proposals and domain research are not runtime requirements.
