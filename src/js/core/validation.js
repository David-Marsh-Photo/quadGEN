// quadGEN Input Validation
// Input validation and data clamping utilities

import { TOTAL } from './state.js';

/**
 * Input validation class for quadGEN
 * Handles percentage and end value validation with UI feedback
 */
export class InputValidator {
    /**
     * Clamp percentage value to valid range (0-100)
     * @param {*} p - Percentage value to clamp
     * @returns {number} Clamped percentage
     */
    static clampPercent(p) {
        const num = parseFloat(p);
        return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
    }

    /**
     * Clamp end value to valid range (0-65535)
     * @param {*} e - End value to clamp
     * @returns {number} Clamped end value
     */
    static clampEnd(e) {
        const num = parseInt(e);
        return isNaN(num) ? 0 : Math.min(TOTAL, Math.max(0, num));
    }

    /**
     * Convert percentage to end value
     * @param {number} p - Percentage (0-100)
     * @returns {number} End value (0-65535)
     */
    static computeEndFromPercent(p) {
        return Math.round((TOTAL * p) / 100);
    }

    /**
     * Convert end value to percentage
     * @param {number} e - End value (0-65535)
     * @returns {number} Percentage (0-100)
     */
    static computePercentFromEnd(e) {
        return (e / TOTAL) * 100;
    }

    /**
     * Validate input element and apply visual feedback
     * @param {HTMLInputElement} input - Input element to validate
     * @param {Function} validator - Validation function to apply
     * @returns {number} Validated value
     */
    static validateInput(input, validator) {
        const originalValue = input.value;
        const validatedValue = validator(originalValue);
        const isValid = validatedValue.toString() === originalValue ||
                       Math.abs(parseFloat(originalValue) - validatedValue) < 0.01;

        // Apply visual feedback
        input.classList.toggle('border-red-300', !isValid);
        input.classList.toggle('border-gray-300', isValid);

        if (!isValid) {
            input.value = validatedValue.toString();
        }

        return validatedValue;
    }

    /**
     * Validate percentage input element
     * @param {HTMLInputElement} input - Percentage input element
     * @returns {number} Validated percentage value
     */
    static validatePercentInput(input) {
        return InputValidator.validateInput(input, InputValidator.clampPercent);
    }

    /**
     * Validate end value input element
     * @param {HTMLInputElement} input - End value input element
     * @returns {number} Validated end value
     */
    static validateEndInput(input) {
        return InputValidator.validateInput(input, InputValidator.clampEnd);
    }

    /**
     * Clear validation styling from input element
     * @param {HTMLInputElement} input - Input element to clear styling from
     */
    static clearValidationStyling(input) {
        input.classList.remove('border-red-300');
        input.classList.add('border-gray-300');
    }

    /**
     * Validate numeric range
     * @param {*} value - Value to validate
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {number} defaultValue - Default value if invalid
     * @returns {number} Validated value
     */
    static validateRange(value, min, max, defaultValue = 0) {
        const num = parseFloat(value);
        if (isNaN(num)) return defaultValue;
        return Math.min(max, Math.max(min, num));
    }

    /**
     * Validate integer value
     * @param {*} value - Value to validate
     * @param {number} defaultValue - Default value if invalid
     * @returns {number} Validated integer
     */
    static validateInteger(value, defaultValue = 0) {
        const num = parseInt(value);
        return isNaN(num) ? defaultValue : num;
    }

    /**
     * Validate positive number
     * @param {*} value - Value to validate
     * @param {number} defaultValue - Default value if invalid
     * @returns {number} Validated positive number
     */
    static validatePositive(value, defaultValue = 0) {
        const num = parseFloat(value);
        return isNaN(num) || num < 0 ? defaultValue : num;
    }
}

/**
 * Export singleton instance for backward compatibility
 */
export default InputValidator;