import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

function makeStubElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    querySelector() { return makeStubElement(); },
    querySelectorAll() { return []; },
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    innerHTML: '',
    value: '',
    textContent: '',
    dataset: {},
    disabled: false
  };
}

function setupDomStubs() {
  const documentStub = {
    getElementById() { return makeStubElement(); },
    querySelector() { return makeStubElement(); },
    querySelectorAll() { return []; },
    createElement() { return makeStubElement(); },
    body: makeStubElement(),
    documentElement: makeStubElement(),
    addEventListener() {},
    removeEventListener() {}
  };

  global.document = documentStub;
  global.window = {
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    addEventListener() {},
    removeEventListener() {},
    location: { reload() {} },
    document: documentStub
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let parseQuadFile;
let parseLabData;
let beginCompositeLabRedistribution;
let registerCompositeLabBase;
let finalizeCompositeLabRedistribution;
let getCompositeDebugState;
let resetCompositeDebugState;
let setCompositeDebugEnabled;
let setCompositePerSampleCeilingEnabled;
let TOTAL;

beforeAll(async () => {
  setupDomStubs();
  ({ parseQuadFile } = await import('../../src/js/parsers/file-parsers.js'));
  ({ parseLabData } = await import('../../src/js/data/lab-parser.js'));
  ({
    beginCompositeLabRedistribution,
    registerCompositeLabBase,
    finalizeCompositeLabRedistribution
  } = await import('../../src/js/core/processing-pipeline.js'));
  ({
    getCompositeDebugState,
    resetCompositeDebugState,
    setCompositeDebugEnabled
  } = await import('../../src/js/core/composite-debug.js'));
  ({ setCompositePerSampleCeilingEnabled } = await import('../../src/js/core/feature-flags.js'));
  ({ TOTAL } = await import('../../src/js/core/state.js'));
});

afterEach(() => {
  setCompositePerSampleCeilingEnabled(true);
  resetCompositeDebugState({ keepEnabled: false });
});

describe('density coverage ceilings', () => {
  it('keeps normalized ink within buffered coverage limits for baked P800 dataset', async () => {
    const quadPath = path.resolve(__dirname, '../../data/P800_K36C26LK25_V6.quad');
    const labPath = path.resolve(__dirname, '../../data/P800_K36C26LK25_V6.txt');

    const quadContent = await fs.readFile(quadPath, 'utf8');
    const labContent = await fs.readFile(labPath, 'utf8');

    const quadData = parseQuadFile(quadContent);
    expect(quadData.valid).toBe(true);

    const labEntry = parseLabData(labContent, 'P800_K36C26LK25_V6.txt');
    expect(labEntry?.valid).toBe(true);

    setCompositePerSampleCeilingEnabled(true);
    setCompositeDebugEnabled(true);

    beginCompositeLabRedistribution({
      channelNames: quadData.channels,
      endValues: quadData.baselineEnd,
      labEntry,
      weightingMode: 'normalized'
    });

    quadData.channels.forEach((channel) => {
      registerCompositeLabBase(channel, quadData.curves[channel]);
    });

    finalizeCompositeLabRedistribution();

    const state = getCompositeDebugState();
    expect(state?.snapshots?.length).toBeGreaterThan(184);

    const snapshot = state.snapshots[184];
    expect(snapshot?.perChannel?.K).toBeTruthy();

    const coverage = state.summary?.coverageSummary?.K;
    expect(coverage).toBeTruthy();

    const { bufferedLimit } = coverage;
    const channelEntry = snapshot.perChannel.K;
    const normalizedAfter = channelEntry.normalizedAfter;
    const endValue = Number(quadData.baselineEnd?.K) || 0;
    const endNormalized = endValue > 0 ? endValue / TOTAL : 0;
    const normalizedLimit = endNormalized > 0 ? (bufferedLimit ?? 0) / endNormalized : (bufferedLimit ?? 0);

    expect(bufferedLimit).toBeGreaterThan(0);
    expect(normalizedAfter).toBeLessThanOrEqual(normalizedLimit + 1e-6);
  });
});
