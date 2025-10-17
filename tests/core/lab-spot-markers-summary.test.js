import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { parseLabData } from '../../src/js/data/lab-parser.js';

describe('LAB measurement correction summary', () => {
  test('parseLabData exposes per-point correction deltas', () => {
    const labPath = resolve('data/P800_K36C26LK25_V19.txt');
    const content = readFileSync(labPath, 'utf-8');
    const entry = parseLabData(content, 'P800_K36C26LK25_V19.txt');

    expect(entry).toBeTruthy();
    expect(Array.isArray(entry.measurementCorrections)).toBe(true);
    expect(entry.measurementCorrections.length).toBeGreaterThan(2);
    expect(entry.measurementCorrections.some((point) => point?.action === 'darken')).toBe(true);
    expect(entry.measurementCorrections.some((point) => point?.action === 'lighten')).toBe(true);

    const midtone = entry.measurementCorrections.find((point) => point && Math.abs(point.inputPercent - 50) < 0.51);
    expect(midtone).toBeTruthy();
    expect(typeof midtone.deltaPercent).toBe('number');
    expect(midtone.action === 'lighten' || midtone.action === 'darken' || midtone.action === 'within').toBe(true);
  });
});
