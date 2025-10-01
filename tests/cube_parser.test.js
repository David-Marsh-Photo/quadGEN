import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadParseCube1D() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'quadgen.html'), 'utf8');
  const start = html.indexOf('function parseCube1D');
  const end = html.indexOf('function parseCube3D', start);
  if (start === -1 || end === -1) {
    throw new Error('Unable to locate parseCube1D snippet');
  }
  const snippet = html.slice(start, end);
  const context = {
    DataSpace: {
      SPACE: { IMAGE: 'image', PRINTER: 'printer' },
      convertSamples(samples) {
        return { values: samples.slice(), sourceSpace: this.SPACE.PRINTER, meta: {} };
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.parseCube1D;
}

const parseCube1D = loadParseCube1D();

describe('parseCube1D', () => {
  it('accepts 256-sample LUT without LUT_1D_SIZE', () => {
    const rows = Array.from({ length: 256 }, (_, i) => (i / 255).toFixed(6));
    const cubeText = rows.join('\n');
    const result = parseCube1D(cubeText);
    expect(result.samples.length).toBe(256);
    expect(result.domainMin).toBe(0);
    expect(result.domainMax).toBe(1);
  });

  it('rejects >256 samples without LUT_1D_SIZE', () => {
    const rows = Array.from({ length: 257 }, (_, i) => (i / 256).toFixed(6));
    const cubeText = rows.join('\n');
    expect(() => parseCube1D(cubeText)).toThrow(/up to 256 points/);
  });
});