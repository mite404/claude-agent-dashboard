/**
 * API contract helpers for task management.
 * Single place to update if the API URL, auth headers, or base path ever changes.
 */

const API_BASE = "/api";

/**
 * PATCH a task with the given changes.
 * @param taskId The task ID to update
 * @param patch Object with fields to update
 */
export async function patchTask(taskId: string, patch: object): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    throw new Error(`PATCH /tasks/${taskId} failed: HTTP ${res.status}`);
  }
}

/**
 * DELETE a task.
 * @param taskId The task ID to delete
 */
export async function deleteTask(taskId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}`, { method: "DELETE" });

  if (!res.ok) {
    throw new Error(`DELETE /api/tasks/${taskId} failed: HTTP ${res.status}`);
  }
}

/**
 * POST a new task to the pool.
 */
export async function createTask(fields: {
  name: string;
  sessionId: string;
  status?: string;
  priority?: string;
  description?: string;
}): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "unassigned", ...fields }),
  });
  if (!res.ok) throw new Error(`POST /tasks failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Atomically claim an unassigned task. Returns 409 if already claimed.
 */
export async function claimTask(
  taskId: string,
  claimedBy: string,
): Promise<{ ok: true } | { ok: false; status: 409; claimedBy: string }> {
  const res = await fetch(`${API_BASE}/tasks/${taskId}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimedBy }),
  });
  if (res.status === 409) {
    const body = await res.json();
    return { ok: false, status: 409, claimedBy: body.claimedBy ?? "unknown" };
  }
  if (!res.ok) throw new Error(`POST /tasks/${taskId}/claim failed: HTTP ${res.status}`);
  return { ok: true };
}

/**
 * DELETE all session events.
 */
export async function clearAllSessionEvents(): Promise<void> {
  const res = await fetch(`${API_BASE}/sessionEvents`, { method: "DELETE" });

  if (!res.ok) {
    throw new Error(`DELETE /api/sessionEvents failed: HTTP ${res.status}`);
  }
}
