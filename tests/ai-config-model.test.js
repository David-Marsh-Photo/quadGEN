import { describe, it, expect } from 'vitest';
import { AI_CONFIG } from '../src/js/ai/ai-config.js';

describe('AI configuration', () => {
  it('uses the claude-sonnet-4-5 model', () => {
    expect(AI_CONFIG.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5');
  });
});
