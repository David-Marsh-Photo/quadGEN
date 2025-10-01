// quadGEN AI Configuration
// AI provider settings and function definitions extracted from monolithic codebase

/**
 * AI provider configuration
 */
export const AI_CONFIG = {
    // AI provider selection: 'anthropic' or 'openai'
    PROVIDER: 'anthropic',

    // Worker URL for API proxy
    WORKER_URL: 'https://sparkling-shape-8b5a.marshmonkey.workers.dev',

    // Model configurations
    ANTHROPIC_MODEL: 'claude-sonnet-4-5',
    OPENAI_MODEL: 'gpt-5-mini', // Use 'gpt-5' if available, 'gpt-4o' is safe default

    // Debug flags
    DEBUG_AI: false,
    DEBUG_SMART: false // Alias during terminology transition
};

/**
 * Claude API function definitions for quadGEN operations
 * This defines the interface that the AI assistant can use to control the application
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
        name: "set_channel_value",
        description: "Set ink limit percentage for a specific channel (K, C, M, Y, etc.).",
        parameters: {
            type: "object",
            properties: {
                channelName: {
                    type: "string",
                    description: "Channel name (K, C, M, Y, LC, LM, LK, LLK, etc.)"
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
        description: "Set raw end value for a specific channel (0-65535 range).",
        parameters: {
            type: "object",
            properties: {
                channelName: {
                    type: "string",
                    description: "Channel name (K, C, M, Y, etc.)"
                },
                endValue: {
                    type: "number",
                    description: "Raw end value (0-65535)",
                    minimum: 0,
                    maximum: 65535
                }
            },
            required: ["channelName", "endValue"]
        }
    },
    {
        name: "apply_to_all_channels",
        description: "Apply the same ink limit percentage to all enabled channels.",
        parameters: {
            type: "object",
            properties: {
                percentage: {
                    type: "number",
                    description: "Ink limit percentage to apply to all channels (0-100)",
                    minimum: 0,
                    maximum: 100
                }
            },
            required: ["percentage"]
        }
    },
    {
        name: "scale_channel_ends_by_percent",
        description: "Scale all channel end values by a percentage (e.g., 110 for 10% increase).",
        parameters: {
            type: "object",
            properties: {
                scalePercent: {
                    type: "number",
                    description: "Scale percentage (100 = no change, 110 = 10% increase, 90 = 10% decrease)",
                    minimum: 1,
                    maximum: 1000
                }
            },
            required: ["scalePercent"]
        }
    },
    {
        name: "get_current_state",
        description: "Get the current application state including channel values and settings.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "generate_and_download_quad_file",
        description: "Generate and download the current quad file configuration.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    },
    {
        name: "enable_disable_channel",
        description: "Enable or disable a specific ink channel.",
        parameters: {
            type: "object",
            properties: {
                channelName: {
                    type: "string",
                    description: "Channel name (K, C, M, Y, etc.)"
                },
                enabled: {
                    type: "boolean",
                    description: "Whether to enable (true) or disable (false) the channel"
                }
            },
            required: ["channelName", "enabled"]
        }
    }

    // TODO: Add remaining function definitions from the full CLAUDE_FUNCTIONS array
    // The original array contains many more functions including:
    // - File loading operations
    // - Curve editing functions
    // - LAB data operations
    // - Edit mode controls
    // - Linearization functions
    // - Auto limit controls
    // - And many more...
];

/**
 * Get AI configuration for current provider
 * @returns {Object} Provider-specific configuration
 */
export function getAIProviderConfig() {
    return {
        provider: AI_CONFIG.PROVIDER,
        model: AI_CONFIG.PROVIDER === 'anthropic' ? AI_CONFIG.ANTHROPIC_MODEL : AI_CONFIG.OPENAI_MODEL,
        workerUrl: AI_CONFIG.WORKER_URL,
        debug: AI_CONFIG.DEBUG_AI
    };
}

/**
 * Get function definitions for current AI provider
 * @returns {Array} Array of function definitions
 */
export function getAIFunctionDefinitions() {
    return CLAUDE_FUNCTIONS;
}

/**
 * Validate AI function call parameters
 * @param {string} functionName - Name of the function
 * @param {Object} parameters - Parameters to validate
 * @returns {Object} Validation result with success status and message
 */
export function validateAIFunctionCall(functionName, parameters) {
    const functionDef = CLAUDE_FUNCTIONS.find(f => f.name === functionName);

    if (!functionDef) {
        return {
            success: false,
            message: `Unknown function: ${functionName}`
        };
    }

    // Basic validation - could be expanded with more sophisticated schema validation
    const required = functionDef.parameters.required || [];
    const missing = required.filter(param => !(param in parameters));

    if (missing.length > 0) {
        return {
            success: false,
            message: `Missing required parameters: ${missing.join(', ')}`
        };
    }

    return {
        success: true,
        message: 'Function call parameters are valid'
    };
}
