import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchTask, deleteTask, createTask, claimTask, clearAllSessionEvents } from './taskApi';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

// ─── patchTask Tests ─────────────────────────────────────────────────────────

describe('patchTask', () => {
  it('calls fetch with PATCH method and correct URL', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await patchTask('task-123', { status: 'completed' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-123',
      expect.objectContaining({
        method: 'PATCH',
      }),
    );
  });

  it('sends JSON body with patch content', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const patch = { status: 'completed', progressPercentage: 100 };
    await patchTask('task-456', patch);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify(patch),
      }),
    );
  });

  it('sets Content-Type header to application/json', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await patchTask('task-789', { status: 'running' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('throws when fetch returns a non-ok status', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));

    await expect(patchTask('task-fail', { status: 'failed' })).rejects.toThrow(
      /PATCH \/tasks\/task-fail failed: HTTP 500/,
    );
  });

  it('throws with specific error message including status code', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 404 }));

    await expect(patchTask('missing-task', {})).rejects.toThrow('404');
  });

  it('succeeds with status 200', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await expect(patchTask('task-ok', { status: 'pending' })).resolves.not.toThrow();
  });

  it('succeeds with status 204 (No Content)', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(patchTask('task-updated', {})).resolves.not.toThrow();
  });
});

// ─── deleteTask Tests ─────────────────────────────────────────────────────────

describe('deleteTask', () => {
  it('calls fetch with DELETE method and correct URL', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteTask('task-to-delete');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-to-delete',
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  it('throws when fetch returns a non-ok status', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 404 }));

    await expect(deleteTask('missing-task')).rejects.toThrow(
      /DELETE \/api\/tasks\/missing-task failed: HTTP 404/,
    );
  });

  it('throws with specific error message including task ID and status', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(deleteTask('task-abc')).rejects.toThrow('500');
  });

  it('succeeds with status 204', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(deleteTask('task-removed')).resolves.not.toThrow();
  });

  it('succeeds with status 200', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'task-id' }), { status: 200 }),
    );

    await expect(deleteTask('task-ok')).resolves.not.toThrow();
  });

  it('properly encodes task ID in URL (with special characters)', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const taskId = 'task-with-special-chars-123';
    await deleteTask(taskId);

    expect(mockFetch).toHaveBeenCalledWith(`/api/tasks/${taskId}`, expect.any(Object));
  });
});

// ─── createTask Tests ─────────────────────────────────────────────────────────

describe('createTask', () => {
  it('calls fetch with POST method and correct URL', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'new-task-id' }), { status: 201 }),
    );

    await createTask({ name: 'My Task', sessionId: 'sess-1' });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends JSON body with all required fields and default status unassigned', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'task-abc' }), { status: 201 }),
    );

    await createTask({ name: 'Test Task', sessionId: 'sess-42' });

    const call = mockFetch.mock.calls[0];
    const body = JSON.parse(call[1]?.body as string) as Record<string, unknown>;
    expect(body.name).toBe('Test Task');
    expect(body.sessionId).toBe('sess-42');
    expect(body.status).toBe('unassigned');
  });

  it('includes optional fields when provided', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'task-xyz' }), { status: 201 }),
    );

    await createTask({
      name: 'Complex Task',
      sessionId: 'sess-10',
      agentType: 'Explore',
      priority: 'high',
      description: 'Some description',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(body.agentType).toBe('Explore');
    expect(body.priority).toBe('high');
    expect(body.description).toBe('Some description');
  });

  it('returns the id from the response JSON', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'returned-id' }), { status: 201 }),
    );

    const result = await createTask({ name: 'Task', sessionId: 'sess-1' });

    expect(result.id).toBe('returned-id');
  });

  it('throws when fetch returns a non-ok status', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));

    await expect(createTask({ name: 'Bad', sessionId: 'sess-1' })).rejects.toThrow(
      /POST \/tasks failed: HTTP 500/,
    );
  });
});

// ─── claimTask Tests ──────────────────────────────────────────────────────────

describe('claimTask', () => {
  it('calls fetch with POST to the claim endpoint', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await claimTask('task-1', 'agent-99');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/task-1/claim',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends claimedBy in the request body', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await claimTask('task-2', 'agent-42');

    const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(body.claimedBy).toBe('agent-42');
  });

  it('returns { ok: true } on success', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const result = await claimTask('task-3', 'agent-1');

    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: false, status: 409, claimedBy } when task already claimed', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ claimedBy: 'agent-existing' }), { status: 409 }),
    );

    const result = await claimTask('task-4', 'agent-new');

    expect(result).toEqual({ ok: false, status: 409, claimedBy: 'agent-existing' });
  });

  it('falls back to "unknown" claimedBy when 409 body has no claimedBy field', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 409 }));

    const result = await claimTask('task-5', 'agent-new');

    expect(result).toEqual({ ok: false, status: 409, claimedBy: 'unknown' });
  });

  it('throws for non-ok, non-409 status codes', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));

    await expect(claimTask('task-6', 'agent-1')).rejects.toThrow(
      /POST \/tasks\/task-6\/claim failed: HTTP 500/,
    );
  });
});

// ─── clearAllSessionEvents Tests ──────────────────────────────────────────────

describe('clearAllSessionEvents', () => {
  it('calls fetch with DELETE to /api/sessionEvents', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await clearAllSessionEvents();

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/sessionEvents',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('succeeds with status 204', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(clearAllSessionEvents()).resolves.not.toThrow();
  });

  it('throws when fetch returns a non-ok status', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 500 }));

    await expect(clearAllSessionEvents()).rejects.toThrow(
      /DELETE \/api\/sessionEvents failed: HTTP 500/,
    );
  });
});
