// quadGEN File Format Parsers
// Parsers for .quad, .acv, .cube, CGATS, and other supported file formats

import { CURVE_RESOLUTION } from '../data/processing-utils.js';
import { DataSpace } from '../data/processing-utils.js';
import { parseQuadFile as parseCanonicalQuadFile } from '../data/quad-parser.js';
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
        const parsed = parseCanonicalQuadFile(content);
        const baselineEnd = Object.fromEntries(
            parsed.channels.map((channelName, index) => [channelName, parsed.values[index]])
        );

        return {
            ...parsed,
            baselineEnd,
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
const CUBE_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const DEFAULT_CUBE_DOMAIN_MIN = Object.freeze([0, 0, 0]);
const DEFAULT_CUBE_DOMAIN_MAX = Object.freeze([1, 1, 1]);
const MAX_DECLARED_CUBE_1D_SIZE = 65536;
const MAX_CUBE_3D_SIZE = 256;
const MAX_HEADERLESS_CUBE_1D_SIZE = 256;

function parseCubeSize(line, directive, lineNumber, maximumSize) {
    const match = line.match(new RegExp(`^${directive}\\s+(\\d+)\\s*$`, 'i'));
    if (!match) {
        throw new Error(`Malformed ${directive} declaration on line ${lineNumber}.`);
    }

    const size = Number(match[1]);
    if (!Number.isSafeInteger(size) || size < 2 || size > maximumSize) {
        throw new Error(`${directive} must declare an integer size between 2 and ${maximumSize} on line ${lineNumber}.`);
    }
    return size;
}

function validateCubeTitle(line, lineNumber) {
    if (!/^TITLE\s+"(?:[^"\\]|\\.)*"\s*$/i.test(line)) {
        throw new Error(`Malformed TITLE declaration on line ${lineNumber}.`);
    }
}

function requireCubeHeaderBeforeData(directive, dataStarted, lineNumber) {
    if (dataStarted) {
        throw new Error(`${directive} must appear before CUBE data rows (line ${lineNumber}).`);
    }
}

function parseCubeDomain(line, directive, lineNumber) {
    const tokens = line.trim().split(/\s+/).slice(1);
    if (tokens.length !== 1 && tokens.length !== 3) {
        throw new Error(`${directive} must contain one scalar or three RGB values on line ${lineNumber}.`);
    }

    const values = tokens.map((token) => (
        CUBE_NUMBER_PATTERN.test(token) ? Number(token) : Number.NaN
    ));
    if (!values.every(Number.isFinite)) {
        throw new Error(`${directive} must contain finite numeric values on line ${lineNumber}.`);
    }

    return {
        arity: values.length,
        values: values.length === 1 ? [values[0], values[0], values[0]] : values
    };
}

function resolveCubeDomains(domainMinDeclaration, domainMaxDeclaration) {
    if (domainMinDeclaration && domainMaxDeclaration
        && domainMinDeclaration.arity !== domainMaxDeclaration.arity) {
        throw new Error('DOMAIN_MIN and DOMAIN_MAX must use matching scalar or RGB arity.');
    }

    const domainMinRGB = domainMinDeclaration
        ? domainMinDeclaration.values.slice()
        : DEFAULT_CUBE_DOMAIN_MIN.slice();
    const domainMaxRGB = domainMaxDeclaration
        ? domainMaxDeclaration.values.slice()
        : DEFAULT_CUBE_DOMAIN_MAX.slice();

    for (let component = 0; component < 3; component += 1) {
        if (domainMaxRGB[component] <= domainMinRGB[component]) {
            throw new Error(`DOMAIN_MAX must be greater than DOMAIN_MIN for RGB component ${component + 1}.`);
        }
    }

    return { domainMinRGB, domainMaxRGB };
}

function parseCubeDataRow(line, lineNumber, minimumComponents, maximumComponents) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < minimumComponents || tokens.length > maximumComponents) {
        const expected = minimumComponents === maximumComponents
            ? `exactly ${minimumComponents}`
            : `${minimumComponents} to ${maximumComponents}`;
        throw new Error(`CUBE data row ${lineNumber} must contain ${expected} numeric components.`);
    }

    const values = tokens.map((token) => (
        CUBE_NUMBER_PATTERN.test(token) ? Number(token) : Number.NaN
    ));
    if (!values.every(Number.isFinite)) {
        throw new Error(`CUBE data row ${lineNumber} must contain finite numeric components.`);
    }
    return values;
}

export function parseCube1D(cubeText, filename = 'lut.cube') {
    try {
        const lines = cubeText.split(/\r?\n/);
        let domainMinDeclaration = null;
        let domainMaxDeclaration = null;
        let declaredSize = null;
        let titleSeen = false;
        let dataStarted = false;
        const samples = [];

        // Early detection: route mislabeled 3D LUTs to the 3D parser
        for (const raw of lines) {
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('#') || /^TITLE(?:\s|$)/i.test(trimmed)) continue;
            if (/^LUT_3D_SIZE(?:\s|$)/i.test(trimmed)) {
                return parseCube3D(cubeText, filename);
            }
        }

        for (let index = 0; index < lines.length; index += 1) {
            const raw = lines[index];
            const trimmed = raw.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const lineNumber = index + 1;

            if (/^TITLE(?:\s|$)/i.test(trimmed)) {
                requireCubeHeaderBeforeData('TITLE', dataStarted, lineNumber);
                if (titleSeen) {
                    throw new Error(`Duplicate TITLE declaration on line ${lineNumber}.`);
                }
                validateCubeTitle(trimmed, lineNumber);
                titleSeen = true;
                continue;
            }

            if (/^LUT_1D_SIZE(?:\s|$)/i.test(trimmed)) {
                requireCubeHeaderBeforeData('LUT_1D_SIZE', dataStarted, lineNumber);
                if (declaredSize !== null) {
                    throw new Error(`Duplicate LUT_1D_SIZE declaration on line ${lineNumber}.`);
                }
                declaredSize = parseCubeSize(trimmed, 'LUT_1D_SIZE', lineNumber, MAX_DECLARED_CUBE_1D_SIZE);
                continue;
            }

            if (/^DOMAIN_MIN(?:\s|$)/i.test(trimmed)) {
                requireCubeHeaderBeforeData('DOMAIN_MIN', dataStarted, lineNumber);
                if (domainMinDeclaration) {
                    throw new Error(`Duplicate DOMAIN_MIN declaration on line ${lineNumber}.`);
                }
                domainMinDeclaration = parseCubeDomain(trimmed, 'DOMAIN_MIN', lineNumber);
                continue;
            }

            if (/^DOMAIN_MAX(?:\s|$)/i.test(trimmed)) {
                requireCubeHeaderBeforeData('DOMAIN_MAX', dataStarted, lineNumber);
                if (domainMaxDeclaration) {
                    throw new Error(`Duplicate DOMAIN_MAX declaration on line ${lineNumber}.`);
                }
                domainMaxDeclaration = parseCubeDomain(trimmed, 'DOMAIN_MAX', lineNumber);
                continue;
            }

            const numbers = parseCubeDataRow(trimmed, lineNumber, 1, 3);
            samples.push(numbers[0]);
            dataStarted = true;
        }

        if (declaredSize == null && samples.length > MAX_HEADERLESS_CUBE_1D_SIZE) {
            throw new Error(`1D LUT lists ${samples.length} samples without LUT_1D_SIZE; limit is ${MAX_HEADERLESS_CUBE_1D_SIZE}.`);
        }

        if (declaredSize !== null && samples.length !== declaredSize) {
            throw new Error(`1D LUT declares ${declaredSize} samples but found ${samples.length}.`);
        }

        if (samples.length < 2) {
            throw new Error('A 1D LUT must contain at least 2 samples.');
        }

        const { domainMinRGB, domainMaxRGB } = resolveCubeDomains(domainMinDeclaration, domainMaxDeclaration);
        const domainMin = domainMinRGB[0];
        const domainMax = domainMaxRGB[0];

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
            domainMinRGB,
            domainMaxRGB,
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
        let domainMinDeclaration = null;
        let domainMaxDeclaration = null;
        let lutSize = null;
        let titleSeen = false;
        let dataStarted = false;
        const lutData = [];

        for (let index = 0; index < lines.length; index += 1) {
            const raw = lines[index];
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const lineNumber = index + 1;

            if (/^TITLE(?:\s|$)/i.test(line)) {
                requireCubeHeaderBeforeData('TITLE', dataStarted, lineNumber);
                if (titleSeen) {
                    throw new Error(`Duplicate TITLE declaration on line ${lineNumber}.`);
                }
                validateCubeTitle(line, lineNumber);
                titleSeen = true;
                continue;
            }

            if (/^LUT_3D_SIZE(?:\s|$)/i.test(line)) {
                requireCubeHeaderBeforeData('LUT_3D_SIZE', dataStarted, lineNumber);
                if (lutSize !== null) {
                    throw new Error(`Duplicate LUT_3D_SIZE declaration on line ${lineNumber}.`);
                }
                lutSize = parseCubeSize(line, 'LUT_3D_SIZE', lineNumber, MAX_CUBE_3D_SIZE);
                continue;
            }

            if (/^LUT_1D_SIZE(?:\s|$)/i.test(line)) {
                throw new Error('A CUBE file cannot contain both LUT_1D_SIZE and LUT_3D_SIZE declarations.');
            }

            if (/^DOMAIN_MIN(?:\s|$)/i.test(line)) {
                requireCubeHeaderBeforeData('DOMAIN_MIN', dataStarted, lineNumber);
                if (domainMinDeclaration) {
                    throw new Error(`Duplicate DOMAIN_MIN declaration on line ${lineNumber}.`);
                }
                domainMinDeclaration = parseCubeDomain(line, 'DOMAIN_MIN', lineNumber);
                continue;
            }

            if (/^DOMAIN_MAX(?:\s|$)/i.test(line)) {
                requireCubeHeaderBeforeData('DOMAIN_MAX', dataStarted, lineNumber);
                if (domainMaxDeclaration) {
                    throw new Error(`Duplicate DOMAIN_MAX declaration on line ${lineNumber}.`);
                }
                domainMaxDeclaration = parseCubeDomain(line, 'DOMAIN_MAX', lineNumber);
                continue;
            }

            lutData.push(parseCubeDataRow(line, lineNumber, 3, 3));
            dataStarted = true;
        }

        if (!lutSize) {
            throw new Error('3D LUT size not found. Expected LUT_3D_SIZE declaration.');
        }

        const expectedPoints = lutSize * lutSize * lutSize;
        if (lutData.length !== expectedPoints) {
            throw new Error(`3D LUT data mismatch. Expected ${expectedPoints} points, found ${lutData.length}.`);
        }

        const { domainMinRGB, domainMaxRGB } = resolveCubeDomains(domainMinDeclaration, domainMaxDeclaration);
        const domainSpanRGB = domainMaxRGB.map((maximum, component) => (
            maximum - domainMinRGB[component]
        ));

        const outputSteps = 256;
        const neutralAxisSamples = new Array(outputSteps);

        for (let i = 0; i < outputSteps; i++) {
            const input = i / (outputSteps - 1);
            const rgb = [input, input, input];
            const out = trilinearInterpolate3D(rgb, lutData, lutSize, domainMinRGB, domainSpanRGB);
            neutralAxisSamples[i] = (out[0] + out[1] + out[2]) / 3;
            if (!Number.isFinite(neutralAxisSamples[i])) {
                throw new Error(`3D LUT interpolation produced a non-finite sample at index ${i}.`);
            }
        }

        const converted = DataSpace.convertSamples(neutralAxisSamples, {
            from: DataSpace.SPACE.IMAGE,
            to: DataSpace.SPACE.PRINTER,
            metadata: { lutSize }
        });

        const anchoredSamples = anchorSamplesToUnitRange(converted.values.slice());
        const domainMin = domainMinRGB[0];
        const domainMax = domainMaxRGB[0];

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
            domainMinRGB,
            domainMaxRGB,
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

function trilinearInterpolate3D(inputRGB, lutData, lutSize, domainMinRGB, domainSpanRGB) {
    const [r, g, b] = inputRGB;

    const normalizedR = Math.max(0, Math.min(1, (r - domainMinRGB[0]) / domainSpanRGB[0]));
    const normalizedG = Math.max(0, Math.min(1, (g - domainMinRGB[1]) / domainSpanRGB[1]));
    const normalizedB = Math.max(0, Math.min(1, (b - domainMinRGB[2]) / domainSpanRGB[2]));

    const lutR = normalizedR * (lutSize - 1);
    const lutG = normalizedG * (lutSize - 1);
    const lutB = normalizedB * (lutSize - 1);

    const r0 = Math.floor(lutR), r1 = Math.min(lutSize - 1, r0 + 1);
    const g0 = Math.floor(lutG), g1 = Math.min(lutSize - 1, g0 + 1);
    const b0 = Math.floor(lutB), b1 = Math.min(lutSize - 1, b0 + 1);

    const fr = lutR - r0;
    const fg = lutG - g0;
    const fb = lutB - b0;

    const idx = (rr, gg, bb) => bb * lutSize * lutSize + gg * lutSize + rr;

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
            // 3D requires an explicit declaration; otherwise preserve 1D compatibility.
            if (/^\s*LUT_3D_SIZE(?:\s|$)/im.test(textContent)) {
                return parseCube3D(textContent, finalFilename);
            }
            return parseCube1D(textContent, finalFilename);
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
        const validation = validateQuadFile(content);
        return {
            ...validation,
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

        const parsed = parseQuadFile(content);
        if (!parsed.valid) {
            return {
                valid: false,
                error: parsed.error
            };
        }

        return {
            valid: true,
            channels: parsed.channels,
            message: `Valid .quad file with ${parsed.channels.length} channels`
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
