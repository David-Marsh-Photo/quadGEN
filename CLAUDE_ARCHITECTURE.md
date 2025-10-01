# CLAUDE_ARCHITECTURE.md

System architecture, data flow, and core components for quadGEN.

## Architecture

### Core Components

**Main Application**: `quadgen.html` - The primary application file containing:
- Complete HTML/CSS/JavaScript in a single file
- AI integration with Claude Sonnet 4 API via Cloudflare Worker proxy
- File processing for .quad, .cube, .txt, and .acv formats
- Real-time curve visualization with HTML5 Canvas
- ControlPoints facade for control‑point operations (normalize, sample, nearest‑point) and ControlPolicy for constraints (min gap, clamp ranges)
- CurveHistory enhancements: key‑point changes are linked to curve actions via `recordKeyPointsChange(channel, oldKP, newKP, oldInterp, newInterp)` and extras passed to the curve history entry (no window globals)
- Build output: `index.html` is now the generated production build from `dist/index.html`; source code is in the `src/` directory.

**Legacy/Alternative Versions**:
- `indexv1.0.html` - Simplified linearization-focused tool
- Various backup versions (`quadgen copy.html`, etc.)

**Cloudflare Infrastructure**:
- `cloudflare-worker.js` - API proxy with rate limiting (deployed to `sparkling-shape-8b5a`)
- `cors-proxy.js` - Alternative CORS proxy implementation
- `CLOUDFLARE_SETUP.md` - Deployment and configuration instructions

### Edit Mode (UI/UX Behavior)
(See also: docs/EDIT_MODE.md for a user‑facing overview.)

- Toggle in Edit Curves panel: off by default. Button text/colors: "Enter Edit Mode" (slate) / "End Edit Mode" (black). ARIA: role="switch" with `aria-checked`.
- When OFF: All key‑point edit APIs return a friendly message and do nothing; AI key‑point overlays are hidden; smoothing sliders are disabled; the "channel disabled (End=0)" hint is suppressed.
- When ON:
  - Channel focus: Selected channel draws last (on top). Other enabled channels render at 50% opacity.
  - Overlays: Only the selected channel shows Smart key‑point markers + ordinal labels; unselected channels hide both.
  - Linear reference: Further dimmed for unselected channels (12.5% vs 25%).
  - Selected point: Square marker gets a channel‑colored outline; the ordinal label is bold and double size. Highlight updates on any selection change.
  - Channel select: Dropdown lists present channels. After a .quad load, the dropdown refreshes and selects the first channel in the file.
  - First-enable conversion: On the first time Edit Mode is turned ON, silently pre-create Smart key points for all channels that need it, using the current plotted curve (.quad or linearization) to avoid first-edit visual jumps.

Implementation notes: Edit Mode state lives at `window.EDIT_MODE_ENABLED`. Guard edit actions early in `quadGenActions.*` and in UI handlers. Rendering checks Edit Mode to decide opacity, draw order, overlays, and label visibility.

### Data Flow Architecture

```
Input Sources → Processing Pipeline → Output
     ↓                    ↓               ↓
.quad files     →  Base Curves    →  .quad files
.cube/.txt      →  Smart Curves      →  Real-time preview
LAB data        →  Linearization  →  Canvas visualization
AI commands     →  Interpolation   →  Undo/redo system
```

### Control Point Adapters (Phase D)

Read‑only adapters expose native control points from data sources for overlays without changing file parsing or application logic:
- ACV: transformed key points (Photoshop control points, post‑orientation) per channel
- LUT (1D/3D neutral): uniform X samples, downsampled to ≤21 points for overlays
- LAB: original measured steps (GRAY%) as overlay points

Adapters provide: `{ points, interpolation, editable:false, policy }`. They are rendered as overlays and will be converted to editable Smart key points automatically on the first edit (silent conversion). File parsing and correction application (make256/apply1DLUT) remain unchanged.

Overlay rendering semantics and alignment:
- Smart key‑point overlay plots absolute Y by multiplying stored pre‑scale outputs by the current End fraction (End%/100), so markers/labels align with the rendered curve after ink‑limit changes.
- Adapter overlays (ACV/LUT/LAB) use the current curve values for Y; they display numbered labels only when no Smart key points exist for the channel to avoid duplicate numbering.

## Print Intent and EDN/QTR Workflows

quadGEN operates entirely in printer-space (.quad). A required Print Intent setting determines how preprocessed corrections are applied:

- Print Intent: Positive (default) or Negative. This governs only how corrections are interpreted; quadGEN does not modify the source image.
- EDN-style corrections (.cube/.acv, designed for positives):
  - Positive intent: Apply as-is as global linearization G(x) = EDN(x).
  - Negative intent: Apply inverted mapping G(x) = 1 − EDN(x) to emulate "apply to positive then invert image" without an editor.
- Measurement linearization (LAB/step wedge): Unchanged; build PCHIP linearization from measurements regardless of intent.

Stacking guidance:
- If EDN and measurement linearization are both active, the effective mapping is S(x) = Lmeas(Gedn(x)). Consider using one or the other to avoid double shaping; a preflight notice is recommended in the UI.

### Global State Management

```javascript
// Loaded .quad file data
window.loadedQuadData = {
  filename: string,
  curves: { channelName: [256 values] },
  channels: [array of channel names]
};

// Global linearization data
linearizationData = {
  samples: [256 values in 0-1 range],
  domainMin: number,
  domainMax: number,
  filename: string
};

// Per-channel linearization data
perChannelLinearization = {
  channelName: { samples, domainMin, domainMax }
};
```

### Undo/History System

**CurveHistory Object**: Manages state capture and restoration
- Individual actions: Single channel changes
- Batch actions: Multi-channel operations with single undo
- State snapshots: Before/after capture for complex operations

## Cloudflare Deployment

### Worker Management
- Worker name: `sparkling-shape-8b5a`
- Rate limiting via KV namespace: `quadgen_rate_limits`
- Environment variables: `CLAUDE_API_KEY`

### Updating Worker
1. Modify `cloudflare-worker.js`
2. Copy code to Cloudflare Dashboard → Workers → Code tab
3. Click "Deploy"
4. Test rate limiting and API functionality

## Printer Support

**P800**: 8 channels (K, C, M, Y, LC, LM, LK, LLK)
**P700-P900**: 10 channels (K, C, M, Y, LC, LM, LK, LLK, V, MK)

Each channel supports:
- 256-step linearization curves (0-65535 range)
- Individual enable/disable state
- Percentage control (0-100%)
- Smart key‑point overlays when < 21 points; markers reflect current Smart Curve inputs
- End-value limits (0-65535)

## File Format Support

**Input Formats**:
- `.quad`: Complete QuadToneRIP files with curve data
- `.cube`: 1D/3D LUT files for linearization
- `.txt`: LAB measurement data (L* values)
- `.acv`: Adobe Photoshop curve files (binary format)
- Pasted LAB data: Direct text input of measurements

**Output**:
- `.quad`: Industry-standard QuadToneRIP format

The application automatically detects file types and routes to appropriate parsers. All processing maintains proper data validation and error handling throughout the pipeline.
