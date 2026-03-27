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
 * DELETE all session events.
 */
export async function clearAllSessionEvents(): Promise<void> {
  const res = await fetch(`${API_BASE}/sessionEvents`, { method: "DELETE" });

  if (!res.ok) {
    throw new Error(`DELETE /api/sessionEvents failed: HTTP ${res.status}`);
  }
}
