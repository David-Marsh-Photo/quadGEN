# quadGEN Architecture Map

Generated on 2025-10-14T00:07:25.724Z

This diagram groups source modules by their primary directory and highlights cross-cluster dependencies.

```mermaid
flowchart TD
  G_js_ai["Ai\n(4 modules)"]
  G_js_core["Core\n(22 modules)"]
  G_js_curves["Curves\n(2 modules)"]
  G_js_data["Data\n(10 modules)"]
  G_js_debug["Debug\n(1 modules)"]
  G_js_files["Files\n(1 modules)"]
  G_js_legacy["Legacy\n(4 modules)"]
  G_js_math["Math\n(1 modules)"]
  G_js_parsers["Parsers\n(1 modules)"]
  G_js_ui["UI\n(27 modules)"]
  G_js_utils["Utilities\n(3 modules)"]
  G_src["Entry & Root\n(1 modules)"]
  G_js_ai -->|6| G_js_core
  G_js_ai -->|1| G_js_curves
  G_js_ai -->|2| G_js_data
  G_js_ai -->|1| G_js_parsers
  G_js_ai -->|8| G_js_ui
  G_js_ai -->|1| G_js_utils
  G_js_core -->|4| G_js_curves
  G_js_core -->|7| G_js_data
  G_js_core -->|1| G_js_debug
  G_js_core -->|5| G_js_legacy
  G_js_core -->|2| G_js_math
  G_js_core -->|13| G_js_ui
  G_js_core -->|16| G_js_utils
  G_js_curves -->|8| G_js_core
  G_js_curves -->|2| G_js_data
  G_js_curves -->|1| G_js_math
  G_js_curves -->|3| G_js_ui
  G_js_data -->|6| G_js_core
  G_js_data -->|5| G_js_legacy
  G_js_data -->|4| G_js_math
  G_js_data -->|8| G_js_utils
  G_js_debug -->|1| G_js_utils
  G_js_files -->|6| G_js_core
  G_js_files -->|2| G_js_data
  G_js_files -->|1| G_js_ui
  G_js_parsers -->|2| G_js_core
  G_js_parsers -->|4| G_js_data
  G_js_parsers -->|1| G_js_math
  G_js_parsers -->|1| G_js_utils
  G_js_ui -->|63| G_js_core
  G_js_ui -->|7| G_js_curves
  G_js_ui -->|15| G_js_data
  G_js_ui -->|5| G_js_files
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
  G_src -->|19| G_js_ui
  G_src -->|2| G_js_utils
```

## Directory Samples
- **Ai** (4 modules)
  - src/js/ai/ai-actions.js
  - src/js/ai/ai-config.js
  - src/js/ai/ai-functions.js
  - src/js/ai/chat-interface.js
- **Core** (22 modules)
  - src/js/core/auto-raise-on-import.js
  - src/js/core/channel-locks.js
  - src/js/core/state-manager.js
  - src/js/core/state.js
  - src/js/core/validation.js
- **Curves** (2 modules)
  - src/js/curves/smart-curves.js
  - src/js/curves/smart-rescaling-service.js
- **Data** (10 modules)
  - src/js/data/processing-utils.js
  - src/js/data/linearization-utils.js
  - src/js/data/curve-simplification.js
  - src/js/data/lab-legacy-bypass.js
  - src/js/data/lab-legacy-core.js
- **Debug** (1 modules)
  - src/js/debug/debug-make256.js
- **Files** (1 modules)
  - src/js/files/file-operations.js
- **Legacy** (4 modules)
  - src/js/legacy/state-bridge.js
  - src/js/legacy/legacy-helpers.js
  - src/js/legacy/linearization-bridge.js
  - src/js/legacy/intent-bridge.js
- **Math** (1 modules)
  - src/js/math/interpolation.js
- **Parsers** (1 modules)
  - src/js/parsers/file-parsers.js
- **UI** (27 modules)
  - src/js/ui/edit-mode.js
  - src/js/ui/channel-registry.js
  - src/js/ui/graph-status.js
  - src/js/ui/status-messages.js
  - src/js/ui/ui-hooks.js
- **Utilities** (3 modules)
  - src/js/utils/debug-registry.js
  - src/js/utils/browser-env.js
  - src/js/utils/lab-math.js
- **Entry & Root** (1 modules)
  - src/main.js
