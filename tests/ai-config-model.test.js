// @vitest-environment jsdom

import { afterEach, describe, it, expect, vi } from 'vitest';
import { AI_CONFIG } from '../src/js/ai/ai-config.js';
import { ChatInterface } from '../src/js/ai/chat-interface.js';

describe('AI configuration', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Claude Sonnet 5 with adaptive thinking disabled', async () => {
    let requestBody;
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          model: 'claude-sonnet-5',
          content: [{ type: 'text', text: 'Ready.' }]
        })
      };
    }));

    const chat = new ChatInterface();
    chat.addMessage = vi.fn();
    chat.shouldShowStatus = () => false;
    chat.getSystemContext = () => 'Test printer state';

    const result = await chat.sendMessage('Describe the current state.');

    expect(result.success).toBe(true);
    expect(AI_CONFIG.ANTHROPIC_MODEL).toBe('claude-sonnet-5');
    expect(requestBody).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      thinking: { type: 'disabled' }
    });
    expect(requestBody).not.toHaveProperty('temperature');
    expect(requestBody).not.toHaveProperty('top_p');
    expect(requestBody).not.toHaveProperty('top_k');
  });
});
