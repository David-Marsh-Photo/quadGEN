# quadGEN User Guide

> Museum-grade calibration for digital negatives, fine art printmaking, and alt-process workflows.

## 1. About This Guide
This guide explains what quadGEN does, who it is for, and how to use it in a real studio environment. It focuses on the three workflows we run most often: building starter `.quad` curves, linearizing with LAB measurements, and bringing in tone curves from tools like Easy Digital Negatives (EDN). The content pulls directly from the quadGEN project—no outside assumptions required.

### Intended Audience
- Hobbyist printers experimenting with monochrome digital negatives.
- Photographers running small studio editions or proofing in-house.
- Fine art studios and service bureaus who handle repeatable alt-process production.

### What You Should Already Know
- How to print a grayscale step wedge through QuadToneRIP (QTR) or an equivalent RIP.
- How to capture LAB measurements (L*) from a printed wedge, or at least how to export EDN/Photoshop curves.
- Basic familiarity with inspecting curves and interpreting tone diagrams.

If you are completely new to QTR or L* measurements, start with the Quick Start Workflow below and the measurement pipeline notes in `docs/print_linearization_guide.md`.

## 2. Quick Start Workflow
This loop keeps calibrations predictable when you’re setting up a new printer/paper/process combination.

### Quick Checklist
- Confirm printer layout, channel enables, ink limits, and any known density constants before exporting.
- Save a “v0” identity `.quad` for comparison.
- After each measurement import, verify the active correction method (Simple Scaling vs Density Solver) and capture a chart screenshot if behaviour changes unexpectedly.
- Run `npm run test:smoke` after code or documentation updates to confirm the bundle still loads without console errors.

### Step 1 — Choose Printer Layout and Baseline Limits
Launch the current `index.html` build, select the template that matches your installed inks, and double-check channel labels. Start with conservative End values; auto-raise can extend limits later, but a safe baseline protects highlights. If the channel table exposes Density inputs, enter studio defaults (K/MK 1.00, C 0.21, LK 0.054) and leave other channels blank so the solver can infer them from measurements.

### Step 2 — Export the Baseline `.quad`
With the layout configured, export a linear ramp via Global Corrections → `Export .quad`. The identity curve respects your current enables, End values, and density constants. Install it in QuadToneRIP’s `quad` folder and label it clearly (e.g., `Printer_Paper_v0.quad`) so you can revert later.

### Step 3 — Print the Step Wedge
Print a 0–100 % wedge (or 21/25-step target) through QTR/Print-Tool using the baseline `.quad`. Disable color management completely. Note paper, ink lot, printer mode, and environmental conditions alongside the physical wedge.

### Step 4 — Measure and Archive LAB Data
Measure each patch’s L* and export a tab-delimited `.txt` with header `GRAY	LAB_L	LAB_A	LAB_B`. Confirm GRAY% values ascend 0→100 and L* stays within range. Store the measurement in `data/` with a versioned name (`Printer_Paper_V1.txt`) before loading it into quadGEN.

### Step 5 — Load Measurements in quadGEN
Use Global Corrections → `Load Data File` to import the LAB set. Confirm the normalization mode (perceptual L* is default; enable “Use log-density…” for through-light workflows) and ensure the Print Intent matches the measurement’s intent. Stick with **Simple Scaling** unless you intentionally need the ladder-based Density Solver pipeline.

### Step 6 — Review the Global Correction
Inspect the chart (output ink vs input ink). Dips below the diagonal indicate dark prints; humps above the diagonal show light patches. Adjust the LAB smoothing slider only when data are noisy. If Auto White/Black limit toggles are active, remember that recompute will bake `bakedAutoWhite`/`bakedAutoBlack` metadata for traceability.

### Step 7 — Optional Advanced Adjustments
Switch to Density Solver when composite redistribution telemetry is required, making sure density constants are populated or computed. Apply contrast intents (Linear, Soft, Hard, Filmic, Gamma, Custom) or manual L* targets as needed; intents stack on top of the measurement correction.

### Step 8 — Edit Mode Touch-Up
Toggle Edit Mode to expose Smart Key Points, then Recompute to seed them from the plotted curve. Adjust via XY inputs or drag (if enabled). When a change demands more ink than the current End, quadGEN either auto-raises (with a status toast) or blocks the edit if the channel is locked.

### Step 9 — Export, Install, and Verify
Export the corrected `.quad`, install it in QTR, and log the filename, measurement source, and intent. Reprint the wedge, re-measure, and compare against the diagonal. Iterate until the curve tracks the target with acceptable midtone deviation while keeping endpoints anchored.

### Step 10 — Iterate and QA
Archive measurement files, exported curves, screenshots, and console logs (`DEBUG_LOGS = true` helps) so future investigations have context. Use `docs/manual_tests.md` for the regression checklist (undo toggles, auto-raise + smoothing interplay, Edit Mode guardrails) before shipping updates.

## 3. quadGEN in the Studio Workflow
quadGEN is a browser-based calibration workbench. It lets you:
- Configure printer channels, ink limits, and export `.quad` control files for QTR.
- Load LAB measurement sets, .acv curves, or .cube LUTs to generate corrections.
- Visualize corrections in printer space (ink out vs input ink), ensuring smooth, monotone mappings.
- Tweak curves with Smart Key Points in Edit Mode with full undo/redo.
- Apply contrast intents (Linear, Soft, Hard, Filmic, Gamma, Custom) and optional auto endpoint rolloff knees.

Typical production sequence:
1. Build a starter `.quad` that matches your printer’s channel layout and safe ink limits.
2. Print a step wedge, measure in LAB, and import data to linearize tone.
3. Optional: Bake contrast intent or EDN-derived curves once the base is linear.
4. Export the calibrated `.quad` and keep iterating until tone matches your target process.

## 4. Accessing quadGEN
You can run quadGEN directly from the hosted build or work offline with a downloaded copy.

- **Hosted (recommended)**: Visit [https://quadgen.ink/](https://quadgen.ink/) in a modern browser. The page serves the latest modular `index.html`. Keep DevTools handy—you can toggle `DEBUG_LOGS = true` or `DEBUG_AI = true` in the console whenever you need deeper traces.
- **Offline reference**: Download `https://quadgen.ink/index.html` and save it alongside the project assets (or use “Save Page As → Webpage, Complete” to capture dependencies). Open the saved file in your browser when you need to inspect the UI without network access. If you need the retired single-file build for historical comparison, copies now live under `archives/legacy-singlefile/` in the repo.

## 5. Interface Tour
quadGEN’s UI is organized around a few panels:

- **Channel Table**: Enable/disable channels, set `End` (ink limits), and monitor source files (LAB, .acv, .cube, .quad). Ink limits control the ceiling for each ink set.
- **Global Corrections**: Load LAB data or tone curves that apply across all channels. This panel also hosts Auto White/Black limit toggles.
- **Per-Channel Corrections**: Load or edit curves per channel. Each channel can mix measurement data, Smart edits, and intents.
- **Edit Curves Panel (Edit Mode)**: Toggle Edit Mode to expose Smart Key Points for fine tuning. Recompute regenerates Smart Key Points from the currently plotted curve using the adaptive simplifier.
- **Chart Area**: Displays Y = output ink % vs X = input %. The diagonal Y = X is the “no correction” reference. Zoom controls sit at the lower left. Cursor readouts follow the selected channel.
- **Help Drawer**: ReadMe, Glossary, and Version History live here. This guide is a supplemental document and does not replace in-app help.
- **Options Panel**: Open the ⚙️ Options button beside Help to manage global preferences (e.g., the log-density normalization toggle).

Keep the manual regression checklist handy (`docs/manual_tests.md`) when verifying undo toggles, Edit Mode states, and other UX details after changes.

## 6. Core Concepts

### Printer-Space Mapping
quadGEN plots how much ink the printer will output (Y) for each input percentage (X). If a patch printed too dark, the correction brings Y below the diagonal, cutting ink at that input. If it printed too light, Y rises above the diagonal to add ink. Always interpret curves in printer space, not Photoshop luminance space.

### `.quad` Files
`.quad` files are 256-entry lookup tables consumed by QuadToneRIP. Channels map to ink positions (e.g., `K`, `C`, `M`, `Y`, or custom alt-process pigments). Summary of the format: see `docs/File_Specs/QTR_QUAD_SPEC_SUMMARY.md`.

### LAB Measurements
LAB `.txt` measurement files list `GRAY%` and `L*` per patch. quadGEN can normalize directly in L* (default) for perceptual printer linearization, or convert to optical density when the log-density toggle is enabled in the ⚙️ Options panel (also mirrored inside the Manual L* modal). In either mode it compares the measured curve against the ideal ramp and produces a smooth correction using the PCHIP interpolator; the LAB smoothing slider now opens at 0 % (baseline widen ×1.0) and lets you dial in additional smoothing between 0–300 % (e.g., 50 % ≈ ×1.27) when you need noise reduction. Details: `docs/print_linearization_guide.md`.

### Correction Pipelines
- **Simple Scaling (default)** multiplies the loaded channel curves by a smoothed gain envelope derived from the measured error. The envelope is capped to ±15 % per channel, keeps K/MK locked to avoid unplanned black expansion, and redistributes overflow into darker reserves so lighter inks do not double when they hit capacity. Fresh sessions, cleared storage, and new operators all start here. Toggle it from ⚙️ Options → **Correction method**.
- **Density Solver (advanced)** preserves the legacy composite redistribution engine documented in `docs/features/channel-density-solver.md`. Switch to it when you need density-ladder promotions, coverage ceilings, and the composite debug tooling for multi-ink balancing.
- Changing methods immediately reprocesses the active LAB or Manual dataset, updates overlays (dashed baseline, light-blocking line, purple reference), and leaves an undo entry so you can compare outputs quickly.

### Smart Key Points & Edit Mode
Smart Key Points are editable control points derived from the plotted curve. Edit Mode exposes these Key Points, supports insertion/deletion, and records every action for undo/redo. Recompute pulls fresh Key Points from the current curve while tagging baked metadata (`bakedGlobal`, `bakedAutoWhite`, `bakedAutoBlack`) when auto rolloff is active.

### Contrast Intents and Auto Endpoint Rolloff
Intents reshape tone globally (Linear, Soft, Hard, Filmic, Gamma, or Custom slider/paste). Auto White/Black limit toggles apply localized soft knees to prevent clipped highlights or shadows. Rolloff metadata is baked when you recompute Smart Key Points with a rolloff enabled, preventing double application when reloading data.

## 7. Workflow A — Build a Starter `.quad`
This is the baseline for any new printer/paper/process combo.

1. **Select Printer Layout**
   - Launch quadGEN and pick the printer model/template that matches your hardware.
   - Confirm channel order and labels match your inks.

2. **Set Initial Ink Limits**
   - In the Channel table, set `End` for each ink to a conservative starting point (e.g., 60–70% for dense blacks). For specialty processes, lean toward lower values to avoid blocking up highlights.
   - Leave per-channel sliders disabled until measurements are available; the goal is a neutral ramp.

3. **Verify Intent and Rolloff**
   - Keep contrast intent on `Linear` and disable Auto White limit unless you already know highlights clip. Leave Auto Black limit ON (default) for safety.

4. **Export Linear Ramp**
   - Use Global Corrections → Export `.quad`. This writes an identity curve respecting your channel enables and End caps.
   - Install the file into QTR’s `quad` folder per QTR documentation.

5. **Print and Inspect**
   - Through QTR or Print-Tool (macOS), print a 0–100% step wedge using the new `.quad`.
   - Disable color management at print time.

6. **Archive the Baseline**
   - Keep the exported `.quad` as your “v0” baseline. You’ll iterate on copies as measurements refine the curve.

## 8. Workflow B — Linearize with LAB Measurements
Once the baseline wedge is printed and measured, use LAB data to refine tone.

1. **Measure the Wedge**
   - Capture L* for each step (Color Muse 2 or equivalent). Export as a tab-separated `.txt` with header `GRAY	LAB_L	LAB_A	LAB_B`.

2. **Load LAB Data**
   - In quadGEN, choose Global Corrections → Load LAB. You can also load per-channel LAB data if you measured channels separately.
   - Ensure `GRAY%` values ascend and cover 0–100%. If any values are out of range, fix them before loading.

3. **Review the Curve**
   - The chart updates immediately. Look for dips (printing too dark) and humps (too light). Hover to inspect specific inputs.
   - Toggle Auto limit rolloff if highlights/shadows plateau before 0% or 100%.

4. **Optionally Enter Edit Mode**
   - If you need to fine-tune, enter Edit Mode.
   - Recompute Smart Key Points to match the plotted curve, then adjust Key Points numerically or via cursor.
   - Remember: End raising happens automatically if a Key Point requires more ink than the current cap, unless the channel is locked.

5. **Export Corrected `.quad`**
   - Use Export `.quad` to write the corrected curve. Install it in QTR.

6. **Reprint and Validate**
   - Print the step wedge again, measure, and compare. Iterate until deviations fall within acceptable tolerances. Typical targets: smooth monotonic curve with <1–2% midtone error.

7. **Document the Result**
   - Note the measurement date, paper batch, and intent in your lab log. If the curve will ship to clients, capture screenshots of the final curve for reference.

### Real-World Scenario: Platinum/Palladium Edition
- **Objective**: Neutralize midtone compression on a matte Pt/Pd paper.
- **Baseline**: Exported linear `.quad` with K End at 55%, warm ink channels disabled.
- **Action**: Load LAB measurements from the first print. quadGEN reveals a midtone hump (~40–60% inputs) indicating washed-out detail.
- **Adjustment**: Enable Edit Mode, insert a Smart Key Point at 50%, pull the output down ~4%. Auto Black limit remains ON to keep the shoulder smooth.
- **Result**: Export new `.quad`, reprint, and confirm midtones track the diagonal closely while deep shadows hold separation.

## 9. Workflow C — Importing EDN or Photoshop Curves
EDN `.acv` files and LUTs can seed corrections or intents once a baseline is established.

1. **Prepare the Source**
   - Export the curve from EDN or Photoshop as `.acv` or `.cube`. quadGEN auto-aligns orientation to printer space (no extra mirroring needed).

2. **Decide on Scope**
   - For a global correction (applies to all channels), use Global Corrections → Load Data File and choose `.acv`/`.cube`.
   - For channel-specific edits, use the per-channel Load controls.

3. **Check the Plot**
   - Verify the imported curve behaves as expected: EDN “lighten” curves should dip below the diagonal in printer space, matching reduced ink.

4. **Blend with LAB Data (Optional)**
   - You can stack an imported curve with LAB measurement corrections. Ensure you understand the combined effect—stacking may over-correct if the curves target similar tonal zones.

5. **Bake into Smart Edits**
   - Enter Edit Mode and Recompute to capture the imported curve as Smart Key Points. This tags metadata so auto rolloff or global corrections aren't re-applied accidentally.

6. **Finalize and Export**
   - Once satisfied, export the `.quad` and log the source of the EDN curve for traceability.

### Use Case: Hybrid LAB + EDN Contrast
- Linearize with LAB to neutralize printer drift.
- Apply an EDN curve globally for desired punch or softness.
- Optionally toggle Auto Black limit if the EDN curve pushes shadows to the ceiling.
- Recompute Smart Key Points to bake in the EDN shape, then hand-tune with Edit Mode if necessary.

## 10. Edit Mode Best Practices
- Recompute sparingly: Only after major changes or when auto rolloff toggles change. This keeps Smart metadata (e.g., `bakedGlobal`, `bakedAutoWhite`) consistent.
- Use the XY field for precise adjustments tied to L* targets. Remember Y is absolute after End.
- Insert Key Points directly on the curve for localized tweaks; avoid over-populating with unnecessary Key Points (default max Key Points is 16 for a reason).
- Undo/redo is your safety net—use it liberally when experimenting. It now tracks per-channel slider edits, global scaling, and LAB/LUT loads on the same timeline.
- When you change channel End while a Smart edit is active, quadGEN rescales other Key Points; verify the overall curve before exporting.

## 11. Auto Endpoint Rolloff & Intents
- **Auto White Limit** (`autoWhiteLimitToggle`): Adds a soft shoulder to highlight zones when the curve clips early. Default OFF.
- **Auto Black Limit** (`autoBlackLimitToggle`): Adds a toe to protect deep shadows. Default ON.
- **Persistence**: User preferences store as `autoWhiteLimitV1` / `autoBlackLimitV1`. Recompute with an active rolloff bakes metadata (`bakedAutoWhite` / `bakedAutoBlack`).
- **Contrast Intents**: Switch via the Intent dropdown. Linear is baseline; Soft, Hard, Filmic, and Gamma preset tone shaping. Custom slider or paste actions can create bespoke looks. Applying intents is undoable and updates filename tags to reflect the chosen intent.
- **Stacking Strategy**: Keep measurement-based linearization as the foundation. Apply intents afterward, and reprint a proof if the intent significantly changes tonal balance.

## 12. Exporting and Archiving
- Use consistent naming: include printer, paper, date, and intent (e.g., `3880_PtPd_Reference_v2025-02-12.quad`).
- Retain original measurement files alongside exported `.quad` curves for traceability.
- Update your studio change log (outside this repo) with what changed, why, and any QA steps performed.
- If multiple technicians share the workstation, agree on a file structure in QTR’s `quad` folder to avoid overwriting reference curves.

## 13. Troubleshooting Checklist
- **Curve appears mirrored**: Confirm you are interpreting printer-space mapping. Refer to `docs/print_linearization_guide.md` for orientation tips and normalization notes.
- **Nothing happens when editing**: Ensure Edit Mode is ON and the target channel is enabled.
- **Per-channel slider re-enables unexpectedly**: Undo restores toggle states; if sliders stay active after undo, re-run the regression matrix (`docs/manual_tests.md`).
- **Measurements rejected**: Check that `GRAY%` values ascend and that all `L*` values fall within 0–100.
- **Highlights blocked up**: Enable Auto White limit or reduce channel End percentages.
- **Shadows crushed**: Lower Auto Black intensity or confirm your measurement data include solid black patches.
- **Intent mismatch warning**: quadGEN tracks the intent when a LAB file was captured. If you change intent later, consider reprinting or switch back to match the measurement.

## 14. Reference & Further Reading
- Quick Start Workflow — see section 2 of this guide.
- `docs/print_linearization_guide.md` — ground-truth math for LAB and manual L* processing.
- `docs/features/auto-limit-rolloff.md` — background on rolloff detection, shaping, and POPS parity.
- `docs/features/contrast-intents.md` — intent math, presets, and customization workflow.
- `docs/features/correction-vs-intent.md` — quick reference explaining tuning vs. creative interpretation.
- `docs/File_Specs/` — format specs for `.quad`, `.acv`, `.cube`, and LAB `.txt` files.
- `docs/POPS_vs_quadGEN_report.md` — comparative analysis vs the POPS profiler.

## 15. Maintaining the Guide
- Update this document when quadGEN adds new user-facing controls or workflows.
- Cross-check in-app Help (ReadMe/Glossary/Version History) if behaviors change; this guide supplements but does not replace those tabs.
- Keep screenshots and process notes in a shared studio folder so technicians can pair visual aids with these instructions when training new staff.

---
*Prepared for the quadGEN print studio team — ensure every negative and print leaves the lab with predictable, repeatable tone.*
