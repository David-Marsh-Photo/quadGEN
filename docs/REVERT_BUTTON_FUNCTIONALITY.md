# Revert Button Functionality Report

## Overview
This document describes the revert button functionality in quadGEN, covering both the **Global Correction Revert** button and the **Per-Channel Revert** buttons. These buttons allow users to restore measurement-based corrections after manual edits or Smart Curve generation.

---

## Global Correction Revert Button

### Location
**Global Correction Panel** → "↺ Revert to Measurement" button
Element ID: `revertGlobalToMeasurementBtn`
Template location: `src/index.template.html:182`

### Purpose
Reverts all channels to the originally loaded global measurement data (LAB/CGATS/TI3), clearing any Smart Curves generated via AI and restoring the measurement-based correction state.

### When Enabled
The button is enabled when:
- Global linearization data is loaded (`linearizationData` exists)
- The data format includes "LAB" or "MANUAL" (measurement-based data)
- `originalData` array exists in `linearizationData`
- `linearizationApplied` is `true`

Button state is controlled by `updateRevertButtonsState()` (line 7195 in the retired `extracted_javascript.js`).

### Behavior When Clicked

#### 1. Guard Check
```javascript
const fmt = String(linearizationData?.format || '').toUpperCase();
const hasOriginal = Array.isArray(linearizationData?.originalData);
const isMeasurement = isGlobalMeasurementActive();
```
- Returns early if no measurement data is active
- Prevents revert when only non-measurement corrections (e.g., LUT files) are loaded

#### 2. History Capture
```javascript
CurveHistory.captureState('Before: Revert Global to Measurement');
```
- Creates undo point before reverting

#### 3. Smart Curve Clearing
For each channel:
- If channel has Smart Curve (`isSmartCurve(ch)` returns true):
  - Restores original .quad curve from `loadedQuadData.originalCurves[ch]`
  - If no original exists, removes the curve (falls back to linear ramp)
  - Deletes `keyPoints`, `keyPointsMeta`, and `sources` entries
- Preserves file-loaded .quad curves (non-Smart)

#### 4. Baseline End Restoration
```javascript
baselineResetQueue.forEach(({ channel, baselineEnd }) => {
  // Restore original End values from baselineEnd
  const endVal = InputValidator.clampEnd(baselineEnd);
  percentInput.value = pct.toFixed(2);
  percentInput.dispatchEvent(new Event('input', { bubbles: true }));
});
```
- Restores channel ink limits to their original values before Smart Curve generation
- Uses batch operation mode to prevent individual history entries

#### 5. Global Linearization State Update
```javascript
linearizationData = null;
linearizationApplied = false;
```
- **Critical**: Completely clears LAB data to restore original .quad state
- Re-enables global linearization toggle (checked = true, disabled = false)

#### 6. UI Updates
- Refreshes global linearization display (drops "Edited" prefix)
- Updates preview and chart
- Updates processing details for all channels
- Shows status: "Reverted to measurement (global)"
- Calls `updateRevertButtonsState()` to update button states

#### 7. Edit Mode Preservation
- Restores previously selected channel in Edit Mode (if active)
- Ensures edit panel reflects correct channel after revert

### Edge Cases

#### Case 1: Revert with No Smart Curves
- Only clears LAB data and restores baselines
- No curve changes occur
- Measurement correction is re-enabled

#### Case 2: Revert with Mixed Channels
- Smart channels: restored to original .quad curves
- Non-Smart channels: unchanged
- All channels get baseline End restored

#### Case 3: Revert After Manual Edits
- Clears manual edits to LAB-generated Smart Curves
- Returns to pure measurement-based correction
- `linearizationData.edited` flag is effectively cleared by setting `linearizationData = null`

---

## Per-Channel Revert Buttons

### Location
**Channel Row** → "↺" button (right side of each channel row)
Class: `.per-channel-revert`
Setup: `src/js/ui/event-handlers.js:1556-1670`

### Purpose
Reverts a single channel to its loaded per-channel measurement or clears Smart Curve to restore loaded .quad state.

### When Enabled
Button is enabled when either:
1. **Has Measurement**: Per-channel LAB/LUT/ACV data is loaded for the channel
2. **Has Smart Curve**: Channel has AI-generated Smart Curve

Button state controlled by:
- `refreshPerChannelDisplay()` in channel row setup
- `updateRevertButtonsState()` global function

Button visibility: Uses `invisible` class (reserves space when disabled).

### Behavior When Clicked

#### 1. Initial Checks
```javascript
const measurement = perChannelLinearizationMap[channelName] || LinearizationState.getPerChannelData(channelName);
const hasMeasurement = !!measurement;
const hasSmart = hasSmartCurveActive(); // checks isSmartCurve(channelName)
```
- Returns early if neither measurement nor Smart Curve exists
- Shows status message explaining why revert is unavailable

#### 2. Revert In Progress Flag
```javascript
window._REVERT_IN_PROGRESS = true;
```
- Prevents UI race conditions during revert operation

#### 3. History Capture
```javascript
CurveHistory.captureState(`Before: Revert ${channelName} to Measurement`);
```
- Creates undo point for channel-specific revert

#### 4. Curve Data Clearing/Restoration

**If Has Smart Curve** (`hasSmart === true`):
```javascript
const originalCurve = window.loadedQuadData?.originalCurves?.[channelName];
if (Array.isArray(originalCurve) && originalCurve.length === 256) {
  window.loadedQuadData.curves[channelName] = [...originalCurve];
  restored = true;
}
```
- Attempts to restore original .quad curve
- If restoration fails but curve exists, keeps existing curve
- Clears `keyPoints`, `keyPointsMeta`, `sources` metadata

**If Has Measurement** (`hasMeasurement === true`):
- Clears loadedQuadData curve/metadata entries
- Restores baseline End (if exists)
- Re-enables measurement correction

#### 5. State Management

**With Measurement**:
```javascript
measurement.edited = false;
perChannelEnabledMap[channelName] = true;
LinearizationState.setPerChannelData(channelName, measurement, true);
syncPerChannelAppState(channelName, measurement);
```
- Removes "Edited" flag
- Re-enables measurement toggle
- Syncs state across systems

**Without Measurement (Smart only)**:
```javascript
perChannelEnabledMap[channelName] = false;
delete perChannelLinearizationMap[channelName];
delete perChannelFilenamesMap[channelName];
LinearizationState.clearPerChannel(channelName);
syncPerChannelAppState(channelName, null);
```
- Disables measurement
- Clears all per-channel data
- Sets `data-allow-toggle="true"` for UI state

#### 6. UI Updates
- Refreshes per-channel display
- Updates toggle state (disabled/checked based on measurement presence)
- Updates processing detail label
- Updates chart and preview
- Updates interpolation controls
- Shows status message

#### 7. Edit Mode Handling
```javascript
if (savedSel && isEditModeEnabled()) {
  const row = Array.from(elements.rows.children).find(tr => tr.getAttribute('data-channel') === savedSel);
  const endVal = row ? InputValidator.clampEnd(row.querySelector('.end-input')?.value || 0) : 0;
  if (endVal > 0) {
    elements.editChannelSelect.value = savedSel;
    EDIT.selectedChannel = savedSel;
    edit_refreshState();
    updateInkChart();
  }
}
```
- Restores Edit Mode channel selection
- Ensures Smart Curves panel reflects correct state

#### 8. Cleanup
```javascript
window._REVERT_IN_PROGRESS = false;
```
- Clears revert flag in `finally` block

### Button Title States
- With Measurement: `"Revert ${channelName} to measurement"`
- With Smart only: `"Clear Smart on ${channelName}"`
- Disabled: `"No measurement loaded"`

### Edge Cases

#### Case 1: Revert with Measurement Active
- Clears Smart Curve
- Re-enables measurement correction
- Toggle becomes enabled and checked

#### Case 2: Revert with Smart Only (No Measurement)
- Restores original .quad curve
- Disables toggle
- Clears all per-channel state

#### Case 3: Revert with Both Measurement and Smart
- Clears Smart Curve
- Re-enables measurement (toggle ON)
- Measurement.edited flag cleared

#### Case 4: Missing Original Curve
- If Smart Curve can't be restored, keeps existing curve
- Prevents data loss in edge cases

---

## Comparison: Global vs Per-Channel Revert

| Feature | Global Revert | Per-Channel Revert |
|---------|--------------|-------------------|
| **Scope** | All channels | Single channel |
| **Clears LAB Data** | Yes (`linearizationData = null`) | No (per-channel only) |
| **Restores Baseline End** | Yes (all channels) | Only if Smart Curve present |
| **Smart Curve Handling** | Clears all Smart Curves | Clears single channel Smart Curve |
| **History Entry** | "Revert Global to Measurement" | "Revert {channel} to Measurement" |
| **Measurement State** | Re-enables global measurement | Re-enables per-channel measurement |
| **Guard Condition** | `isGlobalMeasurementActive()` | Has measurement or Smart Curve |
| **Edit Mode Impact** | Restores channel selection | Restores channel selection |
| **Revert In Progress Flag** | No | Yes (`_REVERT_IN_PROGRESS`) |

---

## Key Implementation Details

### Data Flow
1. **Load .quad**: `baselineEnd` captured, `originalCurves` stored
2. **Load LAB/Measurement**: `linearizationData` set, `linearizationApplied = true`
3. **Edit Mode / Smart Curves**: Generated from LAB-corrected data
4. **Revert Global**: MUST clear `linearizationData = null` to restore original .quad state
5. **Revert Per-Channel**: Clears channel-specific data, optionally restores original curve

### Critical State Variables
- `linearizationData`: Global LAB/measurement data (must be null after global revert)
- `linearizationApplied`: Boolean flag (must be false after global revert)
- `loadedQuadData.originalCurves[ch]`: Immutable original .quad curves
- `loadedQuadData.baselineEnd[ch]`: Original ink limits before Smart generation
- `perChannelLinearizationMap[ch]`: Per-channel measurement data
- `perChannelEnabledMap[ch]`: Per-channel measurement toggle state

### Debugging
Enable debug logging with:
```javascript
DEBUG_LOGS = true
```

Look for console messages:
- `[DEBUG REVERT] Button clicked:` - Global revert triggered
- `[DEBUG REVERT] Clearing linearization data` - LAB data cleared
- `[DEBUG BASELINE] Captured initial baseline:` - Original End values
- `[per-channel] ...` - Per-channel operations

---

## Known Issues / Pitfalls

### Issue 1: LAB Data Not Cleared
**Symptom**: Revert doesn't fully restore original state; measurement still applies
**Cause**: Code sets `linearizationData.edited = false` instead of `linearizationData = null`
**Fix**: Always use `linearizationData = null` in global revert

### Issue 2: Baseline End Not Restored
**Symptom**: Ink limits remain at Smart Curve levels after revert
**Cause**: Missing baseline restoration logic
**Fix**: Iterate through `baselineResetQueue` and restore End values

### Issue 3: Edit Mode Channel Lost
**Symptom**: Edit Mode resets to first channel after revert
**Cause**: Missing `savedSel` restoration logic
**Fix**: Save `EDIT.selectedChannel` before revert, restore after updates

### Issue 4: Double-Apply of Corrections
**Symptom**: Curves appear over-corrected after revert/re-enable
**Cause**: LAB data remains active during Smart Curve regeneration
**Fix**: Ensure `linearizationData = null` before regenerating Smart Curves

---

## Testing Strategy

### Manual Testing Scenarios

#### Scenario 1: Global Revert with Smart Curves
1. Load .quad file
2. Load LAB/CGATS measurement (global)
3. Enable Edit Mode
4. Generate Smart Curves (via AI or manual)
5. Click "Revert to Measurement" (global)
6. **Verify**:
   - Smart Curves cleared
   - Original .quad curves restored
   - Baseline Ends restored
   - Global measurement re-enabled (toggle ON)
   - Processing labels show measurement correction

#### Scenario 2: Per-Channel Revert with Measurement
1. Load .quad file
2. Load per-channel LAB/LUT for channel K
3. Enable Edit Mode
4. Generate Smart Curve for K
5. Click per-channel "↺" button for K
6. **Verify**:
   - Smart Curve cleared for K
   - Per-channel measurement re-enabled (toggle ON)
   - Processing label shows per-channel correction
   - Other channels unchanged

#### Scenario 3: Revert After Manual Edits
1. Load .quad and LAB measurement
2. Enable Edit Mode, generate Smart Curves
3. Manually edit key points (adjust outputs)
4. Click global "Revert to Measurement"
5. **Verify**:
   - All manual edits cleared
   - Smart Curves regenerate from measurement when Edit Mode re-enabled
   - No "Edited" prefix in filename display

#### Scenario 4: Revert Without Baseline
1. Load .quad without baseline metadata
2. Load LAB measurement
3. Generate Smart Curves
4. Click global revert
5. **Verify**:
   - Curves still clear correctly
   - Ink limits remain at reasonable values (no NaN or extremes)

### Automated Testing (Playwright)
See `test-revert-functionality.js` for automated test suite.

---

## References

### Code Locations
- **Global Revert Handler**: `src/extracted_javascript.js:16187-16301` (legacy file, now retired)
- **Per-Channel Revert Handler**: `src/js/ui/event-handlers.js:1556-1670`
- **Revert Button State Update**: `src/extracted_javascript.js:7195-7224` (legacy file, now retired)
- **Channel Row Setup**: `src/js/ui/event-handlers.js:1313-1826`

### Related Documentation
- `CLAUDE.md` - LAB Data Lifecycle & State Management
- `docs/print_linearization_guide.md` - Manual L* linearization workflow
- `QUADGEN_AI_INTEGRATION.md` - Smart Curves and key-point operations

---

## Changelog
- **2025-09-29**: Initial documentation of revert button functionality
