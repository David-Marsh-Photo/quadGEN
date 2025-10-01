// quadGEN UI Utilities
// Common utility functions extracted from the monolithic codebase

import { getViewportSize } from '../utils/browser-env.js';

/**
 * Debounce function to prevent excessive updates
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Alternative, more compact debounce implementation
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Wait time in milliseconds (default: 200)
 * @returns {Function} Debounced function
 */
export function debounceCompact(fn, wait = 200) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

/**
 * Format scale percentage for display
 * @param {number} value - Percentage value to format
 * @returns {string} Formatted percentage string
 */
export function formatScalePercent(value) {
    if (!Number.isFinite(value)) return '100';
    const rounded = Math.round(value * 100) / 100;
    return Math.abs(rounded - Math.round(rounded)) < 0.005
        ? String(Math.round(rounded))
        : rounded.toFixed(2);
}

/**
 * Sanitize filename for cross-platform compatibility
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(filename) {
    // Remove or replace invalid characters for Windows and Mac
    // Invalid: \ / : * ? " < > |
    return filename
        .replace(/[\\/:*?"<>|]/g, '_')  // Replace invalid chars with underscore
        .replace(/\s+/g, '_')          // Replace spaces with underscores
        .replace(/_{2,}/g, '_')        // Replace multiple underscores with single
        .replace(/^_+|_+$/g, '')       // Trim underscores from start/end
        .substring(0, 200);            // Limit length to 200 chars
}

// Note: clamp01 is available from math/interpolation.js

/**
 * Clamp a percentage value between 0 and 100
 * @param {number} percent - Percentage to clamp
 * @returns {number} Clamped percentage between 0 and 100
 */
export function clampPercent(percent) {
    return Math.max(0, Math.min(100, Number(percent) || 0));
}

/**
 * Check if a value is a valid finite number
 * @param {*} value - Value to check
 * @returns {boolean} True if value is a valid finite number
 */
export function isValidNumber(value) {
    return Number.isFinite(value) && !isNaN(value);
}

/**
 * Safe number parsing with fallback
 * @param {*} value - Value to parse
 * @param {number} fallback - Fallback value if parsing fails
 * @returns {number} Parsed number or fallback
 */
export function safeParseNumber(value, fallback = 0) {
    const parsed = Number(value);
    return isValidNumber(parsed) ? parsed : fallback;
}

/**
 * Format a number to a specific number of decimal places
 * @param {number} value - Number to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted number string
 */
export function formatNumber(value, decimals = 2) {
    if (!isValidNumber(value)) return '0';
    return value.toFixed(decimals);
}

/**
 * Throttle function to limit function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Deep clone an object (simple implementation for basic objects)
 * @param {*} obj - Object to clone
 * @returns {*} Cloned object
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (Array.isArray(obj)) return obj.map(item => deepClone(item));

    const cloned = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
}

/**
 * Generate a unique ID string
 * @param {string} prefix - Optional prefix for the ID
 * @returns {string} Unique ID string
 */
export function generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if element is visible in viewport
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element is visible
 */
export function isElementVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') return false;
    const rect = element.getBoundingClientRect();
    const { width: viewportWidth, height: viewportHeight } = getViewportSize();

    return rect.top >= 0 && rect.left >= 0 &&
           rect.bottom <= viewportHeight &&
           rect.right <= viewportWidth;
}

/**
 * Get CSS custom property value
 * @param {string} propertyName - CSS custom property name (with or without --)
 * @param {HTMLElement} element - Element to query (default: document.documentElement)
 * @returns {string} CSS property value
 */
export function getCSSCustomProperty(propertyName, element = document.documentElement) {
    const prop = propertyName.startsWith('--') ? propertyName : `--${propertyName}`;
    return getComputedStyle(element).getPropertyValue(prop).trim();
}

/**
 * Set CSS custom property value
 * @param {string} propertyName - CSS custom property name (with or without --)
 * @param {string} value - Value to set
 * @param {HTMLElement} element - Element to set property on (default: document.documentElement)
 */
export function setCSSCustomProperty(propertyName, value, element = document.documentElement) {
    const prop = propertyName.startsWith('--') ? propertyName : `--${propertyName}`;
    element.style.setProperty(prop, value);
}
