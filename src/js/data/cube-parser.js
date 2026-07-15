// quadGEN .cube LUT Parser (1D and 3D)
// Extracted from original monolithic file

/**
 * Parse a 1D .cube file
 * @param {string} cubeText - Raw cube file content
 * @returns {Object} Parsed 1D LUT data
 */
export function parseCube1D(cubeText) {
  const lines = cubeText.split(/\r?\n/);
  let domainMin = 0.0;
  let domainMax = 1.0;
  let declaredSize = null;
  const samples = [];

  // Check for 3D LUT indicators early - route to appropriate parser
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || s.startsWith("#") || /^TITLE/i.test(s)) continue;

    // Detect 3D LUT file format and route to 3D parser
    if (/^LUT_3D_SIZE/i.test(s)) {
      return parseCube3D(cubeText);
    }
  }

  for (const raw of lines) {
    const s = raw.trim();
    if (!s || s.startsWith("#") || /^TITLE/i.test(s)) continue;

    if (/^LUT_1D_SIZE/i.test(s)) {
      const m = s.match(/LUT_1D_SIZE\s+(\d+)/i);
      if (m) declaredSize = parseInt(m[1], 10);
      continue;
    }
    if (/^DOMAIN_MIN/i.test(s)) {
      // 1 or 3 numbers; for 1D we take the first
      const parts = s.split(/\s+/);
      if (parts[1] !== undefined) domainMin = parseFloat(parts[1]);
      continue;
    }
    if (/^DOMAIN_MAX/i.test(s)) {
      const parts = s.split(/\s+/);
      if (parts[1] !== undefined) domainMax = parseFloat(parts[1]);
      continue;
    }

    // Numeric row: could be 1–3 floats. For LUTs, many files still list RGB triplets.
    const nums = s.split(/\s+/).map(Number);
    if (nums.every((v) => Number.isFinite(v)) && nums.length >= 1 && nums.length <= 3) {
      samples.push(nums[0]); // take the first channel for 1D
    }
  }

  // Guard against mis-labeled 3D LUTs: allow up to 256 samples when no size is declared
  const SAMPLE_LIMIT = 256;
  if (declaredSize == null && samples.length > SAMPLE_LIMIT) {
    throw new Error(`This 1D LUT lists ${samples.length} samples without a LUT_1D_SIZE header. quadGEN supports up to ${SAMPLE_LIMIT} points per channel; verify the file or convert it to a 3D LUT.`);
  }

  if (declaredSize !== null && samples.length >= declaredSize) {
    samples.length = declaredSize;
  }
  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMin === domainMax) {
    domainMin = 0.0; domainMax = 1.0;
  }
  if (!samples.length) {
    throw new Error("No 1D samples found in .cube text.");
  }

  // Note: DataSpace conversion would be applied here when integrated
  // For now, return raw samples - this will be connected when we integrate modules
  return {
    domainMin,
    domainMax,
    samples: samples, // TODO: Apply DataSpace conversion
    originalSamples: samples,
    format: '1DLUT',
    sourceSpace: 'image', // TODO: Set from DataSpace conversion
    conversionMeta: null // TODO: Set from DataSpace conversion
  };
}

/**
 * Parse a 3D .cube file and extract neutral axis
 * @param {string} cubeText - Raw cube file content
 * @returns {Object} Parsed 3D LUT data with neutral axis samples
 */
export function parseCube3D(cubeText) {
  const lines = cubeText.split(/\r?\n/);
  let domainMin = 0.0;
  let domainMax = 1.0;
  let lutSize = null;
  const lutData = [];

  // Parse header information
  for (const raw of lines) {
    const s = raw.trim();
    if (!s || s.startsWith("#") || /^TITLE/i.test(s)) continue;

    if (/^LUT_3D_SIZE/i.test(s)) {
      const m = s.match(/LUT_3D_SIZE\s+(\d+)/i);
      if (m) lutSize = parseInt(m[1], 10);
      continue;
    }
    if (/^DOMAIN_MIN/i.test(s)) {
      const parts = s.split(/\s+/);
      if (parts[1] !== undefined) domainMin = parseFloat(parts[1]);
      continue;
    }
    if (/^DOMAIN_MAX/i.test(s)) {
      const parts = s.split(/\s+/);
      if (parts[1] !== undefined) domainMax = parseFloat(parts[1]);
      continue;
    }

    // Parse RGB data lines
    const parts = s.split(/\s+/);
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
    throw new Error("3D LUT size not found. Expected LUT_3D_SIZE declaration.");
  }

  const expectedDataPoints = lutSize * lutSize * lutSize;
  if (lutData.length !== expectedDataPoints) {
    throw new Error(`3D LUT data mismatch. Expected ${expectedDataPoints} points, found ${lutData.length}.`);
  }

  // Extract neutral axis (diagonal where R=G=B)
  const neutralAxisSamples = [];
  const outputSteps = 256; // Generate 256 samples for consistency with other LUT processing

  for (let i = 0; i < outputSteps; i++) {
    const input = i / (outputSteps - 1); // 0 to 1
    const neutralRGB = [input, input, input]; // R=G=B for neutral gray

    // Trilinear interpolation in 3D LUT
    const outputRGB = trilinearInterpolate3D(neutralRGB, lutData, lutSize, domainMin, domainMax);

    // Convert RGB output to luminance (simple average for neutral axis)
    const luminance = (outputRGB[0] + outputRGB[1] + outputRGB[2]) / 3;
    neutralAxisSamples.push(luminance);
  }

  // Note: DataSpace conversion would be applied here when integrated
  return {
    domainMin,
    domainMax,
    samples: neutralAxisSamples, // TODO: Apply DataSpace conversion
    is3DLUT: true,
    lutSize: lutSize,
    originalDataPoints: expectedDataPoints,
    sourceSpace: 'image', // TODO: Set from DataSpace conversion
    conversionMeta: null // TODO: Set from DataSpace conversion
  };
}

/**
 * Trilinear interpolation for 3D LUT data
 * @param {number[]} inputRGB - RGB input values [r, g, b]
 * @param {number[][]} lutData - 3D LUT data array
 * @param {number} lutSize - Size of the LUT cube
 * @param {number} domainMin - Minimum domain value
 * @param {number} domainMax - Maximum domain value
 * @returns {number[]} Interpolated RGB output
 */
export function trilinearInterpolate3D(inputRGB, lutData, lutSize, domainMin, domainMax) {
  const [r, g, b] = inputRGB;

  // Normalize input to LUT coordinates (0 to lutSize-1)
  const normalizedR = (r - domainMin) / (domainMax - domainMin);
  const normalizedG = (g - domainMin) / (domainMax - domainMin);
  const normalizedB = (b - domainMin) / (domainMax - domainMin);

  const lutR = Math.max(0, Math.min(lutSize - 1, normalizedR * (lutSize - 1)));
  const lutG = Math.max(0, Math.min(lutSize - 1, normalizedG * (lutSize - 1)));
  const lutB = Math.max(0, Math.min(lutSize - 1, normalizedB * (lutSize - 1)));

  // Get integer indices and fractional parts
  const r0 = Math.floor(lutR), r1 = Math.min(lutSize - 1, r0 + 1);
  const g0 = Math.floor(lutG), g1 = Math.min(lutSize - 1, g0 + 1);
  const b0 = Math.floor(lutB), b1 = Math.min(lutSize - 1, b0 + 1);

  const fr = lutR - r0;
  const fg = lutG - g0;
  const fb = lutB - b0;

  // Get the 8 corner values from the LUT cube
  const corners = [
    lutData[r0 * lutSize * lutSize + g0 * lutSize + b0], // (r0,g0,b0)
    lutData[r1 * lutSize * lutSize + g0 * lutSize + b0], // (r1,g0,b0)
    lutData[r0 * lutSize * lutSize + g1 * lutSize + b0], // (r0,g1,b0)
    lutData[r1 * lutSize * lutSize + g1 * lutSize + b0], // (r1,g1,b0)
    lutData[r0 * lutSize * lutSize + g0 * lutSize + b1], // (r0,g0,b1)
    lutData[r1 * lutSize * lutSize + g0 * lutSize + b1], // (r1,g0,b1)
    lutData[r0 * lutSize * lutSize + g1 * lutSize + b1], // (r0,g1,b1)
    lutData[r1 * lutSize * lutSize + g1 * lutSize + b1]  // (r1,g1,b1)
  ];

  // Trilinear interpolation
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