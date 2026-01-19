// quadGEN Status Messages Module
// Handles Lab Tech console status messages and system notifications

import { elements } from '../core/state.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} value - String to escape
 * @returns {string} - Escaped string
 */
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case '\'': return '&#39;';
            default: return char;
        }
    });
}

/**
 * Status message handler for Lab Tech console
 * Based on addChatMessage from quadgen.html with exact same functionality
 */
export class StatusMessages {
    constructor() {
        this.lastStatusMessage = { text: '', ts: 0 };
    }

    /**
     * Add a message to the Lab Tech console chat history
     * Exact implementation from quadgen.html addChatMessage function
     * @param {string} role - Message role: 'system', 'user', 'assistant'
     * @param {string} message - Message content
     */
    addChatMessage(role, message) {
        // Early return if no chat history element
        if (!elements.chatHistory) {
            console.warn('Chat history element not found, cannot add message:', role, message);
            return;
        }

        const line = document.createElement('div');
        line.className = `chat-line ${role}`;

        // Prefix user prompts like a terminal
        const prefix = role === 'user' ? '> ' : '';

        if (role === 'assistant') {
            // Escape HTML first to prevent XSS, then apply minimal markdown formatting
            let formatted = escapeHTML(message)
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/^- (.+)$/gm, '• $1')
                .replace(/^\* (.+)$/gm, '• $1')
                .replace(/^(\d+\.\s)/gm, '$1');
            line.innerHTML = formatted;
        } else {
            line.textContent = prefix + message;
        }

        // Tag system messages as error/info when applicable (for theming)
        if (role === 'system') {
            const t = String(message || '');
            if (/^\s*error\s*:/i.test(t)) line.classList.add('error');
            else if (/^\s*assistant\s*:/i.test(t) || /processing request/i.test(t)) line.classList.add('info');
        }

        elements.chatHistory.appendChild(line);
        elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;

        // Add to system context if available (for AI integration)
        try {
            const assistant = globalScope.claudeAssistant;
            if (role === 'system' && typeof assistant?.addSystemContext === 'function') {
                assistant.addSystemContext(message);
            }
        } catch (err) {
            // Silently ignore context errors
        }
    }

    /**
     * Add system status message with deduplication
     * Prevents spam by checking if same message was sent recently
     * @param {string} message - Status message
     * @param {number} throttleMs - Throttle time in milliseconds (default 1000)
     */
    addStatusMessage(message, throttleMs = 1000) {
        const now = Date.now();
        if (this.lastStatusMessage.text !== message || now - this.lastStatusMessage.ts > throttleMs) {
            this.addChatMessage('system', message);
            this.lastStatusMessage = { text: message, ts: now };
        }
    }

    /**
     * Add error message to console
     * @param {string} message - Error message
     */
    addErrorMessage(message) {
        this.addChatMessage('system', `Error: ${message}`);
    }

    /**
     * Add success message to console
     * @param {string} message - Success message
     */
    addSuccessMessage(message) {
        this.addChatMessage('system', `✅ ${message}`);
    }

    /**
     * Add warning message to console
     * @param {string} message - Warning message
     */
    addWarningMessage(message) {
        this.addChatMessage('system', `⚠️ ${message}`);
    }

    /**
     * Add processing message to console
     * @param {string} message - Processing message
     */
    addProcessingMessage(message) {
        this.addChatMessage('system', `Assistant: ${message}…`);
    }

    /**
     * Add connection status message
     * @param {string} message - Connection message
     */
    addConnectionMessage(message) {
        this.addChatMessage('system', message);
    }

    /**
     * Clear all messages from chat history
     */
    clearMessages() {
        if (elements.chatHistory) {
            elements.chatHistory.innerHTML = '';
        }
        this.lastStatusMessage = { text: '', ts: 0 };
    }

    /**
     * Add API key status messages
     * @param {string} status - 'valid', 'invalid', 'cleared', 'set'
     * @param {string} message - Status message
     */
    addApiKeyStatus(status, message) {
        const icons = {
            valid: '✅',
            invalid: '❌',
            cleared: '🔑',
            set: '⚠️'
        };

        const icon = icons[status] || '';
        this.addChatMessage('system', `${icon} ${message}`);
    }

    /**
     * Add channel operation messages
     * Used for reporting channel value changes, scaling operations, etc.
     * @param {string} operation - Operation description
     * @param {string} details - Optional details
     */
    addChannelOperationMessage(operation, details = '') {
        const message = details ? `${operation}: ${details}` : operation;
        this.addChatMessage('system', message);
    }

    /**
     * Add AI model connection message with throttling
     * @param {string} message - Connection message
     */
    addModelConnectionMessage(message) {
        this.addStatusMessage(message, 1000); // 1 second throttle
    }
}

// Create singleton instance
export const statusMessages = new StatusMessages();

/**
 * Convenience function - exact same signature as quadgen.html
 * @param {string} role - Message role
 * @param {string} message - Message content
 */
export function addChatMessage(role, message) {
    statusMessages.addChatMessage(role, message);
}

/**
 * Convenience functions for common status types
 */
export function addStatusMessage(message, throttleMs) {
    statusMessages.addStatusMessage(message, throttleMs);
}

export function addErrorMessage(message) {
    statusMessages.addErrorMessage(message);
}

export function addSuccessMessage(message) {
    statusMessages.addSuccessMessage(message);
}

export function addWarningMessage(message) {
    statusMessages.addWarningMessage(message);
}

export function addProcessingMessage(message) {
    statusMessages.addProcessingMessage(message);
}

export function addConnectionMessage(message) {
    statusMessages.addConnectionMessage(message);
}

export function addApiKeyStatus(status, message) {
    statusMessages.addApiKeyStatus(status, message);
}

export function addChannelOperationMessage(operation, details) {
    statusMessages.addChannelOperationMessage(operation, details);
}

export function clearChatMessages() {
    statusMessages.clearMessages();
}

registerDebugNamespace('statusMessages', {
    statusMessages,
    addChatMessage,
    addStatusMessage,
    addErrorMessage,
    addSuccessMessage,
    addWarningMessage,
    addProcessingMessage,
    addConnectionMessage,
    addApiKeyStatus,
    addChannelOperationMessage,
    clearChatMessages
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['addChatMessage', 'statusMessages']
});
