import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const url = pathToFileURL(resolve('index.html')).href;
  await page.goto(url);

  const diagnostics = await page.evaluate(() => {
    const quadInput = document.querySelector('#quadFile');
    const labInput = document.querySelector('#linearizationFile');
    const slider = document.querySelector('#plotSmoothingPercentSlider');
    const label = document.querySelector('#plotSmoothingPercentLabel');
    const value = document.querySelector('#plotSmoothingPercentValue');

    return {
      hasQuadInput: !!quadInput,
      hasLabInput: !!labInput,
      slider: slider
        ? {
            min: slider.min,
            max: slider.max,
            step: slider.step,
            value: slider.value,
            ariaLabelledBy: slider.getAttribute('aria-labelledby'),
            isDisabled: slider.hasAttribute('disabled')
          }
        : null,
      labelText: label ? label.textContent?.trim() : null,
      valueText: value ? value.textContent?.trim() : null
    };
  });

  console.log('[diagnostic] smoothing UI:', diagnostics);

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
