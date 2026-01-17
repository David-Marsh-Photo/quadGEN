# quadGEN Architecture Map

Generated on 2026-01-17T18:32:07.424Z

This diagram groups source modules by their primary directory and highlights cross-cluster dependencies.

```mermaid
flowchart TD
  G_js_ai["Ai\n(4 modules)"]
  G_js_core["Core\n(40 modules)"]
  G_js_curves["Curves\n(2 modules)"]
  G_js_data["Data\n(11 modules)"]
  G_js_debug["Debug\n(1 modules)"]
  G_js_files["Files\n(2 modules)"]
  G_js_legacy["Legacy\n(4 modules)"]
  G_js_math["Math\n(1 modules)"]
  G_js_parsers["Parsers\n(1 modules)"]
  G_js_ui["UI\n(32 modules)"]
  G_js_utils["Utilities\n(3 modules)"]
  G_src["Entry & Root\n(1 modules)"]
  G_js_ai -->|6| G_js_core
  G_js_ai -->|1| G_js_curves
  G_js_ai -->|2| G_js_data
  G_js_ai -->|1| G_js_parsers
  G_js_ai -->|8| G_js_ui
  G_js_ai -->|1| G_js_utils
  G_js_core -->|6| G_js_curves
  G_js_core -->|12| G_js_data
  G_js_core -->|1| G_js_debug
  G_js_core -->|5| G_js_legacy
  G_js_core -->|3| G_js_math
  G_js_core -->|18| G_js_ui
  G_js_core -->|20| G_js_utils
  G_js_curves -->|8| G_js_core
  G_js_curves -->|3| G_js_data
  G_js_curves -->|1| G_js_math
  G_js_curves -->|3| G_js_ui
  G_js_data -->|7| G_js_core
  G_js_data -->|5| G_js_legacy
  G_js_data -->|4| G_js_math
  G_js_data -->|8| G_js_utils
  G_js_debug -->|1| G_js_utils
  G_js_files -->|7| G_js_core
  G_js_files -->|3| G_js_data
  G_js_files -->|1| G_js_ui
  G_js_parsers -->|2| G_js_core
  G_js_parsers -->|4| G_js_data
  G_js_parsers -->|1| G_js_math
  G_js_parsers -->|1| G_js_utils
  G_js_ui -->|75| G_js_core
  G_js_ui -->|7| G_js_curves
  G_js_ui -->|15| G_js_data
  G_js_ui -->|6| G_js_files
  G_js_ui -->|8| G_js_legacy
  G_js_ui -->|2| G_js_math
  G_js_ui -->|2| G_js_parsers
  G_js_ui -->|13| G_js_utils
  G_src -->|3| G_js_ai
  G_src -->|10| G_js_core
  G_src -->|1| G_js_curves
  G_src -->|2| G_js_data
  G_src -->|1| G_js_files
  G_src -->|1| G_js_math
  G_src -->|1| G_js_parsers
  G_src -->|21| G_js_ui
  G_src -->|2| G_js_utils
```

## Directory Samples
- **Ai** (4 modules)
  - src/js/ai/ai-actions.js
  - src/js/ai/ai-config.js
  - src/js/ai/ai-functions.js
  - src/js/ai/chat-interface.js
- **Core** (40 modules)
  - src/js/core/auto-raise-on-import.js
  - src/js/core/channel-locks.js
  - src/js/core/state-manager.js
  - src/js/core/state.js
  - src/js/core/bell-shift-state.js
- **Curves** (2 modules)
  - src/js/curves/smart-curves.js
  - src/js/curves/smart-rescaling-service.js
- **Data** (11 modules)
  - src/js/data/processing-utils.js
  - src/js/data/curve-shape-detector.js
  - src/js/data/linearization-utils.js
  - src/js/data/curve-simplification.js
  - src/js/data/lab-legacy-bypass.js
- **Debug** (1 modules)
  - src/js/debug/debug-make256.js
- **Files** (2 modules)
  - src/js/files/file-operations.js
  - src/js/files/reference-quad-loader.js
- **Legacy** (4 modules)
  - src/js/legacy/state-bridge.js
  - src/js/legacy/legacy-helpers.js
  - src/js/legacy/linearization-bridge.js
  - src/js/legacy/intent-bridge.js
- **Math** (1 modules)
  - src/js/math/interpolation.js
- **Parsers** (1 modules)
  - src/js/parsers/file-parsers.js
- **UI** (32 modules)
  - src/js/ui/edit-mode.js
  - src/js/ui/status-service.js
  - src/js/ui/bell-shift-controls.js
  - src/js/ui/ui-hooks.js
  - src/js/ui/bell-width-controls.js
- **Utilities** (3 modules)
  - src/js/utils/debug-registry.js
  - src/js/utils/browser-env.js
  - src/js/utils/lab-math.js
- **Entry & Root** (1 modules)
  - src/main.js
