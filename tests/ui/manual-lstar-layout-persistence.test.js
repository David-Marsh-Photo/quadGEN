import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fileOps from '../../src/js/files/file-operations.js';

vi.mock('../../src/js/files/file-operations.js', () => ({
  updateFilename: vi.fn(),
  downloadFile: vi.fn()
}));

const LAYOUT_STORAGE_KEY = 'quadgen.manualLstarLayout';
const TEST_HTML = `
  <!doctype html>
  <html>
    <body>
      <div id="lstarModal" class="hidden"></div>
      <table>
        <tbody id="lstarInputs"></tbody>
      </table>
      <input id="lstarCountInput" type="number" value="5" />
      <input id="lstarCountInputHeader" type="number" value="5" />
      <div id="lstarValidation"></div>
      <button id="generateFromLstar"></button>
      <button id="saveLstarTxt"></button>
      <button id="addLstarInput"></button>
      <button id="removeLstarInput"></button>
      <button id="addLstarInputHeader"></button>
      <button id="removeLstarInputHeader"></button>
      <input id="manualLstarDensityToggle" type="checkbox" />
      <table>
        <tbody id="rows"></tbody>
      </table>
    </body>
  </html>
`;

describe('manual L* patch layout persistence', () => {
  let dom;
  let storage;
  let manualModule;
  let elements;

  beforeEach(async () => {
    vi.resetModules();

    storage = new Map();

    dom = new JSDOM(TEST_HTML, { url: 'https://example.com' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.localStorage = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
      clear: () => { storage.clear(); }
    };
    Object.defineProperty(dom.window, 'localStorage', {
      value: global.localStorage,
      configurable: true
    });
    global.MutationObserver = class {
      disconnect() {}
      observe() {}
    };

    fileOps.downloadFile.mockClear();
    fileOps.updateFilename.mockClear();

    const stateModule = await import('../../src/js/core/state.js');
    stateModule.initializeElements();
    elements = stateModule.elements;

    manualModule = await import('../../src/js/ui/manual-lstar.js');
    manualModule.initializeManualLstar();
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.MutationObserver;
  });

  it('replays stored patch percents into the grid', () => {
    storage.set(LAYOUT_STORAGE_KEY, JSON.stringify({
      patchCount: 7,
      patchPercents: [0, 2.5, 5, 12.5, 25, 50, 87.5]
    }));

    const debugModule = window.manualLstarModule;
    expect(debugModule).toBeDefined();
    expect(debugModule._internal).toBeDefined();
    expect(typeof debugModule._internal.restoreLayoutFromStorage).toBe('function');

    debugModule._internal.restoreLayoutFromStorage();
    debugModule._internal.updateRows();

    const patchInputs = Array.from(document.querySelectorAll('#lstarInputs .lstar-measured-x'));
    const values = patchInputs.map((input) => input.value);
    const countInput = document.getElementById('lstarCountInput');

    expect(patchInputs).toHaveLength(7);
    expect(values).toEqual(['0.0', '2.5', '5.0', '12.5', '25.0', '50.0', '87.5']);
    expect(countInput.value).toBe('7');
  });

  it('persists patch layout to localStorage when saving manual entries', () => {
    const debugModule = window.manualLstarModule;
    debugModule._internal.updateRows({ savedPatchPercents: [0, 4, 10, 25, 50] });

    const percentInputs = Array.from(document.querySelectorAll('#lstarInputs .lstar-measured-x'));
    const measuredInputs = Array.from(document.querySelectorAll('#lstarInputs .lstar-input'));
    const patchPercents = [0, 4, 10, 25, 50];
    const measuredValues = [100, 95, 88, 72, 55];

    percentInputs.forEach((input, index) => {
      input.value = patchPercents[index].toFixed(1);
    });
    measuredInputs.forEach((input, index) => {
      input.value = measuredValues[index].toFixed(1);
    });

    expect(elements.saveLstarTxt).toBeDefined();
    elements.saveLstarTxt.click();

    expect(fileOps.downloadFile).toHaveBeenCalledTimes(1);
    const stored = storage.get(LAYOUT_STORAGE_KEY);
    expect(stored).toBeTruthy();
    const parsed = stored ? JSON.parse(stored) : null;
    expect(parsed?.patchCount).toBe(5);
    expect(parsed?.patchPercents).toEqual(patchPercents);
  });
});
