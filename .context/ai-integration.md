# quadGEN AI Integration

Lab Tech functions, tool contracts, and documentation policy.

## Documentation Policy

- **Help popup**: Centralized tabs (ReadMe, Glossary, Version History) in `src/js/ui/help-content-data.js`
- **Glossary**: Keep entries alphabetically ordered, preserve formatting style
- **Reference docs**: `/docs` directory, file format specs in `docs/File_Specs/`
- **Architecture map**: `docs/architecture-map.md` (regenerate with `node scripts/docs/export-architecture-map.js`)

## Lab Tech Functions

### Key-Point Operations (Per-Channel)
| Function | Purpose |
|----------|---------|
| `set_smart_key_points(channel?, keyPoints, interpolation)` | Set all key points |
| `get_smart_key_points(channel?)` | Get current key points |
| `adjust_smart_key_point_by_index(channel?, ordinal, params)` | Edit single point |
| `insert_smart_key_point_at(channel?, inputPercent, outputPercent?)` | Insert at position |
| `insert_smart_key_point_between(channel?, leftOrd, rightOrd, output?)` | Insert between points |
| `insert_smart_key_points_batch(channel, inserts[])` | Batch insert |
| `delete_smart_key_point_by_index(channel?, ordinal, {allowEndpoint})` | Delete point |
| `delete_smart_key_point_near_input(channel?, input%, {tolerance})` | Delete near X |

### Global Operations
| Function | Purpose |
|----------|---------|
| `generate_global_custom_curve(keyPoints, interp, channelFilter)` | Multi-channel curve |
| `generate_and_download_quad_file()` | Export .quad |
| `scale_channel_ends_by_percent({ scalePercent })` | Scale all channels |
| `set_auto_white_limit(enabled)` | White endpoint rolloff |
| `set_auto_black_limit(enabled)` | Black endpoint rolloff |
| `set_chart_zoom(percent)` | Set Y-axis zoom |
| `nudge_chart_zoom(direction)` | Increment zoom |

### Correction Controls
| Function | Purpose |
|----------|---------|
| `set_correction_method(method)` | "simple" or "density_solver" |
| `set_correction_gain(percent)` | Blend 0-100% |
| `set_auto_raise_ink_limits(enabled)` | Auto-raise on import |
| `revert_global_to_measurement()` | Revert all channels |
| `revert_channel_to_measurement(channel)` | Revert single channel |

### Contrast Intent
| Function | Purpose |
|----------|---------|
| `set_contrast_intent(preset, params?)` | linear, soft, hard, filmic, gamma |
| `apply_custom_intent_sliders(params)` | gamma, gain, shoulder |
| `apply_custom_intent_paste(text)` | CSV/JSON custom intent |
| `get_contrast_intent()` | Current intent status |

### Channel Protection
| Function | Purpose |
|----------|---------|
| `lock_channel(channel, locked)` | Lock/unlock from edits |
| `get_channel_lock_status(channel?)` | Query lock status |

### Display Controls
| Function | Purpose |
|----------|---------|
| `set_lab_spot_markers(enabled)` | Tolerance badges overlay |
| `set_light_blocking_overlay(enabled)` | Composite ink coverage |

## Key-Point Editing Defaults

- "point N" = Smart key-point ordinal N (1-based, endpoints included)
- Channel default: first enabled channel (percentage > 0 or endValue > 0)
- Silent conversion: auto-create points from loaded data on first edit
- Disambiguation: "point N … %" = key-point change, not ink limit

## Edit Semantics

- `outputPercent` is absolute chart percent (0–100) after End scaling
- If requested point exceeds End, raise End minimally
- When End increases, scale other points by `oldScale/newScale`
- Changing channel End (table fields) uniformly scales entire curve

## Routing Rules

- Prefer `generate_global_custom_curve` for multiple specific channels
- Use per-channel functions for single channel edits
- Do not use deprecated natural-language curve generators
- PCHIP is mandatory for smooth curves; only use Linear for technical cases

## Legacy Aliases (Still Supported)

`set_ai_key_points`, `get_ai_key_points`, `adjust_ai_key_point_by_index`, `insert_ai_key_point_at`, `insert_ai_key_point_between`, `insert_ai_key_points_batch`, `delete_ai_key_point_by_index`, `delete_ai_key_point_near_input`

## Edit Mode × Linearization

- Global linearization applies even when Smart points exist (Edit Mode ON)
- Loading new global LAB/CGATS while Edit Mode is enabled triggers immediate Smart-point reseed
- Double-apply guard: Recompute with global correction tags `bakedGlobal` to prevent double scaling
- Per-channel guard: Skip per-channel linearization only when Smart curve is actually applied

## Cloudflare Worker

- Worker: `cloudflare-worker.js` with KV rate limits
- Environment: `CLAUDE_API_KEY` must be set
- Default limits: 10/minute, 100/hour, 500/day per IP
- Model: Claude Sonnet 4 (`claude-sonnet-4-5`)

## Security

- Do not hardcode API keys
- For workers use `CLAUDE_API_KEY` environment variable
- For local dev, prefer environment variables or non-committed `apikey.txt`
- No web search/fetch tools enabled - only configured AI proxy
