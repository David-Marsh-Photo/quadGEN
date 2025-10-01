import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('CurveHistory (Undo/Redo) Flow', () => {
  let context;

  // Helper to create a mock channel row element
  function createMockRow(channelName) {
    const row = {
      dataset: { channel: channelName },
      _virtualCheckbox: { checked: true, dispatchEvent: () => {} },
      querySelector(selector) {
        if (selector === '.percent-input') return { value: '100' };
        if (selector === '.end-input') return { value: '65535' };
        return null;
      },
      refreshDisplayFn: () => {}
    };
    return row;
  }

  beforeEach(() => {
    const quadgenPath = path.join(__dirname, '..', 'quadgen.html');
    const source = fs.readFileSync(quadgenPath, 'utf8');

    function extractBlock(token, endToken) {
      const start = source.indexOf(token);
      if (start === -1) throw new Error(`Token ${token} not found`);
      const end = source.indexOf(endToken, start);
      if (end === -1) throw new Error(`End token ${endToken} not found`);
      return source.slice(start, end);
    }

    // Mock the DOM and global state
    context = {
      console,
      document: {
        getElementById: (id) => context.elements[id],
        querySelector: () => null,
      },
      elements: {
        undoBtn: { disabled: true, style: {}, title: '' },
        redoBtn: { disabled: true, style: {}, title: '' },
        rows: { children: [] },
      },
      window: { loadedQuadData: { curves: {} } },
      // Stubs for functions called by CurveHistory
      updatePreview: () => {},
      updateInkChart: () => {},
      updateCompactChannelsList: () => {},
      debouncedPreviewUpdate: () => {},
      updateProcessingDetail: () => {},
      normalizeSmartSourcesInLoadedData: () => {},
      getChannelRow: (channelName) => context.elements.rows.children.find(r => r.dataset.channel === channelName),
      InputValidator: {
        clampPercent: val => Math.max(0, Math.min(100, Number(val))),
        clampEnd: val => Math.max(0, Math.min(65535, Number(val))),
        computeEndFromPercent: p => Math.round(p / 100 * 65535),
        computePercentFromEnd: e => (e / 65535) * 100,
        validateInput: (el, fn) => fn(el.value),
      },
      channelPreviousValues: {},
      rescaleSmartCurveForInkLimit: () => {},
    };

    // Create mock channel rows
    const mockChannels = ['K', 'C', 'M', 'Y'];
    context.elements.rows.children = mockChannels.map(createMockRow);

    // Extract and load the CurveHistory object into the VM context
    const historyBlock = extractBlock('const CurveHistory = {', 'const DataSpace = {');
    vm.createContext(context);
    vm.runInContext(historyBlock, context);
  });

  it('should exist in the context', () => {
    expect(context.CurveHistory).toBeDefined();
    expect(context.CurveHistory.history).toBeDefined();
    expect(context.CurveHistory.redoStack).toBeDefined();
  });

});