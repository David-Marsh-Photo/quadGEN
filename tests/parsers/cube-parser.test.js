import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  parseCube1D,
  parseCube3D,
  parseLinearizationFile
} from '../../src/js/parsers/file-parsers.js';

const IDENTITY_3D_ROWS = [
  '0 0 0',
  '1 0 0',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1'
];

const WEIGHTED_3D_ROWS = [0, 1, 2, 3, 4, 5, 6, 7]
  .map((value) => `${value / 7} ${value / 7} ${value / 7}`);

function cube1D({
  size = 3,
  domainMin = '0',
  domainMax = '1',
  rows = ['0', '0.5', '1']
} = {}) {
  return [
    `LUT_1D_SIZE ${size}`,
    `DOMAIN_MIN ${domainMin}`,
    `DOMAIN_MAX ${domainMax}`,
    ...rows
  ].join('\n');
}

function cube3D({
  domainMin = '0',
  domainMax = '1',
  rows = IDENTITY_3D_ROWS
} = {}) {
  return [
    'LUT_3D_SIZE 2',
    `DOMAIN_MIN ${domainMin}`,
    `DOMAIN_MAX ${domainMax}`,
    ...rows
  ].join('\n');
}

describe('CUBE parser conformance', () => {
  let consoleError;

  beforeAll(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleError.mockRestore();
  });

  it.each([
    ['testdata/NegativeDensityRangeCorrection.cube', parseCube1D, 2, 2],
    ['testdata/s_curve_256.cube', parseCube1D, 256, 256],
    ['testdata/midtone_collapse_3d.cube', parseCube3D, 3, 256]
  ])('preserves valid legacy fixture %s', (path, parser, lutSize, sampleCount) => {
    const parsed = parser(readFileSync(path, 'utf8'), path);

    expect(parsed.valid).toBe(true);
    expect(parsed.lutSize).toBe(lutSize);
    expect(parsed.samples).toHaveLength(sampleCount);
    expect(parsed.samples.every(Number.isFinite)).toBe(true);
    expect(parsed.interpolationType).toBe('pchip');
  });

  it('keeps headerless 1D compatibility within the 256-sample limit', () => {
    const parsed = parseCube1D(['0', '0.5 0.5 0.5', '1'].join('\n'));

    expect(parsed).toMatchObject({
      valid: true,
      lutSize: 3,
      domainMin: 0,
      domainMax: 1
    });
    expect(parsed.samples).toHaveLength(3);
  });

  it.each([
    ['headerless', ['0', '0.5', '1'].join('\n')],
    ['lowercase declaration', cube1D().replace('LUT_1D_SIZE', 'lut_1d_size')]
  ])('routes a %s 1D file through the public loader', async (_label, content) => {
    const parsed = await parseLinearizationFile(content, 'compatibility.cube');

    expect(parsed).toMatchObject({
      valid: true,
      format: '1D LUT',
      filename: 'compatibility.cube',
      lutSize: 3
    });
  });

  it('preserves a distinct RGB domain while retaining 1D scalar compatibility', () => {
    const parsed = parseCube1D(cube1D({
      domainMin: '0.1 0.2 0.3',
      domainMax: '0.8 0.9 1'
    }));

    expect(parsed).toMatchObject({
      valid: true,
      domainMin: 0.1,
      domainMax: 0.8,
      domainMinRGB: [0.1, 0.2, 0.3],
      domainMaxRGB: [0.8, 0.9, 1]
    });
  });

  it.each([
    ['short declaration', cube1D({ size: 3, rows: ['0', '1'] }), /declares 3 samples.*found 2/i],
    ['long declaration', cube1D({ size: 2, rows: ['0', '0.5', '1'] }), /declares 2 samples.*found 3/i],
    ['non-finite first component', cube1D({ rows: ['0', 'Infinity 0.5 0.5', '1'] }), /finite numeric components/i],
    ['non-finite unused component', cube1D({ rows: ['0', '0.5 Infinity 0.5', '1'] }), /finite numeric components/i],
    ['partial numeric token', cube1D({ rows: ['0', '0.5junk', '1'] }), /finite numeric components/i],
    ['equal scalar domain', cube1D({ domainMin: '0.5', domainMax: '0.5' }), /DOMAIN_MAX.*greater than DOMAIN_MIN/i],
    ['descending scalar domain', cube1D({ domainMin: '1', domainMax: '0' }), /DOMAIN_MAX.*greater than DOMAIN_MIN/i],
    ['non-finite vector domain', cube1D({ domainMin: '0 0 NaN', domainMax: '1 1 1' }), /finite numeric values/i],
    ['two-component domain', cube1D({ domainMin: '0 0', domainMax: '1 1' }), /one scalar or three RGB values/i],
    ['mixed domain arity', cube1D({ domainMin: '0', domainMax: '1 1 1' }), /matching scalar or RGB arity/i],
    ['malformed title prefix', `${cube1D()}\nTITLEJUNK arbitrary`, /finite numeric components/i],
    ['duplicate title', `TITLE "One"\nTITLE "Two"\n${cube1D()}`, /duplicate TITLE/i],
    ['late title', `${cube1D()}\nTITLE "Late"`, /TITLE must appear before CUBE data/i],
    ['oversized declaration', cube1D({ size: 65537 }), /between 2 and 65536/i]
  ])('rejects malformed 1D input: %s', (_label, content, errorPattern) => {
    expect(parseCube1D(content)).toMatchObject({
      valid: false,
      error: expect.stringMatching(errorPattern)
    });
  });

  it('accepts declared 1D data above the headerless compatibility limit', () => {
    const oversizedRows = Array.from({ length: 257 }, (_, index) => String(index / 256));
    const parsed = parseCube1D(cube1D({ size: 257, rows: oversizedRows }));

    expect(parsed).toMatchObject({
      valid: true,
      lutSize: 257
    });
    expect(parsed.samples).toHaveLength(257);
  });

  it('rejects headerless 1D LUTs outside the two-to-256 sample range', () => {
    const oversizedRows = Array.from({ length: 257 }, (_, index) => String(index / 256));

    expect(parseCube1D(oversizedRows.join('\n'))).toMatchObject({
      valid: false,
      error: expect.stringMatching(/limit is 256/i)
    });
    expect(parseCube1D('0.5')).toMatchObject({
      valid: false,
      error: expect.stringMatching(/at least 2 samples/i)
    });
  });

  it('applies every vector-domain component using red-fastest 3D ordering', () => {
    const parsed = parseCube3D(cube3D({
      domainMin: '0 0.25 0.5',
      domainMax: '0.5 0.75 1',
      rows: WEIGHTED_3D_ROWS
    }));

    expect(parsed.valid).toBe(true);
    expect(parsed.domainMinRGB).toEqual([0, 0.25, 0.5]);
    expect(parsed.domainMaxRGB).toEqual([0.5, 0.75, 1]);

    const neutralIndex = 64;
    const printerIndex = 255 - neutralIndex;
    const t = neutralIndex / 255;
    const normalizedR = t / 0.5;
    const normalizedG = (t - 0.25) / 0.5;
    const normalizedB = 0;
    const expectedNeutral = (normalizedR + (2 * normalizedG) + (4 * normalizedB)) / 7;
    expect(1 - parsed.rawSamples[printerIndex]).toBeCloseTo(expectedNeutral, 10);
  });

  it.each([
    [
      'a non-finite row component',
      cube3D({ rows: IDENTITY_3D_ROWS.with(3, '0 Infinity 1') }),
      /finite numeric components/i
    ],
    [
      'an equal vector-domain component',
      cube3D({ domainMin: '0 0.25 1', domainMax: '1 0.75 1' }),
      /DOMAIN_MAX.*greater than DOMAIN_MIN/i
    ],
    [
      'a non-finite vector domain',
      cube3D({ domainMin: '0 0 Infinity', domainMax: '1 1 1' }),
      /finite numeric values/i
    ],
    [
      'an oversized declaration',
      cube3D().replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 257'),
      /between 2 and 256/i
    ]
  ])('rejects malformed 3D input: %s', (_label, content, errorPattern) => {
    expect(parseCube3D(content)).toMatchObject({
      valid: false,
      error: expect.stringMatching(errorPattern)
    });
  });

  it('returns the same strict rejection through the linearization-file router', async () => {
    const parsed = await parseLinearizationFile(
      cube1D({ size: 4, rows: ['0', '0.5', '1'] }),
      'short.cube'
    );

    expect(parsed).toMatchObject({
      valid: false,
      error: expect.stringMatching(/declares 4 samples.*found 3/i)
    });
  });
});
