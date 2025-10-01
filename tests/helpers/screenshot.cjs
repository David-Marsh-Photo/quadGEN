const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function captureFailure(page, name = 'failure', options = {}) {
  if (!page || typeof page.screenshot !== 'function') return null;
  const outDir = path.resolve(process.cwd(), 'runner/results/artifacts');
  ensureDir(outDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${name}.png`;
  const screenshotPath = path.join(outDir, filename);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, ...options });
    console.log(`[artifact] screenshot saved: ${path.relative(process.cwd(), screenshotPath)}`);
    return screenshotPath;
  } catch (error) {
    console.warn('[artifact] Failed to capture screenshot:', error.message);
    return null;
  }
}

module.exports = {
  captureFailure
};
