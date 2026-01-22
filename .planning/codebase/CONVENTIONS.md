# Coding Conventions

**Analysis Date:** 2026-01-22

## Naming Patterns

**Files:**
- kebab-case for all file names: `state-manager.js`, `chart-renderer.js`, `theme-manager.js`
- Module grouping with consistent prefixes: `bell-*.js`, `composite-*.js`, `scaling-*.js`
- Suffixes indicate responsibility: `-utils.js`, `-config.js`, `-state.js`, `-controller.js`, `-helpers.js`

**Functions:**
- camelCase for all function names
- Verb-first for actions: `applyTheme()`, `buildFile()`, `validateInput()`, `recordChannelAction()`
- Boolean queries use is/has prefix: `isEditModeEnabled()`, `hasAnyLinearization()`, `isCubeEndpointAnchoringEnabled()`
- Setter functions use set prefix: `setChannelValue()`, `setActiveRangeLinearizationEnabled()`, `setTheme()`
- Getter functions use get prefix: `getStateManager()`, `getCurrentPrinter()`, `getHistoryManager()`
- Factory functions clearly indicate creation: `createLinearizationData()`, `createDefaultKeyPoints()`, `createInitialState()`

**Variables:**
- camelCase for variables and properties
- Constants in UPPER_SNAKE_CASE: `TOTAL`, `CURVE_RESOLUTION`, `THEME_KEY`
- State/object literals use descriptive names: `flagState`, `compatExports`, `redistribution SmoothingWindowConfig`
- Temporary/loop variables minimal: `i`, `e` for event, `v` for value in map functions

**Types & Classes:**
- PascalCase for class names: `QuadGenStateManager`, `HistoryManager`, `InputValidator`, `ScalingCoordinator`
- Static methods on classes for utility grouping: `InputValidator.clampPercent()`, `ControlPoints.normalize()`

## Code Style

**Formatting:**
- No configured formatter detected (no .eslintrc, .prettierrc, biome.json)
- Consistent 4-space indentation observed throughout codebase
- Single quotes for strings: `'dark'`, `'test'`, `'K'`
- Semicolons used consistently throughout

**Linting:**
- No formal linting configuration found
- Code follows implicit conventions: consistent whitespace, no trailing commas in old code
- Modern ES6+ syntax used throughout (classes, arrow functions, const/let, template literals)

## Import Organization

**Order:**
1. Standard library imports (node: modules)
2. Relative imports from sibling directories (`./state.js`, `../utils/debug-registry.js`)
3. Parent directory imports (`../../src/js/...`)
4. Side-effect imports (registration functions, initialization)

**Path Aliases:**
- No path aliases configured
- Relative imports use explicit paths: `import { ... } from '../utils/...'`, `import { ... } from './.../'`
- Consistent use of descriptive relative paths based on semantic distance

**Pattern from src/main.js:**
```javascript
// Core modules first
import { APP_VERSION, APP_DISPLAY_VERSION, DEBUG_LOGS } from './js/core/version.js';
import { LAB_TUNING, AUTO_LIMIT_DEFAULTS, CONTRAST_INTENT_PRESETS } from './js/core/config.js';

// Mathematical functions
import { clamp01, createPCHIPSpline, createCubicSpline, gammaMap } from './js/math/interpolation.js';

// UI components grouped by function
import { normalizeDisplayMax, clampPercentForDisplay, mapPercentToY } from './js/ui/chart-utils.js';
import { initializeEventHandlers, initializeAutoLimitHandlers } from './js/ui/event-handlers.js';

// Data processing utilities
import { CURVE_RESOLUTION, AUTO_LIMIT_CONFIG, DataSpace } from './js/data/processing-utils.js';

// State management (last, most comprehensive)
import { PRINTERS, INK_COLORS, TOTAL, elements } from './js/core/state.js';
import { QuadGenStateManager, getStateManager } from './js/core/state-manager.js';
```

## Error Handling

**Patterns:**
- Defensive programming with null/undefined checks: `if (!scaleInput) throw new Error('Scale input not found')`
- Try-catch for browser API access that may fail: `localStorage.setItem()`, `matchMedia()`
- Graceful degradation when window/browser APIs unavailable
- Debug flag guards for expensive console logging: `if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) { console.warn(...) }`

**Example from feature-flags.js:**
```javascript
try {
    const stored = window.localStorage.getItem(SMART_POINT_DRAG_STORAGE_KEY);
    if (stored === null) return null;
    return stored === 'true';
} catch (error) {
    if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
        console.warn('Failed to load smartPointDrag from storage:', error);
    }
    return null;
}
```

## Logging

**Framework:** Native `console` object with conditional guards

**Patterns:**
- Conditional logging based on `DEBUG_LOGS` flag: `if (DEBUG_LOGS) { console.log(...) }`
- Per-module debug namespaces registered via `registerDebugNamespace()`
- Structured startup logging with emoji prefixes: `🚀`, `✅`, `⚠️`, `🔧`, `📊`
- Verbose test logging in `src/main.js` testing functions shows expected patterns

**Module initialization logging:**
```javascript
console.log(`quadGEN ${APP_VERSION} - Modular build system initialized`);
console.log(`🚀 Initializing quadGEN ${APP_VERSION}`);
console.log('✅ quadGEN modular initialization complete');
```

**Conditional debug output:**
```javascript
if (DEBUG_LOGS) {
    console.log('✅ initializeElements() executed');
    console.log('📊 Testing extracted modules...');
}
```

## Comments

**When to Comment:**
- JSDoc comments for public functions and classes (see state-manager.js)
- Inline comments for non-obvious logic or photography-specific algorithms
- Configuration files documented with purpose: `// Configuration`, `// Feature flag`
- Top-of-file module headers describing responsibility

**JSDoc/TSDoc:**
- Used extensively for public API documentation
- Parameter types and return types documented
- Example from state-manager.js:
```javascript
/**
 * Create the initial state structure
 * @returns {Object} Initial state object
 */
createInitialState() {
    return {
        app: { ... }
    };
}
```

- Example from validation.js:
```javascript
/**
 * Clamp percentage value to valid range (0-100)
 * @param {*} p - Percentage value to clamp
 * @returns {number} Clamped percentage
 */
static clampPercent(p) {
    const num = parseFloat(p);
    return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
}
```

## Function Design

**Size:**
- Functions kept compact (avg 10-40 lines)
- Complex logic extracted into helper functions
- Single responsibility principle observed (state mutation, validation, rendering separate)

**Parameters:**
- Positional parameters for simple cases (1-3 args)
- Options object pattern for complex initialization:
```javascript
constructor(options) {
    this.scaleFn = options.scaleFn;
    this.beginTransaction = options.beginTransaction;
    this.commitTransaction = options.commitTransaction;
    this.rollbackTransaction = options.rollbackTransaction;
}
```
- Destructuring used for clarity: `const { data, applied } = linearizationState`

**Return Values:**
- Objects with explicit shape for success/failure: `{ success: true, message: '...', details: {} }`
- Null for missing data (not undefined): `return null` for absent linearization
- Undefined for side-effect-only functions
- Wrapped results with metadata common in core functions

## Module Design

**Exports:**
- Named exports for public API, one per concept
- Closure patterns for private state (flagState in feature-flags.js)
- Grouped related exports: all theme functions from theme-manager.js

**Barrel Files:**
- No barrel files used (no index.js re-exports)
- Each module imports directly from source files
- Encourages explicit dependency visibility

**Initialization Pattern:**
- Installation functions run at module load: `installWindowAdapters()`, used in feature-flags.js
- Debug namespace registration during init: `registerDebugNamespace('featureFlags', { ... })`
- Window adapter functions check type before assignment:
```javascript
if (typeof window.enableActiveRangeLinearization !== 'function') {
    window.enableActiveRangeLinearization = (enabled = true) => setActiveRangeLinearizationEnabled(enabled);
}
```

## Special Patterns

**State Management:**
- Modular state manager centralizes app state: `QuadGenStateManager` in `src/js/core/state-manager.js`
- Per-channel data organization: `channelValues`, `channelStates`, `channelPreviousValues`
- Immutable patterns used for state snapshots: spread operator cloning

**PCHIP Interpolation (MANDATORY):**
- All smooth curve generation uses PCHIP (Piecewise Cubic Hermite Interpolating Polynomial)
- Never use smoothstep, Catmull-Rom, or cubic splines
- Located in `src/js/math/interpolation.js` via `createPCHIPSpline()`

**Debug Registry System:**
- `registerDebugNamespace()` exposes functionality for console debugging
- `getDebugRegistry()` retrieves registered namespaces
- Window exposure controlled via options: `exposeOnWindow: true`
- Enables runtime introspection: `__quadDebug.compat.*`, `__quadDebug.featureFlags.*`

---

*Convention analysis: 2026-01-22*
