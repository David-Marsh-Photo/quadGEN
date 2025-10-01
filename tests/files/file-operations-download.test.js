/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function resetDom() {
  document.body.innerHTML = '';
}

describe('file operations download helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    resetDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDom();
  });

  it('uses URL API even when global window is unavailable', async () => {
    const createObjectURLSpy = vi.fn(() => 'blob:test');
    const revokeObjectURLSpy = vi.fn();

    const originalWindow = global.window;
    const originalURL = global.URL;

    global.URL = {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy
    };

    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    const module = await import('../../src/js/files/file-operations.js');
    const { downloadFile } = module;

    let clickCallCount = 0;

    try {
      global.window = undefined;
      expect(() => downloadFile('hello', 'test.txt')).not.toThrow();
    } finally {
      clickCallCount = clickSpy.mock.calls.length;
      global.window = originalWindow;
      global.URL = originalURL;
      clickSpy.mockRestore();
      appendSpy.mockRestore();
      removeSpy.mockRestore();
    }

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');
    expect(clickCallCount).toBe(1);
  });
});
