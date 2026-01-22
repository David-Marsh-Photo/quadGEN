# Codebase Structure

**Analysis Date:** 2026-01-22

## Directory Layout

```
quadGEN/
├── src/                          # Source code (ES6 modules)
│   ├── main.js                   # Application entry point
│   ├── index.template.html       # HTML template (Vite source)
│   ├── styles/
│   │   └── main.css              # Theme system & global styles
│   └── js/
│       ├── ai/                   # AI integration (Claude API)
│       ├── core/                 # State management & processing
│       ├── curves/               # Smart curve generation
│       ├── data/                 # Format parsing & linearization
│       ├── debug/                # Debug utilities
│       ├── files/                # File I/O operations
│       ├── legacy/               # Legacy code bridges
│       ├── math/                 # Interpolation & math utilities
│       ├── parsers/              # File format parsers
│       ├── ui/                   # User interface components
│       └── utils/                # Shared utilities
├── dist/                         # Build output (generated)
│   └── index.html                # Built HTML (copied to root)
├── index.html                    # Production build (root level)
├── tests/                        # Test suites
│   ├── core/                     # Unit tests for core modules
│   ├── ui/                       # UI component tests
│   ├── e2e/                      # End-to-end Playwright tests
│   ├── lab/                      # LAB data & linearization tests
│   ├── fixtures/                 # Test data files
│   └── helpers/                  # Test utilities
├── docs/                         # Reference documentation
│   ├── architecture-map.md       # Module dependency diagram
│   ├── File_Specs/               # Format specifications
│   ├── features/                 # Feature documentation
│   └── dev/                      # Developer guides
├── scripts/                      # Build & utility scripts
├── .context/                     # Claude AI context modules
├── .planning/                    # Planning & analysis (generated)
├── package.json                  # Dependencies & build config
├── vite.config.js                # Vite bundler config
└── README.md                     # Project overview
```

## Directory Purposes

**src/main.js:**
- Purpose: Application initialization and module orchestration
- Imports all modules in dependency order
- Initializes StateManager, HistoryManager, event handlers
- Sets up theme system, printer UI, chart, modals
- Exports functions to console for debugging

**src/index.template.html:**
- Purpose: HTML template for Vite build
- Single-page structure with semantic HTML
- Links to `/src/main.js` as ES6 module
- Contains Tailwind CSS CDN and custom CSS
- Build output: `dist/index.html` → `index.html` (root)

**src/js/ai/:**
- Purpose: Claude API integration
- Files:
  - `ai-actions.js` - QuadGenActions class with API communication
  - `ai-config.js` - API credentials and configuration
  - `ai-functions.js` - Function definitions for Claude tool use
  - `chat-interface.js` - Chat UI state management
- Used by: `event-handlers.js`, `chat-ui.js`

**src/js/core/:**
- Purpose: State management, processing pipeline, core business logic
- Largest module (~40 files, 19k LOC)
- Submodules:
  - **State & Config:**
    - `state.js` - Global state object (appState), PRINTERS config, elements cache
    - `state-manager.js` - Reactive StateManager with subscriptions
    - `config.js` - LAB tuning parameters, intent presets
    - `version.js` - APP_VERSION, DEBUG_LOGS flag
  - **Processing Pipeline:**
    - `processing-pipeline.js` - make256(), apply1DLUT(), buildFile() (6737 LOC)
    - `feature-flags.js` - Feature toggles & debug gates (453 LOC)
  - **State Machines:**
    - `history-manager.js` - Undo/redo system (1718 LOC)
    - `scaling-utils.js` - Channel scaling & baseline management (1101 LOC)
    - `scaling-coordinator.js` - Global scale orchestration (320 LOC)
    - `bell-shift-state.js` - Bell curve shift mode state
    - `bell-shift-controller.js` - Bell curve control logic
  - **Validation & Guards:**
    - `validation.js` - InputValidator class
    - `channel-locks.js` - Per-channel edit locks (250 LOC)
    - `auto-limit-state.js`, `auto-limit-config.js` - Auto endpoint configuration
  - **Correction & Intent:**
    - `correction-method.js` - EDN vs QTR intent determination
    - `lab-settings.js` - LAB smoothing & normalization modes
    - `composite-*.js` - Multi-ink composite correction (debug, momentum, settings)
    - `snapshot-*.js` - Snapshot flag tracking and slope limiting
  - **Metadata & Analytics:**
    - `event-sync.js` - Event synchronization system
    - `channel-densities.js` - Ink density solver defaults
    - `composite-debug.js` - Debug session tracking (509 LOC)
    - `auto-raise-on-import.js` - Auto ink-limit raising logic (537 LOC)
  - **Nested Subdirectory:**
    - `simple-scaling/` - Legacy scaling system (fallback)

**src/js/curves/:**
- Purpose: Smart curve generation and key-point management
- Files:
  - `smart-curves.js` - ControlPoints, ControlPolicy, Smart curve state, relative/absolute conversion
  - `smart-rescaling-service.js` - Key-point rescaling for ink-limit changes
- Constants: `KP_SIMPLIFY` threshold for simplifying key points
- Export: `generateCurveFromKeyPoints()` uses PCHIP interpolation

**src/js/data/:**
- Purpose: File parsing and data transformation
- Files:
  - **Parsers:**
    - `quad-parser.js` - Parse .quad files
    - `lab-parser.js` - Parse LAB measurement data, build interpolators
    - `cube-parser.js` - Parse 1D/3D LUT files
    - `cgats-parser.js` - CGATS .ti3 measurement format
  - **Utilities:**
    - `linearization-utils.js` - LinearizationState, per-channel & global corrections
    - `processing-utils.js` - CURVE_RESOLUTION, DataSpace enum, array utilities
    - `curve-simplification.js` - CurveSimplification, smoothing algorithms
    - `lab-utils.js` - buildInkInterpolatorFromMeasurements(), LAB math
    - `lab-legacy-bypass.js` - Legacy LAB data format support
    - `curve-shape-detector.js` - Detect curve characteristics (monotonic, slope, etc.)

**src/js/ui/:**
- Purpose: User interface, event handling, visualization
- Major files (>300 LOC):
  - `event-handlers.js` - All DOM event listeners & handlers (6757 LOC)
  - `chart-manager.js` - Chart zoom, correction gain, overlay management (3842 LOC)
  - `edit-mode.js` - Smart key-point editing, drag-drop, overlays (3399 LOC)
  - `help-content-data.js` - Help system content (2146 LOC)
  - `channel-builder-modal.js` - Multi-ink channel builder UI (987 LOC)
  - `composite-debug-panel.js` - Correction analysis UI (923 LOC)
- Smaller utilities:
  - `chart-utils.js` - Coordinate mapping, hit testing, geometry
  - `chart-renderer.js` - Canvas drawing functions
  - `chart-divider.js` - Resizable pane divider
  - `ui-hooks.js` - Observable trigger functions (registerInkChartHandler, etc.)
  - `ui-utils.js` - String formatting, debounce, DOM utilities
  - `theme-manager.js` - Dark/light mode system
  - `status-service.js` - User feedback messages
  - `status-messages.js` - Message templates
  - `graph-status.js` - Processing status updates
  - `quad-preview.js` - .quad file generation preview
  - `manual-lstar.js` - Manual L* value input
  - `options-modal.js` - Application options dialog
  - `help-system.js` - Help panel & tutorials
  - `intent-system.js` - Print intent UI
  - `revert-controls.js` - Undo/revert button logic
  - `channel-registry.js` - Channel row DOM cache
  - `compact-channels.js` - Disabled channels display
  - `tab-manager.js` - Tab switching UI
  - `printer-manager.js` - Printer selection & sync
  - `bell-width-controls.js` - Bell width slider UI
  - `bell-shift-controls.js` - Bell shift mode UI
  - `chat-ui.js` - Claude AI chat interface
  - `tooltips.js` - Tooltip system initialization
  - `labtech-summaries.js` - Post-linearization summaries
  - `lstar-entry-utils.js` - L* input helpers
  - `drag-utils.js` - Drag-drop utilities

**src/js/math/:**
- Purpose: Numerical interpolation
- Files:
  - `interpolation.js` - createPCHIPSpline(), createCubicSpline(), createCatmullRomSpline(), clamp01()
- **Critical:** Always use PCHIP for photography curves (never smoothstep, Catmull-Rom for .quad generation)

**src/js/parsers/:**
- Purpose: File format detection and dispatching
- Files:
  - `file-parsers.js` - parseQuadFile(), parseLabData(), parseCube1D(), parseACVFile(), etc.
- Detection: Magic bytes + structure inspection

**src/js/files/:**
- Purpose: File I/O operations
- Files:
  - `file-operations.js` - downloadFile(), readFileAsText(), generateFilename()
  - `reference-quad-loader.js` - Load reference .quad for comparison

**src/js/legacy/:**
- Purpose: Backwards compatibility bridges
- Files:
  - `state-bridge.js` - Legacy state object compatibility layer
  - `legacy-helpers.js` - Utility functions for legacy code paths
  - `linearization-bridge.js` - Legacy linearization API compatibility
  - `intent-bridge.js` - Legacy intent handling

**src/js/utils/:**
- Purpose: Cross-module utilities
- Files:
  - `debug-registry.js` - registerDebugNamespace(), debug logging system
  - `browser-env.js` - Browser detection & environment checks
  - `lab-math.js` - LAB color space math utilities

**src/js/debug/:**
- Purpose: Diagnostic utilities
- Files:
  - `debug-make256.js` - captureMake256Step() for pipeline debugging

**tests/:**
- Purpose: Automated testing (unit, integration, E2E)
- Organization:
  - `core/` - Unit tests for state, processing, curves
  - `ui/` - UI component tests
  - `e2e/` - Playwright browser automation tests
  - `lab/` - Linearization & correction tests
  - `data/` - Parser & data transformation tests
  - `fixtures/` - Test .quad, .lab, .cube files
  - `helpers/` - Test utilities & snapshots

**docs/:**
- Purpose: User & developer reference
- Files:
  - `architecture-map.md` - Generated module dependency graph
  - `EDIT_MODE.md` - Edit mode user guide
  - `File_Specs/` - Format specifications (QUAD, CUBE, ACV, LAB)
  - `features/` - Feature documentation (bell curves, linearization, etc.)
  - `dev/` - Developer guides

**scripts/:**
- Purpose: Build automation & utilities
- Commands: `npm run build:agent`, `npm run test`, `npm run test:e2e`

## Key File Locations

**Entry Points:**
- `src/main.js` - Application initialization
- `src/index.template.html` - HTML root

**Configuration:**
- `src/js/core/state.js` - PRINTERS, INK_COLORS, TOTAL (65535)
- `src/js/core/config.js` - LAB_TUNING, AUTO_LIMIT_DEFAULTS, CONTRAST_INTENT_PRESETS
- `src/js/core/version.js` - APP_VERSION, DEBUG_LOGS
- `package.json` - Dependencies, build scripts

**Core Logic:**
- `src/js/core/processing-pipeline.js` - make256() main entry
- `src/js/core/state-manager.js` - StateManager reactive system
- `src/js/core/history-manager.js` - Undo/redo
- `src/js/curves/smart-curves.js` - Smart curve state & generation

**Testing:**
- `tests/e2e/*.spec.ts` - Playwright E2E tests
- `tests/core/*.test.js` - Unit tests
- `tests/lab/*.test.js` - Linearization tests

## Naming Conventions

**Files:**
- Controllers: `*-controller.js` (e.g., `bell-shift-controller.js`)
- State: `*-state.js` (e.g., `bell-shift-state.js`)
- Config: `*-config.js` (e.g., `auto-limit-config.js`)
- Managers: `*-manager.js` (e.g., `state-manager.js`, `history-manager.js`)
- Utilities: `*-utils.js` (e.g., `scaling-utils.js`, `ui-utils.js`)
- Parsers: `*-parser.js` (e.g., `quad-parser.js`)
- Modals: `*-modal.js` (e.g., `options-modal.js`)
- Bridges: `*-bridge.js` (e.g., `state-bridge.js`)

**Directories:**
- `src/js/{category}/` - All code grouped by layer
- `tests/{category}/` - Tests mirror source structure
- `docs/features/` - Feature documentation

**Functions:**
- camelCase: `updateInkChart()`, `makeQuadFile()`
- State accessors: `getAppState()`, `setLoadedQuadData()`
- Predicates: `isSmartCurve()`, `isChannelLocked()`, `isEditModeEnabled()`
- Triggers: `triggerInkChartUpdate()`, `triggerPreviewUpdate()`
- Initialization: `initialize{Module}()`, `init{Module}()`

**Classes:**
- PascalCase: `StateManager`, `HistoryManager`, `ControlPoints`, `LinearizationState`, `InputValidator`
- Purpose: Major state containers, domain objects, facade classes

**Constants:**
- SCREAMING_SNAKE_CASE: `TOTAL`, `CURVE_RESOLUTION`, `INK_COLORS`, `PRINTERS`

## Where to Add New Code

**New Feature (UI + Processing):**
- UI: `src/js/ui/{feature-name}.js`
- Core logic: `src/js/core/{feature-name}.js` (if state/config related)
- Test: `tests/{category}/{feature-name}.test.js`
- Integration: Import and initialize in `src/main.js`

**New Component/Modal:**
- Implementation: `src/js/ui/{component-name}-modal.js` or `src/js/ui/{component-name}.js`
- Event handler: Add listener in `src/js/ui/event-handlers.js`
- Styles: Add CSS classes to `src/styles/main.css`
- Test: `tests/ui/{component-name}.test.js` (Playwright)

**New Chart Overlay:**
- Rendering logic: `src/js/ui/chart-renderer.js`
- State: `src/js/core/{overlay-name}.js` (if persistent state needed)
- UI control: `src/js/ui/event-handlers.js` (toggle handler)
- Test: `tests/ui/chart-rendering.test.js` or `tests/e2e/{feature-name}.spec.ts`

**New File Format Support:**
- Parser: `src/js/data/{format-name}-parser.js`
- Registration: `src/js/parsers/file-parsers.js` (add to dispatcher)
- Type detection: Enhance `validateFileFormat()`
- Test: `tests/parsers/{format-name}.test.js` with fixtures in `tests/fixtures/`

**Utilities:**
- Shared helpers: `src/js/utils/{utility-name}.js`
- Module-specific: `{module}/` as needed
- Math functions: `src/js/math/{function-name}.js`

**Tests:**
- Unit: `tests/core/`, `tests/ui/`, `tests/data/`
- E2E: `tests/e2e/{feature-name}.spec.ts`
- Fixtures: `tests/fixtures/{test-data-name}`

## Special Directories

**src/styles/:**
- Purpose: Global CSS and theme system
- CSS Variables: All colors, spacing, animations defined as custom properties
- Dark mode: Toggle via `window.toggleTheme()` switches class on `<html>`
- Committed: Yes (required for build)

**tests/fixtures/:**
- Purpose: Test data files (.quad, .lab, .cube, .acv)
- Generated: No (committed reference files)
- Committed: Yes

**tests/e2e/scripts/:**
- Purpose: Diagnostic Playwright scripts
- Generated: No (development utilities)
- Committed: Yes

**.context/:**
- Purpose: Claude AI context modules
- Generated: No (manually maintained)
- Committed: Yes

**.planning/codebase/:**
- Purpose: Architecture analysis documents
- Generated: Yes (via `/gsd:map-codebase`)
- Committed: No (git-ignored)

**dist/:**
- Purpose: Vite build output
- Generated: Yes (via `npm run build:agent`)
- Committed: No (git-ignored after build)

---

*Structure analysis: 2026-01-22*
