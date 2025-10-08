// Shared LAB math helpers (CIE luminance and density conversions)

export function lstarToY_CIE(L) {
    const l = Math.max(0, Math.min(100, Number(L)));
    if (l > 8) {
        const f = (l + 16) / 116;
        return f * f * f;
    }
    return l / 903.3;
}

export function log10Safe(x) {
    const v = Math.max(1e-6, Math.min(1, x));
    return Math.log(v) / Math.LN10;
}

export function cieDensityFromLstar(L) {
    const Y = lstarToY_CIE(L);
    return -log10Safe(Y);
}
