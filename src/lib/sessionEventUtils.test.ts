import { describe, it, expect } from 'vitest';
import { buildSessionEvent, type ClaudeSessionEventPayload } from './SessionEventUtils';

const basePayload: ClaudeSessionEventPayload = {
  session_id: 'sess-123',
  agent_id: 'agent-456',
  agent_type: 'Explore',
};

describe('buildSessionEvent', () => {
  // ─── Structural invariants ─────────────────────────────────────────────────
  it('always includes type, timestamp, sessionId, and summary', () => {
    const result = buildSessionEvent('Stop', basePayload, 'ts', 'sess-123');
    expect(result).toMatchObject({
      type: 'Stop',
      timestamp: 'ts',
      sessionId: 'sess-123',
      summary: expect.any(String),
    });
  });

  it('includes agent fields only when present', () => {
    const withAgent = buildSessionEvent('Stop', basePayload, 'ts', 'sess');
    expect(withAgent.agentId).toBe('agent-456');
    expect(withAgent.agentType).toBe('Explore');

    const withoutAgent = buildSessionEvent('Stop', { session_id: 'x' }, 'ts', 'sess');
    expect(withoutAgent.agentId).toBeUndefined();
    expect(withoutAgent.agentType).toBeUndefined();
  });

  // ─── Summary truncation ────────────────────────────────────────────────────
  it('truncates UserPromptSubmit summary at 100 chars', () => {
    const payload = { ...basePayload, prompt: 'x'.repeat(200) };
    const result = buildSessionEvent('UserPromptSubmit', payload, 'ts', 'abc_id');

    expect(result.type).toBe('UserPromptSubmit');
    expect(result.summary).toHaveLength(100);
    expect(result.prompt).toBe(payload.prompt);
  });

  it('truncates Notification summary message at 80 chars', () => {
    const longMessage = 'y'.repeat(100);
    const notify = buildSessionEvent(
      'Notification',
      { ...basePayload, message: longMessage, notification_type: 'info' },
      'ts',
      'sess',
    );

    expect(notify.summary).toBe(`info: ${'y'.repeat(80)}`);
  });

  it('truncates PostToolUseFailure summary error at 80 chars', () => {
    const longError = 'z'.repeat(100);
    const failure = buildSessionEvent(
      'PostToolUseFailure',
      { ...basePayload, tool_name: 'Read', error: longError },
      'ts',
      'sess',
    );

    expect(failure.summary).toBe(`Read failed: ${'z'.repeat(80)}`);
  });

  // ─── Conditional summary logic ─────────────────────────────────────────────
  it('formats PreCompact summary with token count when available', () => {
    const withTokens = buildSessionEvent(
      'PreCompact',
      { ...basePayload, token_count: 50000 },
      'ts',
      'sess',
    );
    expect(withTokens.summary).toBe('content compaction (50000 tokens)');
    expect(withTokens.tokenCount).toBe(50000);
  });

  it('falls back to generic PreCompact summary when token count is missing', () => {
    const withoutTokens = buildSessionEvent('PreCompact', basePayload, 'ts', 'sess');
    expect(withoutTokens.summary).toBe('context compaction triggered');
    expect(withoutTokens.tokenCount).toBeNull();
  });

  // ─── Parameterized: event type shapes ──────────────────────────────────────
  it.each([
    ['UserPromptSubmit', { prompt: 'hello' }, { prompt: 'hello' }],
    ['SessionStart', { model: 'claude-sonnet-4' }, { model: 'claude-sonnet-4' }],
    [
      'Notification',
      { message: 'hi', notification_type: 'warn' },
      { message: 'hi', notificationType: 'warn' },
    ],
    ['PermissionRequest', { tool_name: 'Edit' }, { toolName: 'Edit' }],
    [
      'PostToolUseFailure',
      { tool_name: 'Read', error: 'fail' },
      { toolName: 'Read', error: 'fail' },
    ],
    ['SessionEnd', { reason: 'user_exit' }, { reason: 'user_exit' }],
    ['TaskCompleted', { task_title: 'Fix bug' }, { taskTitle: 'Fix bug' }],
    [
      'InstructionsLoaded',
      { file_path: 'CLAUDE.md', source: 'repo' },
      { filePath: 'CLAUDE.md', source: 'repo' },
    ],
    ['WorktreeCreate', { branch: 'feature' }, { branch: 'feature' }],
    ['Stop', {}, {}],
    ['SubagentStart', {}, {}],
  ])('builds %s with correct extra fields', (eventType, payloadExtras, expectedExtras) => {
    const payload = { ...basePayload, ...payloadExtras };
    const result = buildSessionEvent(eventType, payload, 'ts', 'sess');
    expect(result.type).toBe(eventType);
    expect(result.summary).toBeTruthy();
    Object.entries(expectedExtras).forEach(([key, value]) => {
      expect(result[key]).toBe(value);
    });
  });

  // ─── Default / edge cases ──────────────────────────────────────────────────
  it('handles unknown event types gracefully', () => {
    const result = buildSessionEvent('FutureEvent', basePayload, 'ts', 'sess');
    expect(result.type).toBe('FutureEvent');
    expect(result.summary).toBe('FutureEvent');
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(['type', 'timestamp', 'sessionId', 'summary']),
    );
  });

  it('does not throw when optional payload fields are missing', () => {
    const minimalPayload: ClaudeSessionEventPayload = { session_id: 'x' };
    expect(() => buildSessionEvent('UserPromptSubmit', minimalPayload, 'ts', 'sess')).not.toThrow();
    expect(() => buildSessionEvent('Notification', minimalPayload, 'ts', 'sess')).not.toThrow();
    expect(() => buildSessionEvent('PreCompact', minimalPayload, 'ts', 'sess')).not.toThrow();
  });
});
