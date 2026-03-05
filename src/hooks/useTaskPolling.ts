import { useState, useEffect, useCallback } from "react";
import type { Task, TaskNode } from "../types/task";

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
  loading: boolean;
  lastUpdated: Date | null;
  error: string | null;
  refresh: () => void;
}

export function useTaskPolling(intervalMs: number = 2500): UseTaskPollingResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tree, setTree] = useState<TaskNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Task[] = await res.json();
      setTasks(data);
      setTree(buildTree(data));
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const timer = setInterval(fetch_, intervalMs);
    return () => clearInterval(timer);
  }, [fetch_, intervalMs]);

  return { tasks, tree, loading, lastUpdated, error, refresh: fetch_ };
}
