export const DEFAULT_CLAMP_MIN = 0.85;
export const DEFAULT_CLAMP_MAX = 1.9;
export const DEFAULT_RESOLUTION = 256;

export function configureSimpleScaling(options = {}) {
    return {
        clampMin: Number.isFinite(options.clampMin) ? options.clampMin : DEFAULT_CLAMP_MIN,
        clampMax: Number.isFinite(options.clampMax) ? options.clampMax : DEFAULT_CLAMP_MAX,
        resolution: Number.isFinite(options.resolution) ? Math.max(16, Math.floor(options.resolution)) : DEFAULT_RESOLUTION
    };
}
