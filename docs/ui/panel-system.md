# quadGEN Panel System Architecture

## Overview

The quadGEN UI uses an **app layout** with main content area (chart + bottom tabs) on the left and a full-height right panel on the right. This system provides independent resizing for both chart height and panel width, with a flexible, responsive interface that adapts to different screen sizes and user workflows.

## Architecture Diagram

```
┌───────────────────────────────────┬──────────────────────────────┐
│ Header (Logo, Printer, Actions)  │                              │
├───────────────────────────────────┤                              │
│                                   │ ┌────────────────────────┐   │
│   Chart Area (75% default)        │ │ ✏️ Edit Curve       │   │
│   - Canvas with controls          │ ├────────────────────────┤   │
│   - Zoom buttons                  │ │ 🌐 Global Correction │   │
│   - Status display                │ └────────────────────────┘   │
│                                   ║                              │
├───────────────────────────────────┤ Right Panel (~256px default)   │
│ ↕ Chart Divider (horizontal)     │ FULL HEIGHT                  │
├───────────────────────────────────┤ - Vertical tab navigation    │
│ Bottom Tabs                       │ - Optimized narrow layouts   │
│ (Channels │ Lab Tech │ Preview)  │                              │
│                                   │                              │
└───────────────────────────────────┴──────────────────────────────┘
```

## Components

### 1. Chart Divider (`chart-divider.js`)

Manages two independent resize systems:

#### Horizontal Divider (Chart Height)
- **Element**: `#chartDivider`
- **Function**: Adjusts chart container height
- **Constraints**:
  - Minimum: 320px
  - Maximum: 80vh (80% of viewport height)
- **Storage Key**: `quadgen.chartHeight`
- **Cursor**: `row-resize`

#### Vertical Divider (Panel Width)
- **Element**: `#panelDivider`
- **Function**: Adjusts left/right panel widths
- **Constraints**:
  - Chart panel minimum: 450px
  - Right panel minimum: 256px
  - Right panel maximum: 50% of container width
- **Storage Key**: `quadgen.rightPanelWidth`
- **Cursor**: `col-resize`
- **Default**: 256px (right panel)

**Key Functions**:
```javascript
// Exported from chart-divider.js
export function initChartDivider();          // Initialize chart height resize
export function initPanelDivider();          // Initialize panel width resize
export function updateChartHeight(height, save = true);
export function updatePanelWidth(width, save = true);
export function getPanelWidth();
```

**Drag Behavior**:
- Mouse and touch support
- Visual feedback (grip handle, hover states, dragging class)
- Live updates during drag
- Automatic chart redraw on resize
- Persistence to localStorage on drag end

### 2. Tab Manager (`tab-manager.js`)

Manages both horizontal and vertical tab systems:

#### Horizontal Tabs (Bottom)
- **Elements**: `.tab-nav` with `.tab-btn`
- **Tabs**: Channels, Lab Tech, Preview
- **Layout**: Horizontal row with icons and labels
- **Keyboard**: Arrow left/right navigation

#### Vertical Tabs (Right Panel)
- **Elements**: `.vertical-tab-nav` with `.tab-btn-vertical`
- **Tabs**: Edit Curve, Global Correction
- **Layout**: Vertical stack optimized for narrow space
- **Active Indicator**: Left border accent color

**Key Functions**:
```javascript
// Exported from tab-manager.js
export function initializeTabs();                    // Initialize all tabs
export function switchTab(tabName, saveState = true); // Programmatic tab switch
export function getActiveTab();                       // Get current active tab name
```

**State Management**:
- Active tab persisted to localStorage (`quadgen.activeTab`)
- Default tab: `channels`
- ARIA attributes for accessibility

### 3. Layout Structure

#### HTML Elements

```html
<!-- App Layout Container -->
<div class="app-layout">

  <!-- Left: Main Content Area (Chart + Bottom Tabs) -->
  <div class="main-content-area">
    <div id="chartPanel" class="chart-panel">
      <div id="chartContainer">
        <canvas id="inkChart"></canvas>
        <!-- Chart controls, overlays, labels -->
      </div>
      <div id="chartDivider" class="chart-divider"></div>
    </div>

    <!-- Bottom: Horizontal Tabs (inside main-content-area) -->
    <div id="toolTabs" class="tool-tabs-container">
      <div class="tab-nav">
        <button class="tab-btn active" data-tab="channels">...</button>
        <button class="tab-btn" data-tab="lab">...</button>
        <button class="tab-btn" data-tab="preview">...</button>
      </div>
      <div class="tab-content-wrapper">...</div>
    </div>
  </div>

  <!-- Vertical Divider -->
  <div id="panelDivider" class="panel-divider">
    <div class="panel-divider-grip"></div>
  </div>

  <!-- Right: Tool Panel (Full Height) -->
  <div id="rightPanel" class="right-panel">
    <div class="vertical-tab-nav">
      <button class="tab-btn-vertical active" data-tab="edit">...</button>
      <button class="tab-btn-vertical" data-tab="global">...</button>
    </div>
    <div class="tab-content-wrapper-vertical">
      <div class="tab-content active" data-tab-content="edit">...</div>
      <div class="tab-content" data-tab-content="global" hidden>...</div>
    </div>
  </div>
</div>
```

#### CSS Classes

**Layout Classes**:
- `.app-layout` - Flex container for main-content-area + right panel
- `.main-content-area` - Container for chart + bottom tabs (stacked vertically)
- `.chart-panel` - Left panel containing chart and horizontal divider
- `.right-panel` - Right panel with vertical tabs
- `.panel-divider` - Vertical resize bar between panels

**Tab Classes**:
- `.vertical-tab-nav` - Container for vertical tabs
- `.tab-btn-vertical` - Individual vertical tab button
- `.tab-content-wrapper-vertical` - Vertical tab content container

**State Classes**:
- `.active` - Active tab button or content
- `.dragging` - Applied during divider drag
- `hidden` - Applied to inactive tab content

## Responsive Behavior

### Breakpoint: 830px

Below 830px viewport width, the layout switches to **stacked mode**:

```css
@media (max-width: 830px) {
  .app-layout {
    flex-direction: column;  /* Stack vertically */
  }

  .panel-divider {
    display: none;  /* Hide vertical divider */
  }

  .main-content-area,
  .chart-panel,
  .right-panel {
    width: 100%;
    min-width: 100%;
  }
}
```

**Behavior**:
- Main content area (chart + bottom tabs) takes full width
- Right panel stacks below main content
- Vertical divider hidden (drag disabled)
- Horizontal chart divider still functional
- Both panels remain fully accessible

## Initialization

### Main Entry Point (`main.js`)

```javascript
import { initializeTabs } from './js/ui/tab-manager.js';
import { initChartDivider, initPanelDivider } from './js/ui/chart-divider.js';

// Initialize in this order:
initializeElements();
initializeTabs();          // Tab system first
initChartDivider();        // Chart height resize
initPanelDivider();        // Panel width resize
initializeEventHandlers();
// ... other initialization
```

**Order is Important**:
1. Tabs must initialize before dividers to ensure event handlers are ready
2. Chart divider before panel divider (no strict dependency, but conventional)
3. Event handlers after UI components are initialized

### Tab Content Guard

`initializeTabs()` now re-parents the Global Correction tab body back into `.tab-content-wrapper-vertical` on boot if markup ever drifts. This prevents the tab from sitting at the app root (a regression that doubled the right-panel width when the tab was activated). The Playwright regression `tests/e2e/panel-resize.spec.ts` asserts the tab content’s parent class list includes `tab-content-wrapper-vertical` and captures a screenshot for traceability.

## Layout Optimization for Narrow Panels

The right panel (256px minimum) uses optimized layouts:

### Original Wide Layout (Bottom Tabs)
```css
.grid-cols-4  /* 4-column grid */
flex gap-2    /* Horizontal spacing */
inline-flex   /* Inline elements */
```

### Optimized Narrow Layout (Right Panel)
```css
flex-col      /* Vertical stacking */
w-full        /* Full width buttons */
gap-3         /* Vertical spacing */
```

**Examples**:
- **Edit Mode**: 4-column grid → single column stack
- **Global Correction**: 2-column layout → single column with full-width buttons
- **Sliders**: Horizontal compact → vertical with labels above
- **Buttons**: Side-by-side → stacked full-width

## Drag Implementation Details

### Mouse/Touch Event Flow

1. **Start Drag** (`mousedown`/`touchstart`)
   - Record start position (`clientX` or `clientY`)
   - Record initial element size
   - Add `.dragging` class to divider
   - Set document cursor style
   - Prevent text selection

2. **During Drag** (`mousemove`/`touchmove`)
   - Calculate delta from start position
   - Apply constraints (min/max widths or heights)
   - Update element styles (flexBasis for panels, height for chart)
   - Update CSS variables for potential downstream use

3. **End Drag** (`mouseup`/`touchend`)
   - Remove `.dragging` class
   - Restore document cursor
   - Calculate final percentage (for responsive behavior)
   - Persist to localStorage
   - Trigger chart redraw event

### Constraint Enforcement

**Panel Width Constraints**:
```javascript
// From dragPanel() in chart-divider.js
const constrainedPanelWidth = Math.max(
    MIN_PANEL_WIDTH_PX,                    // 256px minimum
    Math.min(newPanelWidth, containerWidth * 0.5)  // 50% maximum
);

const constrainedChartWidth = Math.max(
    MIN_CHART_WIDTH_PX,                    // 450px minimum
    containerWidth - constrainedPanelWidth - 10
);

// Verify both constraints can be satisfied
if (constrainedChartWidth + constrainedPanelWidth + 10 > containerWidth) {
    return;  // Can't satisfy both - abort drag
}
```

**Chart Height Constraints**:
```javascript
// From drag() in chart-divider.js
const viewportHeight = window.innerHeight;
const maxHeightPx = (MAX_HEIGHT_VH / 100) * viewportHeight;  // 80vh

const constrainedHeight = Math.max(
    MIN_HEIGHT_PX,           // 320px
    Math.min(newHeight, maxHeightPx)
);
```

## LocalStorage Schema

### Keys and Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `quadgen.chartHeight` | String | `"60vh"` | Chart container height (CSS value) |
| `quadgen.rightPanelWidth` | String | `"256px"` | Right panel width (256px default; stored as % after drag) |
| `quadgen.activeTab` | String | `"channels"` | Currently active tab name |

### Persistence Strategy

- **Save on drag end**: Only persist when user completes resize
- **Stored values**: Default is 256px; after the first drag the width is persisted as a percentage for responsive behaviour
- **Restore on init**: Read from localStorage during component initialization
- **Fallback to defaults**: If localStorage unavailable or corrupt

**Example**:
```javascript
// After panel resize ends
const widthPercent = (rightPanel.offsetWidth / container.offsetWidth) * 100;
localStorage.setItem('quadgen.rightPanelWidth', `${widthPercent.toFixed(2)}%`);

// On page load
const savedWidth = localStorage.getItem('quadgen.rightPanelWidth') || '256px';
updatePanelWidth(savedWidth, false);  // Don't re-save
```

## Chart Redraw Integration

Both dividers trigger chart redraws after resize:

```javascript
function triggerChartResize() {
    // ResizeObserver in chart-manager.js automatically detects size change
    // and calls updateInkChart()

    // Also dispatch custom event for other listeners
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('chart-height-changed'));
    }
}
```

The existing `ResizeObserver` in `chart-manager.js` automatically handles redraws, so no manual `updateInkChart()` call is needed.

## Dark Mode Support

All panel system components have dark mode variants:

```css
[data-theme="dark"] .panel-divider {
  background: linear-gradient(to right,
    var(--border-emphasis),
    var(--bg-subtle)
  );
}

[data-theme="dark"] .vertical-tab-nav {
  background: var(--bg-subtle);
  border-bottom-color: var(--border-emphasis);
}

[data-theme="dark"] .tab-btn-vertical:hover {
  background: var(--bg-elevated-hover);
}
```

**CSS Variables Used**:
- `--bg-elevated` - Panel backgrounds
- `--border` / `--border-emphasis` - Dividers and borders
- `--accent` - Active tab indicator
- `--muted` - Inactive tab text
- `--text` - Active tab text

## Accessibility Features

### ARIA Attributes

**Dividers**:
```html
<div id="chartDivider"
     role="separator"
     aria-orientation="horizontal"
     aria-label="Resize chart height">
</div>

<div id="panelDivider"
     role="separator"
     aria-orientation="vertical"
     aria-label="Resize panels">
</div>
```

**Tabs**:
```html
<div class="vertical-tab-nav" role="tablist">
  <button class="tab-btn-vertical active"
          data-tab="edit"
          role="tab"
          aria-selected="true">
    Edit Curve
  </button>
</div>

<div class="tab-content active"
     data-tab-content="edit"
     role="tabpanel">
  ...
</div>
```

### Keyboard Support

- **Tab buttons**: Keyboard focusable
- **Arrow navigation**: Left/right for horizontal tabs (bottom)
- **Focus indicators**: `:focus-visible` styles on all interactive elements
- **Screen readers**: Semantic HTML with proper roles and labels

## Testing

### Test Suite Location
`tests/e2e/panel-resize.spec.ts`

### Test Coverage

1. **Structure Tests**
   - Dual panel layout exists
   - All required elements present
   - Vertical tabs render correctly

2. **Interaction Tests**
   - Panel resize by dragging
   - Minimum width constraints enforced
   - Both dividers work independently
   - Correct cursor on hover

3. **Persistence Tests**
   - Panel width saved to localStorage
   - Width restored after page reload

4. **Responsive Tests**
   - Layout stacks below 830px
   - Divider hidden in stacked mode

5. **Visual Regression Tests**
   - Light mode screenshot
   - Dark mode screenshot

### Running Tests

```bash
# Run all panel tests
npx playwright test tests/e2e/panel-resize.spec.ts

# Run specific test
npx playwright test tests/e2e/panel-resize.spec.ts -g "should resize panels"

# Run with UI
npx playwright test tests/e2e/panel-resize.spec.ts --ui

# Generate report
npx playwright test tests/e2e/panel-resize.spec.ts --reporter=html
```

## Browser Compatibility

- **Chrome/Edge**: Full support (tested)
- **Firefox**: Full support
- **Safari**: Full support
- **Mobile browsers**: Touch events supported

**Minimum Requirements**:
- CSS Flexbox
- CSS Grid (for Edit panel layout)
- localStorage API
- Touch events API (optional)
- ResizeObserver API (chart redraw)

## Performance Considerations

### Optimizations

1. **Throttled Redraws**: Chart only redraws on drag end, not during drag
2. **CSS Transitions**: Smooth visual feedback without JavaScript
3. **Event Delegation**: Single mousemove listener on document during drag
4. **RequestAnimationFrame**: Not needed - native browser resize is efficient
5. **LocalStorage Caching**: Read once on init, write once on drag end

### Known Limitations

- **Minimum viewport**: 830px for side-by-side layout (stacks below)
- **Total minimum width**: 706px (450px chart + 256px panel)
- **Maximum panel width**: 50% of container (prevents unusable layouts)

## Debugging

### Console Commands

```javascript
// Get current panel width
window.ChartDivider.getPanelWidth()  // "25.00%"

// Programmatically resize panel
window.ChartDivider.updatePanelWidth('30%')

// Get/set chart height
window.ChartDivider.getCurrentHeight()  // "60vh"
window.ChartDivider.updateChartHeight('500px')

// Switch tabs
window.TabManager.switchTab('global')
window.TabManager.getActiveTab()  // "global"
```

### Debug Logging

Enable verbose logging by checking divider drag events:

```javascript
// In chart-divider.js, all drag operations log to console:
console.log('[ChartDivider] Initialized with height:', savedHeight);
console.log('[ChartDivider] Drag ended, height:', finalHeight);
console.log('[PanelDivider] Initialized with width:', savedWidth);
console.log('[PanelDivider] Drag ended, width:', `${widthPercent}%`);
```

## Future Enhancements

Potential improvements for consideration:

1. **Preset Layouts**: Save/restore multiple panel configurations
2. **Collapse/Expand**: Toggle right panel visibility (full chart width)
3. **Snap Points**: Auto-snap to common widths (256px default, 320px, 50%)
4. **Double-click Reset**: Double-click divider to restore defaults
5. **Drag Preview**: Ghost outline during drag
6. **Accessibility**: Keyboard resizing with arrow keys
7. **Touch Gestures**: Pinch to resize on mobile
8. **Panel Animations**: Smooth transitions when switching layouts

## References

- Source: `/src/js/ui/chart-divider.js`
- Source: `/src/js/ui/tab-manager.js`
- Template: `/src/index.template.html`
- Styles: `/src/styles/main.css`
- Tests: `/tests/e2e/panel-resize.spec.ts`
- Main: `/src/main.js` (initialization)

---

**Last Updated**: 2025-10-23
**Version**: quadGEN v4.2.0+

## Recent Implementation Notes

**2025-10-23**: Confirmed correct HTML structure implementation where:
- `app-layout` contains exactly 3 direct children: `main-content-area`, `panelDivider`, `rightPanel`
- `main-content-area` vertically stacks `chartPanel` (top) and `toolTabs` (bottom)
- `chartPanel` contains `chartContainer` and `chartDivider` (horizontal resize)
- `rightPanel` spans full height alongside main-content-area
- All modal popups (`intentModal`, `lstarModal`, etc.) exist outside `app-layout` structure
