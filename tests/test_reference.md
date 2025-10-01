# quadGEN Test Suite Reference

**Note:** This document should be kept up-to-date whenever tests are added, removed, or significantly modified.

This document provides a summary of the automated tests in the `/tests` directory.

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

### 3. `cube_parser.test.js`
*   **Purpose:** Tests the parsing of `.cube` LUT (Look-Up Table) files.
*   **Covers:** Checks that a standard 1D `.cube` file is parsed correctly and that invalid files are rejected.

### 4. `dataspace.spec.js`
*   **Purpose:** Tests the conversion logic between "image space" (0=white) and "printer space" (0=black).
*   **Covers:** Verifies that data is correctly identified and inverted when moving between these two coordinate systems.

### 5. `load_quad_smoke.spec.js`
*   **Purpose:** A high-level "smoke test" for the entire `.quad` file loading process.
*   **Covers:** It simulates loading a real `.quad` file and checks that the printer is identified, the UI rows are created, and the data is populated without causing any errors.

### 6. `make256_helpers.spec.js`
*   **Purpose:** Tests the main pipeline steps for generating a final 256-point curve.
*   **Covers:** It tests the individual helper functions for building the base curve, applying per-channel linearization, applying global linearization, and applying the auto-endpoint adjustments.

### 7. `history_flow.spec.js`
*   **Purpose:** A placeholder for future tests related to the undo/redo history feature.
*   **Covers:** Nothing. This test is currently skipped.