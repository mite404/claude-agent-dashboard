import React, { useState, useEffect, useMemo } from "react";
import {
  IconSearch,
  IconRefresh,
  IconX,
  IconFilter,
  IconDotsVertical,
  IconChevronRight,
  IconClockHour4,
  IconCircle,
  IconCircleCheck,
  IconCircleX,
  IconCircleOff,
  IconPlayerPause,
  IconPlayerPlay,
  IconRotateDot,
  IconTerminal2,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
} from "@tabler/icons-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, formatElapsed, formatTimestamp } from "@/lib/utils";
import type { TaskNode, TaskStatus, LogEntry } from "@/types/task";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_STATUSES: TaskStatus[] = [
  "running",
  "paused",
  "pending",
  "failed",
  "completed",
  "cancelled",
];

// Sort order: most urgent first
const STATUS_ORDER: Record<TaskStatus, number> = {
  running: 0,
  paused: 1,
  failed: 2,
  pending: 3,
  completed: 4,
  cancelled: 5,
};

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  running: <IconClockHour4 size={14} className="text-stone-300" />,
  completed: <IconCircleCheck size={14} className="text-stone-500" />,
  failed: <IconCircleX size={14} className="text-stone-300" />,
  paused: <IconPlayerPause size={14} className="text-stone-400" />,
  pending: <IconCircle size={14} className="text-stone-600" />,
  cancelled: <IconCircleOff size={14} className="text-stone-700" />,
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
  paused: "Paused",
  pending: "Pending",
  cancelled: "Cancelled",
};

const STATUS_TEXT: Record<TaskStatus, string> = {
  running: "text-stone-200", // brightest — actively doing work
  failed: "text-stone-300", // needs attention
  paused: "text-stone-400",
  pending: "text-stone-500",
  completed: "text-stone-500", // dim — done, no longer needs focus
  cancelled: "text-stone-600", // dimmest — terminal & dismissed
};

const PROGRESS_BAR: Record<TaskStatus, string> = {
  running: "bg-stone-300",
  completed: "bg-stone-400",
  failed: "bg-stone-500",
  paused: "bg-stone-500",
  pending: "bg-stone-700",
  cancelled: "bg-stone-800",
};

const LOG_LEVEL_STYLE: Record<LogEntry["level"], string> = {
  info: "text-stone-300",
  debug: "text-stone-500",
  warn: "text-amber-400",
  error: "text-red-400",
};

const LOG_LEVEL_LABEL: Record<LogEntry["level"], string> = {
  info: "INFO ",
  debug: "DEBUG",
  warn: "WARN ",
  error: "ERROR",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlatTask {
  task: TaskNode;
  depth: number;
  hasChildren: boolean;
}

interface TaskTableProps {
  tree: TaskNode[];
  loading: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
}

type SortCol = "task" | "status" | "agent" | "progress" | "duration";

interface SortState {
  col: SortCol | null;
  dir: "asc" | "desc";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function patchTask(taskId: string, patch: object) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH failed: HTTP ${res.status}`);
}

async function deleteTask(id: string) {
  const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${id} failed: HTTP ${res.status}`);
}

function sortNodes(nodes: TaskNode[], sort: SortState): TaskNode[] {
  if (!sort.col) return nodes;
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0;
    if (sort.col === "status") {
      cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    } else if (sort.col === "task") {
      cmp = a.name.localeCompare(b.name);
    } else if (sort.col === "agent") {
      cmp = a.agentType.localeCompare(b.agentType);
    } else if (sort.col === "progress") {
      cmp = a.progressPercentage - b.progressPercentage;
    } else if (sort.col === "duration") {
      const aDur = a.startedAt
        ? new Date(a.completedAt || new Date()).getTime() - new Date(a.startedAt).getTime()
        : 0;
      const bDur = b.startedAt
        ? new Date(b.completedAt || new Date()).getTime() - new Date(b.startedAt).getTime()
        : 0;
      cmp = aDur - bDur;
    }

    return sort.dir === "asc" ? cmp : -cmp;
  });
  return sorted.map((n) => ({ ...n, children: sortNodes(n.children, sort) }));
}

function flattenVisible(nodes: TaskNode[], expanded: Set<string>, depth = 0): FlatTask[] {
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

// ─── FilterPopover ────────────────────────────────────────────────────────────

function FilterPopover({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8">
          <IconFilter size={13} />
          {label}
          {selected.size > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded bg-stone-600 px-1 text-[10px] font-semibold tabular-nums text-stone-100">
              {selected.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2 space-y-0.5">
        {selected.size > 0 && (
          <button
            onClick={onClear}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-stone-500 hover:text-stone-300 hover:bg-stone-800"
          >
            <IconX size={11} />
            Clear filter
          </button>
        )}
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-stone-800"
          >
            <Checkbox checked={selected.has(opt)} className="pointer-events-none" />
            <span className="capitalize text-stone-300">{opt}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// ─── LogDetailRow ─────────────────────────────────────────────────────────────

function LogDetailRow({ logs, colSpan }: { logs: LogEntry[]; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent border-b-0">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="mx-10 mb-2 overflow-auto rounded-(--radius) bg-stone-950 border border-stone-800 font-mono text-xs leading-relaxed max-h-64">
          {/* Header bar */}
          <div className="sticky top-0 flex items-center gap-2 border-b border-stone-800 bg-stone-900/80 px-3 py-1.5">
            <IconTerminal2 size={15} className="text-stone-500" />
            <span className="text-stone-500 uppercase tracking-widest text-[10px] font-bold">
              Logs
            </span>
            <span className="ml-auto text-stone-600 text-[10px]">{logs.length} lines</span>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {logs.map((entry, i) => (
                <tr
                  key={i}
                  className={cn(
                    "group hover:bg-stone-900/60 transition-colors",
                    entry.level === "error" && "bg-red-950/20",
                    entry.level === "warn" && "bg-amber-950/20",
                  )}
                >
                  <td className="select-none px-2 py-0.5 text-right text-[10px] text-stone-700 w-8">
                    {i + 1}
                  </td>
                  <td className="px-2 py-0.5 text-stone-600 whitespace-nowrap w-24">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td className={cn("px-2 py-0.5 font-bold w-12", LOG_LEVEL_STYLE[entry.level])}>
                    {LOG_LEVEL_LABEL[entry.level]}
                  </td>
                  <td className={cn("px-2 py-0.5 pr-4 break-all", LOG_LEVEL_STYLE[entry.level])}>
                    {entry.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── TaskRow ──────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: TaskNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  logsOpen: boolean;
  selected: boolean;
  isBusy: boolean;
  onToggleExpand: () => void;
  onToggleLogs: () => void;
  onToggleSelect: () => void;
  onAction: (action: "cancel" | "pause" | "resume" | "retry") => void;
}

function TaskRow({
  task,
  depth,
  hasChildren,
  expanded,
  logsOpen,
  selected,
  isBusy,
  onToggleExpand,
  onToggleLogs,
  onToggleSelect,
  onAction,
}: TaskRowProps) {
  const isTerminal = task.status === "completed" || task.status === "cancelled";
  const isPaused = task.status === "paused";
  const isFailed = task.status === "failed";
  const elapsed = formatElapsed(task.startedAt, task.completedAt);

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      onClick={task.logs.length > 0 ? onToggleLogs : undefined}
      className={task.logs.length > 0 ? "cursor-pointer" : undefined}
    >
      {/* Select */}
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onChange={onToggleSelect} />
      </TableCell>

      {/* Task ID — subtasks show parent prefix */}
      <TableCell className="w-28">
        {task.parentId ? (
          <span className="flex items-center gap-1 font-mono text-[10px] leading-none">
            <span className="text-stone-600">{task.parentId.slice(0, 6)}</span>
            <span className="text-stone-700">›</span>
            <span className="text-stone-400">{task.id.slice(0, 6)}</span>
          </span>
        ) : (
          <span className="font-mono text-[10px] text-stone-400 leading-none">
            {task.id.slice(0, 8)}
          </span>
        )}
      </TableCell>

      {/* Name */}
      <TableCell>
        <div
          className="flex items-center gap-1.5"
          style={{ paddingLeft: depth > 0 ? `${depth * 16}px` : undefined }}
        >
          {/* Expand/collapse children toggle */}
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              className="shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200 transition-colors"
              title={expanded ? "Collapse subtasks" : "Expand subtasks"}
            >
              <IconChevronRight
                size={13}
                className={cn("transition-transform duration-150", expanded && "rotate-90")}
              />
            </button>
          ) : depth > 0 ? (
            <span className="shrink-0 w-5 text-center text-stone-700 text-xs select-none">└</span>
          ) : (
            <span className="shrink-0 w-5" />
          )}

          {/* Task name */}
          <span className="truncate font-medium text-stone-100">{task.name}</span>

          {/* Log count indicator — row click handles the toggle */}
          {task.logs.length > 0 && (
            <span
              className={cn(
                "shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
                logsOpen ? "bg-stone-700 text-stone-300" : "text-stone-600",
              )}
            >
              <IconTerminal2 size={14} />
              <span>{task.logs.length}</span>
            </span>
          )}
        </div>
      </TableCell>

      {/* Status */}
      <TableCell className="w-28">
        <div className="flex items-center gap-1.5">
          {STATUS_ICON[task.status]}
          <span className={cn("text-sm", STATUS_TEXT[task.status])}>
            {STATUS_LABEL[task.status]}
          </span>
        </div>
      </TableCell>

      {/* Agent Type */}
      <TableCell className="w-32">
        <span className="rounded-(--radius-sm) bg-stone-800 px-1.5 py-0.5 text-[11px] text-stone-400 font-medium">
          {task.agentType}
        </span>
      </TableCell>

      {/* Progress */}
      <TableCell className="w-36">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-stone-800 min-w-0">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                PROGRESS_BAR[task.status],
              )}
              style={{ width: `${task.progressPercentage}%` }}
            />
          </div>
          <span className="shrink-0 w-8 text-right text-xs tabular-nums text-stone-500">
            {task.progressPercentage}%
          </span>
        </div>
      </TableCell>

      {/* Duration */}
      <TableCell className="w-20 text-xs tabular-nums text-stone-500">{elapsed}</TableCell>

      {/* Actions */}
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isBusy}
              className="h-6 w-6 data-state-open:bg-stone-800"
            >
              <IconDotsVertical size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Task actions</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Pause / Resume */}
            <DropdownMenuItem
              onClick={() => onAction(isPaused ? "resume" : "pause")}
              disabled={isTerminal || !task.status.match(/^(running|paused)$/)}
            >
              {isPaused ? (
                <>
                  <IconPlayerPlay size={13} />
                  Resume
                </>
              ) : (
                <>
                  <IconPlayerPause size={13} />
                  Pause
                </>
              )}
            </DropdownMenuItem>

            {/* Retry */}
            <DropdownMenuItem
              onClick={() => onAction("retry")}
              disabled={!isFailed && task.status !== "cancelled"}
            >
              <IconRotateDot size={13} />
              Retry
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Cancel */}
            <DropdownMenuItem
              onClick={() => onAction("cancel")}
              disabled={isTerminal}
              className="text-red-400 focus:text-red-300"
            >
              <IconCircleX size={13} />
              Cancel
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

// ─── TaskTable (main export) ──────────────────────────────────────────────────

const TOTAL_COLS = 8;

export function TaskTable({
  tree,
  loading,
  lastUpdated,
  onRefresh,
  onStatusChange,
}: TaskTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<TaskStatus>>(new Set());
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ col: null, dir: "asc" });
  const [busy, setBusy] = useState<Record<string, string>>({});

  // Auto-expand parent tasks as tree updates (new parents appear)
  useEffect(() => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      const collect = (nodes: TaskNode[]) => {
        for (const n of nodes) {
          if (n.children.length > 0) next.add(n.id);
          collect(n.children);
        }
      };
      collect(tree);
      return next;
    });
  }, [tree]);

  // Unique agent types for the filter popover
  const agentOptions = useMemo(() => {
    const types = new Set<string>();
    const collect = (nodes: TaskNode[]) => {
      for (const n of nodes) {
        types.add(n.agentType);
        collect(n.children);
      }
    };
    collect(tree);
    return [...types].sort();
  }, [tree]);

  // Sort → flatten → filter
  const flatTasks = useMemo(() => {
    const sorted = sortNodes(tree, sort);
    return flattenVisible(sorted, expandedRows).filter(({ task }) => {
      if (statusFilter.size > 0 && !statusFilter.has(task.status)) return false;
      if (agentFilter.size > 0 && !agentFilter.has(task.agentType)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!task.name.toLowerCase().includes(q) && !task.id.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [tree, expandedRows, statusFilter, agentFilter, search, sort]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleAction = async (taskId: string, action: "cancel" | "pause" | "resume" | "retry") => {
    setBusy((prev) => ({ ...prev, [taskId]: action }));
    try {
      const patch =
        action === "cancel"
          ? { status: "cancelled" as TaskStatus }
          : action === "pause"
            ? { status: "paused" as TaskStatus }
            : action === "resume"
              ? { status: "running" as TaskStatus }
              : { status: "running" as TaskStatus, progressPercentage: 0 };
      await patchTask(taskId, patch);
      onStatusChange?.(taskId, patch.status);
    } catch (err) {
      console.error(`Failed to ${action} task ${taskId}:`, err);
    } finally {
      setBusy((prev) => {
        const n = { ...prev };
        delete n[taskId];
        return n;
      });
    }
  };

  // ── Bulk Actions ───────────────────────────────────────────────────────────

  const handleBulkAction = async (action: "cancel" | "pause" | "retry") => {
    setBusy((prev) => {
      const n = { ...prev };
      for (const id of selectedRows) n[id] = action;
      return n;
    });
    try {
      const patch =
        action === "cancel"
          ? { status: "cancelled" as TaskStatus }
          : action === "pause"
            ? { status: "paused" as TaskStatus }
            : { status: "running" as TaskStatus, progressPercentage: 0 };
      await Promise.all([...selectedRows].map((id) => patchTask(id, patch)));
      setSelectedRows(new Set());
      onRefresh();
    } finally {
      setBusy((prev) => {
        const n = { ...prev };
        for (const id of selectedRows) delete n[id];
        return n;
      });
    }
  };

  const handleBulkDelete = async () => {
    setBusy((prev) => {
      const n = { ...prev };
      for (const id of selectedRows) n[id] = "delete";
      return n;
    });
    try {
      await Promise.all([...selectedRows].map((id) => deleteTask(id)));
      setSelectedRows(new Set());
      onRefresh();
    } finally {
      setBusy((prev) => {
        const n = { ...prev };
        for (const id of selectedRows) delete n[id];
        return n;
      });
    }
  };

  // ── Selection ──────────────────────────────────────────────────────────────

  const visibleIds = flatTasks.map((f) => f.task.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedRows.has(id));
  const someSelected = visibleIds.some((id) => selectedRows.has(id));
  const headerChecked = allSelected ? true : someSelected ? "indeterminate" : false;

  const toggleAll = () => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ── Filter helpers ─────────────────────────────────────────────────────────

  const toggleStatusFilter = (v: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v as TaskStatus)) {
        next.delete(v as TaskStatus);
      } else {
        next.add(v as TaskStatus);
      }
      return next;
    });
  };

  const toggleAgentFilter = (v: string) => {
    setAgentFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) {
        next.delete(v);
      } else {
        next.add(v);
      }
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleLogs = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // ── Sort cycle: null → asc → desc → null ─────────────────────────────────

  const cycleSort = () => {
    setSort((prev) => {
      if (prev.col !== "status") {
        return { col: "status", dir: "asc" };
      }
      if (prev.dir === "asc") {
        return { col: "status", dir: "desc" };
      }
      return { col: null, dir: "asc" };
    });
  };

  const hasFilters = statusFilter.size > 0 || agentFilter.size > 0 || search !== "";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <IconSearch
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none"
          />
          <Input
            placeholder="Filter tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8"
          />
        </div>

        <FilterPopover
          label="Status"
          options={ALL_STATUSES}
          selected={statusFilter}
          onToggle={toggleStatusFilter}
          onClear={() => setStatusFilter(new Set())}
        />
        <FilterPopover
          label="Agent"
          options={agentOptions}
          selected={agentFilter}
          onToggle={toggleAgentFilter}
          onClear={() => setAgentFilter(new Set())}
        />

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter(new Set());
              setAgentFilter(new Set());
              setSearch("");
            }}
          >
            Reset
            <IconX size={12} />
          </Button>
        )}

        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              fetch("http://localhost:3002/spawn", { method: "POST" }).catch(console.error)
            }
          >
            <IconTerminal2 size={13} />
            New Agent
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="gap-1.5"
          >
            <IconRefresh size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Bulk action bar — visible when 1+ rows are selected */}
      {selectedRows.size > 0 && (
        <div className="flex items-center gap-2 rounded-(--radius) border border-stone-800 bg-stone-900/80 px-3 py-1.5">
          <span className="text-xs text-stone-400 tabular-nums">{selectedRows.size} selected</span>
          <div className="flex items-center gap-1 ml-2">
            <Button variant="ghost" size="sm" onClick={() => handleBulkAction("cancel")}>
              Cancel
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleBulkAction("pause")}>
              Pause
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleBulkAction("retry")}>
              Retry
            </Button>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
              Delete
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedRows(new Set())}
            className="ml-auto gap-1"
          >
            <IconX size={12} /> Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-(--radius-md) border border-stone-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-stone-900/60">
              <TableHead className="w-10">
                <Checkbox checked={headerChecked} onChange={toggleAll} />
              </TableHead>
              <TableHead className="w-24">ID</TableHead>
              <TableHead>Task</TableHead>

              {/* Sortable Status column */}
              <TableHead className="w-28">
                <button
                  onClick={cycleSort}
                  className="flex items-center gap-1.5 text-stone-400 hover:text-stone-200 transition-colors group"
                  title="Sort by status"
                >
                  Status
                  <span className="opacity-50 group-hover:opacity-100">
                    {sort.dir === "asc" ? (
                      <IconArrowUp size={12} />
                    ) : sort.dir === "desc" ? (
                      <IconArrowDown size={12} />
                    ) : (
                      <IconArrowsSort size={12} />
                    )}
                  </span>
                </button>
              </TableHead>

              <TableHead className="w-32">Agent</TableHead>
              <TableHead className="w-36">Progress</TableHead>
              <TableHead className="w-20">Duration</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {flatTasks.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={TOTAL_COLS} className="h-32 text-center text-stone-500">
                  {tree.length === 0
                    ? "No tasks yet — start a Claude Code agent session to see tasks appear here."
                    : "No tasks match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              flatTasks.map(({ task, depth, hasChildren }) => (
                <React.Fragment key={task.id}>
                  <TaskRow
                    task={task}
                    depth={depth}
                    hasChildren={hasChildren}
                    expanded={expandedRows.has(task.id)}
                    logsOpen={expandedLogs.has(task.id)}
                    selected={selectedRows.has(task.id)}
                    isBusy={task.id in busy}
                    onToggleExpand={() => toggleExpand(task.id)}
                    onToggleLogs={() => toggleLogs(task.id)}
                    onToggleSelect={() => toggleRow(task.id)}
                    onAction={(action) => handleAction(task.id, action)}
                  />
                  {expandedLogs.has(task.id) && task.logs.length > 0 && (
                    <LogDetailRow logs={task.logs} colSpan={TOTAL_COLS} />
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-1 text-xs text-stone-600">
        <span>
          {selectedRows.size > 0
            ? `${selectedRows.size} of ${flatTasks.length} selected`
            : `${flatTasks.length} task${flatTasks.length !== 1 ? "s" : ""}`}
        </span>
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Connecting…"}</span>
      </div>
    </div>
  );
}
