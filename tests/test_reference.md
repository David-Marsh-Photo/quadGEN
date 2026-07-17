# quadGEN Test Suite Reference

**Note:** Keep referenced entries current when those tests are removed or significantly modified.

This document summarizes selected automated contracts in the `/tests` directory.

## Test Utilities

- **`../test-helpers.js`** - Reusable Playwright utilities for reliable browser testing (stable page setup, safe clicking, element state checking)
- **`../playwright-timeout-fixes.md`** - Best practices guide for avoiding Playwright timeout errors

---

### 1. `cgats-parser.test.js`
*   **Purpose:** Tests the parsing of CGATS measurement files.
*   **Covers:** Verifies that different formats (lab-only, rich spectral, K-only, Argyll `.ti3`) are read correctly, and that metadata and patch data are properly extracted.

### 2. `chart_zoom.spec.js`
*   **Purpose:** Tests the UI logic for the chart zoom feature.
*   **Covers:** Ensures that zoom preferences are saved and loaded, zoom levels snap correctly, and the zoom buttons are disabled at the boundaries (e.g., you can't zoom past 100%).

### 3. `parsers/cube-parser.test.js`
*   **Purpose:** Tests strict parsing of 1D and 3D `.cube` LUT files.
*   **Covers:** Exact 1D declarations and size limits, headerless/lowercase compatibility, atomic finite rows, scalar/RGB domains, red-fastest per-axis 3D neutral extraction, malformed input rejection, and retained fixture behavior.

### 4. `dataspace.spec.js`
*   **Purpose:** Tests the conversion logic between "image space" (0=white) and "printer space" (0=black).
*   **Covers:** Verifies that data is correctly identified and inverted when moving between these two coordinate systems.

### 5. `load_quad_smoke.spec.js`
*   **Purpose:** A high-level "smoke test" for the entire `.quad` file loading process.
*   **Covers:** It simulates loading a real `.quad` file and checks that the printer is identified, the UI rows are created, and the data is populated without causing any errors.

### 6. `make256_helpers.spec.js`
*   **Purpose:** Tests the main pipeline steps for generating a final 256-point curve.
*   **Covers:** It tests the individual helper functions for building the base curve, applying per-channel linearization, applying global linearization, and applying the auto-endpoint adjustments.

### 7. `e2e/manual-lstar-apply.spec.ts`
*   **Purpose:** Proves that Manual L* replacement and history form one reversible operator action.
*   **Covers:** Exact prior-correction independence plus Apply/Undo/Redo convergence across active, central, and compatibility correction payloads; baked metadata and controls; runtime smoothing; chart and canvas; preview; and exported `.quad` content.
