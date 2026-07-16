import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('template modal markup', () => {
  it('does not retain the obsolete global correction help popup', () => {
    const html = readFileSync('src/index.template.html', 'utf8');

    expect(html.includes('id="globalCorrectionHelpPopup"')).toBe(false);
    expect(html.includes('id="closeGlobalCorrectionHelpBtn"')).toBe(false);
  });

  it('wraps the app shell in a properly closed main/section pair', () => {
    const html = readFileSync('src/index.template.html', 'utf8');

    const mainOpen = html.indexOf('<main class="main-container">');
    const mainClose = html.indexOf('</main>', mainOpen + 1);
    const sectionOpen = html.indexOf('<section class="app-shell', mainOpen);
    const sectionClose = html.indexOf('</section>', sectionOpen + 1);

    expect(mainOpen).toBeGreaterThanOrEqual(0);
    expect(sectionOpen).toBeGreaterThan(mainOpen);
    expect(sectionClose).toBeGreaterThan(sectionOpen);
    expect(mainClose).toBeGreaterThan(sectionClose);
  });
});
