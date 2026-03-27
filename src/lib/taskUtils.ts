import type { TaskNode } from "@/types/task";
import { STATUS_ORDER } from "./taskConfig";

// ─── Internal Types ───────────────────────────────────────────────────────────

export interface FlatTask {
  task: TaskNode;
  depth: number;
  hasChildren: boolean;
}

export type SortCol = "task" | "status" | "agent" | "id" | "subtasks" | "progress" | "duration";

export interface SortState {
  col: SortCol | null;
  dir: "asc" | "desc";
}

// ─── Sorting ───────────────────────────────────────────────────────────────────

/**
 * Recursively sort a tree of tasks by the given column and direction.
 * Maintains parent-child relationships while applying sort to all levels.
 */
export function sortNodes(nodes: TaskNode[], sort: SortState): TaskNode[] {
  if (!sort.col) return nodes;

  const now = Date.now();
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0;

    if (sort.col === "status") {
      cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    } else if (sort.col === "task") {
      cmp = a.name.localeCompare(b.name);
    } else if (sort.col === "agent") {
      cmp = a.agentType.localeCompare(b.agentType);
    } else if (sort.col === "id") {
      cmp = (a.agentId ?? "").localeCompare(b.agentId ?? "");
    } else if (sort.col === "subtasks") {
      cmp = a.children.length - b.children.length;
    } else if (sort.col === "progress") {
      cmp = a.progressPercentage - b.progressPercentage;
    } else if (sort.col === "duration") {
      const aDur = a.startedAt
        ? new Date(a.completedAt ?? now).getTime() - new Date(a.startedAt).getTime()
        : 0;
      const bDur = b.startedAt
        ? new Date(b.completedAt ?? now).getTime() - new Date(b.startedAt).getTime()
        : 0;
      cmp = aDur - bDur;
    }

    return sort.dir === "asc" ? cmp : -cmp;
  });

  return sorted.map((n) => ({ ...n, children: sortNodes(n.children, sort) }));
}

// ─── Flattening ───────────────────────────────────────────────────────────────

/**
 * Convert a tree of tasks to a flat list, respecting expansion state.
 * Collapsed parents hide their children; expanded parents include them recursively.
 */
export function flattenVisible(nodes: TaskNode[], expanded: Set<string>, depth = 0): FlatTask[] {
  const result: FlatTask[] = [];

  for (const node of nodes) {
    const hasChildren = node.children.length > 0;
    result.push({ task: node, depth, hasChildren });

    if (hasChildren && expanded.has(node.id)) {
      result.push(...flattenVisible(node.children, expanded, depth + 1));
    }
  }

  return result;
}

// ─── Collection ───────────────────────────────────────────────────────────────

/**
 * Recursively collect all tasks (including children) from a tree.
 */
export function collectAllTasks(nodes: TaskNode[]): TaskNode[] {
  return nodes.flatMap((n) => [n, ...collectAllTasks(n.children)]);
}

/**
 * Recursively collect all task IDs from a tree.
 */
export function collectIds(nodes: TaskNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectIds(n.children)]);
}
