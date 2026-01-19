// Reference .quad file loader for Light Blocking mode
// Loads and validates reference .quad files for comparison overlays

import { parseQuadFile } from '../data/quad-parser.js';
import { getCurrentPrinter } from '../core/state.js';

/**
 * Load and validate a reference .quad file
 * @param {File} file - The .quad file to load
 * @returns {Promise<Object>} Result object with success status and data
 */
export async function loadReferenceQuadFile(file) {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.quad')) {
        return {
            success: false,
            error: `Unsupported file type. Expected .quad file, got: ${file.name}`
        };
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
        return {
            success: false,
            error: `File too large: ${(file.size / (1024 * 1024)).toFixed(1)}MB. Maximum supported size is 10MB.`
        };
    }

    // Validate minimum file size
    if (file.size < 100) {
        return {
            success: false,
            error: `File too small: ${file.size} bytes. This doesn't appear to be a valid .quad file.`
        };
    }

    try {
        // Read file content
        const content = await file.text();

        // Validate file has numeric data (at least 256 values for one channel)
        const numericLines = content.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed && /^\d+$/.test(trimmed);
        });
        if (numericLines.length < 256) {
            return {
                success: false,
                error: `File does not appear to be a valid .quad file (found only ${numericLines.length} numeric values, need at least 256).`
            };
        }

        // Parse .quad file
        const parsed = parseQuadFile(content);

        if (!parsed || !parsed.channels || !Array.isArray(parsed.channels)) {
            return {
                success: false,
                error: 'Failed to parse .quad file (invalid format).'
            };
        }

        // Get current printer configuration
        const currentPrinter = getCurrentPrinter();
        const printerChannels = Array.isArray(currentPrinter?.channels) ? currentPrinter.channels : [];

        // Match channels between reference and current printer
        const matchedChannels = printerChannels.filter(ch =>
            Array.isArray(parsed.channels) && parsed.channels.includes(ch)
        );

        if (matchedChannels.length === 0) {
            return {
                success: false,
                error: `Reference file '${file.name}' has no channels in common with the active printer profile.`,
                warning: true
            };
        }

        // Build reference data structure
        const referenceData = {
            filename: file.name,
            channels: parsed.channels.slice(),
            curves: {}
        };

        // Extract curves for matched channels
        matchedChannels.forEach(channelName => {
            const curve = parsed.curves?.[channelName];
            if (Array.isArray(curve)) {
                referenceData.curves[channelName] = curve.slice();
            }
        });

        return {
            success: true,
            filename: file.name,
            data: referenceData,
            matchedCount: matchedChannels.length,
            totalCount: printerChannels.length,
            unmatchedCount: printerChannels.length - matchedChannels.length
        };

    } catch (error) {
        return {
            success: false,
            error: `Failed to load reference file: ${error.message}`
        };
    }
}
