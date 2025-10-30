// quadGEN File Format Parsers
// Parsers for .quad, .acv, .cube, CGATS, and other supported file formats

import { CURVE_RESOLUTION } from '../data/processing-utils.js';
import { DataSpace } from '../data/processing-utils.js';
import { anchorSamplesToUnitRange } from '../data/linearization-utils.js';
import { isCubeEndpointAnchoringEnabled } from '../core/feature-flags.js';
import {
    parseLabData,
    parseCgatsNumber,
    cieDensityFromLstar,
    lstarToY_CIE,
    log10_safe,
    applyDefaultLabSmoothingToEntry,
    rebuildLabSamplesFromOriginal
} from '../data/lab-parser.js';
import { parseCGATS17 } from '../data/cgats-parser.js';
import { createPCHIPSpline, clamp01 } from '../math/interpolation.js';
import { registerDebugNamespace } from '../utils/debug-registry.js';
import {
    getLabNormalizationMode,
    getLabSmoothingPercent,
    mapSmoothingPercentToWiden
} from '../core/lab-settings.js';

export {
    parseLabData,
    parseCgatsNumber,
    cieDensityFromLstar,
    lstarToY_CIE,
    log10_safe,
    parseCGATS17
};

/**
 * Parse QuadToneRIP .quad file content
 * @param {string} content - File content
 * @returns {Object} Parsed quad data
 */
export function parseQuadFile(content) {
    try {
        console.log('📄 parseQuadFile: parsing real .quad file data');

        const lines = content.split('\n').map(line => line.trim());

        // Look for the QuadToneRIP header line to extract channel names
        let channels = [];
        let dataStartIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // Look for QuadToneRIP header: ## QuadToneRIP K,C,M,Y,LC,LM,LK,LLK
            if (line.startsWith('## QuadToneRIP ')) {
                const channelPart = line.substring('## QuadToneRIP '.length);
                channels = channelPart.split(',').map(ch => ch.trim());
                continue;
            }

            // Find where numeric data starts (first line that starts with a digit)
            if (dataStartIndex === -1 && line && line.match(/^\d/)) {
                dataStartIndex = i;
                break;
            }
        }

        if (channels.length === 0) {
            throw new Error('Could not find QuadToneRIP header with channel names in .quad file');
        }

        if (dataStartIndex === -1) {
            throw new Error('Could not find numeric data in .quad file');
        }

        // Parse the actual numeric data portion
        // Skip to where numeric data starts and collect all numeric lines
        const numericLines = [];
        let invalidDataLines = [];

        for (let i = dataStartIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                if (/^\d+$/.test(line)) {
                    const value = parseInt(line, 10);

                    // Validate reasonable value range for QuadToneRIP (0-65535)
                    if (value < 0 || value > 65535) {
                        throw new Error(`Invalid data value ${value} at line ${i + 1}. QuadToneRIP values must be 0-65535.`);
                    }

                    numericLines.push(value);
                } else if (!line.startsWith('#')) {
                    // Track non-numeric, non-comment lines as potentially problematic
                    invalidDataLines.push(`Line ${i + 1}: "${line}"`);
                    if (invalidDataLines.length > 10) break; // Don't flood with errors
                }
            }
        }

        // Warn about mixed content if found
        if (invalidDataLines.length > 0) {
            const sampleLines = invalidDataLines.slice(0, 3).join(', ');
            console.warn(`Found ${invalidDataLines.length} non-numeric lines in data section: ${sampleLines}`);
        }

        // Each channel should have exactly 256 data points
        const expectedDataPoints = channels.length * 256;
        if (numericLines.length < expectedDataPoints) {
            throw new Error(`Insufficient data: found ${numericLines.length} values, expected ${expectedDataPoints} (${channels.length} channels × 256 points each)`);
        }

        // Extract all 256 data points for each channel
        const channelCurves = {};
        const values = []; // Final values for UI display
        const baselineEnd = {};

        for (let channelIdx = 0; channelIdx < channels.length; channelIdx++) {
            const channelName = channels[channelIdx];
            const channelStartIdx = channelIdx * 256;
            const channelEndIdx = channelStartIdx + 255; // 0-indexed, so 255 is the 256th value

            if (channelEndIdx >= numericLines.length) {
                throw new Error(`Not enough data for channel ${channelName}: need point ${channelEndIdx + 1}, have ${numericLines.length}`);
            }

            // Extract all 256 points for this channel
            const curveData = numericLines.slice(channelStartIdx, channelStartIdx + 256);
            channelCurves[channelName] = curveData;

            // Store the maximum value for UI display (percentage calculation) and baseline
            const maxValue = Math.max(...curveData);
            values.push(maxValue);
            baselineEnd[channelName] = maxValue;
        }

        console.log(`📄 parseQuadFile: successfully parsed ${channels.length} channels with ${numericLines.length} data points`);

        return {
            curves: channelCurves,
            baselineEnd,
            channels,
            values,
            filename: 'loaded.quad',
            valid: true
        };

    } catch (error) {
        console.error('Error parsing .quad file:', error);
        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Parse Photoshop ACV (curve) file
 * @param {ArrayBuffer} arrayBuffer - File buffer
 * @param {string} filename - Original filename
 * @returns {Object} Parsed curve data
 */
export function parseACVFile(arrayBuffer, filename = 'curve.acv') {
    try {
        console.log('📈 parseACVFile: parsing real ACV file data');

        const view = new DataView(arrayBuffer);

        // Minimum ACV file structure: version(2) + totalCurves(2) + pointCount(2) = 6 bytes minimum
        if (arrayBuffer.byteLength < 6) {
            throw new Error('Invalid ACV file - too small (minimum 6 bytes required)');
        }

        // Read ACV header (big-endian 16-bit integers)
        const version = view.getUint16(0, false); // false = big-endian
        const totalCurves = view.getUint16(2, false);

        if (totalCurves === 0) {
            throw new Error('Invalid ACV file - no curves found');
        }

        // Read the first curve only (RGB composite curve)
        let offset = 4;
        const pointCount = view.getUint16(offset, false);
        offset += 2;

        if (pointCount === 0) {
            throw new Error('Invalid ACV file - first curve has no points');
        }

        // Verify we have enough data for all points
        const expectedBytes = offset + (pointCount * 4); // 4 bytes per point (2 for output, 2 for input)
        if (arrayBuffer.byteLength < expectedBytes) {
            throw new Error(`ACV file truncated - expected ${expectedBytes} bytes, got ${arrayBuffer.byteLength}`);
        }

        // Read curve points: (output, input) pairs in Photoshop's 0-255 range
        const rawPoints = [];
        for (let i = 0; i < pointCount; i++) {
            const output = view.getUint16(offset, false);
            const input = view.getUint16(offset + 2, false);

            // Normalize to 0-1 range
            rawPoints.push({
                input: input / 255.0,
                output: output / 255.0
            });

            offset += 4;
        }

        // Sort points by input for monotonic interpolation
        rawPoints.sort((a, b) => a.input - b.input);

        // Extract sorted arrays for PCHIP interpolation
        const inputValues = rawPoints.map(p => p.input);
        const outputValues = rawPoints.map(p => p.output);

        // Create PCHIP spline for smooth, monotonic interpolation
        const spline = createPCHIPSpline(inputValues, outputValues);

        // Sample the spline at 256 evenly-spaced points
        const samples = new Array(256);
        for (let i = 0; i < 256; i++) {
            const t = i / 255.0; // 0 to 1
            let value = spline(t);

            // Apply printer-space orientation transform (per ACV spec):
            // 1. Horizontal flip: reverse input coordinate
            // 2. Vertical inversion: invert output value
            const flippedInput = 1 - t;
            const transformedValue = 1 - spline(flippedInput);

            // Clamp to [0,1] and store
            samples[i] = Math.max(0, Math.min(1, transformedValue));
        }

        // Create controlPointsTransformed from raw ACV anchor points
        // Transform to printer space (flip + invert) and scale to 0-100 range
        const controlPointsTransformed = rawPoints.map(point => ({
            input: (1 - point.input) * 100,   // Horizontal flip and scale to 0-100%
            output: (1 - point.output) * 100  // Vertical inversion and scale to 0-100%
        }));

        console.log(`📈 parseACVFile: successfully parsed ${pointCount} points from ${filename}`);

        return {
            valid: true,
            format: 'ACV',
            filename,
            samples,
            originalSamples: samples.slice(),
            rawSamples: samples.slice(),
            controlPointsTransformed,
            sourceSpace: DataSpace.SPACE.PRINTER,
            domainMin: 0,
            domainMax: 1,
            interpolationType: 'pchip',
            conversionMeta: {
                version,
                totalCurves,
                pointCount,
                printerSpaceOriented: true
            }
        };

    } catch (error) {
        console.error('Error parsing ACV file:', error);
        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Parse 1D CUBE LUT file
 * @param {string} cubeText - CUBE file content
 * @returns {Object} Parsed LUT data
 */
export function parseCube1D(cubeText, filename = 'lut.cube') {
    try {
        const lines = cubeText.split(/\r?\n/);
        let domainMin = 0.0;
        let domainMax = 1.0;
        let declaredSize = null;
        const samples = [];

        // Early detection: route mislabeled 3D LUTs to the 3D parser
        for (const raw of lines) {
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('#') || /^TITLE/i.test(trimmed)) continue;
            if (/^LUT_3D_SIZE/i.test(trimmed)) {
                return parseCube3D(cubeText);
            }
        }

        for (const raw of lines) {
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('#') || /^TITLE/i.test(trimmed)) continue;

            if (/^LUT_1D_SIZE/i.test(trimmed)) {
                const match = trimmed.match(/LUT_1D_SIZE\s+(\d+)/i);
                if (match) declaredSize = parseInt(match[1], 10);
                continue;
            }

            if (/^DOMAIN_MIN/i.test(trimmed)) {
                const parts = trimmed.split(/\s+/);
                if (parts[1] !== undefined) domainMin = parseFloat(parts[1]);
                continue;
            }

            if (/^DOMAIN_MAX/i.test(trimmed)) {
                const parts = trimmed.split(/\s+/);
                if (parts[1] !== undefined) domainMax = parseFloat(parts[1]);
                continue;
            }

            const numbers = trimmed
                .split(/\s+/)
                .map(val => parseFloat(val))
                .filter(val => Number.isFinite(val));

            if (numbers.length >= 1 && numbers.length <= 3) {
                samples.push(numbers[0]);
            }
        }

        const SAMPLE_LIMIT = 256;
        if (declaredSize == null && samples.length > SAMPLE_LIMIT) {
            throw new Error(`1D LUT lists ${samples.length} samples without LUT_1D_SIZE; limit is ${SAMPLE_LIMIT}.`);
        }

        if (declaredSize !== null && samples.length >= declaredSize) {
            samples.length = declaredSize;
        }

        if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMin === domainMax) {
            domainMin = 0.0;
            domainMax = 1.0;
        }

        if (!samples.length) {
            throw new Error('No 1D LUT samples found.');
        }

        const converted = DataSpace.convertSamples(samples, {
            from: DataSpace.SPACE.IMAGE,
            to: DataSpace.SPACE.PRINTER,
            metadata: { filename }
        });

        const normalizedSamples = converted.values.map(value => clamp01(Number(value) || 0));
        const processedSamples = isCubeEndpointAnchoringEnabled()
            ? anchorSamplesToUnitRange(normalizedSamples)
            : normalizedSamples;

        if (typeof DEBUG_LOGS !== 'undefined' && DEBUG_LOGS) {
            console.log('[mod] parseCube1D', {
                filename,
                declaredSize,
                sampleCount: samples.length,
                domainMin,
                domainMax
            });
        }

        return {
            valid: true,
            format: '1D LUT',
            filename,
            lutSize: declaredSize || samples.length,
            samples: processedSamples,
            originalSamples: processedSamples.slice(),
            rawSamples: converted.values.slice(),
            sourceSpace: converted.sourceSpace,
            conversionMeta: converted.meta,
            domainMin,
            domainMax,
            interpolationType: 'pchip'
        };

    } catch (error) {
        console.error('Error parsing 1D CUBE file:', error);
        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Parse 3D CUBE LUT file and extract neutral axis
 * @param {string} cubeText - CUBE file content
 * @returns {Object} Parsed LUT data with neutral axis
 */
export function parseCube3D(cubeText, filename = 'lut3d.cube') {
    try {
        const lines = cubeText.split(/\r?\n/);
        let domainMin = 0.0;
        let domainMax = 1.0;
        let lutSize = null;
        const lutData = [];

        for (const raw of lines) {
            const line = raw.trim();
            if (!line || line.startsWith('#') || /^TITLE/i.test(line)) continue;

            if (/^LUT_3D_SIZE/i.test(line)) {
                const match = line.match(/LUT_3D_SIZE\s+(\d+)/i);
                if (match) lutSize = parseInt(match[1], 10);
                continue;
            }

            if (/^DOMAIN_MIN/i.test(line)) {
                const parts = line.split(/\s+/);
                if (parts[1] !== undefined) domainMin = parseFloat(parts[1]);
                continue;
            }

            if (/^DOMAIN_MAX/i.test(line)) {
                const parts = line.split(/\s+/);
                if (parts[1] !== undefined) domainMax = parseFloat(parts[1]);
                continue;
            }

            const parts = line.split(/\s+/);
            if (parts.length === 3) {
                const r = parseFloat(parts[0]);
                const g = parseFloat(parts[1]);
                const b = parseFloat(parts[2]);
                if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                    lutData.push([r, g, b]);
                }
            }
        }

        if (!lutSize) {
            throw new Error('3D LUT size not found. Expected LUT_3D_SIZE declaration.');
        }

        const expectedPoints = lutSize * lutSize * lutSize;
        if (lutData.length !== expectedPoints) {
            throw new Error(`3D LUT data mismatch. Expected ${expectedPoints} points, found ${lutData.length}.`);
        }

        const outputSteps = 256;
        const neutralAxisSamples = new Array(outputSteps);
        const domainSpan = Math.abs(domainMax - domainMin) > 1e-9 ? (domainMax - domainMin) : 1;

        for (let i = 0; i < outputSteps; i++) {
            const input = i / (outputSteps - 1);
            const rgb = [input, input, input];
            const out = trilinearInterpolate3D(rgb, lutData, lutSize, domainMin, domainSpan);
            neutralAxisSamples[i] = (out[0] + out[1] + out[2]) / 3;
        }

        const converted = DataSpace.convertSamples(neutralAxisSamples, {
            from: DataSpace.SPACE.IMAGE,
            to: DataSpace.SPACE.PRINTER,
            metadata: { lutSize }
        });

        const anchoredSamples = anchorSamplesToUnitRange(converted.values.map(value => Number(value) || 0));

        return {
            valid: true,
            format: '3D LUT',
            filename,
            lutSize,
            samples: anchoredSamples,
            originalSamples: anchoredSamples.slice(),
            rawSamples: converted.values.slice(),
            sourceSpace: converted.sourceSpace,
            conversionMeta: converted.meta,
            domainMin,
            domainMax,
            is3DLUT: true,
            interpolationType: 'pchip'
        };

    } catch (error) {
        console.error('Error parsing 3D CUBE file:', error);
        return {
            valid: false,
            error: error.message
        };
    }
}

function trilinearInterpolate3D(inputRGB, lutData, lutSize, domainMin, domainSpan) {
    const [r, g, b] = inputRGB;

    const normalizedR = Math.max(0, Math.min(1, (r - domainMin) / domainSpan));
    const normalizedG = Math.max(0, Math.min(1, (g - domainMin) / domainSpan));
    const normalizedB = Math.max(0, Math.min(1, (b - domainMin) / domainSpan));

    const lutR = normalizedR * (lutSize - 1);
    const lutG = normalizedG * (lutSize - 1);
    const lutB = normalizedB * (lutSize - 1);

    const r0 = Math.floor(lutR), r1 = Math.min(lutSize - 1, r0 + 1);
    const g0 = Math.floor(lutG), g1 = Math.min(lutSize - 1, g0 + 1);
    const b0 = Math.floor(lutB), b1 = Math.min(lutSize - 1, b0 + 1);

    const fr = lutR - r0;
    const fg = lutG - g0;
    const fb = lutB - b0;

    const idx = (rr, gg, bb) => rr * lutSize * lutSize + gg * lutSize + bb;

    const corners = [
        lutData[idx(r0, g0, b0)],
        lutData[idx(r1, g0, b0)],
        lutData[idx(r0, g1, b0)],
        lutData[idx(r1, g1, b0)],
        lutData[idx(r0, g0, b1)],
        lutData[idx(r1, g0, b1)],
        lutData[idx(r0, g1, b1)],
        lutData[idx(r1, g1, b1)]
    ];

    const result = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
        const c00 = corners[0][c] * (1 - fr) + corners[1][c] * fr;
        const c01 = corners[2][c] * (1 - fr) + corners[3][c] * fr;
        const c10 = corners[4][c] * (1 - fr) + corners[5][c] * fr;
        const c11 = corners[6][c] * (1 - fr) + corners[7][c] * fr;

        const c0 = c00 * (1 - fg) + c01 * fg;
        const c1 = c10 * (1 - fg) + c11 * fg;

        result[c] = c0 * (1 - fb) + c1 * fb;
    }

    return result;
}

/**
 * Main linearization file parser - routes to appropriate parser
 * @param {string|File} fileContentOrFile - File content or File object
 * @param {string} filename - Original filename
 * @returns {Promise<Object>} Parsed linearization data
 */
export async function parseLinearizationFile(fileContentOrFile, filename) {
    try {
        let content;
        let arrayBuffer;
        let finalFilename = filename;

        if (fileContentOrFile instanceof File) {
            finalFilename = finalFilename || fileContentOrFile.name;

            // Route based on file extension first to handle binary files
            const ext = finalFilename ? finalFilename.toLowerCase().split('.').pop() : '';

            if (ext === 'acv') {
                // ACV files are binary - read as ArrayBuffer
                arrayBuffer = await fileContentOrFile.arrayBuffer();
                return parseACVFile(arrayBuffer, finalFilename);
            } else {
                // Text files - read as text
                content = await fileContentOrFile.text();
            }
        } else if (fileContentOrFile instanceof ArrayBuffer) {
            arrayBuffer = fileContentOrFile;
        } else if (ArrayBuffer.isView(fileContentOrFile)) {
            const view = fileContentOrFile;
            arrayBuffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
        } else if (fileContentOrFile && typeof fileContentOrFile.arrayBuffer === 'function') {
            // Handle Blob-like inputs supplied by tests or other consumers
            arrayBuffer = await fileContentOrFile.arrayBuffer();
        } else if (typeof fileContentOrFile === 'string') {
            content = fileContentOrFile;
        } else {
            // Fall back to string coercion for unexpected inputs
            content = fileContentOrFile != null ? String(fileContentOrFile) : '';
        }

        // Route based on content or file extension for text files
        const ext = finalFilename ? finalFilename.toLowerCase().split('.').pop() : '';

        if (!arrayBuffer && typeof content !== 'string' && content != null) {
            // Some callers may pass number arrays; coerce to string before inspection
            content = Array.isArray(content) ? content.join('\n') : String(content);
        }

        if (arrayBuffer && ext === 'acv') {
            return parseACVFile(arrayBuffer, finalFilename);
        }

        if (!content && arrayBuffer) {
            const decoder = typeof TextDecoder !== 'undefined'
                ? new TextDecoder('utf-8', { fatal: false })
                : null;
            if (!decoder) {
                throw new Error('TextDecoder is not available to decode linearization file');
            }
            content = decoder.decode(new Uint8Array(arrayBuffer));
        }

        const textContent = typeof content === 'string' ? content : '';
        const normalizationMode = getLabNormalizationMode();

        if (ext === 'ti3' || textContent.includes('CGATS') || textContent.includes('BEGIN_DATA')) {
            const parsed = parseCGATS17(textContent, finalFilename, { normalizationMode });
            return applyDefaultLabSmoothingToEntry(parsed, { normalizationMode });
        } else if (ext === 'txt' || ext === 'lab') {
            const parsed = parseLabData(textContent, finalFilename, { normalizationMode });
            return applyDefaultLabSmoothingToEntry(parsed, { normalizationMode });
        } else if (ext === 'cube') {
            // Determine if 1D or 3D CUBE
            if (textContent.includes('LUT_1D_SIZE')) {
                return parseCube1D(textContent, finalFilename);
            } else {
                return parseCube3D(textContent, finalFilename);
            }
        } else {
            // Default to LAB format
            const parsed = parseLabData(textContent, finalFilename, { normalizationMode });
            return applyDefaultLabSmoothingToEntry(parsed, { normalizationMode });
        }

    } catch (error) {
        console.error('Error in parseLinearizationFile:', error);
        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Parse manual L* data from validation object
 * @param {Object} validation - Validation result object
 * @returns {Object} Parsed manual L* data
 */
export function parseManualLstarData(validation, options = {}) {
    try {
        console.log('📝 parseManualLstarData: processing manual L* measurements');

        const isValid = validation?.isValid ?? validation?.valid ?? false;
        const measuredPairsInput = Array.isArray(validation?.measuredPairs)
            ? validation.measuredPairs
            : [];

        if (!validation || !isValid || measuredPairsInput.length === 0) {
            return {
                valid: false,
                error: 'Invalid validation data provided'
            };
        }

        const measuredPairs = measuredPairsInput;
        const measuredXs = measuredPairs.map((pair) => Number(pair.x));
        const measuredL = measuredPairs.map((pair) => Number(pair.l));
        const pairCount = measuredPairs.length;

        if (pairCount < 2) {
            return {
                valid: false,
                error: 'At least 2 measurement pairs are required'
            };
        }

        // Auto-detect range for input values: if any input value > 100, assume 0-255 range; otherwise 0-100 range
        const maxInputValue = measuredXs.length > 0 ? Math.max(...measuredXs) : 0;
        const divisor = maxInputValue > 100 ? 255 : 100;

        const normalizedData = measuredPairs.map((pair) => {
            const clampedInput = Math.max(0, Math.min(divisor, Number(pair.x)));
            const clampedLab = Math.max(0, Math.min(100, Number(pair.l)));
            return {
                input: (clampedInput / divisor) * 100,
                lab: clampedLab,
                originalInput: Number(pair.x)
            };
        });

        const usableData = normalizedData
            .filter((point) => Number.isFinite(point.input) && Number.isFinite(point.lab))
            .sort((a, b) => a.input - b.input);

        if (usableData.length < 2) {
            return {
                valid: false,
                error: 'Not enough valid measurement pairs to build a curve'
            };
        }

        const normalizationMode = options.normalizationMode || getLabNormalizationMode();

        const defaultSmoothingPercent = getLabSmoothingPercent();

        const rawSamples = rebuildLabSamplesFromOriginal(usableData, {
            normalizationMode,
            skipDefaultSmoothing: true,
            useBaselineWidenFactor: true
        });

        const baseSamples = rebuildLabSamplesFromOriginal(usableData, {
            normalizationMode,
            useBaselineWidenFactor: true
        }) || rawSamples;

        if (!Array.isArray(baseSamples) || baseSamples.length === 0) {
            return {
                valid: false,
                error: 'Failed to reconstruct manual L* samples'
            };
        }

        const previewWiden = defaultSmoothingPercent > 0
            ? mapSmoothingPercentToWiden(defaultSmoothingPercent)
            : 1;

        const previewSamples = rebuildLabSamplesFromOriginal(usableData, {
            normalizationMode,
            widenFactor: previewWiden
        }) || baseSamples;

        const buildControlPoints = (smoothingPercent) => {
            const sp = Math.max(0, Math.min(600, Number(smoothingPercent) || 0));
            const widen = mapSmoothingPercentToWiden(sp);
            const widenedSamples = rebuildLabSamplesFromOriginal(usableData, {
                widenFactor: widen,
                normalizationMode
            }) || baseSamples;

            const controlPointCount = Math.max(3, 21 - Math.floor(sp / 10));
            const samplesOut = [];
            const xCoords = [];

            for (let i = 0; i < controlPointCount; i++) {
                const x = controlPointCount === 1 ? 0 : i / (controlPointCount - 1);
                const idx = Math.round(x * 255);
                xCoords.push(x);
                samplesOut.push(widenedSamples[Math.max(0, Math.min(255, idx))]);
            }

            return {
                samples: samplesOut,
                xCoords,
                controlPointCount,
                needsDualTransformation: false
            };
        };

        console.log(`📝 parseManualLstarData: successfully processed ${usableData.length} L* measurements`);

        return {
            valid: true,
            format: 'Manual L* Entry',
            filename: `Manual-L-${usableData.length}pts`,
            domainMin: 0,
            domainMax: 1,
            samples: baseSamples.slice(),
            baseSamples: baseSamples.slice(),
            rawSamples: (rawSamples || baseSamples).slice(),
            previewSamples: previewSamples.slice(),
            previewSmoothingPercent: defaultSmoothingPercent,
            originalData: usableData.map((point) => ({
                input: point.input,
                lab: point.lab,
                originalInput: point.originalInput
            })),
            sourceSpace: DataSpace.SPACE.PRINTER,
            getSmoothingControlPoints: buildControlPoints
        };

    } catch (error) {
        console.error('Error parsing manual L* data:', error);
        return {
            valid: false,
            error: error.message
        };
    }
}

/**
 * Parse intent paste data (natural language curves)
 * @param {string} text - Pasted text content
 * @returns {Object} Parsed intent data
 */
export function parseIntentPaste(text) {
    try {
        // TODO: Connect to full parseIntentPaste implementation
        console.log('💬 parseIntentPaste placeholder called');

        if (!text || typeof text !== 'string') {
            return {
                ok: false,
                error: 'No text provided'
            };
        }

        // Basic validation - check for curve-related keywords
        const lowerText = text.toLowerCase();
        const curveKeywords = ['curve', 'bright', 'dark', 'contrast', 'highlight', 'shadow', 'midtone'];
        const hasCurveContent = curveKeywords.some(keyword => lowerText.includes(keyword));

        return {
            ok: hasCurveContent,
            text: text.trim(),
            detected: hasCurveContent ? 'curve_intent' : 'unknown'
        };

    } catch (error) {
        console.error('Error parsing intent paste:', error);
        return {
            ok: false,
            error: error.message
        };
    }
}

/**
 * Validate file format based on content and extension
 * @param {string} content - File content
 * @param {string} filename - Filename
 * @returns {Object} Validation result
 */
export function validateFileFormat(content, filename) {
    const ext = filename ? filename.toLowerCase().split('.').pop() : '';

    // QuadToneRIP .quad files
    if (ext === 'quad') {
        return {
            valid: content.includes('## QuadToneRIP'),
            format: 'quad',
            parser: 'parseQuadFile'
        };
    }

    // CGATS files
    if (ext === 'ti3' || content.includes('CGATS') || content.includes('BEGIN_DATA')) {
        return {
            valid: true,
            format: 'cgats',
            parser: 'parseCGATS17'
        };
    }

    // ACV curve files (binary format)
    if (ext === 'acv') {
        return {
            valid: true,
            format: 'acv',
            parser: 'parseACVFile'
        };
    }

    // CUBE LUT files
    if (ext === 'cube' || content.includes('LUT_1D_SIZE') || content.includes('LUT_3D_SIZE')) {
        return {
            valid: true,
            format: 'cube',
            parser: content.includes('LUT_1D_SIZE') ? 'parseCube1D' : 'parseCube3D'
        };
    }

    // LAB text files
    if (ext === 'txt' || ext === 'lab') {
        return {
            valid: true,
            format: 'lab',
            parser: 'parseLabData'
        };
    }

    return {
        valid: false,
        format: 'unknown',
        error: 'Unsupported file format'
    };
}

/**
 * Validate QuadToneRIP .quad file structure
 * @param {string} content - File content
 * @returns {Object} Validation result
 */
export function validateQuadFile(content) {
    try {
        if (!content || typeof content !== 'string') {
            return {
                valid: false,
                error: 'No file content provided'
            };
        }

        const lines = content.split('\n').map(line => line.trim()).filter(line => line);
        const header = lines.find(line => line.startsWith('## QuadToneRIP'));

        if (!header) {
            return {
                valid: false,
                error: 'Missing QuadToneRIP header'
            };
        }

        // Extract channel names from header
        const channels = header.substring('## QuadToneRIP '.length).split(',').map(c => c.trim());

        if (channels.length === 0) {
            return {
                valid: false,
                error: 'No channels defined in header'
            };
        }

        return {
            valid: true,
            channels,
            message: `Valid .quad file with ${channels.length} channels`
        };

    } catch (error) {
        return {
            valid: false,
            error: error.message
        };
    }
}


registerDebugNamespace('parsers', {
    parseQuadFile,
    parseACVFile,
    parseCube1D,
    parseCube3D,
    parseCGATS17,
    parseLabData,
    parseManualLstarData,
    parseLinearizationFile,
    parseIntentPaste,
    validateFileFormat,
    validateQuadFile,
    cieDensityFromLstar,
    lstarToY_CIE,
    log10_safe,
    rebuildLabSamplesFromOriginal
}, {
    exposeOnWindow: true,
    windowAliases: [
        'parseQuadFile',
        'parseACVFile',
        'parseCube1D',
        'parseCube3D',
        'parseCGATS17',
        'parseLabData',
        'parseManualLstarData',
        'parseLinearizationFile',
        'parseIntentPaste',
        'validateFileFormat',
        'validateQuadFile',
        'cieDensityFromLstar',
        'lstarToY_CIE',
        'log10_safe'
    ]
});
