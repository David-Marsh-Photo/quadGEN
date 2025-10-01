// Visual regression test for chart refactoring
// Tests that all chart elements render correctly after removing duplicates

const { chromium } = require('playwright');
const fs = require('fs');

async function measureElement(page, selector) {
    return await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
        };
    }, selector);
}

async function getCanvasPixelData(page, region) {
    return await page.evaluate((r) => {
        const canvas = document.getElementById('inkChart');
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(r.x, r.y, r.width, r.height);

        // Calculate average color in region
        let totalR = 0, totalG = 0, totalB = 0, totalA = 0;
        const pixels = imageData.data.length / 4;

        for (let i = 0; i < imageData.data.length; i += 4) {
            totalR += imageData.data[i];
            totalG += imageData.data[i + 1];
            totalB += imageData.data[i + 2];
            totalA += imageData.data[i + 3];
        }

        return {
            avgR: Math.round(totalR / pixels),
            avgG: Math.round(totalG / pixels),
            avgB: Math.round(totalB / pixels),
            avgA: Math.round(totalA / pixels),
            pixels
        };
    }, region);
}

async function runTests() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('file://' + process.cwd() + '/index.html');
    await page.waitForTimeout(1500); // Wait for chart to render

    console.log('=== Visual Regression Test Results ===\n');

    const results = {
        passed: 0,
        failed: 0,
        tests: []
    };

    function logTest(name, passed, details) {
        const status = passed ? '✓ PASS' : '✗ FAIL';
        console.log(`${status}: ${name}`);
        if (details) console.log(`  ${details}`);
        results.tests.push({ name, passed, details });
        if (passed) results.passed++;
        else results.failed++;
    }

    // Test 1: Chart canvas exists and has correct dimensions
    const canvasInfo = await page.evaluate(() => {
        const canvas = document.getElementById('inkChart');
        return canvas ? {
            width: canvas.width,
            height: canvas.height,
            exists: true
        } : { exists: false };
    });
    logTest('Chart canvas renders', canvasInfo.exists, `Dimensions: ${canvasInfo.width}x${canvasInfo.height}`);

    // Test 2: Verify gradient bars are present
    const gradientCheck = await page.evaluate(() => {
        const canvas = document.getElementById('inkChart');
        const ctx = canvas.getContext('2d');

        // Check vertical gradient area (left side, black to white)
        const vertGradSample1 = ctx.getImageData(50, 250, 1, 1).data; // Mid-left area

        // Check horizontal gradient area (bottom, white to black)
        // Sample across multiple Y positions near bottom axis
        let foundWhite = false, foundBlack = false;
        for (let y = 405; y <= 420; y++) {
            for (let x = 100; x < 700; x += 50) {
                const sample = ctx.getImageData(x, y, 1, 1).data;
                if (sample[0] > 200) foundWhite = true;
                if (sample[0] < 100) foundBlack = true;
            }
            if (foundWhite && foundBlack) break;
        }

        return {
            verticalGradientPresent: vertGradSample1[0] > 0 || vertGradSample1[1] > 0,
            horizontalGradientLeftWhite: foundWhite,
            horizontalGradientRightDark: foundBlack
        };
    });

    logTest('Vertical gradient renders', gradientCheck.verticalGradientPresent);
    logTest('Horizontal gradient (white→black)',
        gradientCheck.horizontalGradientLeftWhite && gradientCheck.horizontalGradientRightDark,
        `Left: ${gradientCheck.horizontalGradientLeftWhite ? 'white' : 'dark'}, Right: ${gradientCheck.horizontalGradientRightDark ? 'dark' : 'white'}`
    );

    // Test 3: Check axis labels are present
    const labelCheck = await page.evaluate(() => {
        const canvas = document.getElementById('inkChart');
        const ctx = canvas.getContext('2d');

        // Sample areas where labels should be
        // X-axis label area (bottom, should have text)
        const xLabelArea = ctx.getImageData(125, 425, 50, 20);

        // Y-axis label area (left side, should have text)
        const yLabelArea = ctx.getImageData(30, 250, 30, 15);

        // Check if there's non-white content (text)
        function hasContent(imageData) {
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                // If pixel is not white or very light gray
                if (r < 240 || g < 240 || b < 240) {
                    return true;
                }
            }
            return false;
        }

        return {
            xAxisLabelsPresent: hasContent(xLabelArea),
            yAxisLabelsPresent: hasContent(yLabelArea)
        };
    });

    logTest('X-axis labels render', labelCheck.xAxisLabelsPresent);
    logTest('Y-axis labels render', labelCheck.yAxisLabelsPresent);

    // Test 4: Check axis titles are present
    const titleCheck = await page.evaluate(() => {
        const canvas = document.getElementById('inkChart');
        const ctx = canvas.getContext('2d');

        // X-axis title area (bottom center)
        const xTitleArea = ctx.getImageData(300, 440, 200, 15);

        // Y-axis title area (left, vertical text)
        const yTitleArea = ctx.getImageData(5, 200, 15, 150);

        function hasContent(imageData) {
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                if (r < 240) return true;
            }
            return false;
        }

        return {
            xAxisTitlePresent: hasContent(xTitleArea),
            yAxisTitlePresent: hasContent(yTitleArea)
        };
    });

    logTest('X-axis title "INPUT LEVEL %" renders', titleCheck.xAxisTitlePresent);
    logTest('Y-axis title "OUTPUT INK LEVEL %" renders', titleCheck.yAxisTitlePresent);

    // Test 5: Check diagonal line (MK 100% curve) is present
    const curveCheck = await page.evaluate(() => {
        const canvas = document.getElementById('inkChart');
        const ctx = canvas.getContext('2d');

        // Sample points along where diagonal should be
        const samples = [];
        for (let i = 0; i < 5; i++) {
            const x = 150 + (i * 100);
            const y = 370 - (i * 60);
            const pixel = ctx.getImageData(x, y, 1, 1).data;
            // Check if it's dark (the curve line)
            samples.push(pixel[0] < 100 && pixel[1] < 100 && pixel[2] < 100);
        }

        return {
            curvePresent: samples.filter(s => s).length >= 3 // At least 3 of 5 samples hit the line
        };
    });

    logTest('Diagonal curve renders', curveCheck.curvePresent);

    // Test 6: Check grid lines are present
    const gridCheck = await page.evaluate(() => {
        const canvas = document.getElementById('inkChart');
        const ctx = canvas.getContext('2d');

        // Sample vertical grid line area
        const vGridSample = ctx.getImageData(200, 200, 1, 100);

        // Sample horizontal grid line area
        const hGridSample = ctx.getImageData(150, 300, 100, 1);

        function hasLightGrayLines(imageData) {
            for (let i = 0; i < imageData.data.length; i += 4) {
                const r = imageData.data[i];
                const g = imageData.data[i + 1];
                const b = imageData.data[i + 2];
                // Light gray grid lines
                if (r > 200 && r < 245 && g > 200 && g < 245 && b > 200 && b < 245) {
                    return true;
                }
            }
            return false;
        }

        return {
            gridPresent: hasLightGrayLines(vGridSample) || hasLightGrayLines(hGridSample)
        };
    });

    logTest('Grid lines render', gridCheck.gridPresent);

    // Test 7: Verify spacing - labels should be away from gradients
    const spacingCheck = await page.evaluate(() => {
        const canvas = document.getElementById('inkChart');
        const ctx = canvas.getContext('2d');

        // Check X-axis: gradient should be at bottom, labels should be below
        // Sample multiple Y positions to find gradient
        let gradientFound = false;
        for (let y = 405; y <= 415; y++) {
            const row = ctx.getImageData(200, y, 300, 1);
            let hasWhite = false, hasBlack = false;
            for (let i = 0; i < row.data.length; i += 4) {
                if (row.data[i] > 200) hasWhite = true;
                if (row.data[i] < 100) hasBlack = true;
            }
            if (hasWhite && hasBlack) {
                gradientFound = true;
                break;
            }
        }

        const labelRow = ctx.getImageData(200, 430, 300, 1);

        function hasText(imageData) {
            for (let i = 0; i < imageData.data.length; i += 4) {
                if (imageData.data[i] < 150) return true;
            }
            return false;
        }

        return {
            gradientAtCorrectPosition: gradientFound,
            labelsSpacedBelow: hasText(labelRow)
        };
    });

    logTest('Gradient and labels properly spaced',
        spacingCheck.gradientAtCorrectPosition && spacingCheck.labelsSpacedBelow,
        `Gradient: ${spacingCheck.gradientAtCorrectPosition}, Labels: ${spacingCheck.labelsSpacedBelow}`
    );

    // Take a screenshot for manual verification
    await page.screenshot({ path: 'test-refactor-result.png' });
    console.log('\n📸 Screenshot saved to test-refactor-result.png');

    // Summary
    console.log('\n=== Test Summary ===');
    console.log(`Total Tests: ${results.tests.length}`);
    console.log(`Passed: ${results.passed}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Success Rate: ${Math.round((results.passed / results.tests.length) * 100)}%`);

    await browser.close();

    // Exit with error code if tests failed
    process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});