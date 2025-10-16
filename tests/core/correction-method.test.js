import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const MODULE_PATH = '../../src/js/core/correction-method.js';

describe('correction method defaults', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    afterEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    it('selects Simple Scaling by default when no stored preference exists', async () => {
        vi.stubGlobal('localStorage', undefined);
        const mod = await import(MODULE_PATH);
        expect(mod.getCorrectionMethod()).toBe(mod.CORRECTION_METHODS.SIMPLE_SCALING);
    });

    it('respects persisted density solver preference', async () => {
        const mockStorage = {
            getItem: vi.fn().mockImplementation((key) => {
                if (key === 'quadgen.correctionMethod.v1') {
                    return 'densitySolver';
                }
                return null;
            }),
            setItem: vi.fn()
        };
        vi.stubGlobal('localStorage', mockStorage);
        const mod = await import(MODULE_PATH);
        expect(mod.getCorrectionMethod()).toBe(mod.CORRECTION_METHODS.DENSITY_SOLVER);
    });
});
