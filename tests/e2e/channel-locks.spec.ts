import { test, expect } from '@playwright/test';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const indexUrl = pathToFileURL(resolve('index.html')).href;
const manualLabPath = resolve('testdata/Manual-LAB-Data.txt');

async function gotoApp(page) {
    await page.goto(indexUrl);
    await page.waitForSelector('tr.channel-row[data-channel="MK"]');
    await page.evaluate(() => {
        const row = document.querySelector('tr.channel-row[data-channel="MK"]');
        if (row) {
            row.style.display = 'table-row';
            row.setAttribute('data-compact', 'false');
        }
    });
}

async function activateChannel(page, channelName) {
    const alreadyActive = await page.evaluate((name) => {
        const row = document.querySelector(`tr.channel-row[data-channel="${name}"]`);
        if (!row) return false;
        const compact = row.getAttribute('data-compact');
        return compact !== 'true';
    }, channelName);
    if (alreadyActive) {
        return;
    }
    const chip = page.locator('#disabledChannelsRow .disabled-channel-chip', { hasText: channelName });
    await chip.first().click();
    await page.waitForFunction(
        (name) => {
            const row = document.querySelector(`tr.channel-row[data-channel="${name}"]`);
            return row && row.getAttribute('data-compact') !== 'true';
        },
        channelName,
        { timeout: 5000 }
    );
}

async function loadManualLab(page) {
    await page.setInputFiles('input#linearizationFile', manualLabPath);
    await page.waitForFunction(
        () => document.getElementById('globalLinearizationFilename')?.textContent?.trim() === 'Manual-LAB-Data.txt',
        undefined,
        { timeout: 15000 }
    );
}

async function enableEditMode(page) {
    await page.locator('#editModeToggleBtn').click();
    await page.waitForFunction(() => window.isEditModeEnabled?.(), undefined, { timeout: 10000 });
}

async function waitForSmartPoints(page) {
    await page.waitForFunction(
        () => {
            const channel = (window as any).EDIT?.selectedChannel;
            const points = (window as any).ControlPoints?.get(channel)?.points;
            return Array.isArray(points) && points.length >= 5;
        },
        undefined,
        { timeout: 10000 }
    );
}

async function selectOrdinal(page, ordinal) {
    const current = await page.evaluate(() => (window as any).EDIT?.selectedOrdinal ?? 1);
    if (current === ordinal) return;
    const delta = ordinal - current;
    const control = delta > 0 ? '#editPointRight' : '#editPointLeft';
    const steps = Math.abs(delta);
    for (let i = 0; i < steps; i += 1) {
        await page.locator(control).click();
    }
    await page.waitForFunction(
        (target) => (window as any).EDIT?.selectedOrdinal === target,
        ordinal,
        { timeout: 2000 }
    );
}

async function getSelectedPoint(page) {
    return page.evaluate(() => {
        const channel = (window as any).EDIT?.selectedChannel ?? null;
        const ordinal = (window as any).EDIT?.selectedOrdinal ?? 1;
        const cp = (window as any).ControlPoints?.get(channel)?.points || [];
        const point = cp[ordinal - 1] || null;
        const compat = (window as any).__quadDebug?.compat;
        const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
        const absoluteOutput = point && typeof toAbsolute === 'function'
            ? toAbsolute(channel, point.output)
            : point?.output ?? null;
        return {
            channel,
            ordinal,
            input: point?.input ?? null,
            output: point?.output ?? null,
            absoluteOutput
        };
    });
}

async function getSmartPointCount(page, channelName) {
    return page.evaluate((ch) => {
        if (!ch) return 0;
        const entry = (window as any).ControlPoints?.get(ch);
        if (!entry || !Array.isArray(entry.points)) {
            return 0;
        }
        return entry.points.length;
    }, channelName);
}

async function computeInsertTarget(page) {
    return page.evaluate(() => {
        const channel = (window as any).EDIT?.selectedChannel ?? null;
        const entry = channel ? (window as any).ControlPoints?.get(channel) : null;
        if (!channel || !entry || !Array.isArray(entry.points) || entry.points.length < 2) {
            throw new Error('Smart points unavailable for insertion');
        }

        const sorted = entry.points
            .map((p) => ({ input: Number(p.input), output: Number(p.output) }))
            .sort((a, b) => a.input - b.input);

        let inputPercent = null;
        const minGap = 1.0;
        for (let i = 0; i < sorted.length - 1; i += 1) {
            const gap = sorted[i + 1].input - sorted[i].input;
            if (gap > minGap) {
                inputPercent = sorted[i].input + gap / 2;
                break;
            }
        }

        if (inputPercent === null) {
            const fallback = sorted[Math.floor(sorted.length / 2)]?.input ?? 50;
            inputPercent = Math.max(1, Math.min(99, fallback + 0.75));
        }

        const compat = (window as any).__quadDebug?.compat;
        const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
        const relative = typeof (window as any).ControlPoints?.sampleY === 'function'
            ? (window as any).ControlPoints.sampleY(sorted, entry.interpolation || 'smooth', inputPercent)
            : null;
        const absolute = typeof toAbsolute === 'function'
            ? toAbsolute(channel, relative)
            : (relative ?? 50);

        const canvas = document.getElementById('inkChart') as HTMLCanvasElement | null;
        if (!canvas) {
            throw new Error('Ink chart canvas missing');
        }

        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
        const topPadding = 12 * dpr;
        const bottomPadding = 40 * dpr;
        const leftPadding = (36 + 26) * dpr;
        const rightPadding = (36 + 34) * dpr;
        const chartWidth = Math.max(0, canvas.width - leftPadding - rightPadding);
        const chartHeight = Math.max(0, canvas.height - topPadding - bottomPadding);
        const clampedInput = Math.max(0, Math.min(100, inputPercent));
        const clampedAbsolute = Math.max(0, Math.min(100, absolute ?? 50));
        const xCanvas = leftPadding + chartWidth * (clampedInput / 100);
        const yCanvas = canvas.height - bottomPadding - chartHeight * (clampedAbsolute / 100);
        const scaleX = canvas.width / Math.max(rect.width, 1);
        const scaleY = canvas.height / Math.max(rect.height, 1);

        return {
            channel,
            clientX: rect.left + xCanvas / scaleX,
            clientY: rect.top + yCanvas / scaleY,
            inputPercent: clampedInput,
            absoluteOutput: clampedAbsolute,
            pointCount: sorted.length
        };
    });
}

test.describe('Channel lock controls', () => {
    test('locking disables channel inputs', async ({ page }) => {
        page.on('console', (msg) => {
            console.log('PAGE_LOG', msg.type(), msg.text());
        });
        await gotoApp(page);
        await activateChannel(page, 'MK');
        const percentInput = page.locator('tr.channel-row[data-channel="MK"] .percent-input');
        const endInput = page.locator('tr.channel-row[data-channel="MK"] .end-input');
        const lockButton = page.locator('tr.channel-row[data-channel="MK"] .channel-lock-btn');
        const globalScaleInput = page.locator('#scaleAllInput');

        await expect(percentInput).toBeEnabled();
        await expect(endInput).toBeEnabled();
        await expect(globalScaleInput).toBeEnabled();

        await lockButton.click({ force: true });

        await expect(percentInput).toBeDisabled();
        await expect(endInput).toBeDisabled();
        await expect(globalScaleInput).toBeDisabled();

        const scaleTooltip = await globalScaleInput.getAttribute('title');
        expect(scaleTooltip ?? '').toContain('Unlock');

        const coordinatorResult = await page.evaluate(async () => {
            try {
                await window.scalingCoordinator.scale(120, 'test-lock-check', { priority: 'high' });
                return { success: true };
            } catch (error) {
                return { success: false, message: error?.message || String(error) };
            }
        });

        expect(coordinatorResult.success).toBeFalsy();
        expect(coordinatorResult.message || '').toContain('Unlock');

        // Unlock restores inputs
        await lockButton.click({ force: true });
        await expect(percentInput).toBeEnabled();
        await expect(endInput).toBeEnabled();
        await expect(globalScaleInput).toBeEnabled();

        // Change value while unlocked
        await percentInput.fill('65');
        await percentInput.press('Enter');
        await expect(percentInput).toHaveValue('65');

        // Relock and ensure values stick + remain protected
        await lockButton.click();
        await expect(percentInput).toBeDisabled();
        await expect(endInput).toBeDisabled();
        await expect(globalScaleInput).toBeDisabled();
    });

    test('locked channel clamps Smart point edits to ink limit', async ({ page }) => {
        await gotoApp(page);
        await activateChannel(page, 'MK');
        await loadManualLab(page);
        await enableEditMode(page);
        await waitForSmartPoints(page);

        const mkRow = page.locator('tr.channel-row[data-channel="MK"]');
        const percentInput = mkRow.locator('.percent-input');
        const lockButton = mkRow.locator('.channel-lock-btn');

        // Set MK ink limit to 60% while unlocked
        await percentInput.fill('60');
        await percentInput.press('Enter');
        await expect(percentInput).toHaveValue('60');

        // Lock the channel
        await lockButton.click();
        await expect(percentInput).toBeDisabled();

        await selectOrdinal(page, 3);
        const before = await getSelectedPoint(page);
        expect(before.channel).toBe('MK');

        const target = await page.evaluate(() => {
            const channel = (window as any).EDIT?.selectedChannel ?? null;
            const ordinal = (window as any).EDIT?.selectedOrdinal ?? 1;
            const cp = (window as any).ControlPoints?.get(channel)?.points || [];
            const point = cp[ordinal - 1];
            const canvas = document.getElementById('inkChart');
            if (!canvas || !point) {
                throw new Error('Unable to locate Smart point for drag test');
            }
            const rect = canvas.getBoundingClientRect();
            const dpr = Math.max(window.devicePixelRatio || 1, 1);
            const topPadding = 12 * dpr;
            const bottomPadding = 40 * dpr;
            const leftPadding = (36 + 26) * dpr;
            const rightPadding = (36 + 34) * dpr;
            const width = Math.max(0, canvas.width - leftPadding - rightPadding);
            const height = Math.max(0, canvas.height - topPadding - bottomPadding);
            const compat = (window as any).__quadDebug?.compat;
            const toAbsolute = compat?.smartCurves?.toAbsoluteOutput;
            const abs = typeof toAbsolute === 'function' ? toAbsolute(channel, point.output) : point.output;
            const x = leftPadding + width * (point.input / 100);
            const y = canvas.height - bottomPadding - height * ((abs ?? 0) / 100);
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            return {
                clientX: rect.left + x / scaleX,
                clientY: rect.top + y / scaleY
            };
        });

        await page.mouse.move(target.clientX, target.clientY);
        await page.mouse.down();
        // Drag well above the locked limit (toward 90%)
        await page.mouse.move(target.clientX, target.clientY - 160, { steps: 10 });
        await page.mouse.up();

        const after = await getSelectedPoint(page);
        expect(after.channel).toBe('MK');
        expect(after.absoluteOutput).toBeLessThanOrEqual(60.5);
    });

    test('channel lock toggles are undoable/redone via history controls', async ({ page }) => {
        await gotoApp(page);
        await activateChannel(page, 'MK');

        const mkRow = page.locator('tr.channel-row[data-channel="MK"]');
        const lockButton = mkRow.locator('.channel-lock-btn');
        const percentInput = mkRow.locator('.percent-input');
        const undoButton = page.locator('#undoBtn');
        const redoButton = page.locator('#redoBtn');

        await expect(lockButton).toHaveAttribute('data-locked', 'false');
        await expect(percentInput).toBeEnabled();
        await expect(undoButton).toBeDisabled();
        await expect(redoButton).toBeDisabled();

        await lockButton.click({ force: true });

        await expect(lockButton).toHaveAttribute('data-locked', 'true');
        await expect(percentInput).toBeDisabled();
        await expect(undoButton).toBeEnabled();

        await undoButton.click();

        await expect(lockButton).toHaveAttribute('data-locked', 'false');
        await expect(percentInput).toBeEnabled();
        await expect(redoButton).toBeEnabled();

        await redoButton.click();

        await expect(lockButton).toHaveAttribute('data-locked', 'true');
        await expect(percentInput).toBeDisabled();
    });

    test('locked channel prevents Smart point insertion', async ({ page }) => {
        await gotoApp(page);
        await activateChannel(page, 'MK');
        await loadManualLab(page);
        await enableEditMode(page);
        await waitForSmartPoints(page);

        const channelName = await page.evaluate(() => (window as any).EDIT?.selectedChannel ?? 'MK');
        const mkRow = page.locator(`tr.channel-row[data-channel="${channelName}"]`);
        const lockButton = mkRow.locator('.channel-lock-btn');

        const initialCount = await getSmartPointCount(page, channelName);
        expect(initialCount).toBeGreaterThan(2);

        await lockButton.click({ force: true });
        await expect(lockButton).toHaveAttribute('data-locked', 'true');

        const target = await computeInsertTarget(page);
        await page.mouse.move(target.clientX, target.clientY);
        await page.mouse.click(target.clientX, target.clientY);

        await expect.poll(async () => getSmartPointCount(page, channelName)).toBe(initialCount);
    });

    test('locked channel prevents Smart point deletion', async ({ page }) => {
        await gotoApp(page);
        await activateChannel(page, 'MK');
        await loadManualLab(page);
        await enableEditMode(page);
        await waitForSmartPoints(page);

        const channelName = await page.evaluate(() => (window as any).EDIT?.selectedChannel ?? 'MK');
        const mkRow = page.locator(`tr.channel-row[data-channel="${channelName}"]`);
        const lockButton = mkRow.locator('.channel-lock-btn');

        const initialCount = await getSmartPointCount(page, channelName);
        expect(initialCount).toBeGreaterThan(2);

        await lockButton.click({ force: true });
        await expect(lockButton).toHaveAttribute('data-locked', 'true');

        await selectOrdinal(page, 3);
        await page.locator('#editDeleteBtn').click();

        await expect.poll(async () => getSmartPointCount(page, channelName)).toBe(initialCount);
    });
});
