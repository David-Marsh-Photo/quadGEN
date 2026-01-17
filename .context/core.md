# quadGEN Core Context

## Project Overview

quadGEN is a web-based tool for creating and editing QuadToneRIP .quad files used for high-precision inkjet printing. It's a single-page application built in vanilla JavaScript with Claude AI integration for key-point driven curve generation.

**Assistant Persona:** You are a Senior Lab Tech at a fine art print studio offering museum-quality digital prints, historical alternative photographic processes, and hand-pulled photogravures. quadGEN is a program the studio uses to calibrate print processes.

## Architecture

### Modular ES6 Structure
- `src/js/core/` - Core state management, data processing, validation
- `src/js/ui/` - UI components, theme management, chart handling
- `src/js/utils/` - Utility functions and helpers
- `src/js/data/` - Parsers (LAB, CGATS, .cube, .acv)
- `src/main.js` - Application entry point with module initialization

### Key Files
- `src/index.template.html` - Source for all builds
- `dist/index.html` - Build output
- `index.html` - Production build (copied from dist/)
- `docs/architecture-map.md` - Authoritative dependency map

### Build System
- **Framework:** Vite
- **Build command:** `npm run build:agent`
- **Output:** Single-file HTML bundle

## File Format Reference

| Format | Spec Location | Purpose |
|--------|--------------|---------|
| `.quad` | `docs/File_Specs/QTR_QUAD_SPEC_SUMMARY.md` | QuadToneRIP ink curves |
| `.cube` | `docs/File_Specs/CUBE_LUT_SPEC_SUMMARY.md` | 1D/3D LUT (linearization) |
| `.acv` | `docs/File_Specs/ACV_SPEC_SUMMARY.md` | Photoshop curves |
| LAB `.txt` | `docs/File_Specs/LAB_TXT_SPEC_SUMMARY.md` | Measurement data |
| CGATS `.ti3` | (same as LAB) | Argyll measurement data |

## Feature Flags & Debug

### Feature Flags (Console Toggles)
- `enableScalingCoordinator(true|false)` - Global scaling coordinator queue
- `enableActiveRangeLinearization(true|false)` - Active-range LAB linearization
- `setCubeEndpointAnchoringEnabled(true|false)` - 1D LUT endpoint clamp
- `setLegacyLUTMappingEnabled(true|false)` - Toggle gain-based LUT correction (default: false)

### Debug Flags
- `DEBUG_LOGS` (default: false) - General console logging
- `DEBUG_AI` / `DEBUG_SMART` (default: false) - AI/Smart curve logging
- `DEBUG_INTENT_TUNING` (default: false) - Intent tuning console logging
- `DEBUG_LAB_BYPASS` (default: false) - LAB bypass debugging

## Theme System

Comprehensive light/dark mode via `theme-manager.js`:
- CSS custom properties for all UI elements
- localStorage persistence with system preference detection
- Toggle: `window.toggleTheme()`

## Documentation Locations

- `CHANGELOG.md` - User-facing release notes
- `docs/` - Reference documentation
- `docs/features/` - Feature-specific specs
- `docs/architecture-map.md` - Module dependencies (regenerate with `node scripts/docs/export-architecture-map.js`)

## Changelog Workflow

- Keep user-facing notes in `CHANGELOG.md` under "Unreleased" section
- On release: bump `APP_VERSION` in `src/js/core/version.js`
- Update `VERSION_HISTORY` in `src/js/ui/help-content-data.js`
