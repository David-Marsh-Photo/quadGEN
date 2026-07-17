/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import {
  parseQuadFile as parseCanonicalQuad,
  validateQuadFile as validateReferenceQuadFile
} from '../../src/js/data/quad-parser.js';
import {
  parseQuadFile as parseEditableQuad,
  validateFileFormat,
  validateQuadFile as validateEditableQuadFile
} from '../../src/js/parsers/file-parsers.js';
import { loadReferenceQuadFile } from '../../src/js/files/reference-quad-loader.js';

const EIGHT_CHANNELS = ['K', 'C', 'M', 'Y', 'LC', 'LM', 'LK', 'LLK'];
const TEN_CHANNELS = [...EIGHT_CHANNELS, 'V', 'MK'];

function buildQuad({ channels, header = true, dataChannelCount = channels.length, trailing = [] }) {
  const lines = [];
  const curves = {};

  if (header) {
    lines.push(`## QuadToneRIP ${channels.join(',')}`);
  }
  lines.push('# Printer: parser contract fixture', '# quadGEN export-style fixture');

  for (let channelIndex = 0; channelIndex < dataChannelCount; channelIndex += 1) {
    const channelName = channels[channelIndex] || `EXTRA${channelIndex + 1}`;
    const curve = Array.from(
      { length: 256 },
      (_, sampleIndex) => (channelIndex * 4096 + sampleIndex * 17) % 65536
    );
    lines.push(`# ${channelName} curve`, ...curve.map(String));
    curves[channelName] = curve;
  }

  lines.push(...trailing);
  return { content: `${lines.join('\n')}\n`, curves };
}

function fakeQuadFile(content, name = 'fixture.quad') {
  return {
    name,
    size: content.length,
    text: async () => content
  };
}

describe('canonical .quad parsing', () => {
  it.each([
    ['headered 8-channel', EIGHT_CHANNELS, true],
    ['headerless 8-channel', EIGHT_CHANNELS, false],
    ['headered 10-channel', TEN_CHANNELS, true],
    ['headerless 10-channel', TEN_CHANNELS, false]
  ])('preserves exact samples for a valid %s file', async (_label, channels, header) => {
    const { content, curves } = buildQuad({ channels, header });
    const parsed = parseCanonicalQuad(content);
    const editable = parseEditableQuad(content);
    const reference = await loadReferenceQuadFile(fakeQuadFile(content));

    expect(parsed.channels).toEqual(channels);
    expect(parsed.curves).toEqual(curves);
    expect(parsed.values).toEqual(channels.map((channel) => Math.max(...curves[channel])));
    expect(parsed.channels.every((channel) => parsed.curves[channel].length === 256)).toBe(true);
    expect(editable).toMatchObject({ valid: true, channels, curves });
    expect(reference).toMatchObject({
      success: true,
      data: { channels, curves }
    });
  });

  it.each([
    ['six-channel P400 layout', ['K', 'C', 'M', 'Y', 'LC', 'LM']],
    ['alternate ten-channel OR/GR layout', [...EIGHT_CHANNELS, 'OR', 'GR']]
  ])('honors an exact explicit %s', (_label, channels) => {
    const { content } = buildQuad({ channels });
    expect(parseCanonicalQuad(content).channels).toEqual(channels);
  });

  it.each([
    [
      'one extra numeric value',
      () => buildQuad({ channels: EIGHT_CHANNELS, trailing: ['1'] }).content,
      /found 2049 values, expected exactly 2048/
    ],
    [
      'one complete extra headered channel block',
      () => buildQuad({ channels: EIGHT_CHANNELS, dataChannelCount: 9 }).content,
      /found 2304 values, expected exactly 2048/
    ],
    [
      'headerless remainder data',
      () => buildQuad({ channels: EIGHT_CHANNELS, header: false, trailing: ['1'] }).content,
      /exact multiple of 256/
    ],
    [
      'headerless short remainder data',
      () => {
        const { content } = buildQuad({ channels: EIGHT_CHANNELS, header: false });
        const lines = content.trimEnd().split('\n');
        lines.pop();
        return `${lines.join('\n')}\n`;
      },
      /found 2047 values.*exact multiple of 256/
    ],
    [
      'unsupported headerless channel count',
      () => buildQuad({ channels: [...EIGHT_CHANNELS, 'EXTRA'], header: false }).content,
      /cannot infer a recognized channel layout from 9 channels/
    ],
    [
      'trailing non-comment text',
      () => buildQuad({ channels: EIGHT_CHANNELS, trailing: ['not quad data'] }).content,
      /Unexpected non-comment content.*not quad data/
    ],
    [
      'a decimal data token',
      () => buildQuad({ channels: EIGHT_CHANNELS, trailing: ['1.5'] }).content,
      /Unexpected non-comment content.*1\.5/
    ],
    [
      'a non-finite data token',
      () => buildQuad({ channels: EIGHT_CHANNELS, trailing: ['NaN'] }).content,
      /Unexpected non-comment content.*NaN/
    ],
    [
      'an out-of-range integer',
      () => buildQuad({ channels: EIGHT_CHANNELS, trailing: ['65536'] }).content,
      /Invalid data value 65536/
    ],
    [
      'an empty header channel',
      () => buildQuad({ channels: ['K', '', 'C'] }).content,
      /channel names must be non-empty/
    ],
    [
      'a duplicate header channel',
      () => buildQuad({ channels: ['K', 'K'] }).content,
      /channel names must be unique/
    ],
    [
      'a malformed header-like declaration',
      () => buildQuad({ channels: EIGHT_CHANNELS }).content.replace('## QuadToneRIP ', '## QuadToneRIP: '),
      /malformed QuadToneRIP channel declaration/
    ]
  ])('rejects %s', (_label, buildContent, errorPattern) => {
    expect(() => parseCanonicalQuad(buildContent())).toThrow(errorPattern);
  });

  it('keeps editable and reference imports on the same structural rejection', async () => {
    const { content } = buildQuad({ channels: TEN_CHANNELS, trailing: ['65535'] });
    const expectedError = 'Invalid .quad data count: found 2561 values, expected exactly 2560 (10 channels × 256).';

    expect(() => parseCanonicalQuad(content)).toThrow(expectedError);
    expect(parseEditableQuad(content)).toEqual({ valid: false, error: expectedError });

    const referenceResult = await loadReferenceQuadFile(fakeQuadFile(content));
    expect(referenceResult).toMatchObject({
      success: false,
      error: `Failed to load reference file: ${expectedError}`
    });
  });

  it('routes both validation APIs through the exact-count parser', () => {
    const { content } = buildQuad({ channels: EIGHT_CHANNELS, trailing: ['42'] });
    const file = fakeQuadFile(content);

    expect(() => validateReferenceQuadFile(file, content)).toThrow(/expected exactly 2048/);
    expect(validateEditableQuadFile(content)).toMatchObject({
      valid: false,
      error: expect.stringMatching(/expected exactly 2048/)
    });
    expect(validateFileFormat(content, 'fixture.quad')).toMatchObject({
      valid: false,
      error: expect.stringMatching(/expected exactly 2048/)
    });
  });
});
