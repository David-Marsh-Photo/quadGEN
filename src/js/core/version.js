// quadGEN Version and Configuration Constants
// Extracted from original quadgen.html

// Application version - update in one place
export const APP_RELEASE_CHANNEL = 'Beta';
export const APP_VERSION = '3.1.0';
export const APP_DISPLAY_VERSION = APP_RELEASE_CHANNEL ? `${APP_RELEASE_CHANNEL} ${APP_VERSION}` : APP_VERSION;

// Dark mode feature flag
export const ENABLE_DARK_MODE = true;

// Global debug logging toggle for non-AI logs
export let DEBUG_LOGS = false;

// AI provider selection (code-level switch, no UI): 'anthropic' or 'openai'
export const AI_PROVIDER = 'anthropic';
export const WORKER_URL = 'https://sparkling-shape-8b5a.marshmonkey.workers.dev';
export const ANTHROPIC_MODEL = 'claude-sonnet-4-5';
// Set OPENAI_MODEL to 'gpt-5' if you have access; 'gpt-4o' is a safe default
export const OPENAI_MODEL = 'gpt-5-mini';

// Debug flag for AI logs
export const DEBUG_AI = false;
// Temporary alias during terminology transition (AI → Smart)
export const DEBUG_SMART = DEBUG_AI;

export const INTENT_TUNING_STORAGE_KEY = 'quadgen.debugIntentTuning';

// Functions for debug flag management
export function storeIntentTuningFlag(flag) {
    localStorage.setItem(INTENT_TUNING_STORAGE_KEY, flag ? 'true' : 'false');
}

export function loadIntentTuningFlag() {
    return localStorage.getItem(INTENT_TUNING_STORAGE_KEY) === 'true';
}

export const DEBUG_INTENT_TUNING = (() => {
    const stored = loadIntentTuningFlag();
    if (stored) storeIntentTuningFlag(true);
    return stored;
})();

// Global debug function
export function setDebugLogs(enabled) {
    DEBUG_LOGS = enabled;
}
