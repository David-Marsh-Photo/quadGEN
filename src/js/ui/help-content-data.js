// Help content data extracted from legacy source.
// Generated to retire src/extracted_javascript.js dependencies.

import { APP_RELEASE_CHANNEL } from '../core/version.js';

export const VERSION_HISTORY = {
  'Unreleased': {
    date: '—',
    title: 'In progress',
    sections: {
      ADDED: [],
      CHANGED: [],
      FIXED: [],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: []
  },
  '3.0.4': {
    date: '2025-10-04',
    title: 'Smart baking guard',
    sections: {
      ADDED: [],
      CHANGED: [],
      FIXED: [
        'Smart curve baking now reseeds the full LAB measurement set and marks the graph status as *BAKED* on first enable, avoiding the two-point collapse regression.',
        'Global revert button disables once LAB data is baked into Smart curves so you aren’t led to a silent no-op; undo remains available for rollbacks.'
      ],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Smart Baking', desc: 'LAB corrections converted into Smart curves keep every measurement point and display the *BAKED* tag immediately.' },
      { label: 'Revert Guard', desc: 'Once a correction is baked, the global revert control deactivates—undo is the path back to raw measurements.' }
    ]
  },
  '3.0.3': {
    date: '2025-10-03',
    title: 'Smart scaling polish',
    sections: {
      ADDED: [
        'Added a Playwright regression that verifies inserting a Smart point with MK limited to 50% lands on the plotted curve.',
        'Added a Playwright regression that exercises global Scale with Edit Mode enabled so Smart curves stay aligned after ink-limit changes.'
      ],
      CHANGED: [],
      FIXED: [
        'Smart point insertion and recompute now respect per-channel ink limits, eliminating the double-scaled plots and missing markers introduced after the scaling tweaks.',
        'Global scale now preserves Smart curve positioning by skipping the redundant relative-output rescale, preventing the 0.8^2 shrink when scaling after edits, and per-channel edits reapply the active Scale so you can’t bypass the multiplier.'
      ],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Smart Points', desc: 'Editing Smart curves with reduced ink limits no longer double scales the plot or drops control points.' },
      { label: 'Regression Suite', desc: 'New Playwright coverage keeps Smart-point insertion and global Scale interactions stable.' }
    ]
  },
  '3.0.2': {
    date: '2025-10-03',
    title: 'Global + Nudge polish',
    sections: {
      ADDED: [
        'Added a Playwright regression to confirm the Edit Mode Delete button removes an interior Smart key point as expected.',
        'Added a Playwright regression that covers LK ink-limit edits after toggling Edit Mode so the state stays in sync.',
        'Added a Playwright regression that flips the global correction toggle to ensure LAB data can be disabled and re-enabled.',
        'Added a Playwright regression that verifies Edit Mode nudges stay at a 1% step even with zoom and reduced ink limits.'
      ],
      CHANGED: [],
      FIXED: [
        'Edit Mode Delete button removes the selected Smart key point again instead of doing nothing.',
        'LK per-channel scaling now increases the ink limit when you raise the percentage after leaving Edit Mode.',
        'Global correction toggle now actually disables the loaded LAB correction until you turn it back on.',
        'Edit Mode nudges now move points by exactly 1% in chart space; zoom and reduced ink limits no longer amplify the step.'
      ],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Smart Point Nudges', desc: 'Edit Mode nudges now move Smart points by exactly 1% even after you zoom the chart or limit channel ink.' },
      { label: 'LAB Toggle', desc: 'Global LAB/LUT corrections truly disable when you flip the toggle off, matching the legacy behaviour.' },
      { label: 'Regression Coverage', desc: 'Playwright tests cover Delete button, LK scaling, global toggle, and Smart-point nudges.' }
    ]
  },
  '3.0.1': {
    date: '2025-10-02',
    title: 'Intent remap parity',
    sections: {
      ADDED: [
        'Added a Playwright regression to confirm the Intent dropdown enables after loading a .quad file.'
      ],
      CHANGED: [],
      FIXED: [
        'Restored PoPS Matte, PoPS Uncoated, and PoPS Uncoated (softer) intent presets so the modular dropdown matches the legacy single-file build.',
        'Intent dropdown now enables automatically after loading a .quad whenever no LAB/CGATS measurement is active.'
      ],
      REMOVED: [
        'Removed the legacy parity harnesses that relied on `quadgen.html`; automated tests now target modular quadGEN only.'
      ],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Contrast Intent Parity', desc: 'PoPS Matte/Uncoated presets return to the modular dropdown, matching the legacy quadGEN lineup.' },
      { label: 'Intent Remap', desc: 'Intent dropdown now enables automatically after you load a .quad when no LAB/CGATS data is active.' },
      { label: 'Regression Coverage', desc: 'New Playwright regression verifies the Intent controls stay enabled after loading .quad files.' },
      { label: 'Test Suite Cleanup', desc: 'Legacy parity harnesses tied to quadgen.html were retired so automated checks focus on the modular build.' }
    ]
  },
  '3.0.0': {
    date: '2025-10-01',
    title: 'Modular milestone',
    sections: {
      ADDED: [],
      CHANGED: [
        'Modularization work: retired `src/extracted_javascript.js`; every UI panel, parser, and history hook now imports shared ES modules.',
        'Modularization work: rebuilt global/per-channel revert and Edit Mode to share the measurement-seed/state helpers used by Lab Tech.',
        'Modularization work: consolidated file ingestion (.quad, LAB/CGATS/CTI3, Manual L*, LUT, ACV) onto the modular printer-space pipeline with consistent smoothing/metadata.',
        'Modularization work: reorganized the workspace (`src/`, `scripts/`, `docs/`, `archives/`) and documented a regeneration toolchain (architecture map, doc index, Playwright guard).',
        'Benefits: clear separation of concerns—state management, UI, parsing, and math live in focused modules, simplifying onboarding and review.',
        'Benefits: undo/redo, Lab Tech automation, and manual UI share codepaths, reducing drift and regression risk.',
        'Benefits: file handling parity across sources enables centralized future tweaks with consistent smoothing/anchoring.',
        'Benefits: cleaner project tree keeps builds/tests/docs aligned with the modular distribution.',
        'Benefits: modular structure improves portability; the same source can be bundled for web, packaged for desktop, or embedded in other tooling.'
      ],
      FIXED: [],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Modularization Work', desc: 'Modularization work: retired `src/extracted_javascript.js`; every UI panel, parser, and history hook now imports shared ES modules.' },
      { label: 'Modularization Work', desc: 'Modularization work: rebuilt global/per-channel revert and Edit Mode to share the measurement-seed/state helpers used by Lab Tech.' },
      { label: 'Modularization Work', desc: 'Modularization work: consolidated file ingestion (.quad, LAB/CGATS/CTI3, Manual L*, LUT, ACV) onto the modular printer-space pipeline with consistent smoothing/metadata.' },
      { label: 'Modularization Work', desc: 'Modularization work: reorganized the workspace (`src/`, `scripts/`, `docs/`, `archives/`) and documented a regeneration toolchain (architecture map, doc index, Playwright guard).' },
      { label: 'Benefits', desc: 'Benefits: clear separation of concerns—state management, UI, parsing, and math live in focused modules, simplifying onboarding and review.' },
      { label: 'Benefits', desc: 'Benefits: undo/redo, Lab Tech automation, and manual UI share codepaths, reducing drift and regression risk.' },
      { label: 'Benefits', desc: 'Benefits: file handling parity across sources enables centralized future tweaks with consistent smoothing/anchoring.' },
      { label: 'Benefits', desc: 'Benefits: cleaner project tree keeps builds/tests/docs aligned with the modular distribution.' },
      { label: 'Benefits', desc: 'Benefits: modular structure improves portability; the same source can be bundled for web, packaged for desktop, or embedded in other tooling.' }
    ]
  },
  '2.6.4': {
    date: '2025-09-27',
    title: 'Legacy LAB/CGATS alignment',
    sections: {
      ADDED: [],
      CHANGED: [],
      FIXED: [
        'Legacy LAB loader and manual L* entry now use the printer-space inversion helper (density smoothing + PCHIP) so symmetric datasets cross at 50% without flattening.',
        'Legacy CGATS/CTI3 imports share the same inversion helper, keeping plotted curves monotone with anchored endpoints and matching smoothing previews.'
      ],
      REMOVED: [],
      DOCS: [
        'Updated CGATS.17 spec summary in the Help documentation to note the shared inversion workflow.'
      ]
    },
    aboutDialog: [
      { label: 'LAB & CGATS Parity', desc: 'Legacy quadGEN now matches the modular printer-space inversion, so LAB, manual, and CGATS curves line up.' },
      { label: 'Documentation', desc: 'CGATS.17 spec entry explains the shared inversion + smoothing behaviour.' }
    ]
  },
  '2.6.3': {
    date: '2025-09-21',
    title: 'Scale control handoff',
    sections: {
      ADDED: [],
      CHANGED: [
        'Lab Tech AI exposes scale_channel_ends_by_percent, so the assistant can drive the global Scale control directly.',
        'Use the Scale field above the channel list to adjust every End value proportionally.',
        'Global Scale input now auto-clamps once any channel would reach 100% (65,535) and accepts entries up to 1000% for proportional boosts.',
        'Graph labels track the highest ink value on each curve so low-limit channels no longer display inflated percentages.',
        'Removed the dotted intent reference overlay when only a .quad curve is loaded for a cleaner plot.'
      ],
      FIXED: [
        'Global Scale control now scales against per-channel baselines, so 90% → 95% applies once instead of stacking and channel edits no longer throw baseline errors.',
        'Printer initialization defers intent guards until a .quad is loaded, eliminating the missing hasLoadedQuadCurves reference on startup.'
      ],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Scale Control', desc: 'Global Scale reuses cached baselines—90%→95% no longer compounds and channel edits stay clean.' },
      { label: 'Scale Field', desc: 'Use the Scale field above the channel list to adjust every End value proportionally.' },
      { label: 'Auto Clamp', desc: 'Scaling stops automatically when the first channel would hit 100% ink (65,535), and the input now accepts up to 1000%.' },
      { label: 'Chart Labels', desc: 'Ink labels sit at the peak ink value, so flat curves report the true endpoint.' },
      { label: 'Clean Plot', desc: 'The dotted intent reference is hidden when only a .quad is loaded, keeping the chart uncluttered.' },
      { label: 'Lab Tech', desc: 'Assistant can set the Scale via scale_channel_ends_by_percent without touching individual channels.' }
    ]
  },
  '2.6.2': {
    date: '2025-09-20',
    title: '1D LUT limit increase',
    sections: {
      ADDED: [],
      CHANGED: [
        '1D .cube parser now accepts up to 256 samples even without a LUT_1D_SIZE header.'
      ],
      FIXED: [],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: '1D LUT Support', desc: '1D .cube imports now handle up to 256 samples; include LUT_1D_SIZE when possible for clarity.' }
    ]
  },
  '2.6.1': {
    date: '2025-09-20',
    title: 'Intent remap guard + opt-in sweeps',
    sections: {
      ADDED: [],
      CHANGED: [
        'Intent tuning sweep tests now skip by default; set QUADGEN_ENABLE_TUNING_SWEEPS=1 to run the long-form harness.'
      ],
      FIXED: [
        'Apply Intent remains available after loading a global .acv or .cube; it only disables when active LAB/CGATS/TI3 measurement data is applied.'
      ],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Intent Remap Guard', desc: 'Apply Intent stays available after loading global .acv/.cube data unless a LAB/CGATS/TI3 measurement is active.' }
    ]
  },
  '2.6.0': {
    date: '2025-09-20',
    title: 'CGATS parity + rolloff pause',
    sections: {
      ADDED: [
        'Recognized Argyll CTI3 (.ti3) measurement files alongside CGATS.17 for LAB linearization imports.'
      ],
      CHANGED: [
        'Standardized all user-facing terminology to say “Key Point” across labels, tooltips, and status messages.',
        'Auto white/black limit rolloff controls are temporarily hidden while we retune the detector; no automatic knees apply in this build.'
      ],
      FIXED: [
        'CGATS.17 importer now treats CMY values within ±2.5% as neutral, keeping K-only ramps aligned with their LAB counterparts.'
      ],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'CGATS.17 Support', desc: 'Import CGATS.17 grayscale measurement sets natively for LAB linearization.' },
      { label: 'Argyll CTI3', desc: 'Load Argyll-style .ti3 files directly—handled with the same parser and parity checks as CGATS.17.' },
      { label: 'Auto Rolloff', desc: 'White/black auto limit knees are offline for now; curves export exactly as plotted.' }
    ]
  },
  'v2.5.3': {
    date: '2025-09-19',
    title: 'Glossary hardware refresh',
    sections: {
      ADDED: [
        'Glossary now covers Colorimeters, Spectrophotometers, and the Epson P900, with direct links to recommended devices.'
      ],
      CHANGED: [],
      FIXED: [],
      REMOVED: [],
      DOCS: [
        'ReadMe and Help updated with Epson trademark notice plus Nix Spectro L guidance for spectrophotometer workflows.'
      ]
    },
    aboutDialog: [
      { label: 'Glossary/documentation', desc: 'Added more glossary entries, other documentation edits.' }
    ]
  },
  'v2.5.2': {
    date: '2025-09-19',
    title: 'LAB revert guard + debug trims',
    sections: {
      ADDED: [
        'Lab Tech now understands extended zoom phrases like “zoom way in” or “zoom all the way out,” mapping them to the chart controls automatically.',
        'Automated smoke test (`tests/load_quad_smoke.spec.js`) verifies `.quad` loading succeeds without runtime errors.'
      ],
      CHANGED: [],
      FIXED: [
        'Edit Mode now seeds Smart curves from every LAB patch (up to 64) and restores the original measurement ink limit after Smart edits, so toggling Edit Mode or reverting no longer hides patches or shrinks endpoints.',
        'Revert to Measurement now clears LAB linearization data before restoring the .quad, eliminating shrunken endpoints when Edit Mode is re-enabled.'
      ],
      REMOVED: [],
      DOCS: [
        'Updated in-app ReadMe installation links and `docs/quadgen_user_guide.md` to point to the primary domain `https://quadgen.ink/`.',
        'Replaced “master” terminology with “reference” in documentation and in-app help to reflect preferred language.',
        'Added a glossary entry defining “reference curve” to keep Help → Glossary aligned with the new terminology.'
      ]
    },
    aboutDialog: [
      { label: 'LAB Revert Guard', desc: 'Global revert now restores the original measurement ink limit, so Edit Mode comes back with the full patch set intact.' }
    ]
  },
  'v2.5.1': {
    date: '2025-09-18',
    title: 'Zoom presets + curve stability',
    sections: {
      ADDED: [
        'Chart zoom controls (+/−) rescale the ink plot, persist per browser, and expose Lab Tech commands (`set_chart_zoom`, `nudge_chart_zoom`).',
        'Tests/chart_zoom.spec.js exercises the zoom helpers (percent↔Y mapping, persistence, button guards).',
        'Lab Tech understands simple “zoom in” / “zoom out” phrasing and routes it to the controls.'
      ],
      CHANGED: [
        'Zoom now steps through clean 10% increments and clamps to the highest active ink limit so 100% curves stay visible.',
        'Graph grids, axes, overlays, and tooltips all derive from the active zoom so the Y-axis always matches what you see.'
      ],
      FIXED: [
        'Undo/redo of Smart key-point edits keeps the rest of the curve stable; only the edited point moves when you step backward or forward.',
        '“+” now magnifies (lower max) and “−” zooms out, matching expectations.'
      ],
      REMOVED: [],
      DOCS: [
        'Help → ReadMe & Detailed Workflow, QUADGEN_README.md, and AGENTS.md document the zoom workflow and automation hooks.'
      ]
    },
    aboutDialog: [
      { label: 'Zoom Presets', desc: 'Use the +/− control (or Lab Tech commands) to step through 10% zoom levels without ever cropping active ink limits.' },
      { label: 'Stable Undo', desc: 'Smart key-point undo/redo keeps the rest of your curve anchored so only the edited point moves.' }
    ]
  },
  'v2.5.0': {
    date: '2025-09-17',
    title: 'Intent remap automation + button polish',
    sections: {
      ADDED: [
        'Apply Intent now bakes the selected preset into the loaded .quad even when no LAB/manual data is active—ideal for branching variants from a reference linear profile.',
        'Lab Tech assistant can call apply_intent_to_loaded_quad() to bake the current preset without manual clicks.'
      ],
      CHANGED: [],
      FIXED: [],
      REMOVED: [],
      DOCS: []
    },
    aboutDialog: [
      { label: 'Added', desc: 'Apply Intent to bake contrast intents into your loaded .quad—even without LAB data.' },
      { label: 'Lab Tech Automation', desc: 'Lab Tech can invoke apply_intent_to_loaded_quad() to bake the current preset on command.' }
    ]
  },
  'v2.4.0': {
    date: '2025-09-16',
    title: 'Centralized printer-space pipeline + POPS smoothing defaults',
    sections: {
      ADDED: [
        'Printer-space sanity fixtures with FEATURE_EXPECTATIONS guide so you can spot curve regressions quickly.',
        'Node scripts cover DataSpace conversions, make256 helpers, and automated intent sweeps; history flow spec stubbed for headless undo/redo.',
        'Debug-only Intent Tuning panel (enable DEBUG_INTENT_TUNING) to audition smoothing and LAB overrides inside quadGEN.',
        '“Apply to Loaded Curve” button lets you bake the active intent into a loaded .quad without re-running LAB corrections.'
      ],
      CHANGED: [
        'Auto white/black limit rolloff controls are temporarily hidden and no longer apply knees while we retune the detector for consistency.',
        'Measurement rebuild now defaults to POPS-style smoothing (PCHIP with 30% primary + 1×30% post) and LAB bandwidth overrides (K=2, σ_floor=0.036, σ_ceil=0.15, σ_alpha=2.0).',
        'DataSpace now owns every image→printer conversion; loaders tag missing sourceSpace metadata and make256 helpers were split out for clarity.',
        'Undo/redo shares a single timeline so intent swaps, channel edits, and history snapshots stay in sync.',
        'Debug tuning panel drops the experimental intent blend slider to focus on smoothing/LAB controls, and automated intent tolerance is now 8% to match the new defaults.',
        'Cached per-channel row lookups trim DOM thrash during LAB updates and history playback.',
        'Intent dropdown previews the selected curve on the chart before you bake it into a .quad.'
      ],
      FIXED: [
        'Undo now clears per-channel measurement switches alongside loaded data.',
        'Legacy printer-space datasets without explicit sourceSpace metadata no longer get flipped on reload.',
        'Undo/redo preserves the LAB / Manual L* smoothing hook so scripted smoothing continues to work.',
        'Contrast intent status banner reports the active preset instead of always showing Linear.',
        'Intent remap honours existing ink limits, reverting to Linear restores the original .quad curve, and undo/redo preserves that exact shape.'
      ],
      REMOVED: [],
      DOCS: [
        'Updated QUADGEN_DATA_TYPES.md, QUADGEN_DEVELOPMENT.md, QUADGEN_AI_INTEGRATION.md, and AGENTS.md with sourceSpace guidance and regression workflows.'
      ]
    },
    aboutDialog: [
      { label: 'Auto Rolloff Hidden', desc: 'White/black auto limit toggles are offline while we recalibrate the detector.' },
      { label: 'Printer-space Pipeline', desc: 'DataSpace now owns every conversion and the new fixtures/tests catch double-flip regressions early.' },
      { label: 'POPS Smoothing Defaults', desc: '30% primary + 30% post smoothing with LAB bandwidth overrides keep LAB rebuilds print-ready out of the box.' },
      { label: 'Intent Remap', desc: 'Use Apply to Loaded Curve to bake the selected intent into a linearized .quad—no external LUT required. Intent previews now render as soon as you pick a preset.' }
    ]
  },
  'v2.3.0': {
    date: '2025-09-16',
    title: 'Auto endpoint rolloff (white/black) + UX',
    sections: {
      ADDED: [
        'Auto endpoint rolloff now has independent white/black limit toggles so you can knee only the side that needs protection.',
        'Glossary: added Auto white limit, Auto black limit, and Endpoint rolloff entries.',
        'Chart markers: dashed red/blue lines indicate detected knee start/end while the respective Auto limit is on.',
        'Lab Tech assistant: new set_auto_white_limit / set_auto_black_limit commands to toggle Auto endpoint rolloff from chat.'
      ],
      CHANGED: [
        'Threshold: proximity epsilon increased to 3% of End for clearer shoulders on long plateaus.',
        'Auto endpoint rolloff now exposes independent white/black limit checkboxes (defaults: white OFF, black ON) with persisted preferences and per-side baking guards.',
        '.quad generation and channel controls now use the full 0–65,535 16-bit scale instead of 0–64,000; UI ranges and validation updated accordingly so ink limits align with QuadToneRIP conventions.',
        'Chart background: Enhanced visual structure with subtle accent lines - darker 50% crossover grid lines and boundary lines from 100,0→100,100 and 0,100→100,100 to improve coordinate reference.'
      ]
    },
    aboutDialog: [
      { label: 'Auto Rolloff Controls', desc: 'Independent white/black knees with 3% proximity threshold keep endpoints smooth without flattening the curve.' },
      { label: 'Lab Tech Integration', desc: 'New chat commands toggle Auto white/black limits directly from the assistant.' },
      { label: 'Ink Limit Alignment', desc: 'Full 0–65,535 scaling and dashed knee markers keep the UI aligned with QuadToneRIP expectations.' }
    ]
  },
  'v2.2.3': {
    date: '2025-09-15',
    title: 'Intent system fixes + Documentation improvements',
    sections: {
      ADDED: [
        'Help glossary entries for "Image space" and "Printer space": Added comprehensive definitions explaining the coordinate system differences that are central to quadGEN\'s data transformation pipeline. Image space (0=black pixel, 100=white pixel) vs printer space (0=white/no ink, 100=black/maximum ink) with explicit (0,0) and (100,100) coordinate meanings for both systems.',
        'PoPS (Prints on Paper Studio) glossary entry: Added definition with link to their website and note about contrast intent presets included in quadGEN.',
        'MIT License: Added complete license text to Help ReadMe section with proper attribution and scope clarification.',
        'Prints on Paper Studio attribution: Added formal attribution in Help ReadMe Credits section for contrast intent definitions used with permission under GNU Public License.'
      ],
      CHANGED: [
        'Contrast intent system architecture: Centralized all preset definitions (Linear, Soft, Hard, Filmic) into single source object. Removed sliders from Preset tab in favor of descriptive text. Preset dropdowns now populate dynamically from central definitions, making preset management more maintainable.'
      ],
      FIXED: [
        'Intent system image-to-printer space conversion: Fixed critical issue where custom pasted intent data wasn\'t being transformed consistently with preset intents. All intent types now use the same image-to-printer space transformation pipeline (horizontal flip + vertical inversion) as ACV/LUT files, ensuring consistent behavior across preset and custom intents.',
        'Custom intent data parsing for 0-255 range: Fixed parsing failure when pasting intent data with 0-255 range values (common in image editing workflows). Parser now auto-detects range (0-100 vs 0-255) and normalizes appropriately, preventing data truncation and visualization artifacts.',
        'LAB linearization with custom intents: Resolved issue where LAB linearization would revert to linear when custom intent data was applied, caused by NaN values in the correction algorithm due to improper intent data transformation.',
        'Auto-detection for mixed-range data: Added consistent range detection logic to parseIntentPaste(), parseLabData(), parseManualLstarData(), and buildManualLinearizationFromOriginal() functions. Input values auto-detect 0-100 vs 0-255 ranges while maintaining CIE LAB standard (L* values always 0-100).'
      ]
    },
    aboutDialog: [
      { label: 'Intent System Overhaul', desc: 'Fixed critical image-to-printer space conversion issues, 0-255 range parsing, and LAB linearization compatibility with custom intents.' },
      { label: 'Enhanced Documentation', desc: 'Added comprehensive glossary entries for coordinate systems, PoPS attribution, and complete MIT license in Help section.' },
      { label: 'Data Range Auto-Detection', desc: 'Improved parsing across multiple functions to handle both 0-100 and 0-255 input ranges automatically.' },
      { label: 'Architecture Improvements', desc: 'Centralized intent preset definitions and improved preset management workflow.' }
    ]
  },
  'v2.2.2': {
    date: '2025-09-15',
    title: 'UI refinements + Intent behavior improvements',
    sections: {
      CHANGED: [
        'Edit Mode panel layout: Consolidated Calculate points controls onto single row with centered field labels and aligned Recompute button. Improved Point section spacing and reduced graph container margins for tighter UI layout.',
        'Edit Mode help modal: Clarified data conversion to Smart curves, added Calculate points section explaining Max error %/Max points/Recompute functionality, and improved terminology throughout.',
        'Global Correction & Intent help modal: Added correction process overview, warning section explaining when Intent takes effect, and link to Detailed Workflow. Modal title changed from "Correction vs. Intent" to "Global Correction & Intent". Reorganized content with card-based layout for improved readability and visual hierarchy.',
        'Intent dropdown behavior: Now automatically disables when no linearization data is loaded (visual feedback with grayed appearance). Eliminates confusion about why Intent appears inactive with .quad files only.'
      ],
      FIXED: [
        'Edit Mode revert button: Fixed issue where the revert button would appear to work but continue showing "Smart Curve" status when used in Edit Mode. The button now properly clears Smart curve data and displays the original loaded .quad status without automatic restoration interference.'
      ]
    },
    aboutDialog: [
      { label: 'UI Layout Refinements', desc: 'Improved Edit Mode panel layout, Point section spacing, and graph container margins for better space utilization.' },
      { label: 'Enhanced Help Modals', desc: 'Clarified Edit Mode help with Smart curve explanation and reorganized Global Correction help with card-based layout.' },
      { label: 'Intent Dropdown Feedback', desc: 'Intent dropdown now disables and grays out when no linearization data is loaded, eliminating user confusion.' },
      { label: 'Edit Mode Revert Fix', desc: 'Fixed revert button issue that continued showing "Smart Curve" status after reverting in Edit Mode.' }
    ]
  },
  'v2.2.1': {
    date: '2025-09-14',
    title: 'ACV/LUT orientation parity + Undo pairing fixes',
    sections: {
      ADDED: [
        'Custom Intent: new Import Target (ACV/LUT) tab — load .acv/.cube as a target intent (not a correction), with endpoint anchoring, monotonic enforcement, and optional blend with current target.'
      ],
      FIXED: [
        'ACV/LUT orientation centralized in parsers (flip + invert once); removed duplicate reverse+invert in loaders — Photoshop “lighten” now shows less ink (down hump).',
        'Undo pairing for load actions now uses the most recent matching “Before:” state — undoing multiple global loads steps back to the immediately previous correction.'
      ],
      CHANGED: []
    },
    aboutDialog: [
      { label: 'Import Target (ACV/LUT)', desc: 'New Custom Intent tab to load .acv/.cube as a target intent; includes anchor/monotonic options and blend with current.' },
      { label: 'Orientation Parity', desc: 'ACV and LUT imports apply flip+invert once in the parser; loaders no longer reapply.' },
      { label: 'Undo Pairing', desc: 'Undo of consecutive loads returns to the previous correction, not an empty state.' }
    ]
  },
  'v2.2.0': {
    date: '2025-09-13',
    title: 'Local-σ LAB reconstruction, Manual L* parity, console clarity',
    sections: {
      FIXED: [
        'Manual L* and LAB status lines clarified: Δ vs linear now labels positions as % input; removed duplicate method note',
        'Preview update ReferenceError fixed in LAB smoothing provider (removed stale radius reference)'
      ],
      CHANGED: [
        'LAB/Manual L* mapping now uses CIE luminance → density (−log10(Y)) with Dmax normalization (replaces min/max L* normalization); improves shadow convergence; existing .quad files unaffected',
        'LAB reconstruction now uses Gaussian-weighted regression with a local adaptive bandwidth based on median neighbor spacing (robust to uneven spacing and dense datasets)',
        'Manual L* now uses the same CIE density + local-σ Gaussian reconstruction as LAB (full parity)'
      ],
      ADDED: []
    },
    aboutDialog: [
      { label: 'CIE Density Mapping', desc: 'LAB/Manual L* now use CIE luminance → density (−log10(Y)) for corrections; better shadow handling, stable highlights.' },
      { label: 'Local-σ Reconstruction', desc: 'Gaussian weights now adapt to local patch spacing for smoother, robust LAB curves.' },
      { label: 'Manual L* Parity', desc: 'Manual L* uses the same reconstruction as LAB for consistent results.' },
      { label: 'Console Clarity', desc: 'Δ vs linear shows “% input”; method note appears once on load/apply.' }
    ]
  },
  'v2.1.0': {
    date: '2025-09-13',
    title: 'Edit Mode reliability, Revert fixes, channel-colored labels',
    sections: {
      FIXED: [
        'Double-scaling eliminated when toggling Edit Mode OFF→ON on Smart-sourced channels',
        'Ordinal labels no longer collapse to the X-axis when switching to a newly enabled channel',
        'Revert to measurement clears lingering Smart source tags (no linear ramp fallback)',
        'Revert preserves the selected channel in Edit Mode and redraws overlays/labels correctly'
      ],
      ADDED: [
        '.quad Preview: lightweight syntax highlighting and non-copying line numbers',
        '.quad Preview: per-line channel gutter tint with auto-contrast line numbers',
        'Revert UI: added global and per-channel Revert buttons with integrated Undo/Redo',
        'Help: new Detailed Workflow tab plus Version History moved into Help window',
        'Lab Tech console (light mode): One Light–inspired text theme with terminal-style lines',
        'Dark mode toggle: header button (🌙/☀️) to switch themes; remembers your choice and syncs with system preference'
      ],
      CHANGED: [
        'Ordinal label chips now match the exact channel ink color with automatic black/white text for contrast',
        'Edit channel selection instantly redraws overlays to reflect the selected channel',
        'Dark mode polish: improved input/scrollbar contrast, help tab selection contrast, and preview readability'
      ]
    },
    aboutDialog: [
      { label: 'Edit Reliability', desc: 'No more double-apply on Smart curves when toggling Edit Mode.' },
      { label: 'Revert UX', desc: 'Revert keeps your selected channel and restores measurement plotting.' },
      { label: 'Channel-Colored Labels', desc: 'Ordinal labels use the exact plot color for the selected channel.' },
      { label: '.quad Preview', desc: 'Syntax highlighting, line numbers, and channel-colored gutter.' },
      { label: 'Lab Tech Theme', desc: 'Polished console theme (light mode) for readability.' },
      { label: 'Dark Mode Toggle', desc: 'Added header toggle (🌙/☀️); remembers your choice and follows system preference.' }
    ]
  },
  'v2.0.5': {
    date: '2025-09-13',
    title: 'Edit toggle double-scaling fix + stability',
    sections: {
      FIXED: [
        'Edit toggle OFF→ON no longer double-applies global on Smart-sourced channels',
        'Entering Edit Mode after load no longer reverts plotted curve to a linear ramp while key points stay at prior shape',
        'Undo/Redo restore bakedGlobal meta with interpolation to keep plots/overlays aligned',
        'Revert preserves selected channel in Edit Mode and clears Smart source tags so plots/labels reflect the measurement again'
      ]
    },
    aboutDialog: [
      { label: 'Edit Toggle', desc: 'No more double application when toggling Edit Mode; Smart-sourced channels are treated as baked.' },
      { label: 'Plot Alignment', desc: 'Plot stays aligned to key points when entering Edit Mode after loading data.' },
      { label: 'Revert UX', desc: 'Revert keeps your selected channel and restores measurement plotting (no MK fallback labels).' }
    ]
  },
  'v2.0.4': {
    date: '2025-09-11',
    title: 'Edit Mode × Linearization Fixes + Dark Mode Polish',
    sections: {
      FIXED: [
        'Global linearization applies even when Smart points exist (Edit Mode ON)',
        'Recompute samples the current plotted curve (respects global/per-channel corrections and End)',
        'Double-apply guard: recomputed Smart curves “bake” global correction once (no extra global on top)'
      ],
      CHANGED: [
        'Near-linear detection tightened (0.5%→0.2%, 5→11 samples) to avoid collapsing lightly corrected curves',
        'Dark mode: input fields (percent/end, filename, L*, edits) use darker backgrounds and clearer focus',
        'Dark mode: toggle sliders use darker tracks and high-contrast knobs; key-point ordinal labels use theme text color'
      ]
    },
    aboutDialog: [
      { label: 'Global + Smart', desc: 'Global corrections now work with Edit Mode ON; recompute bakes global once to avoid double application.' },
      { label: 'Recompute Source', desc: 'Recompute uses the currently plotted curve so points match what you see.' },
      { label: 'Dark Mode', desc: 'Improved readability for inputs, toggles, and labels.' }
    ]
  },
  'v2.0.3': {
    date: '2025-09-10',
    title: 'Detailed Workflow Guide in Help',
    aboutDialog: [
      { label: 'Detailed Workflow', desc: 'Added a new Help tab with a step-by-step calibration guide (LAB and EDN workflows), including ink-limit verification and target printing.' },
      { label: 'ReadMe/Help Polish', desc: 'Improved Installation links, Glossary entries, and formatting; Help button updated with icon.' }
    ]
  },
  'v2.0.2': {
    date: '2025-09-10',
    title: 'Tabbed Help + About Removed',
    aboutDialog: [
      { label: 'Help Tabs', desc: 'Help window now has ReadMe, Glossary, and Version History tabs.' },
      { label: 'Version History', desc: 'Moved from the separate About dialog into Help → Version History.' },
      { label: 'About Removed', desc: 'Removed the About button and popup; all info is available in Help.' }
    ]
  },
  'v2.0.1': {
    date: '2025-09-09',
    title: 'Embedded Help Window',
    aboutDialog: [
      { label: 'Help Content', desc: 'Help window now displays embedded documentation (Overview, Quick Start, Features, Troubleshooting, External References). No separate inline help to maintain.' },
      { label: 'Header', desc: 'Help header matches the main app (logo + version).' },
      { label: 'Formatting', desc: 'Help content is styled for readability; headings, lists, links, and code are preserved.' }
    ]
  },
  'v2.0': {
    date: '2025-09-09',
    title: 'Edit Mode, Smart Curves, Robust History',
    sections: {
      ADDED: [
        'Edit Mode: gates all key‑point edits and overlay visibility; APIs respect mode state',
        'Undo/Redo: full history for insert/adjust/delete/recompute and Edit Mode toggles',
        'Smart Curve: renamed from “AI curve”; writes source tag “smart”, reads legacy “ai”; legacy AI function names remain as aliases',
        'Absolute coordinates: XY input and Up/Down nudges use absolute Y (post‑End); Left/Right adjust X (pre‑scale)',
        'Redo parity: redo restores Smart key points + interpolation and recomputes curves to match overlays',
        'Ink‑limit guard: blocks edits that would exceed End when End cannot be raised, with a clear status message'
      ]
    },
    aboutDialog: [
      { label: 'Edit Mode', desc: 'All key‑point edits require Edit Mode; overlays show only when ON' },
      { label: 'History', desc: 'Undo/Redo covers edits and Edit Mode toggles' },
      { label: 'Smart Curves', desc: '“AI curve” → “Smart Curve”; reads ai/smart, writes smart; APIs keep AI aliases' },
      { label: 'Absolute Y', desc: 'XY input and Up/Down use absolute Y; Left/Right nudges X' },
      { label: 'Redo Parity', desc: 'Redo restores key points + interpolation, then recomputes curves' },
      { label: 'Ink Guard', desc: 'Blocks edits that exceed End when End is effectively locked' }
    ]
  },
  'v1.9.0': {
    date: '2025-09-06',
    title: 'Gaussian LAB, Overlay Alignment, Preserved Smart Shape',
    sections: {
      CHANGED: [
        'LAB processing now uses Gaussian Weighted Correction (density‑independent); smoothing slider widens Gaussian influence radius',
        'LAB → Smart conversion preserves plotted shape using adaptive key‑point fit (defaults: 0.25% max error, 21 max points)',
        'Key‑point overlay and adapter overlays now align exactly with End‑scaled curves (absolute plotting)'
      ],
      FIXED: [
        'Removed localized “bubble” artifacts when applying LAB to dense .quad curves',
        'Pre‑conversion overlay markers now use interpolated Y (no nearest‑index drift)'
      ]
    },
    aboutDialog: [
      { label: 'Gaussian LAB', desc: 'Density‑independent LAB correction; smoother results on dense .quad curves' },
      { label: 'Preserved Shape', desc: 'LAB → AI conversion fits points to the plotted curve' },
      { label: 'Overlay Accuracy', desc: 'Markers and labels align with End‑scaled curves' },
      { label: 'Simplifier Defaults', desc: 'Tighter default fit (0.25% / 21 points)' }
    ]
  },
  'v1.8.6': {
    date: '2025-09-05',
    title: 'LAB Wedgie Parity & Manual L* Simplification',
    sections: {
      ADDED: [
        'LAB .txt import now uses wedgie-style inversion to a linear target (parity with Manual L*)',
        'Documentation updated to reflect wedgie inversion for measurement data'
      ],
      CHANGED: [
        'Manual L* modal simplified: removed Target X%/L* and link; Measured-only table',
        'Unified processing: Target X% = Measured X%; Target L* = 100→0'
      ],
      FIXED: [
        'Original measured points overlay and format labels consistent across LAB and Manual L*',
        'Measurement intent marker applies to LAB formats regardless of suffix',
        'ACV overlay: “Show key points” displays original ACV anchor points (global and per‑channel); no 32‑point fallback. ACV/LUT/LAB overlays take precedence over Smart key points.',
        'ACV → Smart editing: When first editing key points with a global ACV loaded, editable Smart points are seeded from the ACV anchors (not a simplified set) to avoid unexpected point shifts.',
        'Overlay preference: When Smart key points exist for a channel, the overlay shows those Smart points; ACV/LUT/LAB overlays appear only when no Smart points are present.',
        'No double processing: Global linearization is not applied to channels that have Smart Curves, preventing unintended changes when editing Smart points.',
        'Exact Smart plotting: “Show key points” draws Smart points directly from stored values (pre‑scale) for precise alignment.'
      ],
      REMOVED: [
        'Gaussian LAB documentation references',
        'Manual L* Target L* inputs and link toggle'
      ]
    },
    aboutDialog: [
      { label: 'Wedgie Parity', desc: 'LAB .txt and Manual L* use the same inversion to a linear target' },
      { label: 'Simplified Manual L*', desc: 'Measured-only entry; target is implicit (linear 100→0)' },
      { label: 'Docs Updated', desc: 'Removed Gaussian references; clarified wedgie mapping' }
    ]
  },
  'v1.8.5': {
    date: '2025-09-04',
    title: 'Smart Key‑Point Deletion',
    sections: {
      ADDED: [
        'Smart key‑point deletion: delete by index or nearest to input % (endpoints blocked by default)'
      ]
    },
    aboutDialog: [
      { label: 'Point Deletion', desc: 'Delete key points by index or nearest input % (safe by default: endpoints blocked)' }
    ]
  },
  'v1.8.4': {
    date: '2025-09-04',
    title: 'Smart Key‑Point Labels and UI Polish',
    sections: {
      ADDED: [
        'Numbered labels above Smart key points with ink‑colored backgrounds and auto black/white text for readability',
        'Lab Tech sample: added “apply a midtone lift” example',
        'Smart key‑point deletion: delete by index or nearest to input % (endpoints blocked by default)'
      ],
      CHANGED: [
        'Graph axis titles now use %: “Input Level %” (X), “Output Ink Level %” (Y)',
        'Key‑point label positioning refined: shifts slightly right near 0% and left near 100% to reduce overlap',
        'Lab Tech sample updated to “generate a curve with points 0,0 25,20 75,85 100,100”'
      ],
      DOCS: [
        'Updated CLAUDE.md and AGENTS.md to reflect numeric key‑point workflow and insert/adjust commands'
      ]
    },
    aboutDialog: [
      { label: 'Key‑Point Labels', desc: 'Smart key points now show numbered labels with ink‑colored backgrounds and readable text' },
      { label: 'Axis Titles', desc: 'Graph uses “Input Level %” (X) and “Output Ink Level %” (Y)' },
      { label: 'Lab Tech Samples', desc: 'Focused natural language controls on curve generation' }
    ]
  },
  'v1.8.3': {
    date: '2025-09-03',
    title: 'Expanded Printer Support, OR/GR Inks, Ordered by Release',
    sections: {
      ADDED: [
        'New printers: P400 (K,C,M,Y,LC,LM), x800-x890 (K,C,M,Y,LC,LM,LK,LLK), x900 (K,C,M,Y,LC,LM,LK,LLK,OR,GR), P4-6-8000 (K,C,M,Y,LC,LM,LK,LLK), P5-7-9000 (K,C,M,Y,LC,LM,LK,LLK,OR,GR)',
        'Ink colors: OR (#FF7F00, Orange) and GR (#00A651, Green) supported in charts and swatches',
        'Smart key‑point overlays: squares + ordinal labels for Smart Curves (<21 points)',
        'Smart key‑point insert commands: insert point at X or between ordinals',
        'Undo/redo now restores Smart key points and interpolation meta along with curves'
      ],
      CHANGED: [
        'Printer dropdown, Lab Tech enums, and validation lists reordered newest→oldest based on Epson release eras',
        'Supported printers list in .quad import error updated to include new models',
        'Smart workflow: natural‑language preset curves deprecated; tool now computes numeric key points and applies them directly',
        'Graph axis titles: display shows “Input Level %” (X) and “Output Ink Level %” (Y)'
      ],
      FIXED: [
        'AI-generated curves now respect ink limit percentage; plots update on relative adjustments (e.g., “reduce by 20%”).'
      ],
      REMOVED: [
        'Legacy 860-1160-VM model removed from UI and internal registry'
      ]
    },
    aboutDialog: [
      { label: 'More Printers', desc: 'Added P400, x800-x890, x900, P4-6-8000, P5-7-9000' },
      { label: 'OR/GR Inks', desc: 'Added support for Orange and Green ink channels' },
      { label: 'Smart Curve Scaling', desc: 'Smart Curves now scale with ink limit changes (e.g., reduce by 20%).' },
      { label: 'Defaults', desc: 'Channels now default to 100%' }
    ]
  },
  'v1.8.2': {
    date: '2025-09-03',
    title: 'Unified Workflow Summary & Positive-only Cleanup',
    sections: {
      CHANGED: [
        'About: Consolidated Recommended + Quick Workflow into a single beginner-friendly Workflow Summary',
        'About: Removed the “(Positive‑Only)” label and the PCHIP requirement bullet to simplify guidance'
      ],
      DOCS: [
        'Clarified Positive-only operation in UI text and helper messages; EDN LUT/.acv use Positive mapping (reverse + invert) by default',
        'Removed user-facing references to toggling intent or mismatch warnings; older release notes retained for history'
      ]
    },
    aboutDialog: [
      { label: 'Workflow Summary', desc: 'Step-by-step beginner overview replaces separate Recommended/Quick sections' },
      { label: 'Simplified Wording', desc: 'Cleaned up language and removed extra qualifiers for clarity' },
      { label: 'Positive-only Operation', desc: 'Tool operates in printer-space with Positive mapping; invert images in your editor for digital negatives' }
    ]
  },
  'v1.8.1': {
    date: '2025-09-03',
    title: 'MIT License + Chart Orientation Aids',
    sections: {
      ADDED: [
        'MIT License for quadgen.html only: header comment added; About dialog blurb notes scope and holder',
        'Chart orientation aids: White→black gradient bars added under X-axis (left→right) and beside Y-axis (bottom→top)'
      ],
      CHANGED: [
        'Axis titles: X now “Input Level Percent”, Y now “Output Ink Level Percent”',
        'Axis label contrast: Force solid black text and adjust spacing to avoid overlap with gradients',
        'EDN mapping fixed to Positive semantics (reverse + invert) with no intent toggle'
      ],
      REMOVED: [
        'Negative Print Intent UI and intent mismatch warning banner; tool now operates in Positive intent only'
      ]
    },
    aboutDialog: [
      { label: 'MIT License (HTML only)', desc: 'Added MIT header in quadgen.html and brief notice in About; scope limited to this HTML file' },
      { label: 'Axis Gradients', desc: 'Added white→black bars under X and along Y for clear white/black orientation' },
      { label: 'Readable Labels', desc: 'Labels forced to black with spacing tweaks for clarity' },
      { label: 'Axis Titles', desc: 'Renamed to “Input Level Percent” (X) and “Output Ink Level Percent” (Y)' },
      { label: 'Positive-only Intent', desc: 'Removed Negative intent; EDN mapping uses Positive semantics by default' }
    ]
  },
  'v1.8': {
    date: '2025-09-02',
    title: 'Print Intent Mapping, ACV/LUT Parity, LAB Traceability',
    sections: {
      ADDED: [
        'Print Intent selector (Positive/Negative) applied to EDN-style corrections; live recompute on toggle',
        'LAB measurement intent traceability: UI shows “measured: Positive/Negative” and .quad comments include it',
        'LAB intent mismatch warning banner when current intent differs from recorded LAB measurement intent'
      ],
      FIXED: [
        'ACV/LUT parity: ACV path now uses same orientation as LUT (horizontal flip + vertical inversion for positive-domain EDN)',
        'Immediate graph update when toggling Print Intent with EDN corrections loaded',
        'LAB endpoints anchored to 0 and 1 to preserve full dynamic range',
        'Natural-language curve parser: Tonal regions flipped to match 0% = white, 100% = black ("shadows" now 75–100%)'
      ],
      REMOVED: [
        'Built-in process presets (cyanotype, palladium, etc.) and process triggers from AI routing',
        'Bookmarks/auto-citation experiment; the assistant no longer auto-injects sources'
      ]
    },
    aboutDialog: [
      { label: 'Print Intent Mapping', desc: 'EDN (.cube/.acv) mapped by intent (Positive: flip+invert; Negative: flip only) with live recompute' },
      { label: 'ACV/LUT Parity', desc: 'ACV orientation normalized to match LUT; midtones now align closely' },
      { label: 'LAB Traceability', desc: 'Recorded “measured: Positive/Negative” and added mismatch warning banner' },
      { label: 'LAB Endpoints Anchored', desc: 'Measurement curves now start at 0% and end at 100% to preserve range' },
      { label: 'Tonal Region Mapping', desc: 'Parser regions flipped; 0% is white and 100% is black. "Lift shadows" now affects 75–100% correctly.' },
      { label: 'Simplified AI Scope', desc: 'Removed process presets; assistant provides guidance to load EDN/LAB instead' }
    ]
  },
  'v1.7': {
    date: '2025-09-02',
    title: 'Wedgie Inversion & LAB Data Artifacts Fix',
    sections: {
      FIXED: [
        'LAB data curve artifacts: Replaced complex coordinate transformation with wedgie-style inversion to a linear target',
        'Dense-on-dense data processing: Eliminated curve spikes when applying LAB corrections to loaded .quad files and AI-generated curves',
        'Undo system gaps: Added proper state capture for all LAB data loading methods (sample data, file upload, pasted data)',
        'Algorithm mismatch: Sparse measurement data (21 points) now properly applied to dense curve data (256 points)'
      ],
      ENHANCED: [
        'LAB processing algorithm: Wedgie-style inversion to linear target; optional smoothing available separately',
        'Processing reliability: Eliminated need for ad-hoc smoothing by fixing the mapping at the source',
        'Mathematical accuracy: Replaced experimental coordinate transformation with direct inversion to target'
      ],
      REMOVED: [
        'RBF experimental method: Removed Radial Basis Functions option after confirming no advantage over the simplified inversion',
        'UI switching controls: Cleaned up method selection dropdown and event listeners for simplified interface'
      ]
    },
    aboutDialog: [
      { label: 'LAB Data Artifact Fix', desc: 'Eliminated curve spikes when applying measurement data to loaded .quad files using wedgie-style inversion' },
      { label: 'Unified Inversion', desc: 'Manual L* and LAB .txt now use the same inversion to a linear target' },
      { label: 'Dense Data Processing', desc: 'Proper handling of sparse corrections (21 points) applied to dense curves (256 points)' },
      { label: 'Undo System Completion', desc: 'Added state capture for all LAB data loading methods ensuring proper undo functionality' },
      { label: 'Algorithm Simplification', desc: 'Removed RBF experimental option after simplification to wedgie-style inversion' }
    ]
  },
  'v1.6': {
    date: '2025-08-31',
    title: 'Lab Tech Assistant & Processing Visibility',
    sections: {
      ADDED: [
        'Lab Tech AI assistant with 25 specialized functions for natural language control',
        'Processing detail panels showing Base Curves → Per-Channel → Global pipeline per channel',
        'Professional communication style with markdown formatting support',
        'Quick reference documentation with function locations'
      ],
      ENHANCED: [
        'Smart Curve generation with natural language descriptions ("palladium curve", "S-curve")',
        'Undo system integration for AI-generated curves',
        'Visual state restoration for disabled channels'
      ],
      FIXED: [
        'Disabled channel transparency when Lab Tech adds curves',
        'Processing panel updates now immediate (no manual refresh needed)',
        'Channel iteration bug causing incorrect references',
        'Smart Curve undo functionality integration'
      ]
    },
    aboutDialog: [
      { label: 'Lab Tech Assistant', desc: 'AI assistant with 25 specialized functions for natural language control of QuadGEN' },
      { label: 'Processing Visibility', desc: 'Expandable panels show Base Curves → Per-Channel → Global pipeline for each channel' },
      { label: 'Professional Communication', desc: 'Concise responses with markdown formatting and structured information' },
      { label: 'AI Curve Integration', desc: 'Natural language curve generation with full undo system integration' },
      { label: 'Visual Improvements', desc: 'Enhanced state restoration and immediate processing panel updates' }
    ]
  },
  'v1.5': {
    date: '2025-08-29',
    title: 'Adobe Photoshop .acv Curve File Support',
    sections: {
      ADDED: [
        'Adobe Photoshop .acv file format support: Complete binary format parser for curve presets',
        'Cubic spline interpolation: Smooth curve generation matching Photoshop\'s behavior between control points',
        'ACV format detection: Automatic binary vs text file handling in parseLinearizationFile()',
        'RGB composite curve extraction: Uses first curve from multi-curve .acv files for linearization',
        'Binary data parsing: DataView-based parser supporting Adobe\'s int16 big-endian format specification',
        'File input support: .acv files accepted in both global and per-channel linearization inputs',
        'UI integration: Updated tooltips and file format descriptions to include .acv curve file support'
      ],
      IMPROVED: [
        'File format documentation: Comprehensive .acv technical specifications in internal documentation',
        'Linearization workflow: Seamless integration with existing .cube and .txt file processing pipeline'
      ]
    },
    aboutDialog: [
      { label: 'ACV File Format', desc: 'Complete binary format parser for Adobe Photoshop curve presets' },
      { label: 'Cubic Spline Interpolation', desc: 'Smooth curve generation matching Photoshop\'s behavior between control points' },
      { label: 'RGB Composite Curves', desc: 'Automatic extraction of first curve from multi-curve .acv files' },
      { label: 'Binary Data Handling', desc: 'DataView-based parser supporting Adobe\'s int16 big-endian format specification' },
      { label: 'Seamless Integration', desc: '.acv files work in both global and per-channel linearization workflows' },
      { label: 'UI Updates', desc: 'Updated tooltips and file format descriptions for .acv curve file support' }
    ]
  },
  'v1.4.1': {
    date: '2025-08-29',
    title: 'Smoothing Algorithm Refinements & .quad File Improvements',
    sections: {
      ADDED: [
        'Smoothing Splines algorithm: Mathematical curve smoothing with automatic lambda parameter selection',
        'Visual curve comparison: Original curve overlay (gray dashed line) shows smoothing effects on all channels',
        'Simplified curve algorithms: Focused on Uniform Sampling and Smoothing Splines',
        'Accurate .quad file maximum detection: Uses actual curve maximum instead of endpoint value'
      ],
      REFINED: [
        'Streamlined algorithm selection: Focused on reliable smoothing methods',
        'Simplified interpolation options: Hidden Cubic Spline and Catmull-Rom from UI to reduce complexity',
        'Default algorithm changed: Uniform Sampling now default with Smoothing Splines as advanced option',
        'UI cleanup: Removed monotonicity preservation option (PCHIP handles this appropriately)'
      ],
      IMPROVED: [
        'Curve visualization: Original vs smoothed comparison works with multiple channels simultaneously',
        'Algorithm focus: Concentrated on reliable, predictable smoothing methods for production use',
        '.quad file scaling: Proper scaling based on actual maximum value for non-monotonic curves'
      ]
    },
    aboutDialog: [
      { label: 'Smoothing Splines', desc: 'Added mathematical smoothing algorithm with automatic parameter selection' },
      { label: 'Visual Curve Comparison', desc: 'Original curve overlay shows before/after smoothing effects on all channels' },
      { label: 'Accurate .quad File Handling', desc: 'Proper detection and scaling of ink limits based on actual curve maximum' },
      { label: 'Non-Monotonic Curve Support', desc: 'Correctly handles curves where peak ink density occurs before 100% input' },
      { label: 'Streamlined Algorithm Selection', desc: 'Focused on Uniform Sampling and Smoothing Splines for reliable results' },
      { label: 'Improved Interpolation Defaults', desc: 'PCHIP monotonic interpolation as primary method with Linear fallback' }
    ]
  }
};

// Intent preset helpers delegate to the modular intent-system
function resolveIntentPresetMap() {
  if (typeof window !== 'undefined') {
    const legacy = window.CONTRAST_INTENT_PRESETS;
    if (legacy && typeof legacy === 'object') return legacy;
    if (typeof window.getAllPresets === 'function' && window.getAllPresets !== getAllPresets) {
      try {
        const arr = window.getAllPresets();
        if (Array.isArray(arr)) {
          return arr.reduce((map, preset) => {
            if (preset && preset.id) map[preset.id] = preset;
            return map;
          }, {});
        }
      } catch (err) {}
    }
  }
  return {};
}

function getPreset(presetId) {
  if (typeof window !== 'undefined' && typeof window.getPreset === 'function' && window.getPreset !== getPreset) {
    try { return window.getPreset(presetId); } catch (err) {}
  }
  const map = resolveIntentPresetMap();
  return map[presetId] || null;
}

function getAllPresets() {
  if (typeof window !== 'undefined' && typeof window.getAllPresets === 'function' && window.getAllPresets !== getAllPresets) {
    try { return window.getAllPresets(); } catch (err) {}
  }
  const map = resolveIntentPresetMap();
  return Object.values(map)
    .filter(Boolean)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

function getPresetDefaults(presetId, param) {
  const preset = getPreset(presetId);
  if (!preset || !preset.params) return null;
  const value = preset.params[param];
  return value === undefined || value === null ? null : value;
}

function generatePresetDropdownHTML() {
  const presets = getAllPresets();
  if (!Array.isArray(presets) || presets.length === 0) return '';
  return presets.map((preset) => {
    return '<option value="' + preset.id + '">' + preset.label + '</option>';
  }).join('\n');
}

export function generateAboutDialogVersionHistory(versionHistory, releaseChannel) {
  let content = '';
  for (const [version, data] of Object.entries(versionHistory)) {
    if (version === 'Unreleased') continue;
    const displayVersion = releaseChannel ? `${releaseChannel} ${version}` : version;
    content += `
      <div class="mb-3">
        <p class="font-bold">${displayVersion}</p>
        <ul class="list-none ml-2 mt-1 text-sm leading-tight">`;
    
    for (const item of data.aboutDialog) {
      content += `
          <li>- ${item.desc}</li>`;
    }
    
    content += `
        </ul>
      </div>`;
  }
  return content;
}

export function getHelpReadmeHTML(){
  return `
    <section class="prose prose-gray max-w-none p-6 bg-white rounded-2xl shadow">
      <div style="display: flex; justify-content: center;">
        <div style="font-size: 10px; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace; white-space: normal; line-height: 1.2; text-align: left; width: 100%;">MIT License

Copyright (c) 2025 David Marsh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Scope: This license applies to this HTML file (quadgen.html) only.</div>
      </div>

      <hr />

      <h2 id="overview">Overview</h2>
      <p>
        <strong>quadGEN</strong> is a free, browser-based tool for generating and refining <code>.quad</code> files used with QuadToneRIP.  
        It supports LAB/LUT/ACV inputs, and an Edit Mode for precise, point-based curve edits.  
        Core features work fully offline; the optional AI assistant requires network access.
      </p>
      <p>
        quadGEN is designed for photographers, printmakers, and alt-process practitioners who create digital negatives or monochrome prints and need reliable tonal calibration.
      </p>

      <h3>Project Resources</h3>
      <ul>
        <li><strong>Source code:</strong> <a href="https://github.com/David-Marsh-Photo/quadGEN" target="_blank" rel="noopener">github.com/David-Marsh-Photo/quadGEN</a></li>
        <li><strong>Issues & contributions:</strong> Open a GitHub issue or pull request on the repository linked above.</li>
        <li><strong>Support:</strong> Email <a href="mailto:marshmonkey@gmail.com">marshmonkey@gmail.com</a></li>
      </ul>

      <h3>What is QuadToneRIP?</h3>
      <p>
        QuadToneRIP (QTR) is a specialized RIP/driver for Epson printers focused on high-quality monochrome printing using multi-shade ink sets.  
        QTR uses <code>.quad</code> files to determine how much ink each printer channel lays down at every input level.  
        A <code>.quad</code> file contains 256-sample curves (0–100% input) for each channel supported by the printer (e.g., K, C, M, Y, LC, LM, LK, LLK, OR, GR, etc.).  
        When you select a <code>.quad</code> in your QTR workflow (often via Print-Tool on macOS), QTR reads these curves and applies the specified per-channel ink outputs to render your print.  
        quadGEN’s role is to help you build and refine those <code>.quad</code> curves so QTR can produce linear, predictable output.  
        See the <a href="https://www.quadtonerip.com/html/QTRoverview.html" target="_blank" rel="noopener">QuadToneRIP Overview</a> for more background.
      </p>

      <hr />

      <h2 id="install">Installation and Access</h2>
      <ul>
        <li><strong>Online:</strong> visit <a href="https://quadgen.ink/" target="_blank" rel="noopener">https://quadgen.ink/</a>.</li>
        <li><strong>Offline:</strong> right‑click and download this file: <a href="https://quadgen.ink/index.html" target="_blank" rel="noopener">https://quadgen.ink/index.html</a>, then open it locally (no install required).</li>
        <li><strong>Platforms:</strong> macOS, Windows, Linux (desktop recommended).</li>
        <li><strong>Network note:</strong> AI assistant features require internet; manual editing and exports do not.</li>
      </ul>

      <hr />

<h2 id="quickstart">Quick Start (Beta 2.5.1)</h2>
      <ol>
        <li>Choose your printer and set ink limits (per channel).</li>
        <li>Start with Linear Ramp, or</li>
        <li>Load data: <code>.quad</code>, LAB <code>.txt</code>, LUT <code>.cube</code> (1D/3D), Photoshop <code>.acv</code>, or Manual L*.</li>
        <li>Export the corrected <code>.quad</code>, print a step wedge target.</li>
        <li>Measure print and load data, repeat if necessary.</li>
      </ol>

      <hr />

      <h2 id="features">Features (highlights)</h2>
      <ul>
        <li>Supports most Epson printers.</li>
        <li>Quickly export linear ramps with any single ink channel or combination.</li>
        <li>Inputs: <code>.quad</code>, LAB <code>.txt</code>, LUT <code>.cube</code>, <code>.acv</code>, Manual L*.</li>
        <li>Apply intent remaps directly to a loaded <code>.quad</code> via “Apply to Loaded Curve”.</li>
        <li>Evenly spaced or irregular targets supported.</li>
        <li>Edit Mode: point-based edits at any time.</li>
        <li>Undo/Redo: full history of edits, LAB/LUT loads, global scaling, and per-channel slider changes.</li>
        <li>Recompute key points: simplify Smart Curves with tolerance/max-point controls.</li>
        <li>Graph zoom: use the +/− control in the chart corner to rescale the Y-axis in 10% steps when working with low ink limits; zoom automatically clamps to the highest active ink limit so you never crop a 100% curve.</li>
        <li>Lab Tech: AI assistant for Q&amp;A and automation.</li>
        <li>Contrast intent: presets or custom targets; shows Δ vs target; endpoints fixed (use ink limits to change).</li>
        <li>Auto endpoint rolloff: optional white/black soft knees that detect early plateau and ease into the ink limit with a smooth shoulder/toe (3% proximity threshold).</li>
        <li>Import ACV/LUT as target: in the Custom Intent modal, load <code>.acv</code>/<code>.cube</code> as a target intent (not a correction); includes endpoint anchoring, monotonic enforcement, and blend.</li>
      </ul>

      <hr />

      <h2 id="examples">Usage Examples</h2>
      <ul>
        <li>Digital negatives: cyanotype, Pt/Pd, kallitype, polymer photogravure.</li>
        <li>Inkjet linearization: refine monochrome response for QTR printing.</li>
        <li>Curve editing: enter Edit Mode, nudge an ordinal, export.</li>
        <li>Conversion: load LAB/LUT/ACV and export <code>.quad</code>.</li>
        <li>Intent remap: load your reference linearized <code>.quad</code>, audition Gamma/Filmic presets, and bake a contrast variant directly.</li>
      </ul>

      <hr />

      <h2 id="best">Best Practices</h2>
      <p class="text-sm text-gray-600 mb-3">Linearize your process once, keep that <code>.quad</code> as a reference, and branch from there. You can either bake an intent into the loaded reference with “Apply Intent”, or leave the reference untouched and make the contrast move upstream in Photoshop—printing through the linear reference yields the same result.</p>
      <ul>
        <li>If your process requires a negative, invert it before printing with your <code>.quad</code>.</li>
        <li>Measure the final positive print (not the negative).</li>
        <li>Anchor endpoints and keep curves monotonic.</li>
        <li>Use ink limits to define deepest black (or cleanest white).</li>
        <li>Make incremental edits; use Undo/Redo liberally.</li>
        <li>Keep a “reference” Linear intent <code>.quad</code>. You can bake contrast variants with “Apply Intent”, or do the contrast move in Photoshop and print through the same linear reference—both paths land on the same tone curve.</li>
        <li>Zoom the chart so low-limit runs fill the plot—tap +/− in the lower-left to move in 10% steps, and the chart auto-expands again if you enable a higher ink limit later.</li>
      </ul>

      <hr />

      <h2 id="faq">Troubleshooting &amp; FAQ</h2>
      <ul>
        <li><strong>Offline use:</strong> Lab Tech is unavailable offline; manual functions work fully.</li>
        <li><strong>Curve orientation:</strong> quadGEN plots input % (X) vs ink output % (Y), origin = white. Other tools may use tone curves with origin = black.</li>
        <li><strong>ACV parsing:</strong> Photoshop <code>.acv</code> files now load directly from the file picker. The old <code>TypeError: t.includes is not a function</code> error is resolved—no manual text conversion is required.</li>
        <li><strong>Corrections:</strong> Upward curve = more ink (darker); downward = less ink (lighter). Example: raise mids if midtones are too light.</li>
        <li><strong>Full reset:</strong> Use your browser’s refresh/reload button to return quadGEN to a clean state.</li>
      </ul>

      <hr />

      <h2 id="feedback">Feedback / Contact</h2>
        <p>Source code & issue tracker: <a href="https://github.com/David-Marsh-Photo/quadGEN" target="_blank" rel="noopener">github.com/David-Marsh-Photo/quadGEN</a></p>
        <p>Email: <a href="mailto:marshmonkey@gmail.com">marshmonkey@gmail.com</a></p>

      <hr />

      <h2 id="credits">Credits / Attribution</h2>
      <ul>
        <li>Tailwind CSS — used via CDN (<code>cdn.tailwindcss.com</code>), MIT License.</li>
        <li>Cloudflare Workers — used as an API proxy (rate-limited edge function).</li>
        <li>Anthropic Claude</li>
        <li>OpenAI ChatGPT / Codex</li>
        <li>Prints on Paper Studio — contrast intent definitions and feature references used with permission under <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener">GNU Public License</a>.</li>
        <li>Easy Digital Negatives (EDN) — Copyright Peter Mrhar. EDN is a separate project for building correction LUTs for digital negatives.</li>
        <li>Trademarks: Epson and SureColor are trademarks of Seiko Epson Corporation. QuadToneRIP and Print‑Tool are property of Roy Harrington. Color Muse is a trademark of Variable, Inc. Nix Spectro L is a trademark of Nix Sensor Ltd. All product names, logos, and brands are property of their respective owners.</li>
      </ul>


      <hr />        

      <h2 id="refs">External References</h2>
      <ul>
        <li><a href="http://www.easydigitalnegatives.com/" target="_blank" rel="noopener">Easy Digital Negatives</a> – Export correction LUTs (<code>.cube</code>) and load into quadGEN.</li>
        <li><a href="https://www.quadtonerip.com/" target="_blank" rel="noopener">QuadToneRIP</a> – RIP software using <code>.quad</code> files. Install/export from quadGEN to QTR’s quad folder.</li>
        <li><a href="https://www.quadtonerip.com/html/QTRprinttool.html" target="_blank" rel="noopener">Print-Tool</a> – Utility for printing through QTR on macOS with color-management off.</li>
        <li><a href="https://amzn.to/45R8rof" target="_blank" rel="noopener">Color Muse 2</a> – Handheld colorimeter for LAB measurement. Exports <code>.txt</code> for import into quadGEN.</li>
        <li><a href="https://amzn.to/4msSLOv" target="_blank" rel="noopener">Nix Spectro L</a> – Portable spectrophotometer with deeper shadow sensitivity; exports LAB data compatible with quadGEN.</li>
        <li><a href="https://clayharmonblog.com/downloads/25-step-ColorMuse-target.zip" target="_blank" rel="noopener">Clay Harmon’s 21-step target</a> – Printable target for iterative calibration.</li>
      </ul>
    </section>
  `;
}

// Glossary tab content (embedded, single source of truth)

export function getHelpGlossaryHTML(){
  return `
    <section class="prose prose-gray max-w-none p-6 bg-white rounded-2xl shadow">
      <h2>quadGEN Glossary</h2>
      <p>A concise, alphabetized reference to key terms used in quadGEN, QuadToneRIP, and related workflows.</p>
      <dl>
        <dt>Auto black limit</dt>
        <dd>Temporarily disabled while the rolloff detector is re-tuned. Previously applied a localized soft toe at the black end to preserve shadow separation.</dd>

        <dt>Auto white limit</dt>
        <dd>Temporarily disabled while the rolloff detector is re-tuned. Previously applied a localized soft shoulder at the white end to preserve highlight separation.</dd>

        <dt>ACV (Photoshop Curves)</dt>
        <dd>Binary curve format used by Adobe Photoshop (<code>.acv</code>). In quadGEN: can be loaded as a global correction or per-channel adapter; anchors can seed editable Smart curve.</dd>

        <dt>Alternative process (Alt-process)</dt>
        <dd>Historic or non-traditional photographic printing methods such as platinum/palladium, cyanotype, kallitype, polymer photogravure, and gum bichromate. These processes often use digital negatives created through QuadToneRIP workflows, requiring precise tonal calibration that quadGEN provides.</dd>

        <dt>CGATS.17</dt>
        <dd>Industry-standard color measurement data format developed by Committee for Graphic Arts Technology Standards. Used by professional spectrophotometers and colorimeters (X-Rite i1Pro, DataColor SpyderPrint, etc.) to exchange measurement data. quadGEN extracts monochrome progressions (K-only or composite grayscale) from CGATS files for LAB linearization workflows.</dd>

        <dt>Channel</dt>
        <dd>A printer ink channel (e.g., K, C, M, Y, LC, LM, LK, LLK, OR, GR, MK, V). Channels can be enabled/disabled and have independent End (ink limits).</dd>

                    <dt>Colorimeter</dt>
        <dd>Handheld device that measures color using filtered RGB sensors to approximate human vision. Fast and affordable for step wedges and general calibration. Example: <a href="https://amzn.to/45R8rof" target="_blank" rel="noopener">Color Muse 2</a>.</dd>

<dt>Color Muse 2</dt>
        <dd><a href="https://amzn.to/45R8rof" target="_blank" rel="noopener">Handheld colorimeter</a> for measuring LAB values from printed wedges/targets. Exports <code>.txt</code> files compatible with quadGEN.</dd>

        <dt>Correction (curve)</dt>
        <dd>Mapping that adjusts output ink levels versus input to achieve a target response. In quadGEN, plotted as Y (output ink %) vs X (input %).</dd>

        <dt>Density</dt>
        <dd>Measure of how much light a material absorbs or blocks. In photography and printing, higher density means darker areas that block more light. quadGEN converts L* measurements to density values for linearization calculations, as density provides a more linear relationship with ink amounts than L* alone.</dd>

        <dt>Digital Negative</dt>
        <dd>A digitally created film negative used for alternative photographic processes like platinum/palladium printing, cyanotype, and silver gelatin contact printing. Created by inverting a positive digital image and printing it on transparent film with precise density control.</dd>

        <dt>EDN (Easy Digital Negatives)</dt>
        <dd><a href="http://www.easydigitalnegatives.com/" target="_blank" rel="noopener">Workflow</a> created by Peter Mrhar to build correction LUTs for digital negatives. Export <code>.cube</code> LUTs from EDN for use as global/per-channel corrections in quadGEN.</dd>

        <dt>Edit Mode</dt>
        <dd>Gated state that enables key-point editing and shows overlays. Selected channel draws on top; unselected enabled channels dim.</dd>

        <dt>End (ink limit)</dt>
        <dd>Per-channel maximum ink level. Edits that require more ink can raise End when feasible; when End is effectively locked, edits that exceed it are blocked with status.</dd>

        <dt>Epson Media Installer</dt>
        <dd>Epson utility that downloads and installs ICC profiles and media settings for specific paper types on Epson printers. Provides paper thickness settings and media handling parameters needed for optimal print quality with third-party papers.</dd>

        <dt>Gaussian Weighted Correction</dt>
        <dd>LAB processing method that spreads each measurement's influence smoothly across inputs; reduces artifacts versus naive inversion techniques.</dd>

        <dt>Gamma value</dt>
        <dd>Numerical parameter that controls the shape of a power-law tone curve. In quadGEN's contrast intent presets: gamma < 1.0 (e.g., 0.85) lowers contrast by brightening shadows; gamma > 1.0 (e.g., 1.2, 1.6, 2.2) increases contrast by darkening shadows. Gamma = 1.0 produces a linear curve with no tonal adjustment.</dd>

        <dt>Global correction</dt>
        <dd>A correction that applies uniformly to all channels (e.g., LAB/LUT/ACV loaded as global data or computed from measurements).</dd>

        <dt>Global scale</dt>
        <dd>The batch control that multiplies every channel’s End value by the requested percent. quadGEN records a single undo action for global scaling, so one Undo reverts all affected channels together.</dd>

        <dt>Graph orientation</dt>
        <dd>quadGEN plots printer-space ink mapping with 0% = white (no ink) at the origin. Photoshop/other "tone" tools often use 0,0 = black.</dd>

        <dt>Image space</dt>
        <dd>Coordinate system where 0 represents black (shadow) and 100 represents white (highlight), matching how images are typically viewed and edited. Point (0,0) = black input produces black pixel output; point (100,100) = white input produces white pixel output. ACV files, LUTs, and most user input use image space conventions. quadGEN automatically converts image space data to printer space for internal processing and display.</dd>

        <dt>Ink set</dt>
        <dd>Collection of inks available in a printer, such as the standard CMYK inks or expanded sets like K, C, M, Y, LC, LM, LK, LLK for monochrome work. QuadToneRIP supports multi-shade ink sets that use multiple densities of the same color (e.g., Light Black, Light Light Black) for smoother tonal gradations.</dd>

        <dt>Input Level %</dt>
        <dd>X-axis value representing the input level (0–100%) in printer space; corresponds to the source tone step being mapped.</dd>

        <dt>Intent (Contrast Intent)</dt>
        <dd>A target tonal mapping the correction aims to match. Choose a preset (Linear, Soft/Hard gamma, Filmic, etc...) or define a custom target via sliders or pasted CSV/JSON. Intents affect Δ vs target and exported filename/comments (compact tag), but do not change measurement ingestion; endpoints (0% and 100%) remain fixed. To alter black/white points, adjust ink limits/end values.</dd>

        <dt>Interpolation</dt>
        <dd>Method to form a smooth curve between key points. quadGEN favors monotonic PCHIP for predictable, non-overshooting results.</dd>

        <dt>Endpoint rolloff (shoulder/toe)</dt>
        <dd>A smooth, monotone easing near the ends of the curve (white shoulder, black toe) that prevents a hard plateau and maintains step separation at the last few percent.</dd>

        <dt>Key point</dt>
        <dd>An editable control point of a Smart Curve. Identified by ordinal (1-based). Insert/adjust/delete supported; endpoints often guarded. Coordinates are defined in printer space with the origin at (0,0), where X = input % (0–100) and Y = output ink % (0–100).</dd>

        <dt>L* (L-star)</dt>
        <dd>Lightness component of the LAB color space, ranging from 0 (pure black) to 100 (pure white). L* represents perceptual lightness as seen by human vision. In quadGEN workflows, L* measurements from printed step wedges are converted to density for linearization calculations.</dd>

        <dt>LAB data (<code>.txt</code>)</dt>
        <dd>Text file with measured L*, A*, B* (quadGEN expects GRAY and LAB columns). Used to compute or validate corrections.</dd>

        <dt>LUT (Look-Up Table)</dt>
        <dd>Data structure that maps input values to output values, used for color and tone transformations. quadGEN supports 1D and 3D <code>.cube</code> LUT files from tools like Easy Digital Negatives (EDN) and can extract neutral-axis corrections for linearization.</dd>

        <dt>Lab Tech</dt>
        <dd>The built-in assistant in quadGEN that can answer questions and perform actions (when networked). Optional; core editing/export features work offline.</dd>

        <dt>Linearization</dt>
        <dd>Process of adjusting printer output so that equal input steps (e.g., 0–100%) produce perceptually equal changes in print density or L*. In quadGEN and QuadToneRIP, linearization involves measuring printed step wedges, comparing them to the ideal response, and generating correction curves that enforce a near-linear relationship between input values and visual tone.</dd>

        <dt>Linear ramp</dt>
        <dd>Identity mapping (input % = output %) used as a neutral baseline for tests/export and certain workflows.</dd>

        <dt>Max error %</dt>
        <dd>Used for Smart curve Key point calculation. The largest deviation allowed from data file before a new Key point will be generated. Lower this number to create a tight fitting curve with more Key points. Raise this number to create a smoother curve with fewer Key points.</dd>

        <dt>Max Points</dt>
        <dd>The upper limit on the number of Smart key points that quadGEN will generate when creating a Smart curve. Above this threshold, imported data (e.g., ACV/LUT/LAB) is simplified or interpolated to maintain performance and stability. Maximum is 25 points.</dd>

        <dt>Monotonic</dt>
        <dd>Property of a curve where values either never decrease (monotonic increasing) or never increase (monotonic decreasing) as you move along the X-axis. quadGEN enforces monotonic curves to ensure predictable printer behavior—no ink output reversals that could cause banding or unstable prints.</dd>

        <dt>Reference curve</dt>
        <dd>A fully linearized <code>.quad</code> kept as the authoritative baseline for a printer/process. Branch contrast variants from this reference (Apply Intent or upstream edits) while preserving the trusted linear response.</dd>

        <dt>Open bite</dt>
        <dd>Unwanted etching or surface marking in intaglio printmaking, such as polymer photogravure, caused by insufficient plate hardening. It occurs when too much exposure light is blocked, preventing the formation of proper ink-holding recesses. Often linked to ink limits set too high, requiring careful calibration to avoid.</dd>

        <dt>Output Ink Level %</dt>
        <dd>Y-axis value representing the ink output (0–100%) after applying the curve and current End; higher values mean more ink (darker).</dd>

        <dt>Paper white</dt>
        <dd>The lightest tone that a specific paper can produce—essentially the color and brightness of the unprinted paper surface. In quadGEN workflows, paper white serves as the reference point for determining minimum ink limits and calibrating highlight reproduction.</dd>

        <dt>Patch</dt>
        <dd>Individual tonal step within a step wedge or calibration target. Each patch represents a specific input percentage (e.g., 0%, 10%, 20%) and is measured separately to build the correction curve. A typical 21-step target contains 21 patches at 5% intervals.</dd>

        <dt>Printer space</dt>
        <dd>Coordinate system where 0 represents white (no ink) and 100 represents maximum ink (black), matching how printers actually operate. Point (0,0) = white input produces no ink output (white); point (100,100) = black input produces maximum ink output (black). This is quadGEN's native coordinate system for all internal processing, curve display, and .quad file generation. Input data from image space sources (ACV, LUT, custom intents) is automatically transformed to printer space.</dd>

        <dt>Snapshot pair</dt>
        <dd>Undo entry created from a “Before:”/“After:” capture. quadGEN automatically rewinds to the matching “Before:” snapshot, then stores both states together so redo replays the pair in the correct order.</dd>

        <dt>Smart curve</dt>
        <dd>Adaptive curve model in quadGEN defined by editable key points and monotonic interpolation. Smart curves allow precise local edits while preserving smoothness and avoiding overshoot, enabling efficient linearization and correction workflows.</dd>

        <dt>Step wedge</dt>
        <dd>Test pattern with evenly spaced tonal steps from white to black, printed to measure printer response. Typically contains 10-25 patches at regular intervals (e.g., 0%, 10%, 20%...100%). After printing through QuadToneRIP, the wedge is measured with a colorimeter or spectrophotometer to generate LAB data for linearization in quadGEN. Often used interchangeably with "target."</dd>

        <dt>Target (21/25-step etc)</dt>
        <dd>Printable step-wedge target used for iterative calibration. Measure the print (e.g., with Color Muse 2 or Nix Spectro L), import LAB <code>.txt</code>, refine, and reprint. Often used interchangeably with "step wedge."</dd>

        <dt>Tone curve</dt>
        <dd>Graph showing the relationship between input tonal values and output tonal values, controlling how light and dark areas are reproduced. In quadGEN, tone curves are displayed in printer space (X = input %, Y = output ink %) and can be linear (no change) or shaped for specific contrast intents.</dd>
                    <dt>Spectrophotometer</dt>
        <dd>Measures full spectral reflectance for precise LAB calculations and deep-shadow accuracy. Ideal for alternative processes and professional calibration. Example: <a href="https://amzn.to/4msSLOv" target="_blank" rel="noopener">Nix Spectro L</a>.</dd>

<dt>Nix Spectro L</dt>
        <dd>Compact spectrophotometer capable of low-L* readings. Capture LAB data with the Nix app and import the <code>.txt</code> file into quadGEN. Ideal for alternative and darkroom processes. <a href="https://amzn.to/4msSLOv" target="_blank" rel="noopener">Product link</a>.</dd>

                    <dt>P900</dt>
        <dd>Epson SureColor P900 17-inch photo printer (K,C,M,Y,LC,LM,LK,LLK,V,MK) often used for monochrome workflows with QuadToneRIP. <a href="https://amzn.to/42yGCQD" target="_blank" rel="noopener">Product link</a>.</dd>

        <dt>PCHIP</dt>
        <dd>Piecewise Cubic Hermite Interpolating Polynomial—a mathematical method for creating smooth curves between data points. Unlike other interpolation methods, PCHIP prevents overshooting and maintains monotonic behavior, making it ideal for photographic tone curves where predictable, artifact-free results are essential.</dd>

<dt>PoPS (Prints on Paper Studio)</dt>
        <dd><a href="https://printsonpaper.studio/" target="_blank" rel="noopener">Collaborative printmaking studio</a> specializing in photogravure and digital pigment printing, offering artists a welcoming environment to create and edition fine art prints using innovative techniques. PoPS has developed contrast intent presets included in quadGEN for alternative photographic processes. Note: quadGEN is not affiliated with or part of Prints on Paper Studio.</dd>

        <dt>Print Tool</dt>
        <dd><a href="https://www.quadtonerip.com/html/QTRprinttool.html" target="_blank" rel="noopener">Utility application</a> for macOS that enables color-managed printing from TIFF files while bypassing standard print driver limitations. Commonly used with QuadToneRIP workflows for printing digital negatives and monochrome images.</dd>

        <dt>QuadToneRIP (QTR)</dt>
        <dd><a href="https://www.quadtonerip.com/" target="_blank" rel="noopener">Specialized RIP/driver</a> for Epson printers designed for high-quality monochrome printing with multi-shade ink sets. QTR uses <code>.quad</code> files to control how much ink each channel lays down across the 0–100% input range, enabling precise tonal calibration and alternative process workflows such as digital negatives.</dd>

        <dt>RIP</dt>
        <dd>Raster Image Processor—software that converts digital images into printer-specific instructions, controlling how ink is laid down on paper. RIPs like QuadToneRIP provide precise control over individual ink channels and support specialized workflows beyond standard printer drivers.</dd>

        <dt>Revert (to measurement)</dt>
        <dd>Buttons that return curves to the loaded measurement source for iteration. <strong>Per‑channel Revert</strong> clears Smart curves/points and re‑enables that channel’s measurement (enabled only when measurement data is loaded for that channel). <strong>Global Revert</strong> clears Smart curves/points across all channels and re‑enables the global measurement (enabled only when a global file is loaded and the global toggle is ON). Both actions are undoable.</dd>

        <dt>Recompute</dt>
        <dd>Button in Edit Mode that regenerates Smart curve key points for the selected channel from the currently plotted curve using the configured <em>Max error %</em> and <em>Max Points</em> settings—useful for simplifying or refreshing an editable set from a loaded <code>.quad</code>.</dd>
      </dl>
    </section>
  `;
}

export function getHelpHistoryHTML(versionHistory = VERSION_HISTORY, releaseChannel = APP_RELEASE_CHANNEL){
  const licenseYear = new Date().getFullYear();
  const historyHtml = generateAboutDialogVersionHistory(versionHistory, releaseChannel);
  const inner = `
    <div class="space-y-4">
      <div class="text-xs text-gray-500">MIT License — quadgen.html © ${licenseYear} David Marsh. HTML file only. Full text is in the page source.</div>
      <div>
        <h3 class="text-base font-semibold mb-2">Version History</h3>
        ${historyHtml}
      </div>
      <div>
        <h3 class="text-base font-semibold mb-2">Source & Contributions</h3>
        <p>
          The latest source, issue tracker, and contribution guidelines live at
          <a href="https://github.com/David-Marsh-Photo/quadGEN" target="_blank" rel="noopener">github.com/David-Marsh-Photo/quadGEN</a>.
        </p>
      </div>
    </div>
  `;
  return `<section class="prose prose-gray max-w-none p-6 bg-white rounded-2xl shadow">${inner}</section>`;
}

export function getHelpWorkflowHTML(){
  return `
    <section class="prose prose-gray max-w-none p-6 bg-white rounded-2xl shadow">
      <h2>quadGEN Workflow</h2>
      <h3>Purpose</h3>
      <ul>
        <li>Provide a concise, repeatable workflow to build and refine <code>.quad</code> curves for QuadToneRIP (QTR).</li>
      </ul>
      <h3>Prerequisites</h3>
      <ul>
        <li><a href="https://www.quadtonerip.com/" target="_blank" rel="noopener">QuadToneRIP</a> installed; know where your printer’s “quad” folder is.</li>
        <li>Ability to print a step wedge/target via QTR (Print-Tool on macOS recommended).</li>
        <li>Optional (but recommended): <a href="https://amzn.to/45R8rof" target="_blank" rel="noopener">Color Muse 2</a> or <a href="https://amzn.to/4msSLOv" target="_blank" rel="noopener">Nix Spectro L</a> to capture LAB L*.</li>
      </ul>
      <h3>1) Choose Printer</h3>
      <ul>
        <li>At the top of the page, select your Epson printer model.</li>
      </ul>
      <h3>2) Export a starting <code>.quad</code></h3>
      <ul>
        <li>You can skip this step if you already have an existing <code>.quad</code> to refine. Otherwise, start with a single linear ramp of Black (K) — or Matte Black (MK) if available — using the default 100% ink limit.</li>
        <li>Install the <code>.quad</code> into QTR’s quad folder for your printer.</li>
      </ul>
      <h3>3) Verify Ink Choice & Limits</h3>
      <ul>
        <li><strong>Digital negative processes</strong>: Find the lowest ink limit that still achieves paper white by printing a step target and determine the ink limit used at the first patch that matches your paper white.  Invert the target image in your editor before printing with your <code>.quad</code>. For example, if the first patch that matches your paper white occured on the 8th darkest patch of an evenly spaced 10 step negative (referring to the <i>positive</i> target image), you can use an ink limit of 80%</li>
        <li><strong>Positive processes (e.g., polymer photogravure)</strong>: Find the maximum ink limit that <em>does not</em> cause open bite by printing an open‑bite target and increasing the ink limit until the first signs of open bite, then back off.</li>
        <li>Once you’ve identified an ink limit, create a new .quad file with that limit and proceed to calibration.</li>
      </ul>
      <h3>4) Print a Calibration Target</h3>
      <ul>
        <li>
          <p><strong>Option A — LAB workflow</strong></p>
          <ul>
            <li>Use QTR/Print‑Tool and the <code>.quad</code> from step 2/3 to print a 0–100% step wedge (or <a href="https://clayharmonblog.com/downloads" target="_blank" rel="noopener">Clay Harmon’s 21/25‑step target</a>).</li>
            <li>Ensure color management is OFF in Print‑Tool.</li>
          </ul>
        </li>
        <li>
          <p><strong>Option B — EDN workflow</strong></p>
          <ul>
            <li>Visit <a href="http://www.easydigitalnegatives.com/" target="_blank" rel="noopener">Easy Digital Negatives</a> and download the appropriate target file.</li>
            <li>Print the EDN target via QTR/Print‑Tool with color management OFF, using the <code>.quad</code> from step 2/3.</li>
          </ul>
        </li>
      </ul>
      <h3>5) Calibration: Measure the Print</h3>
      <ul>
        <li>
          <p><strong>Option A — LAB workflow</strong></p>
          <ol>
            <li><strong>Set patch count</strong>: choose the number of patches/steps to match your printed target.</li>
            <li><strong>Enter Patch % (X)</strong>: if your target is not evenly spaced, type the input position for each row (0–100). If evenly spaced, keep the defaults.</li>
            <li><strong>Measure and enter L*</strong>: measure each printed patch with your device (e.g., <a href="https://amzn.to/45R8rof" target="_blank" rel="noopener">Color Muse 2</a> or <a href="https://amzn.to/4msSLOv" target="_blank" rel="noopener">Nix Spectro L</a>) and enter L* (0–100) in the matching row.</li>
            <li><strong>Apply or save</strong>: click “Generate Correction” to apply immediately, or “Save as .txt” to export the entries for later reuse.</li>
          </ol>
        </li>
        <li>
          <p><strong>Option B — EDN workflow</strong></p>
          <ol>
            <li>Follow the EDN instructions to scan and analyze your print result.</li>
            <li>Download the EDN-generated <code>.acv</code> or <code>.cube</code> file.</li>
          </ol>
        </li>
      </ul>
      <h3>6) Load Data into quadGEN</h3>
      <ul>
        <li>
          <p><strong>Option A — LAB workflow</strong></p>
          <ol>
            <li><strong>Load LAB (.txt)</strong>: If not already applied from the Manual L* Entry window, use the Load Data File in the Global Corrections panel to load your saved measurements.</li>
            <li><strong>Interpretation</strong>: Y = output ink % vs X = input %; Y = X is “no correction”. Too dark at X → dip below diagonal; too light at X → rise above.</li>
            <li><strong>Edit Mode tip</strong>: If Edit Mode is already ON, quadGEN now reseeds Smart key points from the measurement as soon as the file loads so the plotted curve updates immediately.</li>
          </ol>
        </li>
        <li>
          <p><strong>Option B — EDN workflow</strong></p>
          <ol>
            <li><strong>Load ACV/LUT</strong>: use the Load Data File in the Global Corrections panel to load the downloaded EDN <code>.acv</code> or <code>.cube</code>.</li>
            <li><strong>Interpretation</strong>: same graph semantics — Y = output ink %, X = input %; dips lighten, humps darken.</li>
          </ol>
        </li>
      </ul>
      <h3>7) Export Corrected <code>.quad</code></h3>
      <ul>
        <li>Export the corrected <code>.quad</code> for general use and archive it as your “reference” Linear profile.</li>
        <li>Keep this reference untouched; branch contrast variants by either baking presets with <strong>Apply Intent</strong> (when no LAB data is loaded) or doing the contrast move upstream in Photoshop before printing through the reference. Both paths land on the same tonal response.</li>
      </ul>
      <h3 id="helpEditModeSection">8) Enter Edit Mode for Fine Tuning (optional)</h3>
      <ul>
        <li><strong>Overview:</strong> Edit Mode converts the selected channel into Smart key points so you can make precise, point-by-point adjustments while every other enabled channel dims for context. Toggle it off when you want to lock the curve.</li>
        <li><strong>Toggle & visibility:</strong> Enable Edit Mode in the Edit Curves panel to expose the Smart controls; the selected channel renders on top and only it shows numbered key-point markers.</li>
        <li><strong>Calculate points:</strong>
          <ul>
            <li><strong>Max error %</strong>: Sets how closely the generated Smart points follow the underlying curve (lower = more points, tighter fit).</li>
            <li><strong>Max Points</strong>: Caps how many Smart points quadGEN will generate (2-21).</li>
            <li><strong>Recompute</strong>: Regenerates Smart key points from the currently plotted curve using the settings above—ideal for simplifying dense data from LAB or <code>.quad</code> loads.</li>
          </ul>
        </li>
        <li><strong>Editing tools:</strong>
          <ul>
            <li><strong>XY input</strong>: Type <code>X,Y</code> (Y is absolute after the channel End). The Up/Down nudges adjust absolute Y, and Left/Right nudges adjust X.</li>
            <li><strong>Point selection</strong>: Use the point selector arrows to step through Smart points in order; the label updates as you move.</li>
            <li><strong>Insert/Delete</strong>: Click the chart to insert at the current curve location. Deleting endpoints is blocked; use Undo if a change goes too far.</li>
            <li><strong>Undo / Redo</strong>: Every edit is logged in history, so you can step backwards or forwards as needed.</li>
          </ul>
        </li>
      </ul>
      <h3>9) Iterate Until Linear (optional)</h3>
      <ul>
        <li>Repeat from step 5 until corrections become negligible.</li>
        <li>There will be some noise in the measurements for both workflows. Expect diminishing returns on linearization.</li>
      </ul>
      <h3>10) Choose a Contrast Intent (optional)</h3>
      <ul>
        <li>Use the <strong>Intent</strong> dropdown in Global Correction to pick a preset (Linear, Soft, Hard, Filmic) or choose <strong>Enter Custom…</strong> to open the modal.</li>
        <li><strong>Custom</strong>: apply sliders (Gamma or Filmic‑like) or <strong>Paste CSV/JSON</strong> data; the parser auto-validates pasted text.</li>
        <li>Intents shape the target curve only; ingestion and reconstruction are unchanged. Endpoints (0% and 100%) remain fixed — adjust ink limits/end values to move black/white points.</li>
        <li>When no LAB data is active, the <strong>Apply Intent</strong> button bakes the selected preset into the loaded <code>.quad</code>; use it to spin off contrast-specific variants directly from your reference.</li>
      </ul>
      <h3>Notes & Tips</h3>
      <ul>
        <li>Keep curves smooth, avoid kinks near endpoints.</li>
        <li>Use the +/− zoom control in the lower-left of the graph to blow up low ink-limit curves; the Y-axis labels reflect the displayed max and the chart auto-expands if a newly enabled channel exceeds it.</li>
        <li>For digital negatives, invert the image in your editor before printing with your <code>.quad</code>.</li>
      </ul>
      <h3>References</h3>
      <ul>
        <li><a href="https://www.quadtonerip.com/" target="_blank" rel="noopener">QuadToneRIP</a></li>
        <li><a href="https://www.quadtonerip.com/html/QTRoverview.html" target="_blank" rel="noopener">QTR Overview</a></li>
        <li><a href="https://www.quadtonerip.com/html/QTRprinttool.html" target="_blank" rel="noopener">Print‑Tool (macOS)</a></li>
        <li><a href="https://amzn.to/45R8rof" target="_blank" rel="noopener">Color Muse 2</a></li>
        <li><a href="https://amzn.to/4msSLOv" target="_blank" rel="noopener">Nix Spectro L</a></li>
      </ul>
    </section>
  `;
}
