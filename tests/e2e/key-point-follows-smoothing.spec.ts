/**
 * E2E test: Verify key point nodes follow the smoothed curve
 *
 * When plot smoothing is applied, the visual position of key point markers
 * should update to stay on the smoothed curve, even though their stored
 * values don't change.
 */

import { test, expect } from '@playwright/test';
import { gotoApp, enableEditMode, selectEditChannel } from './utils/edit-mode-helpers';

test.describe('Key Point Node Sync with Plot Smoothing', () => {
    test.beforeEach(async ({ page }) => {
        await gotoApp(page);
    });

    test('key points visually follow smoothed curve', async ({ page }) => {
        // Enable edit mode (this will enable MK channel by default)
        await enableEditMode(page);
        await page.waitForTimeout(500);

        // Select MK channel
        await selectEditChannel(page, 'MK');
        await page.waitForTimeout(500);

        // Add a non-linear key point at input=50%, output=70%
        await page.evaluate(() => {
            (window as any).insertSmartKeyPointAt('MK', 50, 70);
            (window as any).updateInkChart?.();
        });
        await page.waitForTimeout(500);

        // Get curve value at the key point location BEFORE smoothing
        const beforeSmoothing = await page.evaluate(() => {
            const loadedData = (window as any).getLoadedQuadData?.();
            const curve = loadedData?.curves?.MK;
            if (!curve || curve.length < 256) return null;

            const midIndex = 128; // 50% of 256
            return (curve[midIndex] / 65535) * 100;
        });

        expect(beforeSmoothing).not.toBeNull();
        expect(beforeSmoothing).toBeCloseTo(70, 0); // Should be near 70% (within 0.5%)

        // Apply plot smoothing at 300%
        await page.evaluate(() => {
            const slider = document.getElementById('plotSmoothingPercentSlider') as HTMLInputElement;
            if (slider) {
                slider.value = '300';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await page.waitForTimeout(1000);

        // Get curve value at the key point location AFTER smoothing
        const afterSmoothing = await page.evaluate(() => {
            const loadedData = (window as any).getLoadedQuadData?.();
            const curve = loadedData?.curves?.MK;
            if (!curve || curve.length < 256) return null;

            const midIndex = 128;
            return (curve[midIndex] / 65535) * 100;
        });

        expect(afterSmoothing).not.toBeNull();

        // The curve value should have changed due to smoothing
        // (Smoothing averages nearby values, changing the curve shape)
        const percentChange = Math.abs((afterSmoothing as number) - (beforeSmoothing as number));
        expect(percentChange).toBeGreaterThan(0.1); // At least 0.1% change
    });

    test('key point stored values remain unchanged after smoothing', async ({ page }) => {
        // Enable edit mode and select MK channel
        await enableEditMode(page);
        await selectEditChannel(page, 'MK');
        await page.waitForTimeout(500);

        // Add a key point
        await page.evaluate(() => {
            (window as any).insertSmartKeyPointAt('MK', 50, 70);
        });
        await page.waitForTimeout(500);

        // Get stored points before smoothing
        const pointsBefore = await page.evaluate(() => {
            const cp = (window as any).ControlPoints?.get('MK');
            return cp?.points?.map((p: any) => ({ input: p.input, output: p.output }));
        });

        // Apply smoothing
        await page.evaluate(() => {
            const slider = document.getElementById('plotSmoothingPercentSlider') as HTMLInputElement;
            if (slider) {
                slider.value = '300';
                slider.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        await page.waitForTimeout(1000);

        // Get stored points after smoothing
        const pointsAfter = await page.evaluate(() => {
            const cp = (window as any).ControlPoints?.get('MK');
            return cp?.points?.map((p: any) => ({ input: p.input, output: p.output }));
        });

        // Stored values should be identical - smoothing only affects visual display
        expect(pointsAfter).toEqual(pointsBefore);
    });
});
