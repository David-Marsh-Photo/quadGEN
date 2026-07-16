// quadGEN .quad File Parser
// Extracted from original monolithic file

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
  const lines = content.split('\n').map(line => line.trim());

  // Look for the QuadToneRIP header line to extract channel names
  let channels = [];
  let headerFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Look for QuadToneRIP header: ## QuadToneRIP K,C,M,Y,LC,LM,LK,LLK
    if (line.startsWith('## QuadToneRIP ')) {
      const channelPart = line.substring('## QuadToneRIP '.length);
      channels = channelPart.split(',').map(ch => ch.trim());
      headerFound = true;
      break;
    }
  }

  // Collect all numeric values from the file (ignoring comments)
  const numericLines = [];
  let invalidDataLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      if (/^\d+$/.test(line)) {
        const value = parseInt(line, 10);

        // Validate reasonable value range for QuadToneRIP (0-65535)
        if (value < 0 || value > 65535) {
          throw new Error(`Invalid data value ${value} at line ${i + 1}. QuadToneRIP values must be 0-65535.`);
        }

        numericLines.push(value);
      } else {
        // Track non-numeric, non-comment lines as potentially problematic
        invalidDataLines.push(`Line ${i + 1}: "${line}"`);
        if (invalidDataLines.length > 10) break; // Don't flood with errors
      }
    }
  }

  if (numericLines.length < 256) {
    throw new Error(`Insufficient data: found only ${numericLines.length} values, need at least 256 for one channel`);
  }

  // Warn about mixed content if found
  if (invalidDataLines.length > 0) {
    const sampleLines = invalidDataLines.slice(0, 3).join(', ');
    console.warn(`Found ${invalidDataLines.length} non-numeric lines in data section: ${sampleLines}`);
  }

  // If no header found, infer channel count from data
  if (!headerFound || channels.length === 0) {
    const inferredChannelCount = Math.floor(numericLines.length / 256);

    if (inferredChannelCount === 0) {
      throw new Error(`Insufficient data: found ${numericLines.length} values, need at least 256 for one channel`);
    }

    // Use default channel names if we have a known configuration
    if (DEFAULT_CHANNEL_NAMES[inferredChannelCount]) {
      channels = DEFAULT_CHANNEL_NAMES[inferredChannelCount];
      console.log(`📄 parseQuadFile: no header found, inferred ${inferredChannelCount} channels using default names: ${channels.join(',')}`);
    } else {
      // Generate generic channel names for unknown configurations
      channels = Array.from({ length: inferredChannelCount }, (_, i) => `CH${i + 1}`);
      console.log(`📄 parseQuadFile: no header found, inferred ${inferredChannelCount} channels with generic names`);
    }
  }

  // Each channel should have exactly 256 data points
  const expectedDataPoints = channels.length * 256;
  if (numericLines.length < expectedDataPoints) {
    throw new Error(`Insufficient data: found ${numericLines.length} values, expected ${expectedDataPoints} (${channels.length} channels × 256 points each)`);
  }

  // Extract all 256 data points for each channel
  const channelCurves = {};
  const values = []; // Final values for UI display

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

  // Check for reasonable data content (at least 256 numeric values for one channel)
  const numericLines = content.split('\n').filter(line => line.trim() && /^\d+$/.test(line.trim()));
  if (numericLines.length < 256) {
    throw new Error(`File appears corrupted or incomplete. Found only ${numericLines.length} data points, expected at least 256.`);
  }
}