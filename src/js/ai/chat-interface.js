// quadGEN Chat Interface
// AI assistant chat interface and messaging system

import { elements } from '../core/state.js';
import { AI_CONFIG } from './ai-config.js';
import { CLAUDE_FUNCTIONS } from './ai-functions.js';
import { QuadGenActions } from './ai-actions.js';
import { statusMessages } from '../ui/status-messages.js';
import { triggerInkChartUpdate } from '../ui/ui-hooks.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

/**
 * Chat message management and UI interface
 */
export class ChatInterface {
    constructor() {
        this.chatHistory = [];
        this.conversationHistory = [];
        this.isProcessing = false;
        this._modelLogged = false;
        this.quadGenActions = new QuadGenActions();
    }

    /**
     * Add a message to the chat interface
     * @param {string} role - Message role ('user', 'assistant', 'system')
     * @param {string} message - Message content
     */
    addMessage(role, message) {
        try {
            if (!message || typeof message !== 'string') {
                console.warn('Invalid message provided to addMessage');
                return;
            }

            // Store in history
            this.chatHistory.push({
                role,
                message: message.trim(),
                timestamp: new Date().toISOString()
            });

            // Update UI if elements are available
            this.updateChatUI(role, message);

            // Log for debugging
            if (globalScope.DEBUG_AI) {
                console.log(`[CHAT] ${role}: ${message}`);
            }

        } catch (error) {
            console.error('Error adding chat message:', error);
        }
    }

    /**
     * Update chat UI with new message
     * @param {string} role - Message role
     * @param {string} message - Message content
     */
    updateChatUI(role, message) {
        try {
            // Use the comprehensive status messages system
            statusMessages.addChatMessage(role, message);
        } catch (error) {
            console.error('Error updating chat UI:', error);
            // Fallback: log to console if status messages fail
            console.log(`📱 Chat fallback: [${role}] ${message}`);
        }
    }

    /**
     * Send a chat message to the AI assistant
     * @param {string} userMessage - User message
     * @returns {Promise<Object>} AI response
     */
    async sendMessage(userMessage) {
        try {
            if (!userMessage || typeof userMessage !== 'string') {
                throw new Error('Invalid message provided');
            }

            if (this.isProcessing) {
                throw new Error('Already processing a message');
            }

            this.isProcessing = true;

            // Add user message to chat
            this.addMessage('user', userMessage);

            // Show processing indicator
            if (this.shouldShowStatus()) {
                this.addMessage('system', 'Assistant: processing request…');
            }

            const debugAI = !!globalScope.DEBUG_AI;
            const debugLogs = !!globalScope.DEBUG_LOGS;

            if (debugAI || debugLogs) {
                console.log('📤 Sending message to AI:', userMessage);
            }

            // Get current application context
            const contextMessage = this.getSystemContext();

            // System message with quadGEN Lab Tech instructions
            const baseSystemMessage = `You are Lab Tech, quadGEN's AI assistant for fine art printing and QuadToneRIP .quad file generation.

CURRENT APPLICATION STATE:
${contextMessage}

You are here to help with:
• quadGEN app functionality and usage
• Digital printing workflows and troubleshooting
• Alternative photographic processes (cyanotype, palladium, etc.)
• Historical printing methods and fine art techniques
• QuadToneRIP .quad file generation and editing
• Ink limit optimization and curve adjustment
• LAB measurement data analysis and linearization
• Channel management and smart curve generation

When the user asks for help with curve adjustments:
• Use get_current_state first to understand the current setup
• Ask clarifying questions if needed about desired tonal characteristics
• Make specific, targeted adjustments using the available functions
• Always explain what changes were made and why

For measurement data and linearization:
• Prefer LAB data over other formats when available
• Explain the difference between image-space and printer-space corrections
• Guide users through proper measurement workflow

IMPORTANT RESPONSE FORMAT:
• Keep responses concise and focused
• When making function calls, briefly explain what you're doing
• Include specific percentage or value changes when relevant
• Use technical terminology appropriately for the printing context
• Format numerical data clearly (percentages, curve points, etc.)

KEY‑POINT EDITING DEFAULTS:
• "point N" ALWAYS refers to the AI key‑point ordinal N (1‑based, endpoints included) on the selected channel
• If channel is not specified, use the first enabled channel from the current state
• Silent conversion: If no AI key points exist yet, edit/insert/delete functions will auto‑create them from any loaded data
• Disambiguation: If user mentions "point N ... %", interpret as key‑point change, not channel ink limit

CHANNEL SELECTION RULES:
• Use the first enabled channel (percentage > 0 OR endValue > 0 OR enabled = true) when channel not specified
• If NO channels enabled, ask which channel to use
• Standard ink limits: K/MK=100%, colors=30-45%, Light inks=60-80%

Only engage with requests about: app functionality, printing, photography, historical/alternative processes, digital negatives/positives. Politely decline unrelated topics.`;

            const systemMessage = baseSystemMessage;

            // Prepare the API request messages
            const messages = [
                {
                    role: 'user',
                    content: `${contextMessage}\n\nUser request: ${userMessage}`
                }
            ];

            // Add conversation history (last 10 messages to avoid token limits)
            const recentHistory = this.conversationHistory.slice(-10);
            messages.splice(-1, 0, ...recentHistory);

            // Provider request helper with parsing and error propagation
            const requestProvider = async (provider) => {
                // Build provider-specific payload
                let payload;
                if (provider === 'openai') {
                    const openaiMessages = [
                        { role: 'system', content: systemMessage },
                        ...recentHistory,
                        messages[messages.length - 1]
                    ];
                    const openaiTools = CLAUDE_FUNCTIONS.map(func => ({
                        type: 'function',
                        function: {
                            name: func.name,
                            description: func.description,
                            parameters: func.parameters
                        }
                    }));
                    payload = {
                        provider: 'openai',
                        model: AI_CONFIG.OPENAI_MODEL,
                        messages: openaiMessages,
                        tools: openaiTools
                    };
                } else {
                    payload = {
                        provider: 'anthropic',
                        model: AI_CONFIG.ANTHROPIC_MODEL,
                        max_tokens: 1000,
                        system: systemMessage,
                        messages: messages,
                        tools: CLAUDE_FUNCTIONS.map(func => ({
                            name: func.name,
                            description: func.description,
                            input_schema: func.parameters
                        }))
                    };
                }

                // Retry wrapper for transient errors (429/5xx/529)
                const maxAttempts = 3;
                let response, respText, data;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    response = await fetch(AI_CONFIG.WORKER_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    respText = await response.text();
                    try { data = JSON.parse(respText); } catch (err) { data = {}; }

                    if (response.ok) break;

                    const status = response.status;
                    const retryAfterHeader = response.headers.get('Retry-After');
                    const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
                    const isRetryable = status === 429 || status === 529 || (status >= 500 && status <= 504);
                    if (attempt < maxAttempts && isRetryable) {
                        const backoff = retryAfter ?? attempt * 600; // ms
                    if (debugAI || debugLogs) {
                        console.warn(`Transient AI error ${status}; retrying in ${backoff}ms (attempt ${attempt}/${maxAttempts - 1})`);
                    }
                        await new Promise(r => setTimeout(r, backoff));
                        continue;
                    }

                    const errMsg = data?.error?.message || data?.error || response.statusText || 'Unknown error';
                    const error = new Error(`API Error: ${status} - ${errMsg}`);
                    error.status = status;
                    error.provider = provider;
                    error.data = data;
                    throw error;
                }

                // One-time model/provider debug line
                if (!this._modelLogged) {
                    const servedModel = data.model || (provider === 'openai' ? AI_CONFIG.OPENAI_MODEL : AI_CONFIG.ANTHROPIC_MODEL);
                    const servedProvider = response.headers.get('X-Model-Provider') || provider;
                    const connectMsg = `AI connected → provider: ${servedProvider}, model: ${servedModel}`;
                    if (debugAI || debugLogs) console.log(connectMsg);
                    if (this.shouldShowStatus()) {
                        this.addMessage('system', connectMsg);
                    }
                    this._modelLogged = true;
                }

                // Extract rate limit headers
                const rateLimitHeaders = {};
                ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'].forEach(header => {
                    const value = response.headers.get(header);
                    if (value) rateLimitHeaders[header] = value;
                });

                // Process function calls and text
                const functionResults = [];
                let assistantMessage = '';
                if (provider === 'openai') {
                    const choice = data.choices?.[0] || {};
                    const msg = choice.message || {};
                    // Robust text extraction for OpenAI variants
                    if (typeof msg.content === 'string') {
                        assistantMessage = msg.content;
                    } else if (Array.isArray(msg.content)) {
                        assistantMessage = msg.content.map(c => (typeof c === 'string' ? c : (c?.text ?? ''))).join('');
                    } else if (typeof choice.text === 'string') {
                        assistantMessage = choice.text;
                    } else if (Array.isArray(data.output_text)) {
                        assistantMessage = data.output_text.join('\n');
                    } else if (typeof data.output_text === 'string') {
                        assistantMessage = data.output_text;
                    }
                    const toolCalls = msg.tool_calls || choice.tool_calls || [];
                    for (const call of toolCalls) {
                        if (call.type === 'function' && call.function?.name) {
                            let args = {};
                            try { args = JSON.parse(call.function.arguments || '{}'); } catch (err) {}
                            if (debugAI || debugLogs) console.log('🔧 Function call (OpenAI):', call.function.name, args);
                            const result = await this.executeFunctionCall({ name: call.function.name, parameters: args }, userMessage);
                            functionResults.push({ function: call.function.name, parameters: args, result });
                        }
                    }
                } else {
                    for (const content of data.content || []) {
                        if (content.type === 'text') {
                            assistantMessage += content.text;
                        } else if (content.type === 'tool_use') {
                            if (debugAI || debugLogs) console.log('🔧 Function call (Anthropic):', content.name, content.input);
                            const result = await this.executeFunctionCall({ name: content.name, parameters: content.input }, userMessage);
                            functionResults.push({ function: content.name, parameters: content.input, result });
                        }
                    }
                }

                return { assistantMessage, functionResults, rateLimitHeaders, provider };
            };

            // Use the configured provider
            let result = await requestProvider(AI_CONFIG.PROVIDER);

            const { assistantMessage, functionResults, rateLimitHeaders } = result;
            let finalMessage = assistantMessage || '';

            // If the model didn't produce a narrative, synthesize a concise action summary for AI key point updates
            try {
                const hasSetAI = (functionResults || []).some(fr => fr.function === 'set_ai_key_points');
                if ((!finalMessage || finalMessage.trim().length === 0) && hasSetAI) {
                    const parts = [];
                    for (const fr of functionResults) {
                        if (fr.function === 'set_ai_key_points') {
                            const res = fr.result || {};
                            const msg = res.message || 'Applied AI key points.';
                            parts.push(`Action: ${msg}`);
                        }
                    }
                    if (parts.length > 0) {
                        finalMessage = parts.join('\n\n');
                    }
                }

                // Always format get_ai_key_points results
                const getAIResults = (functionResults || []).filter(fr => fr.function === 'get_ai_key_points');
                if (getAIResults.length > 0) {
                    const lines = [];
                    for (const fr of getAIResults) {
                        const res = fr.result || {};
                        if (res.success && Array.isArray(res.keyPoints)) {
                            const ch = res.channelName || fr.parameters?.channelName || 'channel';
                            const list = res.keyPoints.map(p => `${Math.round(p.input)},${Math.round(p.output)}`).join(' ');
                            lines.push(`Key points (${ch}): ${list}`);
                        } else if (res.message) {
                            lines.push(res.message);
                        }
                    }
                    if (lines.length > 0) {
                        if (!finalMessage || finalMessage.trim().length === 0) {
                            finalMessage = lines.join('\n');
                        } else {
                            finalMessage += `\n${lines.join('\n')}`;
                        }
                    }
                }
            } catch (e) {
                if (debugAI || debugLogs) console.warn('Failed to synthesize action summary:', e.message);
            }

            if (debugAI || debugLogs) console.log('📝 Total function calls processed:', functionResults.length);

            // Update conversation history
            this.conversationHistory.push(
                { role: 'user', content: userMessage },
                { role: 'assistant', content: finalMessage || 'I performed the requested actions.' }
            );

            // Add assistant response to chat
            this.addMessage('assistant', finalMessage || 'Actions completed successfully.');

            // Process any function results
            if (functionResults && functionResults.length > 0) {
                this.processFunctionResults(functionResults);
            }

            return {
                success: true,
                message: 'Request processed successfully',
                response: finalMessage || 'Actions completed successfully.',
                functionResults: functionResults,
                actionsPerformed: functionResults.length > 0,
                rateLimitHeaders: rateLimitHeaders
            };

        } catch (error) {
            console.error('AI API Error:', error);
            const errorMessage = `Error communicating with AI provider: ${error.message}`;
            this.addMessage('system', errorMessage);
            return {
                success: false,
                message: errorMessage,
                response: `Sorry, I encountered an error: ${error.message}`
            };
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process AI function call results
     * @param {Array} functionResults - Array of function call results
     */
    processFunctionResults(functionResults) {
        try {
            if (!Array.isArray(functionResults)) return;

            for (const result of functionResults) {
                if (result.function && result.success) {
                    console.log(`📋 Function executed: ${result.function}`);

                    // Handle specific function types
                    if (result.function.includes('set_ai_key_points') || result.function.includes('smart')) {
                        this.handleSmartCurveUpdate(result);
                    }
                }
            }

        } catch (error) {
            console.error('Error processing function results:', error);
        }
    }

    /**
     * Handle Smart Curve updates from AI functions
     * @param {Object} result - Function call result
     */
    handleSmartCurveUpdate(result) {
        try {
            // TODO: Connect to actual Smart Curve update logic
            console.log('🎯 Smart Curve update:', result);

            // Trigger UI updates if needed
            triggerInkChartUpdate();

        } catch (error) {
            console.error('Error handling Smart Curve update:', error);
        }
    }

    /**
     * Clear chat history
     */
    clearHistory() {
        try {
            this.chatHistory = [];
            this.conversationHistory = [];

            // Clear UI
            const chatContainer = elements.chatHistory || elements.chatContainer;
            if (chatContainer) {
                chatContainer.innerHTML = '';
            }

            this.addMessage('system', 'Chat history cleared.');

        } catch (error) {
            console.error('Error clearing chat history:', error);
        }
    }

    /**
     * Get system context for AI requests
     * @returns {string} Current application context
     */
    getSystemContext() {
        try {
            // TODO: Connect to actual application state
            return 'Current printer: P700/P900, Channels: K enabled (100%), C disabled, M disabled, Y disabled';
        } catch (error) {
            console.error('Error getting system context:', error);
            return 'Unable to get current application context';
        }
    }

    /**
     * Execute a function call from the AI
     * @param {Object} functionCall - Function call object with name and parameters
     * @param {string} userMessage - Original user message for context
     * @returns {Object} Function execution result
     */
    async executeFunctionCall(functionCall, userMessage) {
        try {
            const { name, parameters } = functionCall;

            if (globalScope.DEBUG_AI) {
                console.log(`🔧 Executing function: ${name}`, parameters);
            }

            // Route function calls to the appropriate handler
            switch (name) {
                case 'set_channel_value':
                    return this.quadGenActions.setChannelValue(parameters.channelName, parameters.percentage);
                case 'set_channel_end_value':
                    return this.quadGenActions.setChannelEndValue(parameters.channelName, parameters.endValue);
                case 'apply_to_all_channels':
                    return this.quadGenActions.applyToAllChannels(parameters.percentage);
                case 'scale_channel_ends_by_percent':
                    return await this.quadGenActions.scaleChannelEndsByPercent(parameters.scalePercent);
                case 'enable_disable_channel':
                    return this.quadGenActions.enableDisableChannel(parameters.channelName, parameters.enabled);
                case 'load_lab_data_global':
                    return this.quadGenActions.loadLabData(parameters.labData, true);
                case 'load_lab_data_per_channel':
                    return this.quadGenActions.loadLabData(parameters.labData, false, parameters.channelName);
                case 'apply_manual_lstar_values':
                    return this.quadGenActions.applyManualLstarValues(
                        parameters.lValues,
                        parameters.channelName,
                        parameters.patchPercents
                    );
                case 'generate_and_download_quad_file':
                    return this.quadGenActions.generateAndDownloadQuadFile();
                case 'get_current_state':
                    return this.quadGenActions.getCurrentState();
                case 'revert_global_to_measurement':
                    return this.quadGenActions.revertGlobalToMeasurement();
                case 'revert_channel_to_measurement':
                    return this.quadGenActions.revertChannelToMeasurement(parameters?.channelName);
                case 'set_lab_spot_markers':
                    return this.quadGenActions.setLabSpotMarkers(parameters.enabled);
                case 'set_auto_raise_ink_limits':
                    return this.quadGenActions.setAutoRaiseInkLimits(parameters.enabled);
                case 'set_light_blocking_overlay':
                    return this.quadGenActions.setLightBlockingOverlay(parameters.enabled);
                case 'set_correction_method':
                    return this.quadGenActions.setCorrectionMethod(parameters.method);
                case 'set_correction_gain':
                    return this.quadGenActions.setCorrectionGain(parameters.percent);
                case 'get_correction_gain':
                    return this.quadGenActions.getCorrectionGain();
                case 'lock_channel':
                    return this.quadGenActions.lockChannel(parameters.channelName, parameters.locked);
                case 'get_channel_lock_status':
                    return this.quadGenActions.getChannelLockStatus(parameters?.channelName);
                default:
                    console.warn(`Unknown function call: ${name}`);
                    return {
                        success: false,
                        message: `Function '${name}' is not yet implemented in the modular version`
                    };
            }
        } catch (error) {
            console.error('Error executing function call:', error);
            return {
                success: false,
                message: `Error executing function: ${error.message}`
            };
        }
    }

    /**
     * Get chat history
     * @returns {Array} Chat history array
     */
    getHistory() {
        return [...this.chatHistory];
    }

    /**
     * Check if should show assistant status messages
     * @returns {boolean} True if should show status
     */
    shouldShowStatus() {
        // TODO: Connect to actual settings/preferences
        return true; // Default to showing status
    }

    /**
     * Validate API key functionality
     * @param {string} apiKey - API key to validate
     * @returns {Promise<Object>} Validation result
     */
    async validateApiKey(apiKey) {
        try {
            if (!apiKey || typeof apiKey !== 'string') {
                return {
                    valid: false,
                    message: 'Invalid API key format'
                };
            }

            // TODO: Connect to actual API validation
            console.log('🔑 Validating API key...');

            // Placeholder validation
            const isValid = apiKey.length > 10; // Simple length check

            return {
                valid: isValid,
                message: isValid ? 'API key appears valid' : 'API key too short'
            };

        } catch (error) {
            console.error('Error validating API key:', error);
            return {
                valid: false,
                message: `Validation error: ${error.message}`
            };
        }
    }

    /**
     * Set API key
     * @param {string} apiKey - API key to set
     * @param {boolean} validate - Whether to validate the key
     */
    async setApiKey(apiKey, validate = true) {
        try {
            if (validate) {
                const validation = await this.validateApiKey(apiKey);
                if (validation.valid) {
                    this.addMessage('system', `✅ ${validation.message}. You can now chat with Lab Tech!`);
                } else {
                    this.addMessage('system', `❌ ${validation.message}`);
                    return;
                }
            } else {
                this.addMessage('system', '⚠️ API key set WITHOUT validation. Try sending a message to test if it works.');
            }

            // TODO: Store API key securely
            console.log('🔑 API key set');

        } catch (error) {
            console.error('Error setting API key:', error);
            this.addMessage('system', `❌ Could not validate API key: ${error.message}`);
        }
    }

    /**
     * Clear API key
     */
    clearApiKey() {
        try {
            // TODO: Clear stored API key
            console.log('🔑 API key cleared');
            this.addMessage('system', 'API key cleared. Please set a new API key to continue chatting.');

        } catch (error) {
            console.error('Error clearing API key:', error);
        }
    }

    /**
     * Test API connection
     * @returns {Promise<Object>} Connection test result
     */
    async testConnection() {
        try {
            // TODO: Connect to actual API test
            console.log('🔗 Testing API connection...');

            // Placeholder test
            const result = {
                success: true,
                message: 'Connection test successful (placeholder)'
            };

            this.addMessage('system', `Connection test: ${result.message}`);
            return result;

        } catch (error) {
            console.error('Connection test failed:', error);
            this.addMessage('system', `Connection test failed: ${error.message}`);
            return {
                success: false,
                message: error.message
            };
        }
    }
}

/**
 * Global chat interface instance
 */
let globalChatInterface = null;

/**
 * Get or create global chat interface
 * @returns {ChatInterface} Global chat interface instance
 */
export function getChatInterface() {
    if (!globalChatInterface) {
        globalChatInterface = new ChatInterface();
    }
    return globalChatInterface;
}

/**
 * Legacy function wrapper for backward compatibility
 * @param {string} role - Message role
 * @param {string} message - Message content
 */
export function addChatMessage(role, message) {
    const chatInterface = getChatInterface();
    chatInterface.addMessage(role, message);
}

/**
 * Legacy function wrapper for sending messages
 * @returns {Promise<Object>} AI response
 */
export async function sendChatMessage() {
    console.log('💬 sendChatMessage() called!');
    try {
        const chatInterface = getChatInterface();

        // Get message from UI input
        const messageInput = elements.chatInput || elements.messageInput || elements.aiInputCompact;
        if (!messageInput) {
            throw new Error('No message input element found');
        }

        const message = messageInput.value?.trim();
        if (!message) {
            throw new Error('Please enter a message');
        }

        // Clear input
        messageInput.value = '';

        // Send message
        return await chatInterface.sendMessage(message);

    } catch (error) {
        console.error('Error in sendChatMessage:', error);
        const chatInterface = getChatInterface();
        chatInterface.addMessage('system', `Error: ${error.message}`);
        throw error;
    }
}

/**
 * Check if should show assistant status
 * @returns {boolean} True if should show status
 */
export function shouldShowAssistantStatus() {
    const chatInterface = getChatInterface();
    return chatInterface.shouldShowStatus();
}

/**
 * Initialize chat interface event handlers
 */
export function initializeChatInterface() {
    try {
        console.log('💬 Initializing chat interface...');

        // TODO: Connect to actual UI elements and event handlers
        // This is a placeholder for the full chat interface initialization

        // Set up send button listeners
        if (elements.sendMessageBtnCompact) {
            console.log('💬 Setting up event listener for sendMessageBtnCompact');
            elements.sendMessageBtnCompact.addEventListener('click', sendChatMessage);
            // Enable the button (it starts disabled in HTML)
            elements.sendMessageBtnCompact.disabled = false;
            console.log('💬 Enabled sendMessageBtnCompact button');
        } else {
            console.warn('💬 sendMessageBtnCompact element not found!');
        }

        // Set up keyboard shortcuts
        if (elements.chatInput || elements.messageInput || elements.aiInputCompact) {
            const input = elements.chatInput || elements.messageInput || elements.aiInputCompact;
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!elements.sendMessageBtnCompact?.disabled) {
                        sendChatMessage();
                    }
                }
            });
        }

        console.log('✅ Chat interface initialized');

    } catch (error) {
        console.error('Error initializing chat interface:', error);
    }
}

registerDebugNamespace('chatInterface', {
    ChatInterface,
    getChatInterface,
    addChatMessage,
    sendChatMessage,
    shouldShowAssistantStatus,
    initializeChatInterface
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: [
        'ChatInterface',
        'getChatInterface',
        'addChatMessage',
        'sendChatMessage',
        'shouldShowAssistantStatus',
        'initializeChatInterface'
    ]
});
