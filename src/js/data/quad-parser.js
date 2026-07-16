// Canonical quadGEN .quad structural parser

const VALUES_PER_CHANNEL = 256;
const MAX_QUAD_VALUE = 65535;

// Default channel names by count (based on common QTR printer configurations)
const DEFAULT_CHANNEL_NAMES = {
  8: ['K', 'C', 'M', 'Y', 'LC', 'LM', 'LK', 'LLK'],           // P600/P800
  10: ['K', 'C', 'M', 'Y', 'LC', 'LM', 'LK', 'LLK', 'V', 'MK'] // P700/P900
};

/**
 * Parse a QuadToneRIP .quad file content
 * @param {string} content - Raw file content
 * @returns {Object} Parsed data with channels, values, and curves
 */
export function parseQuadFile(content) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('No .quad file content provided.');
  }

  const lines = content.split(/\r?\n/).map(line => line.trim());
  const headerCandidates = lines.filter(line => /^##\s*QuadToneRIP/i.test(line));
  const headerLines = lines.filter(line => /^## QuadToneRIP(?:\s|$)/.test(line));

  if (headerCandidates.length !== headerLines.length) {
    throw new Error('Invalid .quad header: malformed QuadToneRIP channel declaration.');
  }
  if (headerLines.length > 1) {
    throw new Error('Invalid .quad header: multiple QuadToneRIP channel declarations found.');
  }

  let channels = null;
  if (headerLines.length === 1) {
    const declaration = headerLines[0].slice('## QuadToneRIP'.length).trim();
    channels = declaration.split(',').map(channel => channel.trim());

    if (channels.some(channel => channel === '')) {
      throw new Error('Invalid .quad header: channel names must be non-empty.');
    }
    if (new Set(channels).size !== channels.length) {
      throw new Error('Invalid .quad header: channel names must be unique.');
    }
  }

  const numericValues = [];
  lines.forEach((line, index) => {
    if (!line || line.startsWith('#')) return;

    if (!/^\d+$/.test(line)) {
      throw new Error(`Unexpected non-comment content at line ${index + 1}: "${line}".`);
    }

    const value = Number(line);
    if (!Number.isInteger(value) || value < 0 || value > MAX_QUAD_VALUE) {
      throw new Error(`Invalid data value ${line} at line ${index + 1}. QuadToneRIP values must be integers from 0-65535.`);
    }
    numericValues.push(value);
  });

  if (channels) {
    const expectedValueCount = channels.length * VALUES_PER_CHANNEL;
    if (numericValues.length !== expectedValueCount) {
      throw new Error(
        `Invalid .quad data count: found ${numericValues.length} values, expected exactly ${expectedValueCount} ` +
        `(${channels.length} channels × ${VALUES_PER_CHANNEL}).`
      );
    }
  } else {
    if (numericValues.length === 0 || numericValues.length % VALUES_PER_CHANNEL !== 0) {
      throw new Error(
        `Invalid headerless .quad data count: found ${numericValues.length} values; expected an exact multiple of ${VALUES_PER_CHANNEL}.`
      );
    }

    const inferredChannelCount = numericValues.length / VALUES_PER_CHANNEL;
    const inferredChannels = DEFAULT_CHANNEL_NAMES[inferredChannelCount];
    if (!inferredChannels) {
      throw new Error(
        `Headerless .quad data cannot infer a recognized channel layout from ${inferredChannelCount} channels; ` +
        'include a QuadToneRIP channel header.'
      );
    }
    channels = inferredChannels.slice();
  }

  // Extract all 256 data points for each channel
  const channelCurves = {};
  const values = []; // Final values for UI display

  for (let channelIdx = 0; channelIdx < channels.length; channelIdx++) {
    const channelName = channels[channelIdx];
    const channelStartIdx = channelIdx * 256;
    const curveData = numericValues.slice(channelStartIdx, channelStartIdx + VALUES_PER_CHANNEL);
    channelCurves[channelName] = curveData;

    // Store the maximum value for UI display (percentage calculation)
    values.push(Math.max(...curveData));
  }

  return { channels, values, curves: channelCurves };
}

/**
 * Find matching printer configuration based on channels
 * @param {string[]} channels - Channel names from .quad file
 * @param {Object} PRINTERS - Printer configurations object
 * @returns {string|null} Printer ID or null if no match
 */
export function findMatchingPrinter(channels, PRINTERS) {
  for (const [printerId, config] of Object.entries(PRINTERS)) {
    if (config.channels.length === channels.length &&
        config.channels.every((ch, i) => ch === channels[i])) {
      return printerId;
    }
  }
  return null;
}

/**
 * Validate .quad file before parsing
 * @param {File} file - File object
 * @param {string} content - File content
 * @throws {Error} If validation fails
 */
export function validateQuadFile(file, content) {
  // Check file type
  if (!file.name.toLowerCase().endsWith('.quad')) {
    throw new Error(`Unsupported file type. Expected .quad file, got: ${file.name}`);
  }

  // Check file size (reasonable limits)
  if (file.size > 10 * 1024 * 1024) { // 10MB limit
    throw new Error(`File too large: ${(file.size / (1024*1024)).toFixed(1)}MB. Maximum supported size is 10MB.`);
  }

  if (file.size < 100) { // Minimum reasonable size
    throw new Error(`File too small: ${file.size} bytes. This doesn't appear to be a valid .quad file.`);
  }

  parseQuadFile(content);
}
