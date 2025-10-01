import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { parseCGATS17 } from '../src/js/data/cgats-parser.js';

describe('cgats-parser', () => {
  it('Tier A lab-only CGATS builds measurement set metadata', () => {
    const samplePath = path.resolve(__dirname, '..', 'testdata', 'cgats17_21step_lab.txt');
    const contents = fs.readFileSync(samplePath, 'utf8');

    const parsed = parseCGATS17(contents, samplePath);
    expect(parsed.format).toBe('CGATS.17 (LAB)');
    expect(parsed.originalData.length).toBe(21);
    expect(parsed.originalData[0].lab).toBe(100);
    expect(parsed.originalData.at(-1).lab).toBe(0);

    const { measurementSet } = parsed;
    expect(measurementSet, 'measurementSet should be attached').toBeTruthy();
    expect(measurementSet.patches.length).toBe(21);
    expect(measurementSet.meta.originator).toBe('Synthetic Generator');
    expect(measurementSet.meta.spectral).toBe(null);
    expect(Array.from(measurementSet.schema.fields)).toEqual(['SAMPLE_ID', 'LAB_L', 'LAB_A', 'LAB_B']);
    expect(measurementSet.patches[0].lab.L).toBe(100);
    expect(measurementSet.patches.at(-1).lab.L).toBe(0);
    expect(measurementSet.raw.text.startsWith('CGATS.17')).toBeTruthy();
  });

  it('Tier B rich CGATS captures spectral metadata and device values', () => {
    const samplePath = path.resolve(__dirname, '..', 'testdata', 'cgats17_21step_rich.txt');
    const contents = fs.readFileSync(samplePath, 'utf8');

    const parsed = parseCGATS17(contents, samplePath);
    expect(parsed.format.startsWith('CGATS.17')).toBeTruthy();
    expect(parsed.originalData.length).toBe(21);

    const { measurementSet } = parsed;
    expect(measurementSet, 'measurementSet should be attached').toBeTruthy();
    expect(measurementSet.patches.length).toBe(21);
    expect(measurementSet.meta.spectral.actualBands).toBe(36);
    expect(measurementSet.meta.spectral.actualStartNm).toBe(380);
    expect(measurementSet.meta.spectral.actualEndNm).toBe(730);
    expect(measurementSet.meta.declaredSetCount).toBe(21);
    expect(measurementSet.meta.actualSetCount).toBe(21);

    const firstPatch = measurementSet.patches[0];
    expect(firstPatch.device.cmyk).toBeTruthy();
    expect(firstPatch.device.cmyk.c).toBe(2);
    expect(firstPatch.device.cmyk.k).toBe(0);
    expect(firstPatch.spectrum).toBeTruthy();
    expect(firstPatch.spectrum.nm.length).toBe(36);
    expect(firstPatch.spectrum.values.length).toBe(36);
  });

  it('K-only CGATS sample retains measurement metadata', () => {
    const samplePath = path.resolve(__dirname, '..', 'testdata', 'CGATS.17.txt');
    const contents = fs.readFileSync(samplePath, 'utf8');

    const parsed = parseCGATS17(contents, samplePath);

    expect(parsed.format).toBe('CGATS.17 (K-only)');
    expect(parsed.originalData.length).toBe(12);
    expect(parsed.originalData[0].input).toBe(0);
    expect(parsed.originalData.at(-1).input).toBe(100);

    const { measurementSet } = parsed;
    expect(measurementSet.meta.instrument.includes('i1Pro')).toBeTruthy();
    expect(measurementSet.meta.declaredSetCount).toBe(432);
    expect(measurementSet.meta.actualSetCount).toBe(432);
    expect(measurementSet.schema.fields.length).toBe(9);
    expect(measurementSet.patches.length).toBe(432);
    expect(measurementSet.raw.text.includes('NUMBER_OF_SETS 432')).toBeTruthy();

    for (let i = 1; i < parsed.originalData.length; i++) {
      expect(parsed.originalData[i].input >= parsed.originalData[i - 1].input, 'inputs should be sorted').toBeTruthy();
    }
  });

  it('K-only detection tolerates small CMY offsets', () => {
    const tolerantCgats = `CGATS.17

NUMBER_OF_FIELDS 8
BEGIN_DATA_FORMAT
SAMPLE_ID CMYK_C CMYK_M CMYK_Y CMYK_K LAB_L LAB_A LAB_B
END_DATA_FORMAT

NUMBER_OF_SETS 3
BEGIN_DATA
1 2 2 2 0 100 0 0
2 1.5 1.5 1.5 50 50 0 0
3 2.4 2.4 2.4 100 0 0 0
END_DATA
`;

    const parsed = parseCGATS17(tolerantCgats, 'tolerant.cgats');

    expect(parsed.format).toBe('CGATS.17 (K-only)');
    const inputs = Array.from(parsed.originalData, (p) => Math.round(p.input));
    expect(inputs).toEqual([0, 50, 100]);
  });

  it('Argyll CTI3 rich file matches CGATS workflow', () => {
    const cgatsPath = path.resolve(__dirname, '..', 'testdata', 'cgats17_21step_rich_colormuse.txt');
    const ti3Path = path.resolve(__dirname, '..', 'testdata', 'cgats17_21step_rich_colormuse.ti3');
    const cgatsContents = fs.readFileSync(cgatsPath, 'utf8');
    const ti3Contents = fs.readFileSync(ti3Path, 'utf8');

    const cgatsParsed = parseCGATS17(cgatsContents, cgatsPath);
    const ti3Parsed = parseCGATS17(ti3Contents, ti3Path);

    expect(ti3Parsed.format).toBe(cgatsParsed.format);
    expect(ti3Parsed.originalData.length).toBe(cgatsParsed.originalData.length);
    const cgatsLabs = cgatsParsed.originalData.map((p) => p.lab);
    const ti3Labs = ti3Parsed.originalData.map((p) => p.lab);
    expect(ti3Labs).toEqual(cgatsLabs);
  });

  it('composite fallback normalizes total ink to 0-100%', () => {
    const compositeCgats = `CGATS.17

NUMBER_OF_FIELDS 8
BEGIN_DATA_FORMAT
SAMPLE_ID CMYK_C CMYK_M CMYK_Y CMYK_K LAB_L LAB_A LAB_B
END_DATA_FORMAT

NUMBER_OF_SETS 5
BEGIN_DATA
1 0 0 0 0 100 0 0
2 10 10 10 0 80 0 0
3 30 30 30 0 60 0 0
4 60 60 60 0 40 0 0
5 80 80 80 0 20 0 0
END_DATA
`;

    const parsed = parseCGATS17(compositeCgats, 'composite.cgats');

    expect(parsed.format).toBe('CGATS.17 (composite)');
    expect(parsed.originalData.length).toBe(5);
    expect(parsed.originalData[0].input).toBe(0);
    expect(parsed.originalData.at(-1).input).toBe(100);
    expect(parsed.measurementSet.patches.length).toBe(5);

    for (let i = 1; i < parsed.originalData.length; i++) {
      expect(parsed.originalData[i].input >= parsed.originalData[i - 1].input, 'composite inputs sorted').toBeTruthy();
    }
  });

  it('RGB-based CGATS converts to derived grayscale input', () => {
    const samplePath = path.resolve(__dirname, '..', 'testdata', 'POPS_MEASUREMENTS.cgats');
    const contents = fs.readFileSync(samplePath, 'utf8');

    const parsed = parseCGATS17(contents, samplePath);

    expect(parsed.format).toBe('CGATS.17 (K-only)');
    expect(parsed.originalData.length).toBe(800);
    expect(parsed.originalData[0].input).toBe(0);
    expect(parsed.originalData.at(-1).input).toBe(100);

    const { measurementSet } = parsed;
    expect(measurementSet.meta.spectral.actualBands).toBe(36);
    expect(measurementSet.patches[0].device.rgb).toBeTruthy();
    expect(measurementSet.patches[0].device.rgb.r).toBe(255);

    for (const point of parsed.originalData) {
      expect(point.input >= 0 && point.input <= 100, 'input should stay within 0-100').toBeTruthy();
    }
  });

  it('legacy LAB-only CGATS falls back to evenly spaced inputs', () => {
    const samplePath = path.resolve(__dirname, '..', 'sample_lab_only.cgats');
    const contents = fs.readFileSync(samplePath, 'utf8');

    const parsed = parseCGATS17(contents, samplePath);

    expect(parsed.format).toBe('CGATS.17 (LAB)');
    expect(parsed.originalData.length).toBe(5);
    const expected = [0, 25, 50, 75, 100];
    parsed.originalData.forEach((point, idx) => {
      expect(Math.abs(point.input - expected[idx]) < 1e-6, `expected input ${expected[idx]} at index ${idx}, saw ${point.input}`).toBeTruthy();
    });
    expect(parsed.measurementSet.patches.length).toBe(5);
  });
});
