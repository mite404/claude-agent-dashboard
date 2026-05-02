import { describe, it, expect } from 'vitest';
import { buildSessionEvent } from './sessionEventUtils';

describe('buildSessionEvent', () => {
  it('builds a UserPromptSubmit event with truncated prompt', () => {
    const payload = { session_id: 'abc', prompt: 'x'.repeat(200) };
    const result = buildSessionEvent('UserPromptSubmit', payload, '2024-01-01T00:00:00Z', 'abc');

    expect(result.type).toBe('UserPromptSubmit');
    expect(result.summary).toBe(100);
    expect(result.prompt).toBe(payload.prompt); // full prompt preserved in extra field
  });
});
