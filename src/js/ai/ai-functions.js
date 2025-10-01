// quadGEN AI Functions
// Complete function definitions for Claude AI integration
// Extracted from quadgen.html reference implementation

/**
 * Claude Sonnet 4 API function definitions for quadGEN operations
 * This array defines all the functions that the AI can call to interact with the application
 */
export const CLAUDE_FUNCTIONS = [
  {
    name: "set_contrast_intent",
    description: "Set the contrast intent preset (linear, soft, hard, filmic) or explicit gamma.",
    parameters: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          description: "Preset name: linear | soft | hard | filmic | gamma",
          enum: ["linear", "soft", "hard", "filmic", "gamma"]
        },
        params: {
          type: "object",
          description: "Optional parameters for filmic or gamma presets",
          properties: {
            gamma: { type: "number", description: "Gamma value when preset='gamma' (e.g., 0.85, 1.20)" },
            filmicGain: { type: "number", description: "Filmic midtone gain (default 0.55)" },
            shoulder: { type: "number", description: "Filmic shoulder strength (default 0.35)" }
          }
        }
      },
      required: ["preset"]
    }
  },
  {
    name: "apply_custom_intent_sliders",
    description: "Apply a custom intent using slider parameters (gamma or filmic-like).",
    parameters: {
      type: "object",
      properties: {
        gamma: { type: "number", description: "Custom gamma (used if gain/shoulder are at defaults)" },
        gain: { type: "number", description: "Filmic midtone gain (triggers filmic when not 0.55)" },
        shoulder: { type: "number", description: "Filmic shoulder (triggers filmic when not 0.35)" }
      },
      required: []
    }
  },
  {
    name: "apply_custom_intent_paste",
    description: "Parse and apply a custom intent from pasted CSV/JSON data.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Pasted CSV/JSON describing a 0–100% input to relative density target" }
      },
      required: ["text"]
    }
  },
  {
    name: "get_contrast_intent",
    description: "Return the current contrast intent id/name/params and whether a saved custom exists.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "set_edit_mode",
    description: "Enable or disable Edit Mode for key‑point editing and overlays.",
    parameters: {
      type: "object",
      properties: {
        enabled: { type: "boolean", description: "true to enable Edit Mode; false to disable" }
      },
      required: ["enabled"]
    }
  },
  {
    name: "explain_lab_linearization",
    description: "Return a concise explanation of quadGEN's LAB linearization and plotting semantics for user-facing help.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "set_channel_value",
    description: "Set the ink limit percentage for a specific channel",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel name (K, C, M, Y, LC, LM, LK, LLK, V, MK)",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        percentage: {
          type: "number",
          description: "Ink limit percentage (0-100)",
          minimum: 0,
          maximum: 100
        }
      },
      required: ["channelName", "percentage"]
    }
  },
  {
    name: "set_channel_end_value",
    description: "Set the ink limit end value for a specific channel (0-65535 range)",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel name (K, C, M, Y, LC, LM, LK, LLK, V, MK)",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        endValue: {
          type: "number",
          description: "Ink limit end value (0-65535). Common values: 21627 (~33%), 32768 (50%), 65535 (100%)",
          minimum: 0,
          maximum: 65535
        }
      },
      required: ["channelName", "endValue"]
    }
  },
  {
    name: "apply_to_all_channels",
    description: "Apply the same ink limit percentage to all enabled channels",
    parameters: {
      type: "object",
      properties: {
        percentage: {
          type: "number",
          description: "Ink limit percentage to apply to all enabled channels (0-100)",
          minimum: 0,
          maximum: 100
        }
      },
      required: ["percentage"]
    }
  },
  {
    name: "apply_end_to_all_channels",
    description: "Apply the same ink limit end value to all enabled channels",
    parameters: {
      type: "object",
      properties: {
        endValue: {
          type: "number",
          description: "Ink limit end value to apply to all enabled channels (0-65535)",
          minimum: 0,
          maximum: 65535
        }
      },
      required: ["endValue"]
    }
  },
  {
    name: "scale_channel_ends_by_percent",
    description: "Use the global Scale control to multiply every enabled channel's End against its cached baseline (100% = no change).",
    parameters: {
      type: "object",
      properties: {
        scalePercent: {
          type: "number",
          description: "Desired scale percent for all enabled channels (10–200). 100 leaves Ends unchanged.",
          minimum: 10,
          maximum: 200
        }
      },
      required: ["scalePercent"]
    }
  },
  {
    name: "enable_disable_channel",
    description: "Enable or disable a specific ink channel",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel name (K, C, M, Y, LC, LM, LK, LLK, V, MK)",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) the channel"
        }
      },
      required: ["channelName", "enabled"]
    }
  },
  {
    name: "batch_channel_operations",
    description: "Perform multiple channel enable/disable operations in a single call",
    parameters: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          description: "Array of channel operations to perform",
          items: {
            type: "object",
            properties: {
              channelName: {
                type: "string",
                description: "Channel name (K, C, M, Y, LC, LM, LK, LLK, V, MK)",
                enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
              },
              enabled: {
                type: "boolean",
                description: "Whether to enable (true) or disable (false) the channel"
              }
            },
            required: ["channelName", "enabled"]
          }
        }
      },
      required: ["operations"]
    }
  },
  {
    name: "open_global_linearization_file_picker",
    description: "Open file picker dialog to load global linearization file (.cube, .txt, or .acv)",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "open_per_channel_linearization_file_picker",
    description: "Open file picker dialog to load linearization file for a specific channel",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel name to load linearization for",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        }
      },
      required: ["channelName"]
    }
  },
  {
    name: "load_sample_lab_file",
    description: "Load the sample LAB measurement data file for testing",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "load_sample_cube_file",
    description: "Load the sample LUT cube file for testing",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "load_lab_data_global",
    description: "Load LAB measurement data from pasted text for global linearization",
    parameters: {
      type: "object",
      properties: {
        labData: {
          type: "string",
          description: "LAB measurement data in standard format (GRAY_PERCENT LAB_L [LAB_A LAB_B])"
        }
      },
      required: ["labData"]
    }
  },
  {
    name: "load_lab_data_per_channel",
    description: "Load LAB measurement data from pasted text for specific channel linearization",
    parameters: {
      type: "object",
      properties: {
        labData: {
          type: "string",
          description: "LAB measurement data in standard format (GRAY_PERCENT LAB_L [LAB_A LAB_B])"
        },
        channelName: {
          type: "string",
          description: "Channel name to apply the LAB data to",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        }
      },
      required: ["labData", "channelName"]
    }
  },
  {
    name: "apply_manual_lstar_values",
    description: "Generate a correction from manual L* measurements (top → bottom evenly spaced unless patchPercents provided)",
    parameters: {
      type: "object",
      properties: {
        lValues: {
          type: "array",
          description: "Measured L* values (0–100), ordered from lightest patch (top row) to darkest",
          items: { type: "number" },
          minItems: 3
        },
        channelName: {
          type: "string",
          description: "Optional channel name to apply the correction to (defaults to global)",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        patchPercents: {
          type: "array",
          description: "Optional patch percentages (0–100) matching lValues; defaults to even spacing",
          items: { type: "number" }
        }
      },
      required: ["lValues"]
    }
  },
  {
    name: "load_cube_data_global",
    description: "Load .cube (LUT) file data from pasted text for global linearization",
    parameters: {
      type: "object",
      properties: {
        cubeData: {
          type: "string",
          description: ".cube file data in standard LUT format (supports 1D and 3D LUTs)"
        }
      },
      required: ["cubeData"]
    }
  },
  {
    name: "load_cube_data_per_channel",
    description: "Load .cube (LUT) file data from pasted text for specific channel linearization",
    parameters: {
      type: "object",
      properties: {
        cubeData: {
          type: "string",
          description: ".cube file data in standard LUT format (supports 1D and 3D LUTs)"
        },
        channelName: {
          type: "string",
          description: "Channel name to apply the cube data to",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        }
      },
      required: ["cubeData", "channelName"]
    }
  },
  {
    name: "generate_and_download_quad_file",
    description: "Generate, save, export, or download the .quad file with current settings",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "set_filename",
    description: "Set the filename for the .quad file (without extension)",
    parameters: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Desired filename without extension (will be sanitized automatically)"
        }
      },
      required: ["filename"]
    }
  },
  {
    name: "set_global_linearization",
    description: "Enable or disable global linearization (requires linearization file to be loaded)",
    parameters: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) global linearization"
        }
      },
      required: ["enabled"]
    }
  },
  {
    name: "set_auto_white_limit",
    description: "(Temporarily disabled) Previously toggled the Auto white limit rolloff (toe near paper white).",
    parameters: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "No effect in this build; auto white limit is disabled."
        }
      },
      required: ["enabled"]
    }
  },
  {
    name: "set_auto_black_limit",
    description: "(Temporarily disabled) Previously toggled the Auto black limit rolloff (shoulder near max ink).",
    parameters: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "No effect in this build; auto black limit is disabled."
        }
      },
      required: ["enabled"]
    }
  },
  {
    name: "revert_global_to_measurement",
    description: "Revert all channels to the loaded global measurement source (clears Smart curves/points; undoable). Enabled only when a global measurement is loaded.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "revert_channel_to_measurement",
    description: "Revert a specific channel to its loaded per‑channel measurement source (clears Smart curves/points; undoable). Enabled only when that channel has measurement loaded.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel name to revert",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        }
      },
      required: ["channelName"]
    }
  },
  {
    name: "set_per_channel_linearization",
    description: "Enable or disable linearization for a specific channel (requires linearization file to be loaded for that channel)",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel name (K, C, M, Y, LC, LM, LK, LLK, V, MK)",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        enabled: {
          type: "boolean",
          description: "Whether to enable (true) or disable (false) linearization for this channel"
        }
      },
      required: ["channelName", "enabled"]
    }
  },
  {
    name: "set_interpolation_method",
    description: "Set the interpolation method for curve generation",
    parameters: {
      type: "object",
      properties: {
        method: {
          type: "string",
          description: "Interpolation method to use",
          enum: ["pchip", "linear"]
        }
      },
      required: ["method"]
    }
  },
  {
    name: "set_smoothing_percentage",
    description: "Set the data point smoothing percentage (0-90%)",
    parameters: {
      type: "object",
      properties: {
        percentage: {
          type: "number",
          description: "Smoothing percentage (0=none, 90=maximum)",
          minimum: 0,
          maximum: 90
        }
      },
      required: ["percentage"]
    }
  },
  {
    name: "change_printer",
    description: "Switch between supported printer models",
    parameters: {
      type: "object",
      properties: {
        printerName: {
          type: "string",
          description: "Printer model to switch to",
          enum: ["P700P900", "P5-7-9000", "P800", "P400", "x900", "3880-7880", "x800-x890", "P4-6-8000"]
        }
      },
      required: ["printerName"]
    }
  },
  {
    name: "generate_custom_curve",
    description: "Generate a curve from explicit numerical key points (single channel). Prefer set_ai_key_points for AI-driven curves.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel name to generate curve for",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        keyPoints: {
          type: "array",
          description: "Array of curve control points with input/output values (0-100 range)",
          items: {
            type: "object",
            properties: {
              input: {
                type: "number",
                description: "Input position (0-100%)",
                minimum: 0,
                maximum: 100
              },
              output: {
                type: "number",
                description: "Output value (0-100%)",
                minimum: 0,
                maximum: 100
              }
            },
            required: ["input", "output"]
          },
          minItems: 2
        },
        interpolationType: {
          type: "string",
          description: "Interpolation method between points",
          enum: ["linear", "smooth"],
          default: "smooth"
        }
      },
      required: ["channelName", "keyPoints"]
    }
  },
  {
    name: "get_ai_key_points",
    description: "Get stored AI key points (endpoints included). If channelName is omitted, uses the first enabled channel. If none exist yet, returns an empty list with suggestions; edit calls will auto‑create.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        }
      },
      required: []
    }
  },
  {
    name: "get_smart_key_points",
    description: "Get stored Smart key points (endpoints included). If channelName is omitted, uses the first enabled channel. If none exist yet, returns an empty list with suggestions; edit calls will auto‑create.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        }
      },
      required: []
    }
  },
  {
    name: "set_ai_key_points",
    description: "Replace AI key points and reapply the curve. If channelName is omitted, uses the first enabled channel.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        keyPoints: {
          type: "array",
          description: "Array of {input, output} in 0-100%",
          items: {
            type: "object",
            properties: {
              input: { type: "number", minimum: 0, maximum: 100 },
              output: { type: "number", minimum: 0, maximum: 100 }
            },
            required: ["input", "output"]
          },
          minItems: 2
        },
        interpolationType: {
          type: "string",
          enum: ["linear", "smooth"],
          default: "smooth"
        }
      },
      required: ["keyPoints"]
    }
  },
  {
    name: "set_smart_key_points",
    description: "Replace Smart key points and reapply the curve. If channelName is omitted, uses the first enabled channel.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        keyPoints: {
          type: "array",
          description: "Array of {input, output} in 0-100%",
          items: {
            type: "object",
            properties: {
              input: { type: "number", minimum: 0, maximum: 100 },
              output: { type: "number", minimum: 0, maximum: 100 }
            },
            required: ["input", "output"]
          },
          minItems: 2
        },
        interpolationType: {
          type: "string",
          enum: ["linear", "smooth"],
          default: "smooth"
        }
      },
      required: ["keyPoints"]
    }
  },
  {
    name: "set_ai_key_points_batch",
    description: "Replace AI key points for multiple channels and reapply curves as a single batch action.",
    parameters: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          description: "List of per-channel key points updates",
          items: {
            type: "object",
            properties: {
              channelName: {
                type: "string",
                description: "Channel to update",
                enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
              },
              keyPoints: {
                type: "array",
                description: "Array of {input, output} in 0-100%",
                items: {
                  type: "object",
                  properties: {
                    input: { type: "number", minimum: 0, maximum: 100 },
                    output: { type: "number", minimum: 0, maximum: 100 }
                  },
                  required: ["input", "output"]
                },
                minItems: 2
              },
              interpolationType: {
                type: "string",
                enum: ["linear", "smooth"],
                default: "smooth"
              }
            },
            required: ["channelName", "keyPoints"]
          },
          minItems: 1
        }
      },
      required: ["entries"]
    }
  },
  {
    name: "set_smart_key_points_batch",
    description: "Replace Smart key points for multiple channels and reapply curves as a single batch action.",
    parameters: {
      type: "object",
      properties: {
        entries: {
          type: "array",
          description: "List of per-channel key points updates",
          items: {
            type: "object",
            properties: {
              channelName: {
                type: "string",
                description: "Channel to update",
                enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
              },
              keyPoints: {
                type: "array",
                description: "Array of {input, output} in 0-100%",
                items: {
                  type: "object",
                  properties: {
                    input: { type: "number", minimum: 0, maximum: 100 },
                    output: { type: "number", minimum: 0, maximum: 100 }
                  },
                  required: ["input", "output"]
                },
                minItems: 2
              },
              interpolationType: {
                type: "string",
                enum: ["linear", "smooth"],
                default: "smooth"
              }
            },
            required: ["channelName", "keyPoints"]
          },
          minItems: 1
        }
      },
      required: ["entries"]
    }
  },
  {
    name: "simplify_ai_key_points_from_curve",
    description: "Extract adaptive key points from the current curve (prefers loaded .quad) and apply them to a channel.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel to simplify",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        maxErrorPercent: {
          type: "number",
          description: "Max allowed deviation in % (0.05–5). Default 1.0",
          minimum: 0.05,
          maximum: 5
        },
        maxPoints: {
          type: "integer",
          description: "Upper bound on points (2–20). Default 16",
          minimum: 2,
          maximum: 20
        }
      },
      required: ["channelName"]
    }
  },
  {
    name: "simplify_smart_key_points_from_curve",
    description: "Extract adaptive Smart key points from the current curve (prefers loaded .quad) and apply them to a channel.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel to simplify",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        maxErrorPercent: {
          type: "number",
          description: "Max allowed deviation in % (0.05–5). Default 1.0",
          minimum: 0.05,
          maximum: 5
        },
        maxPoints: {
          type: "integer",
          description: "Upper bound on points (2–20). Default 16",
          minimum: 2,
          maximum: 20
        }
      },
      required: ["channelName"]
    }
  },
  {
    name: "adjust_ai_key_point_by_index",
    description: "Adjust a single AI key point by ordinal (1‑based, endpoints included). If channelName is omitted, uses the first enabled channel. If no AI key points exist yet, quadGEN will silently create them from the current curve/data and then apply the edit.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        ordinal: {
          type: "integer",
          description: "1-based index of the key point (including endpoints)",
          minimum: 1
        },
        inputPercent: {
          type: "number",
          description: "Absolute new input (X) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        outputPercent: {
          type: "number",
          description: "Absolute new output (Y) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        deltaInput: {
          type: "number",
          description: "Delta to add to input (X) in percentage points"
        },
        deltaOutput: {
          type: "number",
          description: "Delta to add to output (Y) in percentage points"
        }
      },
      required: ["ordinal"]
    }
  },
  {
    name: "adjust_smart_key_point_by_index",
    description: "Adjust a single Smart key point by ordinal (1‑based, endpoints included). If channelName is omitted, uses the first enabled channel. If no Smart key points exist yet, quadGEN will create them from the current curve/data and then apply the edit.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        ordinal: {
          type: "integer",
          description: "1-based index of the key point (including endpoints)",
          minimum: 1
        },
        inputPercent: {
          type: "number",
          description: "Absolute new input (X) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        outputPercent: {
          type: "number",
          description: "Absolute new output (Y) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        deltaInput: {
          type: "number",
          description: "Delta to add to input (X) in percentage points"
        },
        deltaOutput: {
          type: "number",
          description: "Delta to add to output (Y) in percentage points"
        }
      },
      required: ["ordinal"]
    }
  },
  {
    name: "insert_ai_key_point_at",
    description: "Insert a new AI key point at a given input (X). If output is omitted, sample current Smart Curve at X. If no AI key points exist yet, they will be created from the current curve/data.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        inputPercent: {
          type: "number",
          description: "Input position (X) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        outputPercent: {
          type: "number",
          description: "Optional output (Y) in % (0-100) — if omitted, sampled from current Smart Curve",
          minimum: 0,
          maximum: 100
        }
      },
      required: ["inputPercent"]
    }
  },
  {
    name: "insert_smart_key_point_at",
    description: "Insert a new Smart key point at a given input (X). If output is omitted, sample current Smart curve at X. If no Smart key points exist yet, they will be created from the current curve/data.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        inputPercent: {
          type: "number",
          description: "Input position (X) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        outputPercent: {
          type: "number",
          description: "Optional output (Y) in % (0-100) — if omitted, sampled from current Smart curve",
          minimum: 0,
          maximum: 100
        }
      },
      required: ["inputPercent"]
    }
  },
  {
    name: "insert_ai_key_point_between",
    description: "Insert a new AI key point between two adjacent ordinals. If output is omitted, sample at the midpoint. If no AI key points exist yet, they will be created from the current curve/data.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        leftOrdinal: {
          type: "integer",
          description: "Left ordinal (1-based)",
          minimum: 1
        },
        rightOrdinal: {
          type: "integer",
          description: "Right ordinal (must be leftOrdinal+1)",
          minimum: 2
        },
        outputPercent: {
          type: "number",
          description: "Optional output (Y) in % (0-100) — if omitted, sampled from current Smart Curve",
          minimum: 0,
          maximum: 100
        }
      },
      required: ["leftOrdinal", "rightOrdinal"]
    }
  },
  {
    name: "insert_smart_key_point_between",
    description: "Insert a new Smart key point between two adjacent ordinals. If output is omitted, sample at the midpoint. If no Smart key points exist yet, they will be created from the current curve/data.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        leftOrdinal: {
          type: "integer",
          description: "Left ordinal (1-based)",
          minimum: 1
        },
        rightOrdinal: {
          type: "integer",
          description: "Right ordinal (must be leftOrdinal+1)",
          minimum: 2
        },
        outputPercent: {
          type: "number",
          description: "Optional output (Y) in % (0-100) — if omitted, sampled from current Smart curve",
          minimum: 0,
          maximum: 100
        }
      },
      required: ["leftOrdinal", "rightOrdinal"]
    }
  },
  {
    name: "insert_ai_key_points_batch",
    description: "Insert multiple AI key points for a single channel in one batch (single undoable action).",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel to update",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        inserts: {
          type: "array",
          description: "List of points to insert",
          items: {
            type: "object",
            properties: {
              inputPercent: { type: "number", minimum: 0, maximum: 100 },
              outputPercent: { type: "number", minimum: 0, maximum: 100 }
            },
            required: ["inputPercent"]
          },
          minItems: 1
        }
      },
      required: ["channelName", "inserts"]
    }
  },
  {
    name: "insert_smart_key_points_batch",
    description: "Insert multiple Smart key points for a single channel in one batch (single undoable action).",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Channel to update",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        inserts: {
          type: "array",
          description: "List of points to insert",
          items: {
            type: "object",
            properties: {
              inputPercent: { type: "number", minimum: 0, maximum: 100 },
              outputPercent: { type: "number", minimum: 0, maximum: 100 }
            },
            required: ["inputPercent"]
          },
          minItems: 1
        }
      },
      required: ["channelName", "inserts"]
    }
  },
  {
    name: "delete_ai_key_point_by_index",
    description: "Delete a single AI key point by ordinal (1‑based). Endpoints blocked by default. If no AI key points exist yet, they will be created from the current curve/data first.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        ordinal: {
          type: "integer",
          description: "1-based index of the key point to delete",
          minimum: 1
        },
        allowEndpoint: {
          type: "boolean",
          description: "Whether to allow deletion of endpoints (defaults to false)",
          default: false
        }
      },
      required: ["ordinal"]
    }
  },
  {
    name: "delete_smart_key_point_by_index",
    description: "Delete a single Smart key point by ordinal (1‑based). Endpoints blocked by default. If no Smart key points exist yet, they will be created from the current curve/data first.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        ordinal: {
          type: "integer",
          description: "1-based index of the key point to delete",
          minimum: 1
        },
        allowEndpoint: {
          type: "boolean",
          description: "Whether to allow deletion of endpoints (defaults to false)",
          default: false
        }
      },
      required: ["ordinal"]
    }
  },
  {
    name: "delete_ai_key_point_near_input",
    description: "Delete the AI key point nearest to a given input % within a tolerance. Endpoints blocked by default. If no AI key points exist yet, they will be created from the current curve/data first.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        inputPercent: {
          type: "number",
          description: "Target input position (X) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        tolerance: {
          type: "number",
          description: "Maximum distance in % to consider a match (default 1.0)"
        },
        allowEndpoint: {
          type: "boolean",
          description: "Whether to allow deletion of endpoints (defaults to false)",
          default: false
        }
      },
      required: ["inputPercent"]
    }
  },
  {
    name: "delete_smart_key_point_near_input",
    description: "Delete the Smart key point nearest to a given input % within a tolerance. Endpoints blocked by default. If no Smart key points exist yet, they will be created from the current curve/data first.",
    parameters: {
      type: "object",
      properties: {
        channelName: {
          type: "string",
          description: "Optional channel name. If omitted, the first enabled channel is used.",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        inputPercent: {
          type: "number",
          description: "Target input position (X) in % (0-100)",
          minimum: 0,
          maximum: 100
        },
        tolerance: {
          type: "number",
          description: "Maximum distance in % to consider a match (default 1.0)"
        },
        allowEndpoint: {
          type: "boolean",
          description: "Whether to allow deletion of endpoints (defaults to false)",
          default: false
        }
      },
      required: ["inputPercent"]
    }
  },
  {
    name: "copy_curve_to_channel",
    description: "Copy a custom curve from one channel to another channel",
    parameters: {
      type: "object",
      properties: {
        sourceChannel: {
          type: "string",
          description: "Channel to copy the curve from",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        },
        targetChannel: {
          type: "string",
          description: "Channel to copy the curve to",
          enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
        }
      },
      required: ["sourceChannel", "targetChannel"]
    }
  },

  {
    name: "generate_global_custom_curve",
    description: "Generate curves from explicit numerical key points for multiple channels simultaneously. Creates single batch undo action.",
    parameters: {
      type: "object",
      properties: {
        keyPoints: {
          type: "array",
          description: "Array of curve control points with input/output values (0-100 range)",
          items: {
            type: "object",
            properties: {
              input: {
                type: "number",
                description: "Input value (0-100)"
              },
              output: {
                type: "number",
                description: "Output value (0-100)"
              }
            },
            required: ["input", "output"]
          }
        },
        interpolationType: {
          type: "string",
          description: "Interpolation method between points",
          enum: ["linear", "smooth"],
          default: "smooth"
        },
        channelFilter: {
          oneOf: [
            {
              type: "string",
              enum: ["all", "enabled"],
              description: "Predefined channel filters"
            },
            {
              type: "array",
              items: {
                type: "string",
                enum: ["K", "C", "M", "Y", "LC", "LM", "LK", "LLK", "V", "MK"]
              },
              description: "Array of specific channel names"
            }
          ],
          description: "Which channels to apply to: 'all' (all printer channels), 'enabled' (only enabled channels), or array of specific channels like ['LK', 'MK']",
          default: "enabled"
        }
      },
      required: ["keyPoints"]
    }
  },

  {
    name: "get_current_state",
    description: "Get the current state of all channels and app settings",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "undo_last_change",
    description: "Revert to the previous state (undo the last change made to curves or channel settings)",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "get_history_summary",
    description: "Get a summary of recent changes and undo history for reference",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "get_quad_file_content",
    description: "Return the current generated .quad file content as text (based on current settings)",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
];
