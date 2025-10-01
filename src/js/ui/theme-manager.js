import { triggerInkChartUpdate } from './ui-hooks.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import { getMatchMedia } from '../utils/browser-env.js';

/**
 * Theme Management System
 * Handles light/dark mode switching with localStorage persistence
 * and system preference detection
 */

// Configuration
const THEME_KEY = 'quadgen.theme';
const ENABLE_DARK_MODE = true; // Feature flag from quadgen.html

/**
 * Check if system prefers dark mode
 * @returns {boolean} True if system prefers dark mode
 */
function getSystemPrefersDark() {
    try {
        const matcher = getMatchMedia();
        return !!(matcher && matcher('(prefers-color-scheme: dark)').matches);
    } catch (err) {
        return false;
    }
}

/**
 * Apply theme to the document
 * @param {string} theme - 'dark' or 'light'
 * @param {boolean} persist - Whether to save to localStorage
 */
export function applyTheme(theme, persist = true) {
    try {
        const root = document.documentElement;

        if (theme === 'dark') {
            root.setAttribute('data-theme', 'dark');
        } else {
            root.removeAttribute('data-theme');
        }

        if (persist) {
            localStorage.setItem(THEME_KEY, theme);
        }

        // Update theme toggle button if it exists
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            const isDark = theme === 'dark';
            themeToggle.textContent = isDark ? '☀️' : '🌙';
            themeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
            themeToggle.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
        }

        // Trigger chart update if available (from global scope)
        try {
            triggerInkChartUpdate();
        } catch (err) {
            // Chart update failed, not critical
        }

        console.log(`🎨 Theme applied: ${theme}`);

    } catch (err) {
        console.error('Error applying theme:', err);
    }
}

/**
 * Get current theme from localStorage or system preference
 * @returns {string} 'dark' or 'light'
 */
export function getCurrentTheme() {
    if (!ENABLE_DARK_MODE) return 'light';

    const saved = localStorage.getItem(THEME_KEY);
    if (saved && (saved === 'dark' || saved === 'light')) {
        return saved;
    }

    // Default to system preference
    return getSystemPrefersDark() ? 'dark' : 'light';
}

/**
 * Toggle between light and dark themes
 */
export function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const isDark = currentTheme === 'dark';
    const newTheme = isDark ? 'light' : 'dark';

    applyTheme(newTheme);

    return newTheme;
}

/**
 * Initialize theme system
 */
export function initializeTheme() {
    if (!ENABLE_DARK_MODE) {
        console.log('🎨 Dark mode disabled, using light theme');
        return;
    }

    console.log('🎨 Initializing theme system...');

    // Apply initial theme
    const initialTheme = getCurrentTheme();
    applyTheme(initialTheme, false); // Don't persist on init

    // Set up theme toggle button
    setupThemeToggle();

    // Listen for system theme changes
    setupSystemThemeListener();

    console.log('✅ Theme system initialized');
}

/**
 * Set up theme toggle button event listener
 */
function setupThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    if (!themeToggle) {
        console.warn('Theme toggle button not found');
        return;
    }

    themeToggle.addEventListener('click', () => {
        toggleTheme();
    });

    console.log('🎨 Theme toggle button initialized');
}

/**
 * Set up system theme change listener
 */
function setupSystemThemeListener() {
    try {
        const matcher = getMatchMedia();
        const mq = matcher ? matcher('(prefers-color-scheme: dark)') : null;
        if (!mq || (!mq.addEventListener && !mq.addListener)) {
            return;
        }

        const onChange = (e) => {
            const override = localStorage.getItem(THEME_KEY);
            // Only follow system changes if user hasn't explicitly set a preference
            if (!override || override === 'system') {
                applyTheme(e.matches ? 'dark' : 'light', false);
            }
        };

        // Use modern API if available, fallback to deprecated API
        if (mq.addEventListener) {
            mq.addEventListener('change', onChange);
        } else {
            mq.addListener(onChange);
        }

        console.log('🎨 System theme change listener initialized');

    } catch (err) {
        console.warn('Failed to set up system theme listener:', err);
    }
}

/**
 * Reset theme preference to follow system
 */
export function resetToSystemTheme() {
    localStorage.removeItem(THEME_KEY);
    const systemTheme = getSystemPrefersDark() ? 'dark' : 'light';
    applyTheme(systemTheme, false);

    console.log('🎨 Theme reset to system preference:', systemTheme);
}

/**
 * Check if dark mode is currently active
 * @returns {boolean} True if dark mode is active
 */
export function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

registerDebugNamespace('theme', {
    applyTheme,
    toggleTheme,
    getCurrentTheme,
    isDarkMode,
    resetToSystemTheme,
    initializeTheme
}, {
    exposeOnWindow: true,
    windowAliases: [
        'applyTheme',
        'toggleTheme',
        'getCurrentTheme',
        'isDarkMode',
        'resetToSystemTheme'
    ]
});
