import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('global correction help popup markup', () => {
  it('has balanced <div> tags', () => {
    const html = readFileSync('src/index.template.html', 'utf8');
    const startIndex = html.indexOf('<div id="globalCorrectionHelpPopup"');

    expect(startIndex).toBeGreaterThanOrEqual(0);

    const endIndex = html.indexOf('<!-- Intent Help Popup', startIndex);

    expect(endIndex).toBeGreaterThan(startIndex);

    const snippet = html.slice(startIndex, endIndex);
    const openCount = (snippet.match(/<div\b/gi) || []).length;
    const closeCount = (snippet.match(/<\/div>/gi) || []).length;

    expect(closeCount).toBe(
      openCount,
      'Mismatched <div> closures in globalCorrectionHelpPopup markup'
    );
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
