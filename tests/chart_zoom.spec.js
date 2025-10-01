import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const quadgenPath = path.join(__dirname, '..', 'quadgen.html');
const source = fs.readFileSync(quadgenPath, 'utf8');

function extractSection(startToken, endToken) {
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Token ${startToken} not found`);
  const end = source.indexOf(endToken, start);
  if (end === -1) throw new Error(`Token ${endToken} not found`);
  return source.slice(start, end);
}

const zoomBlock = extractSection('const CHART_ZOOM_LEVELS', 'const DEFAULT_INTENT');

function createButton() {
  return {
    disabled: false,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

const context = {
  console,
  Math,
  Number,
  localStorage: {
    _data: { chartZoomPercentV1: '60' },
    getItem(key) { return this._data[key] || null; },
    setItem(key, value) { this._data[key] = String(value); }
  },
  elements: {
    chartZoomInBtn: createButton(),
    chartZoomOutBtn: createButton(),
    rows: { children: [] }
  },
  document: {},
  _inkUpdates: 0,
  _sessionUpdates: 0
};

context.updateInkChart = () => { context._inkUpdates++; };
context.updateSessionStatus = () => { context._sessionUpdates++; };
context.InputValidator = {
  clampEnd(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(65535, Math.round(num)));
  },
  computePercentFromEnd(endValue) {
    const clamped = this.clampEnd(endValue);
    return (clamped / 65535) * 100;
  }
};

function resetRows(children = []) {
  context.elements.rows.children = children;
}

function makeRow(percent, channel = 'K') {
  const endValue = Math.round(Math.max(0, Math.min(100, percent)) / 100 * 65535);
  return {
    id: `${channel}-row`,
    getAttribute(name) {
      if (name === 'data-channel') return channel;
      return null;
    },
    querySelector(selector) {
      if (selector === '.end-input') return { value: String(endValue) };
      return null;
    }
  };
}

vm.createContext(context);
vm.runInContext(zoomBlock, context);

const {
  getChartZoomPercent,
  setChartZoomPercent,
  stepChartZoom,
  updateChartZoomButtons,
  mapPercentToY,
  mapYToPercent
} = context;

describe('chart_zoom', () => {
  it('restores saved zoom preference on load', () => {
    resetRows();
    expect(getChartZoomPercent()).toBe(60);
    updateChartZoomButtons();
    expect(context.elements.chartZoomInBtn.disabled).toBe(false);
    expect(context.elements.chartZoomOutBtn.disabled).toBe(false);
  });

  it('setChartZoomPercent updates state, persists, and triggers refresh', () => {
    resetRows();
    context._inkUpdates = 0;
    context._sessionUpdates = 0;
    const result = setChartZoomPercent(40);
    expect(result).toBe(40);
    expect(getChartZoomPercent()).toBe(40);
    expect(context.localStorage._data.chartZoomPercentV1).toBe('40');
    expect(context._inkUpdates >= 1).toBe(true);
    expect(context._sessionUpdates >= 1).toBe(true);
    expect(context.elements.chartZoomInBtn.disabled).toBe(false);
    expect(context.elements.chartZoomOutBtn.disabled).toBe(false);
  });

  it('setChartZoomPercent snaps to nearest decile', () => {
    resetRows();
    const result = setChartZoomPercent(26, { persist: true, refresh: true });
    expect(result).toBe(30);
    expect(getChartZoomPercent()).toBe(30);
  });

  it('stepChartZoom respects boundaries', () => {
    resetRows();
    setChartZoomPercent(30, { persist: true, refresh: true });
    updateChartZoomButtons();
    const zoomIn = stepChartZoom(1, { persist: true, refresh: true });
    expect(zoomIn).toBe(20);
    expect(getChartZoomPercent()).toBe(20);
    const zoomOut = stepChartZoom(-1, { persist: true, refresh: true });
    expect(zoomOut).toBe(30);
    expect(getChartZoomPercent()).toBe(30);
  });

  it('mapPercentToY and mapYToPercent round-trip with custom max', () => {
    const geom = { chartHeight: 580, padding: 60, height: 700, displayMax: 60 };
    const topY = mapPercentToY(60, geom);
    const midY = mapPercentToY(30, geom);
    expect(topY).toBeCloseTo(60);
    expect(midY).toBeCloseTo(350);
    const recovered = mapYToPercent(midY, geom);
    expect(recovered).toBeCloseTo(30);
  });

  it('updateChartZoomButtons exposes descriptive aria labels', () => {
    resetRows();
    setChartZoomPercent(100, { persist: true, refresh: true });
    updateChartZoomButtons();
    expect(context.elements.chartZoomOutBtn.disabled).toBe(true);
    expect(context.elements.chartZoomOutBtn.attributes['aria-label'].includes('100%')).toBeTruthy();
    setChartZoomPercent(10, { persist: true, refresh: true });
    updateChartZoomButtons();
    expect(context.elements.chartZoomInBtn.disabled).toBe(true);
    expect(context.elements.chartZoomInBtn.attributes['aria-label'].includes('10%')).toBeTruthy();
  });

  it('setChartZoomPercent clamps to active ink limits', () => {
    resetRows([makeRow(100)]);
    const result = setChartZoomPercent(40);
    expect(result).toBe(100);
    expect(getChartZoomPercent()).toBe(100);
    resetRows();
  });

  it('zoom-in button locks when active ink limit requires higher max', () => {
    resetRows([makeRow(80)]);
    setChartZoomPercent(80, { persist: true, refresh: true });
    updateChartZoomButtons();
    expect(getChartZoomPercent()).toBe(80);
    expect(context.elements.chartZoomInBtn.disabled).toBe(true);
    resetRows();
  });
});