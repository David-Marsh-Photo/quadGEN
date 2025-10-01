import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('Quad File Loader Smoke Test', () => {
  it('should load a .quad file without errors', () => {
    const rootDir = path.join(__dirname, '..');
    const quadgenPath = path.join(rootDir, 'quadgen.html');
    const source = fs.readFileSync(quadgenPath, 'utf8');

    function extractBlock(token) {
      const start = source.indexOf(token);
      if (start === -1) {
        throw new Error(`Token ${token} not found in quadgen.html`);
      }
      let i = start;
      while (i < source.length && source[i] !== '{') i++;
      if (i >= source.length) throw new Error(`Opening brace not found for token ${token}`);
      let depth = 0;
      let end = i;
      for (; end < source.length; end++) {
        const ch = source[end];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end++;
            break;
          }
        }
      }
      while (end < source.length && source[end] !== ';' && source[end] !== '\n') end++;
      if (end < source.length) end++;
      return source.slice(start, end);
    }

    function createClassList() {
      return { add() {}, remove() {}, toggle() {} };
    }

    function createRowsContainer() {
      const container = {
        children: [],
        innerHTML: '',
        appendChild(child) {
          if (child && child.isFragment && Array.isArray(child.children)) {
            child.children.forEach(grandChild => this.appendChild(grandChild));
            return child;
          }
          this.children.push(child);
          child.parentNode = this;
          return child;
        },
        dispatchEvent() {},
        set innerHTML(value) {
          this._html = value;
          this.children = [];
        },
        get innerHTML() {
          return this._html || '';
        }
      };
      return container;
    }

    function createMockRow(channelName) {
      const percentInput = { value: '100', style: {}, classList: createClassList(), addEventListener() {}, dispatchEvent() {}, _historyCache: null };
      const endInput = { value: '65535', style: {}, classList: createClassList(), addEventListener() {}, dispatchEvent() {} };
      const disabledTag = { classList: createClassList() };
      const linearizationCell = { style: { visibility: 'visible' } };
      const percentCell = { style: { opacity: '1' } };
      const endCell = { style: { opacity: '1' } };
      const processingLabel = { textContent: '', style: {} };
      const channelLabel = { style: { opacity: '1' } };
      const channelNameSpan = { textContent: channelName, style: { opacity: '1' } };

      const btnGroup = {
        children: [],
        querySelector(selector) {
          if (selector === '.per-channel-revert') {
            return this.children.find(child => child && child.className && child.className.includes('per-channel-revert')) || null;
          }
          return null;
        },
        appendChild(child) {
          child.parentElement = this;
          this.children.push(child);
        }
      };

      const perChannelBtn = { parentElement: btnGroup, addEventListener() {}, setAttribute() {} };
      const perChannelFile = { files: [], addEventListener() {}, click() {} };
      const perChannelToggle = { disabled: true, checked: false, addEventListener() {}, dispatchEvent() {}, classList: createClassList() };

      const mapping = {
        '.percent-input': percentInput,
        '.end-input': endInput,
        '[data-disabled]': disabledTag,
        '.per-channel-btn': perChannelBtn,
        '.per-channel-file': perChannelFile,
        '.per-channel-toggle': perChannelToggle,
        '.processing-label': processingLabel
      };

      const row = {
        dataset: { channel: channelName },
        className: 'channel-row',
        style: {},
        children: [],
        attributes: {},
        parentNode: null,
        isConnected: true,
        classList: createClassList(),
        refreshDisplayFn: null,
        _checkboxChangeHandler: null,
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) { delete this.attributes[name]; },
        hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); },
        querySelector(selector) {
          if (selector === 'td span span:nth-child(2)' || selector === 'td:nth-child(2) span') return channelNameSpan;
          if (selector === 'td:nth-child(3)') return linearizationCell;
          if (selector === 'td:nth-child(4)') return percentCell;
          if (selector === 'td:nth-child(5)') return endCell;
          if (selector === '.per-channel-revert') return btnGroup.querySelector(selector);
          if (selector === '.processing-label') return processingLabel;
          return mapping[selector] || null;
        },
        querySelectorAll(selector) {
          if (selector === 'input, select') return [percentInput, endInput, perChannelToggle];
          return [];
        }
      };

      const enableCheckbox = {
        checked: true,
        addEventListener(type, handler) { if (type === 'change') row._checkboxChangeHandler = handler; },
        dispatchEvent(evt) { if (row._checkboxChangeHandler && evt && evt.type === 'change') row._checkboxChangeHandler(); }
      };
      row._virtualCheckbox = enableCheckbox;

      return row;
    }

    const rowsContainer = createRowsContainer();

    const documentStub = {
      createElement(tag) {
        return { tagName: tag.toUpperCase(), children: [], className: '', style: {}, attributes: {}, classList: createClassList(), appendChild(child) { this.children.push(child); child.parentNode = this; }, setAttribute(name, value) { this.attributes[name] = value; if (name === 'id') this.id = value; }, querySelector() { return null; }, querySelectorAll() { return []; }, set innerHTML(value) { this._html = value; }, get innerHTML() { return this._html || ''; } };
      },
      createDocumentFragment() {
        return { isFragment: true, children: [], appendChild(child) { this.children.push(child); } };
      },
      querySelector(selector) {
        const match = selector && selector.match(/^tr\[data-channel="([^"]+)"\]$/);
        if (match && context.channelRowCache) {
          return context.channelRowCache.get(match[1]) || null;
        }
        return null;
      },
      body: { appendChild() {}, removeChild() {} }
    };

    const context = {
      console, Math, Number, Array, Object, Map, Set, document: documentStub,
      Event: function Event(type, options = {}) { this.type = type; this.bubbles = !!options.bubbles; },
      setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
      clearTimeout() {},
      requestAnimationFrame(fn) { if (typeof fn === 'function') fn(); },
      elements: { rows: rowsContainer, channelInfo: { innerHTML: '' }, printerDescription: { innerHTML: '' }, printerSelect: { value: '' } },
      updateCompactChannelsList() {}, updateRevertButtonsState() {}, edit_populateChannelSelect() {}, updatePreview() {}, updateInkChart() {}, updateFilename() {}, debouncedPreviewUpdate() {}, updateProcessingDetail() {}, updateProcessingDetailForce() {}, refreshPerChannelLinearizationDisplay() {}, updateInterpolationControls() {}, showStatus() {},
      perChannelLinearization: Object.create(null), perChannelEnabled: Object.create(null), perChannelFilenames: Object.create(null), channelPreviousValues: Object.create(null),
      ControlPoints: { get() { return { points: [] }; }, persist() {} },
      ControlPolicy: { clampY(value) { const num = Number(value); if (!Number.isFinite(num)) return 0; return Math.max(0, Math.min(65535, num)); } },
      quadGenActions: { _interpolateCurve() { return new Array(256).fill(0); }, _applyCurveToChannel() { return { success: true }; } },
      make256() { return new Array(256).fill(0); },
      DEBUG_LOGS: false,
      CurveHistory: { isBatchOperation: false, recordChannelAction() {}, captureState() {}, undo() { return { success: true }; }, redo() { return { success: true }; } },
      window: null
    };
    context.window = context;
    documentStub.createElement('div');
    context.document = documentStub;
    context.TOTAL = 65535;
    context.N = 256;
    context.DENOM = context.N - 1;

    vm.createContext(context);

    vm.runInContext(extractBlock('const INK_COLORS ='), context);
    vm.runInContext(`${extractBlock('class InputValidator')}\nthis.InputValidator = InputValidator;`, context);
    vm.runInContext(extractBlock('const PRINTERS ='), context);
    vm.runInContext('const channelRowCache = new Map(); this.channelRowCache = channelRowCache;', context);
    vm.runInContext('function registerChannelRow(channelName, tr) { if (channelName && tr) channelRowCache.set(channelName, tr); } this.registerChannelRow = registerChannelRow;', context);
    vm.runInContext('function getChannelRow(channelName) { return channelRowCache.get(channelName) || null; } this.getChannelRow = getChannelRow;', context);
    vm.runInContext(extractBlock('function rescaleSmartCurveForInkLimit'), context);
    vm.runInContext(extractBlock('function setupChannelRow'), context);
    vm.runInContext(extractBlock('function setPrinter'), context);
    vm.runInContext(extractBlock('function findMatchingPrinter'), context);
    vm.runInContext(extractBlock('function parseQuadFile'), context);

    context.channelRowCache = context.channelRowCache || new Map();
    context.createChannelRow = function(channelName) {
      return createMockRow(channelName);
    };

    context.document.querySelector = function(selector) {
      const match = selector && selector.match(/^tr\[data-channel="([^"]+)"\]$/);
      if (match) {
        return context.channelRowCache.get(match[1]) || null;
      }
      return null;
    };

    const quadPath = '/Users/marshmonkey/Library/CloudStorage/Dropbox/Photography/quadGEN/QTR Profiles/P700-900-UC/TOYOBO_MK23_LAB_CORRECTEDv2.quad';
    if (!fs.existsSync(quadPath)) {
      throw new Error(`Required test file missing: ${quadPath}`);
    }

    const quadContent = fs.readFileSync(quadPath, 'utf8');
    const parsed = context.parseQuadFile(quadContent);
    expect(Array.isArray(parsed.channels) && parsed.channels.length > 0, 'Parsed channels missing').toBeTruthy();

    const printerId = context.findMatchingPrinter(parsed.channels);
    expect(printerId, 'No matching printer found for test .quad').toBeTruthy();

    context.window.loadedQuadData = { switchingPrinter: true };
    context.setPrinter(printerId);
    delete context.window.loadedQuadData.switchingPrinter;

    const rows = context.elements.rows.children.filter(child => child && child.dataset && child.dataset.channel);
    expect(rows.length, 'Channel row count mismatch').toBe(parsed.channels.length);

    parsed.values.forEach((endValue, index) => {
      const row = rows[index];
      const endInput = row.querySelector('.end-input');
      const percentInput = row.querySelector('.percent-input');
      endInput.value = String(endValue);
      const pct = context.InputValidator.computePercentFromEnd(endValue);
      percentInput.value = pct.toString();
      if (typeof row.refreshDisplayFn === 'function') {
        row.refreshDisplayFn();
      }
    });

    rows.forEach(row => {
      const percentInput = row.querySelector('.percent-input');
      const cache = percentInput && percentInput._historyCache;
      if (cache) {
        expect(cache.value, 'History cache desynced after load').toBe(percentInput.value);
      }
    });
  });
});
