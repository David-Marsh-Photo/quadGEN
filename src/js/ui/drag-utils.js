// Utility helpers for Smart point drag behaviour

/**
 * Convert a clamped drag output (relative to the chart display max) into an absolute percent that
 * matches the visible chart range.
 *
 * @param {number} clampedOutputPercent - Output percent clamped to the chart display max.
 * @param {number} displayMax - Current chart display maximum percent.
 * @returns {number} Absolute output percent (0-100).
 */
export function normalizeDragOutputToAbsolute(clampedOutputPercent, displayMax) {
  const safeDisplayMax = Number.isFinite(displayMax) && displayMax > 0 ? displayMax : 100;
  const safeOutput = Number.isFinite(clampedOutputPercent) ? clampedOutputPercent : 0;
  if (!Number.isFinite(safeDisplayMax) || safeDisplayMax <= 0) {
    return 0;
  }
  const clampedOutput = Math.max(0, Math.min(safeDisplayMax, safeOutput));
  return Math.max(0, Math.min(100, clampedOutput));
}
