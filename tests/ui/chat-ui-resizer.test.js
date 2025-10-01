/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function resetDom() {
  document.body.innerHTML = '';
}

describe('ChatUI resizer behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    resetDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDom();
  });

  it('attaches resize listeners even when global window is unavailable', async () => {
    document.body.innerHTML = `
      <div id="labTechResizer"></div>
      <div id="chatHistory"></div>
    `;

    const module = await import('../../src/js/ui/chat-ui.js');
    const { ChatUI } = module;

    const instance = new ChatUI();
    instance.chatContainer = document.getElementById('chatHistory');

    const resizer = document.getElementById('labTechResizer');
    const defaultView = document.defaultView;
    const addListenerSpy = vi.spyOn(defaultView, 'addEventListener');

    const originalWindow = global.window;

    try {
      // Simulate a stripped global scope where window is unavailable.
      // Setting undefined reproduces the failure seen when the module
      // references window directly (TypeError on property access).
      global.window = undefined;

      expect(() => instance.initializeResizer()).not.toThrow();

      // Trigger a resize gesture to ensure listeners were registered
      resizer.dispatchEvent(new MouseEvent('mousedown', { clientY: 120, bubbles: true }));

      expect(addListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), undefined);
      expect(addListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function), undefined);
    } finally {
      global.window = originalWindow;
      addListenerSpy.mockRestore();
    }
  });
});
