// quadGEN Chat UI Module
// Creates and manages the Lab Tech console UI components

import { elements } from '../core/state.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';

const MIN_CHAT_HEIGHT = 120;
const MAX_CHAT_HEIGHT = 520;

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

function resolveDocument(node) {
    if (node?.ownerDocument) return node.ownerDocument;
    if (globalScope.document) return globalScope.document;
    return null;
}

function resolveView(doc) {
    if (doc?.defaultView) return doc.defaultView;
    if (globalScope.window) return globalScope.window;
    return globalScope;
}

/**
 * Chat UI Manager
 * Handles creation and management of chat interface elements
 */
export class ChatUI {
    constructor() {
        this.isInitialized = false;
        this.chatContainer = null;
        this.messageInput = null;
        this.sendButton = null;
        this.resizerInitialized = false;
    }

    /**
     * Initialize the chat UI elements
     * Creates the DOM elements if they don't exist
     */
    initialize() {
        if (this.isInitialized) return;

        console.log('🎨 Initializing Chat UI...');

        // Try to find existing elements first
        this.chatContainer = document.getElementById('chatHistory');
        this.messageInput = document.getElementById('aiInputCompact');
        this.sendButton = document.getElementById('sendMessageBtnCompact');

        // If elements don't exist, create them
        if (!this.chatContainer || !this.messageInput || !this.sendButton) {
            this.createChatUI();
        }

        // Update the elements state object
        this.updateElementsState();

        // Set up initial state
        this.setupInitialState();

        this.initializeResizer();

        this.isInitialized = true;
        console.log('✅ Chat UI initialized');
    }

    /**
     * Create the chat UI elements and inject them into the DOM
     */
    createChatUI() {
        console.log('🏗️ Creating Chat UI elements...');

        // Find or create a container for the chat interface
        let container = document.getElementById('labTechConsole');

        if (!container) {
            // Create a container if it doesn't exist
            container = document.createElement('div');
            container.id = 'labTechConsole';
            container.className = 'border border-gray-200 rounded-xl p-4 mb-4';

            // Insert it into the main content area
            const mainContent = document.querySelector('main') || document.querySelector('body');
            if (mainContent) {
                mainContent.insertBefore(container, mainContent.firstChild);
            }
        }

        // Create chat history container
        if (!this.chatContainer) {
            this.chatContainer = document.createElement('div');
            this.chatContainer.id = 'chatHistory';
            this.chatContainer.className = 'overflow-y-auto text-xs leading-4 mb-2 min-h-[224px] max-h-[224px] p-2 border border-gray-300 rounded';
            this.chatContainer.innerHTML = '<!-- Lab Tech chat messages will appear here -->';
        }

        // Create input container
        const inputContainer = document.createElement('div');
        inputContainer.className = 'flex gap-2';

        // Create message input
        if (!this.messageInput) {
            this.messageInput = document.createElement('input');
            this.messageInput.id = 'aiInputCompact';
            this.messageInput.type = 'text';
            this.messageInput.placeholder = 'Ask Lab Tech… (Enter to send)';
            this.messageInput.className = 'flex-1 px-2 py-1 text-xs border border-gray-300 rounded';
        }

        // Create send button
        if (!this.sendButton) {
            this.sendButton = document.createElement('button');
            this.sendButton.id = 'sendMessageBtnCompact';
            this.sendButton.textContent = 'Send';
            this.sendButton.className = 'px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded font-bold';
            this.sendButton.disabled = true; // Start disabled
        }

        // Assemble the UI
        inputContainer.appendChild(this.messageInput);
        inputContainer.appendChild(this.sendButton);

        container.appendChild(this.chatContainer);
        container.appendChild(inputContainer);

        console.log('✨ Chat UI elements created and injected into DOM');
    }

    /**
     * Update the global elements state with our chat UI elements
     */
    updateElementsState() {
        if (elements) {
            elements.chatHistory = this.chatContainer;
            elements.chatContainer = this.chatContainer;
            elements.aiInputCompact = this.messageInput;
            elements.chatInput = this.messageInput;
            elements.messageInput = this.messageInput;
            elements.sendMessageBtnCompact = this.sendButton;

            console.log('🔄 Updated elements state with chat UI references');
        }
    }

    /**
     * Initialize the drag-to-resize handle for the Lab Tech console
     */
    initializeResizer() {
        if (this.resizerInitialized) return;

        const fallbackDocument = resolveDocument(null);
        const docContext = resolveDocument(this.chatContainer) || fallbackDocument;
        const resizer = docContext?.getElementById?.('labTechResizer');
        const target = this.chatContainer || docContext?.getElementById?.('chatHistory');

        if (!resizer || !target) {
            console.warn('Lab Tech resizer elements not found');
            return;
        }

        const viewContext = resolveView(docContext);

        let isResizing = false;
        let startY = 0;
        let startHeight = 0;

        const getHeight = () => {
            const styleSource = (viewContext && typeof viewContext.getComputedStyle === 'function')
                ? viewContext
                : (typeof globalScope.getComputedStyle === 'function' ? globalScope : null);
            if (styleSource) {
                const computed = styleSource.getComputedStyle(target)?.height;
                const parsed = parseInt(computed, 10);
                if (Number.isFinite(parsed)) return parsed;
            }
            return target.clientHeight;
        };

        const setHeight = (value) => {
            const clamped = Math.max(MIN_CHAT_HEIGHT, Math.min(MAX_CHAT_HEIGHT, value));
            target.style.height = `${clamped}px`;
        };

        const addScopedListener = (type, handler, options) => {
            if (viewContext && typeof viewContext.addEventListener === 'function') {
                viewContext.addEventListener(type, handler, options);
                return;
            }
            if (docContext && typeof docContext.addEventListener === 'function') {
                docContext.addEventListener(type, handler, options);
            }
        };

        const removeScopedListener = (type, handler, options) => {
            if (viewContext && typeof viewContext.removeEventListener === 'function') {
                viewContext.removeEventListener(type, handler, options);
                return;
            }
            if (docContext && typeof docContext.removeEventListener === 'function') {
                docContext.removeEventListener(type, handler, options);
            }
        };

        const stopResizing = () => {
            if (!isResizing) return;
            isResizing = false;
            if (docContext?.body?.classList) {
                docContext.body.classList.remove('select-none');
            }
            removeScopedListener('mousemove', onMouseMove);
            removeScopedListener('mouseup', stopResizing);
            removeScopedListener('touchmove', onTouchMove);
            removeScopedListener('touchend', stopResizing);
        };

        const onMouseMove = (event) => {
            if (!isResizing) return;
            const delta = event.clientY - startY;
            setHeight(startHeight + delta);
        };

        const onMouseDown = (event) => {
            isResizing = true;
            startY = event.clientY;
            startHeight = getHeight();
            if (docContext?.body?.classList) {
                docContext.body.classList.add('select-none');
            }
            addScopedListener('mousemove', onMouseMove);
            addScopedListener('mouseup', stopResizing);
            event.preventDefault();
        };

        const onTouchMove = (event) => {
            if (!isResizing || event.touches.length !== 1) return;
            const touch = event.touches[0];
            const delta = touch.clientY - startY;
            setHeight(startHeight + delta);
            event.preventDefault();
        };

        const onTouchStart = (event) => {
            if (event.touches.length !== 1) return;
            isResizing = true;
            startY = event.touches[0].clientY;
            startHeight = getHeight();
            if (docContext?.body?.classList) {
                docContext.body.classList.add('select-none');
            }
            addScopedListener('touchmove', onTouchMove, { passive: false });
            addScopedListener('touchend', stopResizing);
            event.preventDefault();
        };

        resizer.addEventListener('mousedown', onMouseDown);
        resizer.addEventListener('touchstart', onTouchStart, { passive: false });

        this.resizerInitialized = true;
    }

    /**
     * Set up initial state for the chat UI
     */
    setupInitialState() {
        if (this.chatContainer) {
            // Add welcome message if empty
            if (this.chatContainer.innerHTML.trim() === '<!-- Lab Tech chat messages will appear here -->') {
                this.addWelcomeMessage();
            }
        }

        if (this.sendButton) {
            // The send button starts disabled and gets enabled by the chat interface
            console.log('🔘 Send button initialized (disabled state)');
        }
    }

    /**
     * Add a welcome message to the chat
     */
    addWelcomeMessage() {
        const welcomeMessage1 = document.createElement('div');
        welcomeMessage1.className = 'chat-line system';
        welcomeMessage1.textContent = '💬 Lab Tech AI Assistant Ready';

        const welcomeMessage2 = document.createElement('div');
        welcomeMessage2.className = 'chat-line system';
        welcomeMessage2.style.fontStyle = 'normal';
        welcomeMessage2.style.fontSize = '11px';
        welcomeMessage2.textContent = 'Type a message and press Enter or click Send to chat with your AI assistant.';

        this.chatContainer.appendChild(welcomeMessage1);
        this.chatContainer.appendChild(welcomeMessage2);
        console.log('👋 Added welcome message to chat');
    }

    /**
     * Scroll chat container to bottom
     */
    scrollToBottom() {
        if (this.chatContainer) {
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        }
    }

    /**
     * Clear all messages from the chat
     */
    clearMessages() {
        if (this.chatContainer) {
            this.chatContainer.innerHTML = '';
            this.addWelcomeMessage();
        }
    }

    /**
     * Get the current input value
     */
    getInputValue() {
        return this.messageInput ? this.messageInput.value : '';
    }

    /**
     * Clear the input field
     */
    clearInput() {
        if (this.messageInput) {
            this.messageInput.value = '';
        }
    }

    /**
     * Enable or disable the send button
     */
    setSendButtonEnabled(enabled) {
        if (this.sendButton) {
            this.sendButton.disabled = !enabled;
        }
    }

    /**
     * Focus on the input field
     */
    focusInput() {
        if (this.messageInput) {
            this.messageInput.focus();
        }
    }
}

// Create and export a singleton instance
export const chatUI = new ChatUI();

// Initialize automatically when the module is loaded
if (typeof document !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            chatUI.initialize();
        });
    } else {
        // DOM is already ready
        chatUI.initialize();
    }
}

registerDebugNamespace('chatUI', {
    chatUI
}, {
    exposeOnWindow: true,
    windowAliases: ['chatUI']
});
