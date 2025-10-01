# Edit Mode

Edit Mode enables hands‑on, Key Point‑based editing of channel curves with clear visual focus, safe defaults, and full undo/redo.

## Overview
- Toggle: Use the Edit Mode button in the Edit Curves panel (left‑justified) to turn editing ON/OFF.
- Focus: When ON, the selected channel draws on top; other enabled channels dim to 50%.
- Overlays: Only the selected channel shows Key Point markers and ordinal labels; unselected channels hide both.
- Baseline: A faded dashed linear ramp shows for Smart/edited curves (and when linearization is active) as a reference.
- Safety: When OFF, edits are blocked and Key Point overlays are hidden so you can inspect the curve without accidental changes.

## First‑Enable Behavior (Seeding)
On the first time Edit Mode is turned ON, the app prepares Smart Key Points to avoid "first‑edit jumps":
- Direct‑seed threshold: When the source has ≤ 25 points, seed them directly as Smart Key Points; otherwise, simplify to an edit‑friendly subset.
- .quad/LUT/LAB: Extract from the current plotted curve; LAB/Manual L* with ≤ 25 measurements seed at the measured Patch % positions; otherwise simplify.
- ACV (per‑channel or global): If ≤ 25 anchors, seed directly; else simplify from the plotted curve.
- Enabled channels: Seeded points are applied as curves in a single batch (single undo).
- Disabled channels: Seeded Key Points are persisted only; channels remain disabled (no enabling).

## Channel & Key Point Controls
### Channel selection
- Compact dropdown (56px) with ◀/▶ cycle buttons; lists enabled channels only.
- The “Channel:” label is left‑justified; the selector is centered.

### Selected Key Point row
- Left: "Selected Key Point" + ◀ [ordinal] ▶.
- Right: Delete button (same row).

### Move a Key Point
- Nudge: ◁ ▷ △ ▽ (white on slate, hover darker gray, active black with pressed effect). Shift = coarse, Alt/Option = fine.
- XY field: Type `X,Y` and press Enter. X is input %, Y is absolute % (post‑End). Validates numbers and clamps 0–100. Errors briefly highlight the field.
- Absolute nudges: Up/Down adjust absolute Y; Left/Right adjust X.
- Click to insert: In Edit Mode, click the chart to insert a Key Point at the selected channel's curve position (locked to the curve at cursor X). The inserted Key Point becomes the selection.

## Cursor & Tooltip
- In Edit Mode, the tooltip X,Y readout locks to the selected channel’s curve at cursor X.
- A bold channel‑colored circle marks the curve sample under the cursor.
- Tooltip shows a second line "click to add Key Point" when insertion is possible.

## Rendering & Layering
- Selected channel draws last (on top) in Edit Mode.
- Unselected enabled channels: 50% opacity; no ordinal labels/markers.
- Linear reference: Faded dotted 0→End ramp (12.5% opacity for unselected channels, 25% otherwise).
- Labels: Selected channel ordinal labels render above the right‑edge ink‑limit labels for readability.

## Undo / Redo
All edit actions (insert, adjust, delete, recompute/simplify, batch seed on first enable) are fully undoable:
- Individual actions record per‑channel changes.
- First‑enable seeding uses a single batch for enabled channels; persist‑only for disabled channels.

## Constraints & Edge Cases
- Minimum gap: Inserts/adjusts respect a minimum X gap between Key Points; errors explain when not enough space.
- End=0 channels: Remain disabled; seeding persists Key Points only. Enable in the Channels table to make visible/editable.
- End raise on absolute targets: When the requested absolute Y requires more ink than the channel End, the app raises End minimally and rescales other Key Points to preserve their absolute outputs. If End is effectively locked, the edit is blocked and a status alert appears in the graph header.

## AI Integration
- Tool: `set_edit_mode(enabled: boolean)` lets the assistant toggle Edit Mode.
- Guidance: When performing Key Point edits and Edit Mode is OFF, call `set_edit_mode(true)` first.
- Positive‑space rules and endpoints policy apply (0→0, 100→100 anchored unless explicitly requested).

## Accessibility & Keyboard
- Enter commits XY changes.
- Buttons have an active “pressed” visual (2px translateY) for tactile feedback.

## Troubleshooting
- "Can't insert here": Not enough space between neighbors; move adjacent Key Points or pick another X.
- “Nothing changes when editing”: Ensure Edit Mode is ON and the channel is enabled; confirm you’ve selected the correct channel.
- “Other channels look faint”: This is expected focus dimming in Edit Mode; turn it off to restore normal rendering.
