// quadGEN File Operations
// File loading, saving, and download utilities

import { sanitizeFilename } from '../ui/ui-utils.js';
import { PRINTERS, elements } from '../core/state.js';
import { InputValidator } from '../core/validation.js';
import { LinearizationState } from '../data/linearization-utils.js';
import { make256 } from '../core/processing-pipeline.js';
import { APP_DISPLAY_VERSION } from '../core/version.js';
import { CONTRAST_INTENT_PRESETS } from '../core/config.js';

const globalScope = typeof globalThis !== 'undefined' ? globalThis : {};

/**
 * Sample data for testing and examples
 */
export const SAMPLE_DATA = {
    colorMuse: `GRAY\tLAB_L\tLAB_A\tLAB_B
0\t97.15\t0.00\t0.00
5\t97.14\t0.00\t0.00
10\t95.90\t0.00\t0.00
15\t93.30\t0.00\t0.00
20\t90.06\t0.00\t0.00
25\t85.89\t0.00\t0.00
30\t79.22\t0.00\t0.00
35\t71.65\t0.00\t0.00
40\t64.43\t0.00\t0.00
45\t58.21\t0.00\t0.00
50\t52.13\t0.00\t0.00
55\t46.63\t0.00\t0.00
60\t41.83\t0.00\t0.00
65\t38.50\t0.00\t0.00
70\t35.63\t0.00\t0.00
75\t31.53\t0.00\t0.00
80\t29.94\t0.00\t0.00
85\t27.34\t0.00\t0.00
90\t25.15\t0.00\t0.00
95\t22.14\t0.00\t0.00
100\t18.93\t0.00\t0.00`,

    gammaCube: `TITLE "Gamma 2.2 Curve Example"
# Sample 1D LUT with gamma 2.2 curve
LUT_1D_SIZE 16
DOMAIN_MIN 0.0
DOMAIN_MAX 1.0

0.000000
0.033037
0.069675
0.109243
0.152036
0.198312
0.248303
0.302222
0.360259
0.422584
0.489349
0.560691
0.636732
0.717578
0.803322
1.000000`
};

/**
 * Download a file to the user's device
 * @param {string} content - File content
 * @param {string} filename - Filename for download
 * @param {string} mimeType - MIME type (default: text/plain)
 */
export function downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const docContext = globalScope.document || (typeof document !== 'undefined' ? document : null);
    const viewContext = docContext?.defaultView;
    const urlApi = globalScope.URL || viewContext?.URL;

    if (!urlApi?.createObjectURL || !urlApi?.revokeObjectURL) {
        throw new Error('URL API unavailable for downloadFile');
    }

    const url = urlApi.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    urlApi.revokeObjectURL(url);
    document.body.removeChild(a);
}

/**
 * Get preset defaults for intent parameters
 * @param {string} presetId - Preset ID
 * @param {string} param - Parameter name
 * @returns {*} Default value or null
 */
export function getPresetDefaults(presetId, param) {
    const preset = CONTRAST_INTENT_PRESETS[presetId];
    return preset?.params?.[param] || null;
}

/**
 * Generate compact tag to embed contrast intent in filename
 * @returns {string} Intent tag (e.g., "G085", "FILM", "LIN")
 */
export function getIntentFilenameTag() {
    try {
        const contrastIntent = globalScope.contrastIntent || {};
        const id = String(contrastIntent.id || 'linear');

        if (id === 'linear') return 'LIN';

        if (id === 'soft' || id === 'hard' || id === 'custom_gamma') {
            const g = Number(contrastIntent.params?.gamma ?? (getPresetDefaults(id, 'gamma') || 1.00));
            if (!isFinite(g) || g <= 0) return 'G100';
            const val = Math.round(g * 100);
            return `G${String(val).padStart(3, '0')}`; // e.g., 0.85 => G085, 1.20 => G120
        }

        if (id === 'filmic' || id === 'custom_filmic') {
            // Keep very compact; omit params to keep names short
            return 'FILM';
        }

        if (id === 'pops_standard') return 'POPS';
        if (id === 'custom_points') return 'CUST';
        if (id.startsWith('custom')) return 'CUST';

        // Fallback for unknown intent types
        return id.substring(0, 4).toUpperCase();
    } catch (err) {
        return 'LIN';
    }
}

/**
 * Check if any linearization is available (global or per-channel)
 * @returns {boolean} True if linearization data is active
 */
export function hasAnyLinearization() {
    try {
        // Check modular LinearizationState first
        if (LinearizationState?.hasAnyLinearization) {
            return LinearizationState.hasAnyLinearization();
        }

        // Fallback to legacy global variables
        if (globalScope) {
            const hasGlobal = !!(globalScope.linearizationData && globalScope.linearizationApplied);
            const perChannel = globalScope.perChannelLinearization;
            const hasAnyPerEnabled = perChannel &&
                Object.keys(perChannel).some((ch) => globalScope.perChannelEnabled?.[ch]);
            return hasGlobal || hasAnyPerEnabled;
        }

        return false;
    } catch (err) {
        return false;
    }
}

/**
 * Generate automatic filename based on printer and channel configuration
 * Matches legacy system behavior exactly (uses _ separator, CORRECTED suffix, intent tags)
 * @returns {string} Generated filename (without extension)
 */
export function generateFilename() {
    try {
        const printerSelect = elements.printerSelect || document.getElementById('printerSelect');
        if (!printerSelect) return 'untitled';

        const p = PRINTERS[printerSelect.value];
        if (!p) return 'untitled';

        // Extract just the printer model (remove "Epson " prefix)
        const printerModel = p.name.replace(/^Epson\s+/, '').replace(/\s+/g, '');
        let parts = [printerModel]; // Start with printer model

        // Add active channels with their percentages
        const rowsElement = elements.rows || document.getElementById('rows');
        if (rowsElement) {
            Array.from(rowsElement.children).forEach((tr) => {
                // Skip the placeholder row
                if (tr.id === 'noChannelsRow') return;

                const nameElement = tr.querySelector('td span span:nth-child(2)');
                const endInput = tr.querySelector('.end-input');

                if (nameElement && endInput) {
                    const name = nameElement.textContent.trim();
                    const endVal = InputValidator.clampEnd(endInput.value);

                    if (endVal > 0) {
                        const percent = Math.round(InputValidator.computePercentFromEnd(endVal));
                        parts.push(name + percent);
                    }
                }
            });
        }

        // Add CORRECTED suffix if any linearization is applied
        const hasLinearization = hasAnyLinearization();
        if (hasLinearization) {
            const tag = getIntentFilenameTag();
            if (tag) parts.push(tag);
            parts.push('CORRECTED');
        }

        return parts.join('_'); // Use underscore separator like legacy system
    } catch (error) {
        console.warn('Error generating filename:', error);
        return 'untitled';
    }
}

/**
 * Update filename input with current settings (auto-generation)
 * Only updates if user hasn't manually edited the filename
 */
export function updateFilename() {
    try {
        const filenameInput = elements.filenameInput || document.getElementById('filenameInput');
        if (!filenameInput) return;

        if (!filenameInput.dataset.userEdited) {
            filenameInput.value = generateFilename();
            // Trigger validation styling
            filenameInput.dispatchEvent(new Event('input'));
        }
    } catch (error) {
        console.warn('Error updating filename:', error);
    }
}

/**
 * Generate QuadToneRIP .quad file content
 * Ported from legacy buildFile function to use modular state management
 * @returns {string} Quad file content
 */
export function buildQuadFile() {
    const printerSelect = elements.printerSelect;
    if (!printerSelect) {
        throw new Error('Printer not selected');
    }

    const p = PRINTERS[printerSelect.value];
    if (!p) {
        throw new Error('Invalid printer selection');
    }

    const lines = [
        "## QuadToneRIP " + p.channels.join(","),
        "# Printer: " + p.name,
        `# quadGEN ${APP_DISPLAY_VERSION} by David Marsh`
    ];

    // Add user notes if provided
    const userNotes = elements.userNotes?.value?.trim();
    if (userNotes) {
        lines.push("#");
        lines.push("# Notes:");
        // Split notes by lines and add # prefix to each non-empty line
        userNotes.split('\n').forEach(line => {
            const t = line.trim();
            lines.push(t ? ("# " + t) : "#");
        });
    }

    // Add linearization information using modular state
    const hasLinearization = LinearizationState.hasAnyLinearization();
    if (hasLinearization) {
        lines.push("#");
        lines.push("# Linearization Applied:");

        // Global linearization
        const globalData = LinearizationState.getGlobalData();
        if (globalData && LinearizationState.globalApplied) {
            const globalFilename = globalData.filename || "unknown file";
            const globalCount = globalData.samples ? globalData.samples.length : 0;
            lines.push(`# - Global: ${globalFilename} (${globalCount} points, affects all channels)`);
        }

        // Per-channel linearization
        const perChannelList = [];
        p.channels.forEach(channelName => {
            if (LinearizationState.isPerChannelEnabled(channelName)) {
                const data = LinearizationState.getPerChannelData(channelName);
                if (data) {
                    const filename = data.filename || "unknown file";
                    const count = data.samples ? data.samples.length : 0;
                    perChannelList.push(`${channelName}: ${filename} (${count} points)`);
                }
            }
        });

        if (perChannelList.length > 0) {
            lines.push("# - Per-channel:");
            perChannelList.forEach(item => {
                lines.push(`#   ${item}`);
            });
        }
    }

    // Add limits summary
    lines.push("#");
    lines.push(...buildLimitsSummary());

    // Build channel blocks
    p.channels.forEach((ch, idx) => {
        const row = elements.rows.children[idx];
        if (!row || row.id === 'noChannelsRow') return;

        const endInput = row.querySelector('.end-input');
        const e = InputValidator.clampEnd(endInput ? endInput.value : 0);
        const arr = make256(e, ch, true); // Apply linearization if enabled
        lines.push("# " + ch + " curve");
        lines.push(...arr.map(String));
    });

    return lines.join("\n") + "\n";
}

/**
 * Helper function to build limits summary
 * @returns {Array<string>} Array of limit summary lines
 */
function buildLimitsSummary() {
    const lines = ["# Limits summary:"];

    Array.from(elements.rows.children).forEach((tr) => {
        // Skip the placeholder row
        if (tr.id === 'noChannelsRow') return;

        const nameElement = tr.querySelector('td span span:nth-child(2)');
        const endInput = tr.querySelector('.end-input');

        if (nameElement && endInput) {
            const name = nameElement.textContent.trim();
            const e = InputValidator.clampEnd(endInput.value);
            const p = InputValidator.computePercentFromEnd(e);

            if (e === 0) {
                lines.push("#   " + name + ": disabled");
            } else {
                const isWhole = Math.abs(p - Math.round(p)) < 1e-9;
                const percentFormatted = isWhole ? String(Math.round(p)) : p.toFixed(2);
                lines.push("#   " + name + ": = " + percentFormatted + "%");
            }
        }
    });

    return lines;
}

/**
 * Generate and download a .quad file
 * @returns {Object} Result with success status and message
 */
export function generateAndDownloadQuadFile() {
    try {
        // Generate the .quad file content
        const quadContent = buildQuadFile();

        if (!quadContent || quadContent.length === 0) {
            return {
                success: false,
                message: 'Failed to generate .quad file content. Check that channels are properly configured.'
            };
        }

        // Get the filename
        const filenameInput = elements.filenameInput || document.getElementById('filenameInput');
        let filename;
        const customName = filenameInput ? filenameInput.value.trim() : '';

        if (customName) {
            // Remove .quad extension if user added it, then sanitize
            const cleanName = customName.replace(/\.quad$/, '');
            filename = `${sanitizeFilename(cleanName)}.quad`;
        } else {
            // Use auto-generated filename
            filename = `${generateFilename()}.quad`;
        }

        // Download the file
        downloadFile(quadContent, filename, 'text/plain');

        return {
            success: true,
            message: `Successfully generated and downloaded ${filename}`
        };

    } catch (error) {
        console.error('Error generating quad file:', error);
        return {
            success: false,
            message: `Error generating .quad file: ${error.message}`
        };
    }
}

/**
 * Download sample LAB data file
 */
export function downloadSampleLabData() {
    downloadFile(SAMPLE_DATA.colorMuse, 'LAB-Data-sample.txt', 'text/plain');
}

/**
 * Download sample .cube LUT file
 */
export function downloadSampleCubeFile() {
    downloadFile(SAMPLE_DATA.gammaCube, 'LUT_sample.cube', 'text/plain');
}

/**
 * Read file as text using FileReader
 * @param {File} file - File object to read
 * @returns {Promise<string>} File content as text
 */
export function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            resolve(event.target.result);
        };

        reader.onerror = (error) => {
            reject(new Error(`Failed to read file: ${error.message}`));
        };

        reader.readAsText(file);
    });
}

/**
 * Validate file size and type
 * @param {File} file - File to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
export function validateFile(file, options = {}) {
    const {
        maxSize = 10 * 1024 * 1024, // 10MB default
        allowedExtensions = ['.quad', '.cube', '.txt', '.acv', '.ti3', '.lab'],
        minSize = 1
    } = options;

    // Check file size
    if (file.size > maxSize) {
        return {
            valid: false,
            message: `File too large: ${(file.size / (1024*1024)).toFixed(1)}MB. Maximum allowed: ${(maxSize / (1024*1024)).toFixed(1)}MB.`
        };
    }

    if (file.size < minSize) {
        return {
            valid: false,
            message: `File too small: ${file.size} bytes. This doesn't appear to be a valid file.`
        };
    }

    // Check file extension
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (extension && !allowedExtensions.includes(extension)) {
        return {
            valid: false,
            message: `Unsupported file type: ${extension}. Allowed types: ${allowedExtensions.join(', ')}`
        };
    }

    return {
        valid: true,
        message: 'File validation passed'
    };
}

/**
 * Handle file input change event
 * @param {Event} event - File input change event
 * @param {Function} callback - Callback function to handle file content
 * @param {Object} options - Options for file validation
 */
export async function handleFileInput(event, callback, options = {}) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    try {
        // Validate file
        const validation = validateFile(file, options);
        if (!validation.valid) {
            throw new Error(validation.message);
        }

        // Read file content
        const content = await readFileAsText(file);

        // Call callback with file data
        if (typeof callback === 'function') {
            await callback({
                file: file,
                content: content,
                filename: file.name,
                size: file.size
            });
        }

    } catch (error) {
        console.error('Error handling file input:', error);
        throw error;
    }
}
