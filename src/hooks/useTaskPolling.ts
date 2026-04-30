import { useState, useEffect, useCallback } from 'react';
import type { Task, TaskNode, SessionEvent } from '../types/task';

// Mutates tasks in-place: marks tasks as "blocked" if any dependency is incomplete.
// Must run BEFORE buildTree so the tree inherits the updated status.
export function computeBlockedState(tasks: Task[]): void {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    if (!task.dependencies?.length) continue;
    const blocking = task.dependencies.filter((depId) => {
      const dep = taskMap.get(depId);
      return dep && dep.status !== 'completed' && dep.status !== 'cancelled';
    });
    if (blocking.length > 0) {
      task.status = 'blocked';
      (task as TaskNode).blockedBy = blocking;
    }
  }
}

export function buildTree(tasks: Array<Task>): Array<TaskNode> {
  const map = new Map<string, TaskNode>();
  const roots: Array<TaskNode> = [];

  for (const task of tasks) {
    map.set(task.id, { ...task, children: [] });
  }

  for (const node of map.values()) {
    if (node.parentId) {
      const parent = map.get(node.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node); // orphaned child — treat as root
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

interface UseTaskPollingResult {
  tasks: Task[];
  tree: TaskNode[];
  sessionEvents: SessionEvent[];
  loading: boolean;
  lastUpdated: Date | null;
  error: string | null;
  refresh: () => void;
}

export function useTaskPolling(intervalMs: number = 2500): UseTaskPollingResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tree, setTree] = useState<TaskNode[]>([]);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const [tasksRes, eventsRes] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/sessionEvents'),
      ]);
      if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status}`);

      const rawTasks = await tasksRes.json();
      const data: Task[] = Array.isArray(rawTasks) ? rawTasks.map((t: Task) => ({ ...t })) : [];

      // Compute blocked state before building tree so tree inherits updated statuses
      computeBlockedState(data);
      setTasks(data);
      setTree(buildTree(data));

      if (eventsRes.ok) {
        const rawEvents = await eventsRes.json();
        const eventsArray = rawEvents?.data ?? rawEvents;
        setSessionEvents(Array.isArray(eventsArray) ? eventsArray : []);
      }

      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const timer = setInterval(fetch_, intervalMs);
    return () => clearInterval(timer);
  }, [fetch_, intervalMs]);

  return { tasks, tree, sessionEvents, loading, lastUpdated, error, refresh: fetch_ };
}
