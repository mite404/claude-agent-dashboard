import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchTask, deleteTask } from './taskApi';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

// ─── patchTask Tests ─────────────────────────────────────────────────────────

describe('patchTask', () => {
  it('calls fetch with PATCH method and correct URL', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

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
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

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
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

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
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 }),
    );

    await expect(patchTask('task-fail', { status: 'failed' })).rejects.toThrow(
      /PATCH \/tasks\/task-fail failed: HTTP 500/,
    );
  });

  it('throws with specific error message including status code', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 404 }),
    );

    await expect(patchTask('missing-task', {})).rejects.toThrow('404');
  });

  it('succeeds with status 200', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    await expect(patchTask('task-ok', { status: 'pending' })).resolves.not.toThrow();
  });

  it('succeeds with status 204 (No Content)', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    await expect(patchTask('task-updated', {})).resolves.not.toThrow();
  });
});

// ─── deleteTask Tests ─────────────────────────────────────────────────────────

describe('deleteTask', () => {
  it('calls fetch with DELETE method and correct URL', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

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
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 404 }),
    );

    await expect(deleteTask('missing-task')).rejects.toThrow(
      /DELETE \/api\/tasks\/missing-task failed: HTTP 404/,
    );
  });

  it('throws with specific error message including task ID and status', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );

    await expect(deleteTask('task-abc')).rejects.toThrow('500');
  });

  it('succeeds with status 204', async () => {
    const mockFetch = vi.mocked(global.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

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
    mockFetch.mockResolvedValueOnce(
      new Response(null, { status: 204 }),
    );

    const taskId = 'task-with-special-chars-123';
    await deleteTask(taskId);

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/tasks/${taskId}`,
      expect.any(Object),
    );
  });
});
