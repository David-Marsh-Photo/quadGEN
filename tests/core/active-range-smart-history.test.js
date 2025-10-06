import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const bootstrapDom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = bootstrapDom.window;
global.document = bootstrapDom.window.document;
global.Blob = bootstrapDom.window.Blob;

let setLoadedQuadData;
let getLoadedQuadData;
let elements;
let setEditModeFlag;
let resetAppState;
let TOTAL;
let PRINTERS;
let LinearizationState;
let parseQuadFile;
let parseLabData;
let applyDefaultLabSmoothingToEntry;
let simplifySmartKeyPointsFromCurve;
let make256;
let buildQuadFile;
let setActiveRangeLinearizationEnabled;
let resetFeatureFlags;
let ControlPoints;

const quadPath = 'data/P800_K37_C26_LK25_V1.quad';
const labPath = 'data/P800_K37_C26_LK25_V1_correction.txt';

beforeAll(async () => {
  const stateModule = await import('../../src/js/core/state.js');
  setLoadedQuadData = stateModule.setLoadedQuadData;
  getLoadedQuadData = stateModule.getLoadedQuadData;
  elements = stateModule.elements;
  setEditModeFlag = stateModule.setEditModeFlag;
  resetAppState = stateModule.resetAppState;
  TOTAL = stateModule.TOTAL;
  PRINTERS = stateModule.PRINTERS;

  const linearizationModule = await import('../../src/js/data/linearization-utils.js');
  LinearizationState = linearizationModule.LinearizationState;

  const parserModule = await import('../../src/js/parsers/file-parsers.js');
  parseQuadFile = parserModule.parseQuadFile;

  const labModule = await import('../../src/js/data/lab-parser.js');
  parseLabData = labModule.parseLabData;
  applyDefaultLabSmoothingToEntry = labModule.applyDefaultLabSmoothingToEntry;

  const smartModule = await import('../../src/js/curves/smart-curves.js');
  simplifySmartKeyPointsFromCurve = smartModule.simplifySmartKeyPointsFromCurve;
  ControlPoints = smartModule.ControlPoints;

  const pipelineModule = await import('../../src/js/core/processing-pipeline.js');
  make256 = pipelineModule.make256;

  if (typeof global.localStorage === 'undefined') {
    const storage = new Map();
    global.localStorage = {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(String(key), String(value)),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear()
    };
  }

  const fileOpsModule = await import('../../src/js/files/file-operations.js');
  buildQuadFile = fileOpsModule.buildQuadFile;

  const flagsModule = await import('../../src/js/core/feature-flags.js');
  setActiveRangeLinearizationEnabled = flagsModule.setActiveRangeLinearizationEnabled;
  resetFeatureFlags = flagsModule.resetFeatureFlags;
});

function loadFixture(relativePath) {
  const absolute = path.resolve(relativePath);
  return fs.readFileSync(absolute, 'utf8');
}

function setupDom({ printerId, channels, endValues }) {
  const rowsHtml = channels
    .map((channel) => `
      <tr data-channel="${channel}">
        <td>
          <span><span class="swatch"></span><span>${channel}</span></span>
        </td>
        <td><input class="end-input" value="${endValues?.[channel] ?? TOTAL}"></td>
        <td><input class="percent-input" value="100"></td>
      </tr>
    `)
    .join('');

  const dom = new JSDOM(`<!doctype html><html><body>
    <select id="printerSelect">
      <option value="${printerId}" selected>${printerId}</option>
    </select>
    <input id="filenameInput" value="fixture">
    <textarea id="userNotes"></textarea>
    <table><tbody id="channels">${rowsHtml}</tbody></table>
  </body></html>`);

  global.window = dom.window;
  global.document = dom.window.document;
  global.Blob = dom.window.Blob;

  elements.rows = document.getElementById('channels');
  elements.printerSelect = document.getElementById('printerSelect');
  elements.printerSelect.value = printerId;
  elements.filenameInput = document.getElementById('filenameInput');
  elements.userNotes = document.getElementById('userNotes');
  elements.autoWhiteLimitToggle = { checked: false };
  elements.autoBlackLimitToggle = { checked: false };
  elements.curveSmoothingMethod = { value: 'cubic' };
  elements.tuningSmoothingPercent = { value: '0' };
}

function teardownDom() {
  delete global.window;
  delete global.document;
  delete global.Blob;
  elements.rows = null;
  elements.autoWhiteLimitToggle = null;
  elements.autoBlackLimitToggle = null;
  elements.printerSelect = null;
  elements.filenameInput = null;
  elements.userNotes = null;
  elements.curveSmoothingMethod = null;
  elements.tuningSmoothingPercent = null;
}

function setupFixture({ activeRange }) {
  resetFeatureFlags({ activeRangeLinearization: !!activeRange });
  LinearizationState.clear();
  resetAppState();

  const quadContent = loadFixture(quadPath);
  const parsedQuad = parseQuadFile(quadContent);
  setLoadedQuadData(parsedQuad);

  const labContent = loadFixture(labPath);
  const labEntryRaw = parseLabData(labContent, path.basename(labPath));
  const labEntry = applyDefaultLabSmoothingToEntry(labEntryRaw);
  LinearizationState.setGlobalData(labEntry, true);

  const printerId = 'P800';
  setupDom({
    printerId,
    channels: PRINTERS[printerId].channels,
    endValues: parsedQuad.baselineEnd
  });
  setEditModeFlag(true);

  if (activeRange) {
    setActiveRangeLinearizationEnabled(true);
  }
}

describe('Active-range integration with Smart/history', () => {
  beforeEach(() => {
    setupFixture({ activeRange: true });
  });

  afterEach(() => {
    resetFeatureFlags();
    LinearizationState.clear();
    resetAppState();
    setEditModeFlag(false);
    teardownDom();
  });

  it('recompute history points align with active-range corrected curve', () => {
    const loaded = getLoadedQuadData();
    const endValue = (loaded?.baselineEnd?.K) ?? TOTAL;

    const curveWithActiveRange = make256(endValue, 'K', true);

    const result = simplifySmartKeyPointsFromCurve('K', {
      maxErrorPercent: 0.5,
      maxPoints: 16
    });

    expect(result.success).toBe(true);

    const storedPoints = ControlPoints.get('K')?.points || [];
    expect(storedPoints.length).toBeGreaterThan(1);

    const maxError = storedPoints.reduce((max, point) => {
      const index = Math.round((point.input / 100) * (curveWithActiveRange.length - 1));
      const expectedPercent = (curveWithActiveRange[index] / TOTAL) * 100;
      const delta = Math.abs(expectedPercent - point.output);
      return Math.max(max, delta);
    }, 0);

    expect(maxError).toBeLessThan(0.5);
  });

  it('exports active-range corrected curves when the flag is enabled', () => {
    const loaded = getLoadedQuadData();
    const endValue = (loaded?.baselineEnd?.K) ?? TOTAL;

    const expected = make256(endValue, 'K', true);
    expect(expected).toHaveLength(256);

    const content = buildQuadFile();
    const lines = content.trim().split('\n');
    const markerIndex = lines.indexOf('# K curve');
    expect(markerIndex).toBeGreaterThan(-1);

    const exported = lines.slice(markerIndex + 1, markerIndex + 1 + expected.length).map((value) => Number(value));
    expect(exported).toHaveLength(expected.length);
    expect(exported).toEqual(expected);
  });

  it('tracks active-range metadata across smart recompute', () => {
    simplifySmartKeyPointsFromCurve('K', {
      maxErrorPercent: 0.5,
      maxPoints: 12
    });

    let meta = getLoadedQuadData()?.keyPointsMeta?.K || {};
    expect(meta.activeRangeLinearized).toBe(true);

    teardownDom();
    setupFixture({ activeRange: false });

    simplifySmartKeyPointsFromCurve('K', {
      maxErrorPercent: 0.5,
      maxPoints: 12
    });

    meta = getLoadedQuadData()?.keyPointsMeta?.K || {};
    expect(meta.activeRangeLinearized).toBeUndefined();
  });
});
