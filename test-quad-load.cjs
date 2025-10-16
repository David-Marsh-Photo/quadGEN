const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Create a test .quad file with specific ink limits
const createTestQuadFile = () => {
    const lines = ['## QuadToneRIP K,C,M,Y', '# Test quad file with varying limits'];

    // K channel: 0-14418 (22% of 65535)
    for (let i = 0; i < 256; i++) {
        lines.push(String(Math.round((i / 255) * 14418)));
    }

    // C channel: 0-32768 (50% of 65535)
    for (let i = 0; i < 256; i++) {
        lines.push(String(Math.round((i / 255) * 32768)));
    }

    // M channel: 0-49152 (75% of 65535)
    for (let i = 0; i < 256; i++) {
        lines.push(String(Math.round((i / 255) * 49152)));
    }

    // Y channel: 0-65535 (100% of 65535)
    for (let i = 0; i < 256; i++) {
        lines.push(String(Math.round((i / 255) * 65535)));
    }

    return lines.join('\n');
};

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Navigate to the app
    await page.goto(`file://${process.cwd()}/index.html`);
    await page.waitForTimeout(1000);

    // Create test file
    const testQuadContent = createTestQuadFile();
    const testFilePath = path.join(process.cwd(), 'test-quad-limits.quad');
    fs.writeFileSync(testFilePath, testQuadContent);

    console.log('📝 Created test .quad file with specific limits:');
    console.log('  K: 14418 (22%)');
    console.log('  C: 32768 (50%)');
    console.log('  M: 49152 (75%)');
    console.log('  Y: 65535 (100%)');

    // Load the quad file
    await page.setInputFiles('input[type="file"]#quadFile', testFilePath);
    await page.waitForTimeout(1500);

    // Check what values were loaded
    const result = await page.evaluate(() => {
        const rows = document.querySelectorAll('[data-channel]');
        const channels = {};

        rows.forEach(row => {
            const channelName = row.dataset.channel;
            const endInput = row.querySelector('.end-input');
            const percentInput = row.querySelector('.percent-input');

            if (endInput && percentInput) {
                channels[channelName] = {
                    endValue: parseInt(endInput.value),
                    percent: parseFloat(percentInput.value)
                };
            }
        });

        // Also check loaded quad data
        const loadedData = window.loadedQuadData || window.getLoadedQuadData?.();

        return {
            uiChannels: channels,
            loadedQuadData: loadedData ? {
                values: loadedData.values,
                baselineEnd: loadedData.baselineEnd,
                channels: loadedData.channels
            } : null
        };
    });

    console.log('\n📊 Loaded UI Values:');
    console.log(JSON.stringify(result.uiChannels, null, 2));

    console.log('\n📊 Loaded Quad Data:');
    console.log(JSON.stringify(result.loadedQuadData, null, 2));

    // Verify the values
    const expected = {
        K: { endValue: 14418, percent: 22 },
        C: { endValue: 32768, percent: 50 },
        M: { endValue: 49152, percent: 75 },
        Y: { endValue: 65535, percent: 100 }
    };

    console.log('\n✅ Expected Values:');
    console.log(JSON.stringify(expected, null, 2));

    // Check for discrepancies
    console.log('\n🔍 Checking for discrepancies:');
    let hasErrors = false;

    for (const [channel, expectedVals] of Object.entries(expected)) {
        const actual = result.uiChannels[channel];
        if (!actual) {
            console.log(`❌ Channel ${channel} not found in UI`);
            hasErrors = true;
            continue;
        }

        const endMatch = Math.abs(actual.endValue - expectedVals.endValue) < 10;
        const percentMatch = Math.abs(actual.percent - expectedVals.percent) < 1;

        if (!endMatch || !percentMatch) {
            console.log(`❌ ${channel}: Expected ${expectedVals.percent}% (${expectedVals.endValue}), got ${actual.percent}% (${actual.endValue})`);
            hasErrors = true;
        } else {
            console.log(`✅ ${channel}: ${actual.percent}% (${actual.endValue})`);
        }
    }

    if (!hasErrors) {
        console.log('\n✅ All values loaded correctly!');
    } else {
        console.log('\n❌ BUG CONFIRMED: Ink limits not loaded correctly from .quad file');
    }

    // Cleanup
    fs.unlinkSync(testFilePath);
    await browser.close();
})();
