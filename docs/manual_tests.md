# Manual Regression Tests

## Per-channel Measurement Undo
Goal: ensure undo removes both measurement data and the associated UI toggle state for a channel.

### Manual Steps:
1. Load the modular `index.html` build (hosted or local) and choose any printer (e.g., P700-P900).
2. Load a per-channel measurement file (e.g., `lab_banded_shadow.txt`) onto any channel via the row's **load file** button and ensure the per-channel toggle enables itself.
3. Trigger undo (toolbar Undo button or keyboard shortcut) immediately after the load.
4. Confirm both of the following:
   - The channel processing label no longer lists the measurement source and the plotted curve returns to the prior state.
   - The per-channel toggle beside **load file** is disabled and unchecked.

Record the result in your test log. If either check fails, the regression guard has detected a problem.

## Manual L* Patch Layout Persistence
Goal: confirm the Manual L* modal restores the saved Patch % layout instead of reverting to the evenly spaced defaults.

### Manual Steps:
1. Open the latest `index.html`, launch the Manual L* modal (Global Corrections → **Enter L* Values**), and increase the row count to 7. Adjust several Patch % values (e.g., `0`, `4`, `12`, `25`, `50`, `75`, `90`) and enter valid measured L* numbers in every row.
2. Click **Save as .txt** (or **Generate Correction**) to persist the entry, then close the modal.
3. Re-open the Manual L* modal without clearing browser storage. The row count and Patch % values should match the layout from step 1—no rows should revert to the evenly spaced defaults.
4. Note in your log whether the layout was restored. If it did not persist, capture the console output of `localStorage.getItem('quadgen.manualLstarLayout')` before continuing other tests.

Reset: Clear browser storage (e.g., `localStorage.removeItem('quadgen.manualLstarLayout')`) if you need to restore the default five evenly spaced rows before the next run.

## Edit Mode — Curve Point Dragging
Goal: confirm the curve point dragging toggle (Options panel) works and preserves Smart-curve ordering.

### Manual Steps:
1. Open the latest `index.html`, click ⚙️ Options, and confirm **Enable curve point dragging** is checked by default (re-enable it if a prior session left it off).
2. Load `testdata/Manual-LAB-Data.txt` via **Load LAB / Manual** so Edit Mode seeds Smart points.
3. Enter Edit Mode, select the MK channel, and navigate to point 3.
4. Drag point 3 upward via the chart. Expect the curve to update in real time and the point to retain its ordinal.
5. Drag point 3 far left toward point 2. Release—the X coordinate must clamp just to the right of point 2 (no crossing or reorder).
6. Toggle the option off and refresh the page to ensure the checkbox remembers the override (it should remain unchecked until you re-enable it); restore the default-On state before leaving the session.
7. Drag a point off the chart entirely (e.g., past the right edge) and release—the point should snap back to its original coordinates with no staircase artifacts.

Document pass/fail and attach screenshots if the drag behaviour deviates (e.g., points jump, curve collapses, or the toggle fails to persist state).

## Correction Overlay Toggle
Goal: ensure the new Options toggle draws and hides the dashed correction target overlay reliably.

### Manual Steps:
1. Load `index.html`, open ⚙️ Options, and confirm **Show correction target overlay** is checked by default (re-enable it if a prior session stored an override).
2. Load `testdata/Manual-LAB-Data.txt` via **Load LAB / Manual** and wait until the global correction applies (status toast should reference the file and the chart should redraw).
3. With the toggle still on, confirm the chart shows the dashed **red** correction trace and the **purple** dashed linear baseline reaching the active ink ceiling; `window.isChartDebugShowCorrectionTarget?.()` should return `true`.
4. Disable **Show correction target overlay** and ensure the dashed overlay disappears; the helper above should return `false`.
5. Re-enable the toggle and confirm the overlay returns immediately with the same effective ceiling.
6. Close the Options panel, re-open it, and verify the checkbox still reflects the current state before changing it again.

Capture before/after screenshots of the chart if the overlay fails to appear/disappear or the helper state desynchronizes from the checkbox.

## Light Blocking Overlay Toggle
Goal: confirm the light-blocking overlay renders, updates with curve edits, and reports cursor samples in the tooltip.

### Manual Steps:
1. Load `index.html`, open ⚙️ Options, and enable **Show light blocking overlay** (the checkbox remembers prior sessions—turn it on if it was disabled).
2. Load `data/P800_K36C26LK25_V6.quad` so the chart displays multiple active channels. Once curves appear, hover the chart and confirm the tooltip now includes a `Light Block: …%` line.
3. Drag the MK channel’s Smart point 4 upward in Edit Mode (or adjust the MK percent slider) and verify the solid **purple** light-blocking overlay shifts immediately while the tooltip values change—no dashed reference line should appear.
4. Toggle the option off and confirm the overlay disappears and the tooltip reverts to the two-line format.
5. Re-enable the toggle, close ⚙️ Options, and reopen it to ensure the checkbox still reflects the active state.

Document pass/fail with a screenshot of the overlay and tooltip. Note any lag between edits and overlay refresh, or if the tooltip fails to display the light-blocking line.

## Measurement Spot Markers Overlay
Goal: verify the measurement spot marker overlay highlights LAB readings correctly and exposes the ±1 % tolerance status.

### Manual Steps:
1. Load `index.html`, open ⚙️ Options, and confirm **Show measurement spot markers** is disabled (the checkbox remains disabled until a LAB dataset is active).
2. Load `data/P800_K36C26LK25_V19.quad`, then apply `data/P800_K36C26LK25_V19.txt`. Re-open ⚙️ Options and ensure the spot marker checkbox is now enabled.
3. Enable **Show measurement spot markers**. The chart should render a mid-rail of badges anchored to the unzoomed 70 % baseline (green checks for patches within ±1 %, colored arrows pointing up/down for out-of-tolerance points) with faint dots marking the actual measured positions on the curve. Hover 2–3 markers:
   - Tooltip should report `Input …%`, the measured L*, and the required action (Darken/Lighten with the delta percent).
   - Arrow direction must match the action (up = darken / add ink, down = lighten / remove ink).
4. Toggle the option off and verify all badges disappear immediately. Re-enable to confirm the overlay redraws without requiring a reload.
5. Refresh the page, reapply the LAB dataset, and confirm the overlay preference stored in localStorage (`localStorage.getItem('quadgen.showLabSpotMarkers')`) restores the checkbox and overlay state when LAB data is present.

Capture a screenshot showing both a green check badge and at least one arrow marker, along with hover tooltip text. Log any markers that fail to render or tooltips that omit the action summary.

## Correction Gain Slider
Goal: confirm the correction gain slider blends between the identity ramp and the measured correction, and that overlays/export previews follow the current mix.

### Manual Steps:
1. Load `data/P800_K36C26LK25_V19.quad` and `data/P800_K36C26LK25_V19.txt`. Enable **Show measurement spot markers**.
2. Open ⚙️ Options and verify the **Correction gain** slider defaults to 100 % with the label reading `100%`.
3. Confirm that at 100 % the chart shows the fully corrected curve and several spot markers display non-zero deltas (red/blue arrows) indicating the full correction amount.
4. Drag the slider to 50 %. Pause the thumb—within ~150 ms the chart and markers should settle at the half-strength correction (arrow lengths and delta labels roughly half) while the label reads `50%` and the debug helper reports `getCorrectionGainPercent() === 50`. Releasing the mouse/keyboard should flush the update immediately even if the pause was brief.
5. Drag the slider to 0 %. After the short debounce window the spot markers should switch to green checks (no correction applied) and the chart should return to the identity ramp.
6. Return the slider to 100 % and verify the chart/markers revert to the original correction magnitude.
7. Export the `.quad` at 50 % and 100 % gains; compare the 256-point tables to confirm the 50 % export is the midpoint between the identity ramp and the fully corrected curve.

Record pass/fail with screenshots for 0%, 50%, and 100%. Note any delays in redraws or mismatches between the label, debug helper, and exported data.

## Global Correction Overrides Baked Metadata
Goal: confirm that loading a new LAB/CGATS/manual dataset reshapes baked `.quad` files immediately at 100 % correction gain.

### Manual Steps:
1. Load `data/P800_21K.quad`. The stock curve is almost linear through 0–60 % input even though its metadata marks the K channel as baked.
2. Apply `data/P800_21K.txt` via **Global Correction → Load Data File** and wait for the toast/status row to reference the file.
3. Ensure **Correction gain** remains at `100%`; do **not** touch the slider.
4. Inspect the K channel around 30–50 % input:
   - Visually, the solid curve should dip below the diagonal to match the dashed overlay in that region.
   - Optionally sample the values via `window.__quadDebug?.chartDebug?.getCurveSamplesForChannel?.('K', document.querySelector('tr.channel-row[data-channel=\"K\"]'));` – the `percent` at ~40 % input should differ from the baseline by at least 5 %.
5. Toggle the gain to 99 % and back to 100 % to confirm the curve stays reshaped (no more “only at 99 %” workaround).
6. Document pass/fail with a screenshot of the chart showing the corrected highlight segment. Include the console sample if the visual difference is subtle.

## Plot Smoothing Tail
Goal: confirm aggressive plot smoothing keeps the highlight region smooth.

### Manual Steps:
1. Load `data/P800_K36C26LK25_V19.quad`, then apply `data/P800_K36C26LK25_V19.txt`.
2. Open ⚙️ Options and raise **Plot smoothing** to **120% (×1.87)**.
3. Enable **Show correction target overlay** and the composite debug overlay (⚙️ Options → **Enable composite debug overlay**). Hover the chart near 95–100 % input or sample the snapshots via `window.__quadDebug?.compositeDebug?.getCompositeDebugState?.()`—the K channel should climb smoothly with no sharp kink at the final snapshot (the last slope should be ≤ the prior slope).
4. Capture a screenshot of the highlight region if a kink appears; reduce **Plot smoothing** back to 0 % and confirm the original tail shape returns.

## Plot Smoothing Highlight Head
Goal: confirm aggressive plot smoothing leaves the highlight ramp smooth near 0–2 % input.

### Manual Steps:
1. Load `data/P800_K36C26LK25_V19.quad`, then apply `data/P800_K36C26LK25_V19.txt`.
2. Open ⚙️ Options and raise **Plot smoothing** to **150% (×2.05)**.
3. Zoom into the first 5 % of the curve (or sample deltas via `window.loadedQuadData.curves.K.slice(0, 12)`). Record the slope behaviour—LK currently shows a small reversal around ~1.3 % when smoothing is high because the legacy kernel still pads the endpoints.
4. Revert the slider to 0 % and confirm the opening ramps return to the original `.quad` values.

## Composite Flagged Snapshots
Goal: ensure the snapshot flagger highlights abrupt ink swings and surfaces them in both the chart and composite debug panel.

### Manual Steps:
1. Load `index.html`, open ⚙️ Options, and enable **Enable composite debug overlay** (leave the panel open).
2. Open DevTools (⌥⌘I / F12) and in the Console run:
   ```js
   const channel = 'K';
   const snapshotFlags = {
     1: {
       kind: 'rise',
       magnitude: 75,
       threshold: 7,
       channels: [channel],
       details: [{ channel, delta: 75, magnitude: 75, direction: 'rise' }],
       inputPercent: 50,
     },
   };
   const snapshots = [
     { index: 0, inputPercent: 0, perChannel: { [channel]: { normalizedAfter: 0.2 } } },
     { index: 1, inputPercent: 50, perChannel: { [channel]: { normalizedAfter: 0.95 } } },
   ];
   const summary = { channelNames: [channel], channelMaxima: { [channel]: 65535 } };
   window.commitCompositeDebugSession?.({ summary, snapshots, selectionIndex: 1, snapshotFlags });
   window.setCompositeDebugEnabled?.(true);
   ```
3. Confirm a 🚩 marker appears near the 50 % input on the chart and hovers show the channel/magnitude tooltip (overlay marker uses `data-flagged-snapshot="1"`).
4. Verify the composite debug panel lists the flagged snapshot, includes rise/drop arrow + magnitude, and clicking the badge jumps the selection (panel header should show `🚩` after the snapshot label).
5. Check `window.getCompositeDebugState()?.flags` returns an object with key `1` and the expected metadata (kind `rise`, magnitude ≈ 75, threshold 7).
6. Clear the session via `window.commitCompositeDebugSession?.(null)` and confirm both chart markers and panel list disappear.

Capture a screenshot that includes the chart flag and the composite debug badge.

## Composite Slope Limiter
Goal: confirm real composite datasets no longer produce >7 % ink jumps or snapshot flags after redistribution completes.

### Manual Steps:
1. With the composite debug overlay enabled, load `data/P800_K36C26LK25_V6.quad` followed by `data/P800_K36C26LK25_V6.txt` (Normalized weighting).
2. Wait for the redistribution toast to clear, then open the composite debug panel and confirm `summary.snapshotFlags` is missing or reports `count: 0`; `window.getCompositeDebugState()?.flags` should return an empty object.
3. Inspect the chart around ~86 % input: verify the K curve now ramps smoothly (no vertical jump) and no 🚩 marker renders on the canvas.
4. Sample the final two snapshots (indices 254–255) via the debug selector; K’s `normalizedAfter` entries should differ by ≤ 0.07.
5. Export the debug state with `window.getCompositeDebugState()` and capture a screenshot highlighting the smooth ramp where the previous build spiked.

If any flags reappear or the Δ exceeds 7 %, file a regression with the exported payload attached.

## Composite Slope Kernel
Goal: validate the default-on kernel smoother reshapes steep roll-offs without violating the 7 % guard or altering roll-ons.

### Manual Steps:
1. On load confirm `window.isSlopeKernelSmoothingEnabled?.()` returns `true`. If a prior session disabled it, toggle back on via `window.enableSlopeKernelSmoothing?.(true)` or reload without `QUADGEN_ENABLE_SLOPE_KERNEL=0`.
2. Load `data/P800_K36C26LK25_V6.quad` and `data/P800_K36C26LK25_V6.txt` with Normalized weighting. Allow redistribution to finish.
3. Open the composite debug overlay, select the K channel, and focus snapshots 246–252 (≈88–92 % input). Record the `normalizedAfter` deltas—they should begin around 0.05–0.06 and taper below 0.02 over the final three samples (no flat 0.07 staircase).
4. Ensure no new 🚩 markers appear and `window.getCompositeDebugState()?.flags` stays empty.
5. For comparison, disable the flag (`window.enableSlopeKernelSmoothing(false)`), rerun the import, and confirm the roll-off reverts to the linear fallback with nearly uniform ~0.07 steps.
6. Capture both curves (kernel on/off) for traceability and leave the flag off only if you’re intentionally testing the fallback.

Document the measured deltas; if the kernel path exceeds 0.07 or flattens the transition, attach the debug payload with notes.

## Composite Weighting Selector
Goal: confirm the Isolated/Normalized/Momentum/Equal selector in ⚙️ Options changes how LAB corrections redeploy across multi-ink channels.

### Manual Steps:
1. Launch `index.html`, open the ⚙️ Options panel, and set **Composite weighting** to **Normalized**.
2. Load `data/TRIFORCE_V4.quad`, then `data/TRIFORCE_V4.txt`. Enable the composite debug overlay (Options → Enable composite debug overlay) and the redistribution smoothing window toggle, then scrub the snapshot selector to roughly 26 % input—cyan should retain a non-zero corrected value, LK should no longer absorb 100 % of the delta, and the smoothing badge should light up when the hand-off window is active.
3. Switch the selector back to **Isolated**, reload `data/TRIFORCE_V4.txt`, and verify the same snapshot now drives cyan to 0% while LK carries the remaining correction.
4. Switch the selector to **Equal**, reload `data/TRIFORCE_V4.txt`, and confirm the snapshot shows cyan/LK shares within a few percent of each other (and no channel monopolizes the correction).
5. Switch the selector to **Momentum**, reload `data/TRIFORCE_V4.txt`, and confirm:
   - The summary card shows **Mode Momentum** with a non-empty Momentum row (cyan momentum should exceed LK around the hand-off).
   - The channel detail list includes a Momentum line, and the snapshot at ~26 % input biases the share toward the higher-momentum channel (cyan regains a non-zero share while LK no longer takes the full delta).
6. Record the observed cyan/LK values and the Momentum readouts (overlay card or `window.getCompositeDebugState()`) with before/after screenshots for all four modes.

## Auto-Raise × Smoothing Interoperability
Goal: ensure auto-raising ink limits does not suppress redistribution smoothing windows when Normalized weighting is active.

### Manual Steps:
1. Open `index.html`, click ⚙️ Options, and enable **Enable composite debug overlay**, **Enable redistribution smoothing window**, and **Auto-raise ink limits after import**. Set **Composite weighting** to **Normalized**.
2. Load `data/P800_K36C26LK25_V6.quad` via **Load .quad** and wait for the status toast to clear.
3. Load `data/P800_K36C26LK25_V6.txt` via **Load LAB / Manual** (global import). Expect multiple status toasts announcing the auto-raised channels (K, C, LK at minimum).
4. Open the composite debug panel (Options overlay should already expose it) and confirm:
   - `summary.autoRaisedEnds` lists the channels that were raised (you can also call `window.getCompositeDebugState()?.summary?.autoRaisedEnds`).
   - Each auto-raised entry reports a `reason` (`coverage-exhausted` when a raise occurred, `coverage-available`/`handoff-available` when it was skipped) so coverage-driven decisions are visible without digging through the status log.
   - `summary.smoothingWindows` reports at least one entry covering the ~55–73 % input band, with `forced: true`.
   - Snapshot 184 shows the smoothing badge and hover tooltip indicating the taper window (K handing off to C/LK).
5. Switch **Composite weighting** back to **Equal**, reload `data/P800_K36C26LK25_V6.txt`, and confirm smoothing windows disappear while the auto-raise entries remain—document the behaviour difference (badge missing under Equal is expected).
6. Switch the selector back to **Normalized**, reload the LAB file one more time, and capture screenshots of the status toast stack plus the composite debug panel showing both auto-raised entries and smoothing windows.

Document pass/fail and attach the screenshots. If either array is missing under Normalized weighting, note the console output from `window.getCompositeDebugState()` in your test log.

## Edit Mode — XY Input Stability
Goal: ensure editing the `X,Y` field does not rescale the entire curve when channel ink limits are below 100%.

### Manual Steps:
1. Load `index.html`, choose **P600-P800**, and import `data/TRIFORCE_V3.quad` via **Load .quad**.
2. Enter Edit Mode, select channel `K`, and navigate to key point 6 (≈57.6%, 16.6%).
3. In the `X,Y` input, change only the X portion to `60` while keeping the Y portion unchanged (e.g., `60.0,16.6`) and press Enter.
4. Observe the chart and channel percent:
   - The curve should adjust locally (point moves right) without lifting the entire midtone region.
   - The channel percent must remain at 37% and the point’s absolute output should still be near 16.6%.
5. Repeat, this time entering the relative output (e.g., `60.0,44.8`). Confirm the field snaps back to the channel-limited absolute value (~16.6%) and the surrounding curve remains stable.

Failing either check indicates a regression in the XY input handling; capture screenshots and log the delta between the pre/post sampled curve (sample 128).

## Channel Ink Lock
Goal: ensure per-channel lock buttons prevent ink limit edits and clamp Smart curve updates.

### Manual Steps:
1. Open the latest `index.html`, locate the MK row, and click the lock (🔒) button. The percent and End inputs should disable immediately.
2. Attempt to type a new percent value or use the spinner arrows—values must remain unchanged and a status appears noting the lock.
3. Unlock the channel, set the percent to 60%, and lock again.
4. Enter Edit Mode, drag Smart point 3 upward, and confirm the absolute output never exceeds ~60%.
5. Unlock and verify inputs re-enable, then return the percent to 100% for baseline comparisons.

Record the result (with screenshots if the clamp fails or inputs remain editable while locked).

## Auto-Raise Ink Limit (Flagged)
Goal: validate the gated auto-raise helper lifts ink limits after loading high-output corrections and reports blocked channels when locks are active.

### Manual Steps:
1. Load `index.html`, open the ⚙️ Options panel, and enable **Auto-raise ink limits after import** (the toggle defaults to off; turn it on for this run).
2. Set the K channel to 50% via the percent input and confirm the End reflects the lower ceiling.
3. Import a global LAB correction that peaks above 50%—`testdata/TRIFORCE_V4.txt` or `P800_K36C26LK25_V6.txt` work well.
4. Expect a status toast such as `K ink limit changed to 64% (auto-raised for global correction)`, the K percent field to update, and `window.getCompositeDebugState().summary.autoRaisedEnds` to list K with `locked: false`.
5. Undo once and confirm both the correction and ink limit revert to their prior values.
6. Re-open ⚙️ Options to confirm the toggle remains on, lock the K channel, repeat steps 2–3, and verify: no End change occurs, a lock-specific status appears, and `autoRaisedEnds` records the blocked state (`locked: true`).

Document the observed percent values, status messages, and composite summary output in the regression log.

## Simple Scaling Default Pipeline
Goal: ensure the Simple Scaling correction method loads by default and records the expected lift summary.

### Manual Steps:
1. (Optional but recommended) Clear the saved preference: in DevTools run `localStorage.removeItem('quadgen.correctionMethod.v1')`, then refresh `index.html`.
2. Open the ⚙️ Options panel and confirm **Simple Scaling** is selected under **Correction method**.
3. Load `data/P800_K36C26LK25_V6.quad`, then load `data/P800_K36C26LK25_V6.txt`.
4. Observe the chart: the corrected curves should track the Simple Scaling gain (gain overlay enabled) and the dashed baseline should match the original `.quad` draw.
5. In the console verify the session metadata:
   ```js
   const data = window.getLoadedQuadData();
   ({ method: data?.correctionMethod, summary: data?.simpleScalingSummary });
   ```
   Expected: `method === 'simpleScaling'` and `summary.perChannel.K.maxLift === 0`.
6. Undo once and confirm the method and summary roll back with the curves.

Record screenshots of the Options panel and chart if the default selection or lift summary differ from expectations.

## Composite Redistribution Amplitude Check
Goal: confirm the density-solver composite redistribution keeps multi-ink `.quad` files balanced without flattening bell curves or collapsing the total amplitude once the pipeline is enabled.

### Manual Steps:
1. Load `index.html`, open the ⚙️ Options panel, switch **Correction method** to **Density Solver**, and verify the selection sticks (the default Simple Scaling path must be deselected).
2. In the DevTools console ensure composite redistribution is enabled (`window.isCompositeLabRedistributionEnabled?.()` should return `true`).
3. Use **Load .quad** to open `data/TRIFORCE_V4.quad`, then load `data/TRIFORCE_V4.txt` via **Load LAB / Manual**.
4. Observe the Global Correction chart: the cyan (C) and light black (LK) bells should retain their shape below the ink ceiling while the K channel stays above 20 k counts through the midtones (compare against `artifacts/triforce_v4_composite_redistribution.png`).
5. In the console, capture the total-output spread for reference:
   ```js
   const data = window.getLoadedQuadData(); const totals = new Array(256).fill(0);
   Object.values(data.curves).forEach((arr) => arr.forEach((v, i) => totals[i] += v));
   ({ min: Math.min(...totals), max: Math.max(...totals) })
   ```
   Expected max ≈ 39 k. Values under ~33 k indicate an amplitude regression—re-run with `window.enableCompositeLabRedistribution(false)` to confirm the issue and file a bug with screenshots.
6. While the files remain loaded, inspect the density solver output:
   ```js
   const profile = window.getCompositeDensityProfile?.(95);
   const summary = profile ? Object.fromEntries(
     Object.entries(profile.perChannel || {}).map(([name, stats]) => [
       name,
       {
         constant: Number(stats.constant?.toFixed?.(3) ?? stats.constant ?? 0),
         share: Number(stats.share?.toFixed?.(2) ?? stats.share ?? 0),
         cumulative: Number(stats.cumulative?.toFixed?.(3) ?? stats.cumulative ?? 0)
       }
     ])
   ) : null;
   ({ input: profile?.input, densityDelta: profile?.densityDelta, perChannel: summary });
   ```
Expect constants roughly `{ LK: 0.08, C: 0.15, K: 0.77 }`, 95 % shares dominated by K (≈0.9), and `densityDelta` matching `targetDensity − measuredDensity` (negative in TRIFORCE highlights, near zero in the deepest shadows). If LK spikes above ~0.1, K drops below 0.7, or `densityDelta` mirrors the weighted baseline instead of the target delta, capture the console output and chart for investigation.

## Composite Coverage Summary
Goal: confirm coverage ceilings and usage metrics surface correctly for audits.

### Manual Steps:
1. With `P800_K36C26LK25_V6.quad` and `P800_K36C26LK25_V6.txt` loaded under **Normalized** weighting (auto-raise and smoothing windows enabled), run `window.getCompositeCoverageSummary()` in the console.
2. Verify each active channel reports `limit`, `buffer`, `bufferedLimit`, `used`, `remaining`, and `overflow`. Highlight inks should land near 0.20 with overflow ≤0.005; K should report a larger limit and similar overflow buffer.
3. Toggle composite weighting to **Equal**, re-run the command, and confirm the limits/usage remain unchanged (coverage is weighting-agnostic) while smoothing badges may clear as expected.
4. In the channel table, confirm every Density column now shows a coverage indicator (`Coverage 20.0% / 20.5%`, etc.). Entries that match the console `maxNormalized` should display the same percentages, and rows that are clamped (overflow > 0) should tint amber with a tooltip listing the clamped samples.
5. Capture both the console output and a screenshot of the channel table indicators for the regression log.

Attach console stats and chart screenshots whenever the amplitude drops unexpectedly or the bell channels flatten against the ceiling.

### Optional Automation
- Run `node scripts/analyze_composite_weighting.cjs` to compare legacy (composite off) vs composite totals for TRIFORCE fixtures. The script prints total-ink ratios and warning counts so you can spot amplitude drift without taking manual measurements.

## Density Ladder Sequencing (Normalized weighting)
Goal: confirm Normalized weighting exhausts highlight inks in density order (LK → C → K) and records ladder decisions in composite debug.

### Manual Steps:
1. Launch `index.html` with default flags (auto-raise off, composite per-sample ceiling on). Enable auto-raise if the scenario calls for it, ensure **Composite weighting** remains **Normalized**, and confirm the composite debug overlay is enabled.
2. Load `data/P800_K36C26LK25_V6.quad`, then `data/P800_K36C26LK25_V6.txt`. Wait for the global correction toast, then advance the snapshot slider to indices 5, 21, and 22 (roughly 2 %, 8 %, 8.6 % input).
3. For snapshot 5, confirm LK carries the correction (LK normalizedAfter ≈0.63), C contributes a small increase, and K remains at 0.0. `window.getCompositeDebugState().snapshots[5].ladderSelection` should list LK first, then any secondary contributions.
4. For snapshot 21, check that LK reaches ≈1.0 normalizedAfter with headroom ≈0, C rises above its baseline (normalizedDelta > 0.25), and K stays at 0.0 (delta ≤ 0.005). `ladderSelection` should show LK then C, while `ladderBlocked` lists K blocked by lighter headroom.
5. For snapshot 22, confirm LK remains pegged at 1.0, C continues climbing (normalizedAfter ≈0.28), and K still reports a negligible normalized increase (<0.001). The channel Density column should display amber coverage badges for LK/C only (K stays grey).
6. Inspect `ladderSelection` for LK and C—`floorNormalized` should match the darker stack (baseline or C coverage), `layerNormalized` should report the incremental headroom, and `allowedNormalized` should equal the floating ceiling (baseline + buffer). Record these values along with ladder-blocked messages.
7. Capture a composite debug screenshot if K activates before C or any ladder entries are missing the new fields (floor / layer / allowed).
8. Advance to snapshots 40–60 and confirm LK never flat-lines at 1.0 before the crest (`headroomAfter` stays ≥ 0.035 until ≈ snapshot 52). Verify `frontReserveBase` / `frontReserveApplied` appear in the debug payload and that the LK → C hand-off tapers (|LK valueDelta₅₂ − valueDelta₅₃| ≤ 650). Save the snapshot JSON and chart if the reserve fails to engage.

## Baked LAB Analysis
Goal: ensure `*BAKED*` LAB corrections populate coverage summaries without mutating the underlying curves.

### Manual Steps:
1. Load `P800_K36C26LK25_V6.quad`, then apply the global `*BAKED* P800_K36C26LK25_V6.txt` correction (confirm the status toast shows the `*BAKED*` filename).
2. Open the composite debug overlay (⚙️ Options → **Enable composite debug overlay**) and move the snapshot slider to roughly 72 % input (snapshot 184). Alternatively, run `window.getCompositeDebugState().snapshots[184]` in the console.
3. Verify `deltaDensity` and `inkDelta` are both `0`, and the per-channel table shows `valueDelta = 0` / `normalizedDelta = 0` for K, C, and LK. The plotted curves should remain identical to the loaded `.quad`.
4. Run `window.getCompositeCoverageSummary()` and confirm limits/usage entries populate (C/LK retain their 0.21 / 0.005 buffered ceilings) even though no redistribution occurred.
5. Toggle the composite debug overlay off and on to ensure the snapshot data persists; attach a screenshot or console snippet if any channel reports a non-zero delta.

## Linear Reference Identity Sanity
Goal: ensure a perfectly linear LAB dataset produces zero composite correction and leaves `.quad` curves unchanged.

### Manual Steps:
1. Open `index.html`, set **LAB smoothing** in ⚙️ Options to `0%`.
2. Load `data/TRIFORCE_V4.quad` via **Load .quad** (or any multi-ink baseline you want to sanity-check).
3. Load `testdata/linear_reference_lab.txt` via **Load LAB / Manual** and wait for the status toast.
4. Sample one channel before/after in the console, e.g. `window.sampleGlobalCurve?.(95, 'K')`. Expect deltas ≤ ±6 ink units (rounding noise only). `window.compareAgainstBaseline?.()` should likewise report zero differences.
5. Re-import `testdata/linear_reference_lab.txt` while **LAB smoothing** remains at `0%`. Sample the same channel again—values should match step 4 exactly (no additional smoothing applied on reload).
6. Inspect the density profile at 95 % input:
   ```js
   const profile = window.getCompositeDensityProfile?.(95);
   profile?.densityDelta; // expect ~0
   ```
   The delta should be effectively zero and the per-channel corrected values should match the baseline curve.
7. If you adjusted the slider during experimentation, return it to 0 % to match the studio default.

### Automated Check
- `npx vitest run tests/lab/triforce-linear-reference-identity.test.js`
  - Fails if any channel moves more than 6 ink units or if the normalized delta exceeds 0.2 %.

### Automated Testing with Shell Playwright

You can automate these manual tests using shell Playwright scripts:

```javascript
// test-undo-regression.js - Automate per-channel undo testing
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading quadGEN...');
  await page.goto(`file://${__dirname}/index.html`);
  await page.waitForTimeout(2000);

  // Check initial state
  const initial = await page.evaluate(() => {
    const firstRow = document.querySelector('[data-channel]');
    const channel = firstRow?.dataset.channel;
    const toggle = firstRow?.querySelector('.per-channel-toggle');
    return {
      channel,
      toggleEnabled: toggle ? !toggle.disabled : false,
      toggleChecked: toggle ? toggle.checked : false
    };
  });

  console.log('Initial state:', JSON.stringify(initial, null, 2));

  // TODO: Add file loading and undo simulation
  // This would require additional UI interaction patterns

  await browser.close();
  console.log('✅ Regression test framework ready');
})();
```

### Running Automated Tests:
```bash
npm install --save-dev playwright
npx playwright install chromium
node test-undo-regression.js
```

**Benefits of Automation**:
- Consistent test execution
- Faster regression detection
- Easy integration with CI/CD
- Clean JSON output for validation

## Automated Coverage: LAB Linearization Audits
- `tests/e2e/triforce-correction-audit.spec.ts` drives the Options modal with TRIFORCE datasets, captures correction snapshots at 5 % and 95 %, and saves a JSON artifact (see `tests/e2e/utils/lab-flow.ts` for the shared harness). Use this when validating LAB smoothing, density redistribution, or regression reports.

## Global Scale Undo Screenshot Check
Goal: capture before/after artifacts that confirm the global scale batch history entry.

1. Run `npx playwright test tests/history/batch_operations.spec.ts --reporter=line`.
2. The test saves `batch-scale-applied.png` and `batch-scale-after-undo.png` in the Playwright output directory (for example, `test-results/tests-history-batch_operations-spec.ts/`).
3. Attach those PNGs to the release log or manual QA report so a reviewer can visually confirm the pre-scale and post-undo states.
4. If the screenshots show mismatched toggle states or out-of-date filenames, re-run the regression suite; the undo stack may not be recording batch actions correctly.

## Automated Coverage: Global Scaling *(Phase 0 – Foundation)*
Phase 0 Track 4 regression guards now cover the following flows via Playwright (run automatically by `npm run test:e2e`):

- `tests/e2e/global-scale-baseline-drift.spec.ts` – edits under non-100 % scale return to baseline without drifting cached ends.
- `tests/e2e/global-scale-rapid-undo.spec.ts` – rapid slider scrub (100 %→50 %→100 %) retains history entries and undoes cleanly.
- `tests/e2e/edit-mode-keypoint-scaling.spec.ts` (“adding a Smart point after global scale”) – confirms Smart insertions respect scaled absolute outputs.
- `tests/e2e/global-scale-measurement-revert.spec.ts` – verifies measurement loads survive revert + rescale cycles without baseline cache contamination.

Phase 0 – Foundation tags in the regression matrix:
- **Baseline cache** coverage — recorded against the three Vitest scenarios in `tests/core/scaling-utils-baseline.test.js`.
- **Smart rescaling** coverage — mapped to the audit-mode assisted Playwright scenarios above.
- **Undo/Revert** coverage — tied to `global-scale-rapid-undo.spec.ts` and `global-scale-measurement-revert.spec.ts`.

### Coordinator Parity Checks *(Phase 1)*
- `scripts/diagnostics/compare-coordinator-legacy.js` compares legacy vs. feature-flagged coordinator scaling across randomized command streams (default 10 runs × 200 steps; optional extended run of 10 × 1000 for deeper coverage). Artifacts drop under `artifacts/scaling-coordinator-parity/` with per-seed snapshots and a top-level `summary.json`. Use this before widening the coordinator rollout or after significant scaling logic changes.
- `scripts/diagnostics/compare-coordinator-smart.js` validates coordinator behaviour against legacy while a Smart curve is active (`P700-P900_MK50.quad`, Edit Mode ON). Artifacts land in `artifacts/scaling-coordinator-smart/`.
- `scripts/diagnostics/compare-coordinator-lab.js` loads `cgats17_21step_lab.txt`, applies the measurement globally, and drives a five-step sequence (90→110→70→125→95) to confirm parity under LAB corrections. Results are stored in `artifacts/scaling-coordinator-lab/`.
- `scripts/diagnostics/compare-coordinator-ai.js` invokes `scale_channel_ends_by_percent` via the Lab Tech interface (90→110→70→95) and verifies coordinator parity; artifacts live under `artifacts/scaling-coordinator-ai/`.

Manual spot checks are only required if one of these specs fails or a new scenario is introduced.

## Scaling State – Manual Acceptance (Single Operator)
Use this quick pass whenever the scaling-state flag defaults to ON or after making related changes. It complements the automated harness by confirming the UI, history, and telemetry behave as expected in a real session.

1. Launch the latest `index.html` build (post-`npm run build:agent`) and confirm `Help → Version History` loads normally without the former Scaling State audit panel.
2. In the Global Scale panel, enter `135` and press Enter. Expect the field to snap back to `100`, reflecting the guard against values above the cached maximum.
3. Click **Undo** and **Redo** once each. Verify the scale input returns to the prior value (`90` after redo in the current workflow) and that no console warnings/errors appear in DevTools.
4. Open the DevTools console and run `window.validateScalingStateSync()`; ensure it logs success without mismatches.
5. Capture the current scaling audit snapshot (if available) via:
   ```js
   JSON.stringify(window.scalingStateAudit, null, 2)
   ```
   Attach the JSON to your QA notes alongside the harness artifact names used for this release.

If any step fails, toggle the flag off with `window.setScalingStateEnabled(false)`, re-run the harness to capture recovery metrics, and file an issue before re-enabling the flag.
