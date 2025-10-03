# Per-Channel Measurement Toggle Specification

## Purpose
- Allow selective application/removal of per-channel measurement data while keeping Smart curves and undo history consistent.
- Coordinate channel toggles with Edit Mode, revert controls, and Lab Tech automation.

## User-Facing Entry Points
- Channel table toggle (`.per-channel-toggle`) next to each channel’s End/percent fields.
- Per-channel `↺` revert button (`.per-channel-revert`).
- Lab Tech commands: `load_lab_data_per_channel`, `enable_channel(channel, enabled)`.

## Core State & Helpers
- `LinearizationState.setPerChannelData`, `.clearPerChannel`, `.isPerChannelEnabled`.
- Channel row registry in `src/js/ui/channel-registry.js` (stores refresh handlers).
- Event handlers: `src/js/ui/event-handlers.js` (`handlePercentInput`, `handleEndInput`, `handlePerChannelToggle`).

## Expected Behavior
1. **Loading Per-Channel Measurement**
   - Parser stores measurement in `LinearizationState` with metadata and seeds Smart key points when Edit Mode is active.
   - Toggle becomes enabled and checked; channel label shows measurement filename/count.

2. **Disabling Toggle**
   - Clears correction for that channel (restores raw `.quad` curve or Smart state as appropriate).
   - Metadata and UI labels update to reflect disabled status.
   - Undo restores measurement state and toggle.

3. **Revert Button**
   - For measurement-backed channels: re-enables measurement, clears Smart overlays.
   - For Smart-only channels: clears Smart, disables toggle, restores `.quad` curve.

4. **Interaction with Edit Mode & Smart Curves**
   - Disabling measurement while Smart curves exist keeps Smart data but disables measurement-specific overlays; re-enable measurement before editing if you need measurement context.
   - Smart seeding respects `LinearizationState.isPerChannelEnabled(channel)` to avoid double applying measurement corrections.

5. **History**
   - Toggle changes and per-channel revert actions record history entries for undo/redo.

## Edge Cases & Guards
- Toggle hidden/disabled when no measurement exists.
- Saved Smart metadata (`smartTouched`) prevents automatic re-seeding unless flagged.
- Lab Tech commands follow same guardrails; improper channel names respond with status errors.

## Testing
- Manual tests: `docs/manual_tests.md` (per-channel undo toggle matrix).
- Playwright (future): load per-channel measurement, toggle off/on, verify curve and metadata state.

## Debugging Aids
- `DEBUG_LOGS` prints toggle state changes and measurement load events.
- Dev tools: `window.LinearizationState.getPerChannelData(channel)` to inspect metadata and enable state.

## References
- Revert spec: `docs/features/revert-controls.md`.
- Smart curve spec: `docs/features/smart-curve-engine.md`.
