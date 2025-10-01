import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const quadgenPath = path.join(__dirname, '..', 'quadgen.html');
const source = fs.readFileSync(quadgenPath, 'utf8');

function extractBlock(token) {
  const start = source.indexOf(token);
  if (start === -1) {
    throw new Error(`Token ${token} not found in quadgen.html`);
  }
  let i = start;
  while (source[i] !== '{' && i < source.length) i++;
  if (i >= source.length) throw new Error(`Opening brace not found for token ${token}`);
  let depth = 0;
  let end = i;
  for (; end < source.length; end++) {
    const ch = source[end];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end++; // include closing brace
        break;
      }
    }
  }
  while (end < source.length && source[end] !== ';') end++;
  if (end < source.length) end++;
  return source.slice(start, end);
}

const dataspaceCode = extractBlock('const DataSpace =');
const normalizeCode = extractBlock('function normalizeLinearizationEntry');

const context = {};
vm.createContext(context);
vm.runInContext(`${dataspaceCode}\n${normalizeCode}\nthis.DataSpace = DataSpace;\nthis.normalizeLinearizationEntry = normalizeLinearizationEntry;`, context);

const { DataSpace, normalizeLinearizationEntry } = context;

describe('dataspace', () => {
  function arraysAlmostEqual(actual, expected, epsilon = 1e-6) {
    expect(actual.length, 'array length mismatch').toBe(expected.length);
    for (let i = 0; i < actual.length; i++) {
      expect(actual[i], `index ${i}: expected ${expected[i]}, got ${actual[i]}`).toBeCloseTo(expected[i], epsilon);
    }
  }

  it('DataSpace treats missing metadata as printer space', () => {
    expect(DataSpace.isPrinterSpace(null)).toBe(true);
    const result = DataSpace.convertSamples([0, 0.25, 0.5, 1], {});
    arraysAlmostEqual(result.values, [0, 0.25, 0.5, 1]);
    expect(result.sourceSpace).toBe(DataSpace.SPACE.PRINTER);
  });

  it('DataSpace converts image-space samples to printer-space orientation', () => {
    const samples = [0, 0.25, 1];
    const result = DataSpace.convertSamples(samples, { from: DataSpace.SPACE.IMAGE, to: DataSpace.SPACE.PRINTER });
    arraysAlmostEqual(result.values, [0, 0.75, 1]);
    expect(result.sourceSpace).toBe(DataSpace.SPACE.PRINTER);
  });

  it('normalizeLinearizationEntry adds printer sourceSpace when missing', () => {
    const entry = { samples: [0, 0.5, 1] };
    const normalized = normalizeLinearizationEntry(entry);
    expect(normalized.sourceSpace).toBe(DataSpace.SPACE.PRINTER);
  });

  it('normalizeLinearizationEntry preserves existing metadata', () => {
    const entry = { samples: [0, 1], sourceSpace: DataSpace.SPACE.IMAGE, format: 'LAB Data' };
    const normalized = normalizeLinearizationEntry(entry);
    expect(normalized.sourceSpace).toBe(DataSpace.SPACE.IMAGE);
    expect(normalized.format).toBe('LAB Data');
  });
});