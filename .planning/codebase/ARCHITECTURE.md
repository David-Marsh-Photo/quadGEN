# Architecture

**Analysis Date:** 2026-01-22

## Pattern Overview

**Overall:** Modular ES6 single-page application (SPA) with layered architecture separating state management, data processing, UI rendering, and file I/O.

**Key Characteristics:**
- Vanilla JavaScript (no framework) with ES6 modules
- Centralized state management via StateManager and AppState objects
- Reactive event-driven updates via observer pattern (triggerInkChartUpdate, etc.)
- Multi-stage data processing pipeline with feature flags
- Undo/redo history system via HistoryManager
- Theme system with localStorage persistence

## Layers

**UI Layer:**
- Purpose: User interface rendering, event handling, and chart visualization
- Location: `src/js/ui/`
- Contains: Event handlers, chart management, modals, controls, theme system
- Depends on: Core state, curves, data processing
- Used by: Application entry point
- Key files: `event-handlers.js` (6757 LOC), `chart-manager.js` (3842 LOC), `edit-mode.js` (3399 LOC)

**Core State & Management Layer:**
- Purpose: Global state management, printer configuration, DOM element caching, history tracking
- Location: `src/js/core/`
- Contains: State machines (state.js, state-manager.js), history manager, validation, configuration
- Depends on: Curves, data utilities, debug registry
- Used by: UI layer, processing pipeline
- Key files: `state.js` (1187 LOC), `state-manager.js` (905 LOC), `history-manager.js` (1718 LOC), `processing-pipeline.js` (6737 LOC)

**Data Processing Layer:**
- Purpose: Parse input formats, apply corrections, generate output curves
- Location: `src/js/data/`, `src/js/parsers/`
- Contains: File parsers, linearization, LAB data handling, curve simplification
- Depends on: Math utilities, legacy bridge code
- Used by: Core processing pipeline, UI layer
- Key files: `linearization-utils.js`, `lab-parser.js`, `quad-parser.js`, `lab-legacy-bypass.js`

**Curves & Interpolation Layer:**
- Purpose: Smart curve generation, key-point management, curve rescaling
- Location: `src/js/curves/`, `src/js/math/`
- Contains: Smart curve state management, PCHIP/cubic interpolation, key-point validation
- Depends on: Math interpolation, processing utilities
- Used by: Core pipeline, UI layer
- Key files: `smart-curves.js`, `smart-rescaling-service.js`, `interpolation.js`

**Utility Layers:**
- Purpose: Shared helpers and cross-cutting concerns
- Location: `src/js/utils/`, `src/js/ai/`, `src/js/legacy/`, `src/js/files/`, `src/js/debug/`
- Contains: Debug registry, LAB math, browser environment detection, AI integration, legacy state bridges, file I/O
- Used by: All other layers

## Data Flow

**Curve Generation & Processing Pipeline:**

1. **Input Sources** → Load phase
   - `.quad` files → `parseQuadFile()` → `loadedQuadData.curves`
   - LAB measurements → `parseLabData()` → `LinearizationState.samples`
   - `.cube` LUTs → `parseCube1D/3D()` → global linearization
   - `.acv` (Photoshop curves) → `parseACVFile()` → adapter overlays

2. **Base Curves** → `buildBaseCurve()` in processing pipeline
   - Use loaded .quad data OR linear ramps (0-65535)
   - Per-channel enabled/disabled state determines output

3. **Smart Curves** → `generateCurveFromKeyPoints()` in `smart-curves.js`
   - Per-channel key-point arrays (relative %) interpolated with PCHIP
   - Applied per-channel if `isSmartCurve(channel)` returns true
   - Rescaled uniformly if ink limit (End) changes via `rescaleSmartCurveForInkLimit()`

4. **Per-Channel Linearization** → `applyPerChannelLinearizationStep()` in processing pipeline
   - Per-channel correction samples applied independently
   - Feature-flag gated (active-range linearization)

5. **Global Linearization** → `applyGlobalLinearizationStep()` in processing pipeline
   - System-wide corrections (EDN-style .cube or .acv)
   - Applied after per-channel stage
   - Feature-flag gated with legacy LUT mapping modes

6. **Auto Endpoint Rolloff** → `applyAutoEndpointAdjustments()` in processing pipeline
   - Detects and prevents flat ceilings/floors near endpoints
   - Windows: last 20% (white), first 10% (black)
   - Configurable via `autoWhiteLimitToggle`, `autoBlackLimitToggle`

7. **Output** → `make256()` returns final 256-step curve (0-65535 range)

**UI Rendering Cycle:**

```
User Input (click, file upload, slider)
  ↓
UI Handler (event-handlers.js)
  ↓
Update State (state.js via updateAppState/stateManager)
  ↓
History Capture (history-manager.js)
  ↓
Process Curves (make256 → processing-pipeline.js)
  ↓
Update Chart (triggerInkChartUpdate → chart-manager.js)
  ↓
Update Preview (triggerPreviewUpdate → quad-preview.js)
  ↓
Render Canvas (chart-renderer.js)
```

**State Management Lifecycle:**

1. **App Initialization** (src/main.js)
   - Initialize elements cache
   - Create StateManager instance
   - Load printer configuration
   - Register event handlers
   - Initialize chart, theme, UI modals

2. **File Load** (parseQuadFile, parseLabData)
   - Parse file format
   - Validate curves/measurements
   - Populate state.loadedQuadData or LinearizationState
   - Trigger chart update

3. **Edit Operation** (Smart key points, percentages, end values)
   - StateManager records change
   - HistoryManager captures snapshot
   - Processing pipeline re-runs
   - UI updated via trigger functions

4. **Undo/Redo** (HistoryManager.undo/redo)
   - Restore previous state snapshot
   - Mark `isRestoring = true` to skip history capture
   - Trigger updates
   - Mark `isRestoring = false`

## Key Abstractions

**StateManager:**
- Purpose: Centralized reactive state container with subscriptions
- Files: `src/js/core/state-manager.js`
- Pattern: Observer pattern with path-based subscriptions
- Methods: `update(path, value)`, `subscribe(paths, callback)`, `batch(fn)`
- Used for: Channel values, linearization state, edit selections, app state

**ControlPoints:**
- Purpose: Smart key-point validation and manipulation
- Files: `src/js/curves/smart-curves.js`
- Methods: `normalize()`, `sample()`, `nearestPoint()`, `validate()`
- Stores: Relative percentages (0-100) internally, converts to absolute for display
- Constraints: Applied via `ControlPolicy` (min gap, clamp ranges)

**LinearizationState:**
- Purpose: Encapsulate LAB measurement data and per-channel corrections
- Files: `src/js/data/linearization-utils.js`
- Fields: `samples` (0-1 normalized), `domainMin/Max`, `edited` flag, `extras` (metadata)
- Conversion: `normalizeLinearizationEntry()` ensures printer-space compatibility
- Lifecycle: Cleared on revert via `linearizationData = null; linearizationApplied = false`

**ProcessingPipeline:**
- Purpose: Coordinate multi-stage curve generation
- Files: `src/js/core/processing-pipeline.js`
- Main export: `make256(channelName)` → 256-value array
- Stages: Base → Smart → Per-channel → Global → Auto endpoint rolloff
- Feature flags: Individual stages can be toggled (DEBUG_LOGS, feature gates)

**HistoryManager:**
- Purpose: Undo/redo with snapshot integration
- Files: `src/js/core/history-manager.js`
- Snapshots: Full state clone (curves, linearization, channel locks, scaling)
- Transactions: Batch multiple actions into single undo entry
- Limits: Max 20 entries with overflow trimming

**SmartRescalingService:**
- Purpose: Maintain key-point visual consistency during ink-limit changes
- Files: `src/js/curves/smart-rescaling-service.js`
- Pattern: When End increases, scale all points by `oldEnd/newEnd` so visual position unchanged
- Prevents: Scaling artifacts when adjusting channel percentages with Smart Curves active

## Entry Points

**Main Application:**
- Location: `src/main.js`
- Triggers: Script load (async module imports)
- Responsibilities:
  1. Import all modules
  2. Initialize elements cache
  3. Create StateManager and HistoryManager
  4. Set up event handlers
  5. Initialize chart, theme, modals
  6. Load printer UI
  7. Make app functions available to console

**HTML Root:**
- Location: `src/index.template.html` (source), `dist/index.html` (build output), `index.html` (production)
- Loads: `src/main.js` as ES6 module
- Vite-built into single HTML file via `npm run build:agent`

**UI Event System:**
- Location: `src/js/ui/event-handlers.js`
- Initialization: `initializeEventHandlers()` called from `main.js`
- Handlers: Delegated via document event listeners for file input, channel controls, linearization buttons
- Updates: Route to StateManager.update() and trigger functions

**Chart Rendering:**
- Location: `src/js/ui/chart-renderer.js`
- Update trigger: `registerInkChartHandler(updateInkChart)` in `chart-manager.js`
- Render loop: Canvas frame rendering with grid, curves, overlays

## Error Handling

**Strategy:** Defensive validation with console warnings and user feedback messages.

**Patterns:**
- Input validation in `InputValidator` (src/js/core/validation.js)
  - Range checks: `isValidPercent()`, `isValidEndValue()`
  - Type guards: `isValidNumber()`, `isValidFilename()`
  - Constraints: Channel locks, disabled states

- File parsing safety
  - Try/catch in parsers with fallback to linear ramp
  - Format detection via magic bytes/structure inspection
  - Curve validation: `validateCurveData()` checks length and value ranges

- State snapshot safety
  - Deep clone validation in HistoryManager.cloneEntry()
  - JSON serialization with fallback shallow clone
  - State restoration marked with `isRestoring` flag to prevent loops

- UI feedback
  - Status messages via `showStatus(message, type)` in `status-service.js`
  - Error display via `showError(message)`
  - Status service subscribes to processing events

**No Exceptions Thrown:** Application uses defensive return values rather than exceptions. Failed operations return null/undefined with console warnings.

## Cross-Cutting Concerns

**Logging:**
- Global `DEBUG_LOGS` flag in `src/js/core/version.js`
- Per-module debug flags: `DEBUG_AI`, `DEBUG_SMART`, `DEBUG_INTENT_TUNING`, `DEBUG_LAB_BYPASS`
- Debug namespace registry at `src/js/utils/debug-registry.js`
- Console methods: `console.log()` with `[MODULE_NAME]` prefix convention

**Validation:**
- Centralized in `src/js/core/validation.js` (InputValidator class)
- Applied at: File import, channel edit, end-value change, scale operations
- Guards: Channel locks prevent conflicting edits
- Constraints: Per-channel ink limits, global scale bounds

**Authentication:**
- Not applicable (client-side SPA, no auth required)
- Cloudflare Worker proxy handles API key management (separate from code)

**Feature Flags:**
- Location: `src/js/core/feature-flags.js`
- Console toggles: `enableScalingCoordinator(bool)`, `setCubeEndpointAnchoringEnabled(bool)`, etc.
- Gate: Individual processing stages, debug panels, alternate algorithms
- Defaults: Conservative (accessibility over advanced features)

**Theme System:**
- Location: `src/js/ui/theme-manager.js`
- CSS custom properties for all colors/spacing
- localStorage persistence with system preference fallback
- Toggle: `window.toggleTheme()` or UI button

**AI Integration:**
- Location: `src/js/ai/`
- Cloudflare Worker proxy at `https://sparkling-shape-8b5a.workers.dev`
- Functions: `ai-functions.js` defines callable Smart Curve tools
- Chat UI: `src/js/ui/chat-ui.js` renders interface
- Rate limiting: KV store backed (server-side)

---

*Architecture analysis: 2026-01-22*
