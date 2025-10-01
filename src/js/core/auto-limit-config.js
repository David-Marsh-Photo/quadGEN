// Auto Endpoint Rolloff Configuration
// Configuration system for auto white/black limit detection and application

import { registerDebugNamespace } from '../utils/debug-registry.js';
import { registerLegacyHelpers, getLegacyScope } from '../legacy/legacy-helpers.js';

/**
 * Default configuration values for auto limit processing
 */
export const AUTO_LIMIT_DEFAULTS = Object.freeze({
    limitProximityPct: 3,           // % of endValue for proximity threshold
    slopeAbsolutePct: 0.45,         // % threshold for slope collapse detection
    sustainSamples: 3,              // Number of samples for sustained low slope
    minWidthPct: 8,                 // Minimum knee width as % of curve
    blackShoulderScanStartPct: 80,  // Where to start scanning for black limit (high input)
    whiteToeScanEndPct: 22,         // Where to end scanning for white limit (low input)
    fallbackPlateauPct: 3           // Fallback plateau requirement as % of curve
});

/**
 * Configuration class for auto limit processing
 */
export class AutoLimitConfig {
    constructor() {
        this.overrides = null;
    }

    /**
     * Get default value for a configuration key
     * @param {string} key - Configuration key
     * @returns {number} Default value
     */
    getDefault(key) {
        return AUTO_LIMIT_DEFAULTS[key];
    }

    /**
     * Get configuration value, applying overrides if set
     * @param {string} key - Configuration key
     * @returns {number} Configuration value
     */
    getNumber(key) {
        if (this.overrides && this.overrides.hasOwnProperty(key)) {
            const override = this.overrides[key];
            if (typeof override === 'number' && Number.isFinite(override)) {
                return override;
            }
        }
        return this.getDefault(key);
    }

    /**
     * Set configuration overrides
     * @param {Object} overrides - Override values
     */
    setOverrides(overrides) {
        if (!overrides || typeof overrides !== 'object') {
            this.overrides = null;
            return;
        }

        const sanitized = {};
        const clampPercent = (value, min, max) => Math.max(min, Math.min(max, value));

        Object.keys(overrides).forEach(key => {
            const rawValue = overrides[key];
            if (rawValue === undefined || rawValue === null || rawValue === '') return;

            let num = Number(rawValue);
            if (!Number.isFinite(num)) return;

            switch (key) {
                case 'limitProximityPct':
                    num = clampPercent(num, 0.5, 20);
                    break;
                case 'slopeAbsolutePct':
                    num = clampPercent(num, 0.01, 20);
                    break;
                case 'sustainSamples':
                    num = Math.round(Math.min(64, Math.max(1, num)));
                    break;
                case 'minWidthPct':
                    num = clampPercent(num, 1, 50);
                    break;
                case 'blackShoulderScanStartPct':
                    num = clampPercent(num, 50, 95);
                    break;
                case 'whiteToeScanEndPct':
                    num = clampPercent(num, 5, 50);
                    break;
                case 'fallbackPlateauPct':
                    num = clampPercent(num, 1, 20);
                    break;
                default:
                    return; // Skip unknown keys
            }
            sanitized[key] = num;
        });

        this.overrides = Object.keys(sanitized).length > 0 ? sanitized : null;
    }

    /**
     * Clear configuration overrides
     */
    clearOverrides() {
        this.overrides = null;
    }
}

// Create singleton instance
export const AUTO_LIMIT_CONFIG = new AutoLimitConfig();
const legacyScope = getLegacyScope();
legacyScope.AUTO_LIMIT_CONFIG = AUTO_LIMIT_CONFIG;
registerLegacyHelpers({ AUTO_LIMIT_CONFIG });

registerDebugNamespace('autoLimitConfig', {
    AUTO_LIMIT_CONFIG,
    AUTO_LIMIT_DEFAULTS
}, {
    exposeOnWindow: typeof window !== 'undefined',
    windowAliases: ['AUTO_LIMIT_CONFIG']
});
