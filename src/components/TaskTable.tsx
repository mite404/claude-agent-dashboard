import React, { useState, useEffect, useMemo, useRef } from "react";
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
  IconEyeOff,
  IconAdjustmentsHorizontal,
  IconCheck,
  IconCopy,
  IconTrash,
  IconClockPlay,
  IconSun,
  IconMoon,
  IconBan,
  IconMicroscope,
  IconRuler,
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
import { StatusBadge } from "@/components/ui/badge";
import type { TaskNode, TaskStatus, LogEntry, HookEvent, SessionEvent, SessionEventType, TaskKind } from "@/types/task";

// ─── Constants ───────────────────────────────────────────────────────────────

const ALL_STATUSES: TaskStatus[] = [
  "running",
  "paused",
  "blocked",
  "pending",
  "failed",
  "completed",
  "cancelled",
];

// Sort order: most urgent first
const STATUS_ORDER: Record<TaskStatus, number> = {
  running: 0,
  paused: 1,
  blocked: 2,
  failed: 3,
  pending: 4,
  completed: 5,
  cancelled: 6,
};

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  running: <IconClockHour4 size={14} aria-hidden="true" className="text-lime-400" />,
  completed: <IconCircleCheck size={14} aria-hidden="true" className="text-stone-500" />,
  failed: <IconCircleX size={14} aria-hidden="true" className="text-red-500" />,
  paused: <IconPlayerPause size={14} aria-hidden="true" className="text-amber-400" />,
  pending: <IconCircle size={14} aria-hidden="true" className="text-stone-500" />,
  cancelled: <IconCircleOff size={14} aria-hidden="true" className="text-stone-500" />,
  blocked: <IconBan size={14} aria-hidden="true" className="text-orange-400" />,
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
  paused: "Paused",
  pending: "Pending",
  cancelled: "Cancelled",
  blocked: "Blocked",
};

const STATUS_TEXT: Record<TaskStatus, string> = {
  running: "text-lime-400",   // lime — actively doing work
  failed: "text-red-500",     // red — needs attention
  paused: "text-amber-400",   // amber — suspended
  blocked: "text-orange-400", // orange — waiting on a dependency
  pending: "text-stone-500",
  completed: "text-stone-500",
  cancelled: "text-stone-500",
};

const PROGRESS_BAR: Record<TaskStatus, string> = {
  running: "bg-stone-300",
  completed: "bg-stone-400",
  failed: "bg-stone-500",
  paused: "bg-stone-500",
  blocked: "bg-orange-900/50",
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
  sessionEvents: SessionEvent[];
  loading: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void;
  lightMode: boolean;
  onThemeToggle: () => void;
}

type SortCol = "task" | "status" | "agent" | "subtasks" | "progress" | "duration";
type HideableCol = "task" | "status" | "agent" | "subtasks" | "progress" | "duration";

const HIDEABLE_COLS: { col: HideableCol; label: string }[] = [
  { col: "task", label: "Task" },
  { col: "agent", label: "Agent" },
  { col: "status", label: "Status" },
  { col: "subtasks", label: "Subtasks" },
  { col: "progress", label: "Progress" },
  { col: "duration", label: "Duration" },
];

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
  const now = Date.now();
  const sorted = [...nodes].sort((a, b) => {
    let cmp = 0;
    if (sort.col === "status") {
      cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    } else if (sort.col === "task") {
      cmp = a.name.localeCompare(b.name);
    } else if (sort.col === "agent") {
      cmp = a.agentType.localeCompare(b.agentType);
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

function collectAllTasks(nodes: TaskNode[]): TaskNode[] {
  return nodes.flatMap((n) => [n, ...collectAllTasks(n.children)]);
}

function collectIds(nodes: TaskNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectIds(n.children)]);
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
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-stone-400 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
          >
            <IconX size={11} />
            Clear filter
          </button>
        )}
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
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
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive, but only if already near the bottom
  // (so manually scrolling up to read older entries isn't interrupted)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [logs]);

  const copyLogs = () => {
    const text = logs
      .map((e) => `${formatTimestamp(e.timestamp)}  ${LOG_LEVEL_LABEL[e.level]}  ${e.message}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <TableRow className="hover:bg-transparent border-b-0">
      <TableCell colSpan={colSpan} className="p-0">
        <div ref={scrollRef} className="mx-7.5 mb-2 overflow-auto rounded-(--radius) bg-stone-950 border border-stone-800 font-mono text-xs leading-relaxed max-h-96">
          {/* Header bar */}
          <div className="sticky top-0 flex items-center gap-2 border-b border-stone-800 bg-stone-900/80 px-3 py-1.5">
            <IconTerminal2 size={15} aria-hidden="true" className="text-stone-500" />
            <span className="text-stone-500 uppercase tracking-widest text-[10px] font-bold">
              Logs
            </span>
            <span className="ml-auto text-stone-500 text-[10px]">{logs.length} lines</span>
            <button
              onClick={copyLogs}
              title="Copy logs"
              aria-label={copied ? "Logs copied" : "Copy logs"}
              className="ml-1 text-stone-500 hover:text-stone-300 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500 rounded"
            >
              {copied ? <IconCheck size={13} className="text-stone-400" /> : <IconCopy size={13} />}
            </button>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              {logs.map((entry, i) => (
                <tr
                  key={`${entry.timestamp}-${i}`}
                  className={cn(
                    "group hover:bg-stone-900/60 transition-colors",
                    entry.level === "error" && "bg-red-950/20",
                    entry.level === "warn" && "bg-amber-950/20",
                  )}
                >
                  <td className="select-none px-2 py-0.5 text-right text-[10px] text-stone-600 w-8">
                    {i + 1}
                  </td>
                  <td className="px-2 py-0.5 text-stone-500 whitespace-nowrap w-24">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td className={cn("px-2 py-0.5 font-bold w-12", LOG_LEVEL_STYLE[entry.level])}>
                    {LOG_LEVEL_LABEL[entry.level]}
                  </td>
                  <td className={cn("px-2 py-0.5 pr-4 break-all whitespace-pre-wrap", LOG_LEVEL_STYLE[entry.level])}>
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

// ─── CheckpointRow ────────────────────────────────────────────────────────────

const CHECKPOINT_ICON: Record<TaskStatus, string> = {
  completed: "✓",
  running:   "●",
  pending:   "○",
  paused:    "◐",
  failed:    "✗",
  cancelled: "–",
  blocked:   "⊘",
};

const CHECKPOINT_COLOR: Record<TaskStatus, string> = {
  completed: "text-green-400",
  running:   "text-blue-400",
  failed:    "text-red-400",
  paused:    "text-amber-400",
  blocked:   "text-orange-400",
  pending:   "text-stone-600",
  cancelled: "text-stone-700",
};

// ─── Event Trail constants ────────────────────────────────────────────────────

const TOOL_EMOJI: Record<string, string> = {
  Bash:      "💻",
  Read:      "📖",
  Write:     "✍️",
  Edit:      "✏️",
  Grep:      "🔍",
  Glob:      "📂",
  WebFetch:  "🌐",
  WebSearch: "🔎",
  Agent:     "🤖",
  Task:      "🤖",
};

const EVENT_STATUS_COLOR: Record<HookEvent["status"], string> = {
  running:   "text-blue-400",
  completed: "text-stone-500",
  failed:    "text-red-400",
};

// ─── Session Strip constants ──────────────────────────────────────────────────

const SESSION_EVENT_EMOJI: Record<SessionEventType, string> = {
  UserPromptSubmit:   "💬",
  SessionStart:       "🚀",
  Stop:               "🛑",
  SubagentStart:      "🟢",
  SubagentStop:       "👥",
  Notification:       "🔔",
  PermissionRequest:  "🔐",
  PreCompact:         "📦",
  PostToolUseFailure: "❌",
};

const TASK_KIND_ICON: Partial<Record<TaskKind, React.ReactNode>> = {
  evaluation: <IconMicroscope size={11} className="text-sky-400" />,
  planning:   <IconRuler size={11} className="text-violet-400" />,
};

function CheckpointRow({ task, colSpan }: { task: TaskNode; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent border-b-0">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="mx-7.5 mb-2 rounded-(--radius) border border-stone-800 bg-stone-950 text-xs overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-800/60 bg-stone-900/60 px-3 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-stone-500">
              Subtasks
            </span>
            <span className="font-mono text-[10px] text-stone-600">
              {task.children.filter(c => c.status === "completed").length}/{task.children.length} done
            </span>
          </div>
          {/* Checkpoint list */}
          <div className="divide-y divide-stone-800/40">
            {task.children.map((child) => (
              <div key={child.id} className="flex items-center gap-3 px-3 py-2 hover:bg-stone-900/40 transition-colors">
                <span className={cn("w-3 shrink-0 text-center font-mono font-bold", CHECKPOINT_COLOR[child.status])}>
                  {CHECKPOINT_ICON[child.status]}
                </span>
                <span className="flex-1 truncate text-stone-200">{child.name}</span>
                <StatusBadge status={child.status} className="shrink-0" />
                <span className="shrink-0 font-mono text-[10px] text-stone-600">
                  {formatElapsed(child.startedAt, child.completedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── AgentSummaryRow ──────────────────────────────────────────────────────────

function AgentSummaryRow({ message, colSpan }: { message: string; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent border-b-0">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="mx-7.5 mb-2 rounded-(--radius) border border-stone-800 bg-stone-950">
          <div className="border-b border-stone-800/60 bg-stone-900/60 px-3 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-stone-500">
              Agent Summary
            </span>
          </div>
          <div className="whitespace-pre-wrap p-3 font-mono text-[11px] text-stone-300">
            {message}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── EventTrailRow ────────────────────────────────────────────────────────────

function EventTrailRow({ task, colSpan }: { task: TaskNode; colSpan: number }) {
  const events = task.events ?? [];
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever new events arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <TableRow className="hover:bg-transparent border-b-0">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="mx-7.5 mb-2 rounded-(--radius) border border-stone-800 bg-stone-950 text-xs overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-800/60 bg-stone-900/60 px-3 py-2">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-stone-500">
              Event Trail
            </span>
            <span className="font-mono text-[10px] text-stone-600">
              {events.filter((e) => e.status === "completed").length}/{events.length} done
            </span>
          </div>
          <div ref={scrollRef} className="divide-y divide-stone-800/40 max-h-60 overflow-y-auto">
            {events.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-stone-600 italic">No tool events yet…</div>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-stone-900/40 transition-colors"
                >
                  <span className="shrink-0 w-5 text-center select-none" aria-hidden="true">
                    {TOOL_EMOJI[event.toolName] ?? "⚡"}
                  </span>
                  <span className="w-16 shrink-0 font-mono text-[10px] text-stone-500">
                    {event.toolName}
                  </span>
                  <span
                    className="flex-1 truncate font-mono text-[10px] text-stone-400"
                    title={event.summary}
                  >
                    {event.summary}
                  </span>
                  <span className={cn("shrink-0 font-mono text-[10px]", EVENT_STATUS_COLOR[event.status])}>
                    {event.status}
                  </span>
                  <span className="shrink-0 w-14 text-right font-mono text-[10px] text-stone-600">
                    {formatElapsed(event.timestamp, event.completedAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── GlobalEventStrip ─────────────────────────────────────────────────────────

function GlobalEventStrip({ events }: { events: SessionEvent[] }) {
  const [open, setOpen] = useState(() => events.length > 0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever new events arrive or the panel opens
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length, open]);

  return (
    <div className="rounded-md border border-stone-800 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left bg-stone-900/60 hover:bg-stone-900 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
        aria-expanded={open}
        aria-label={open ? "Collapse session events" : "Expand session events"}
      >
        <IconChevronRight
          size={13}
          aria-hidden="true"
          className={cn("text-stone-500 transition-transform duration-150 shrink-0", open && "rotate-90")}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-stone-500">
          Session Events
        </span>
        <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded bg-stone-800 px-1 text-[10px] font-semibold tabular-nums text-stone-400">
          {events.length}
        </span>
      </button>

      {open && (
        <div ref={scrollRef} className="max-h-64 overflow-auto divide-y divide-stone-800/40">
          {events.length === 0 ? (
            <div className="px-3 py-3 text-xs text-stone-600 italic">
              No session events yet — submit a user prompt to start.
            </div>
          ) : (
            events.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-stone-900/40 transition-colors"
              >
                {/* Emoji */}
                <span className="shrink-0 w-5 text-center select-none" aria-hidden="true">
                  {SESSION_EVENT_EMOJI[event.type] ?? "📋"}
                </span>
                {/* Event type */}
                <span className="w-40 shrink-0 text-[11px] text-stone-500">
                  {event.type}
                </span>
                {/* Summary */}
                <span
                  className="flex-1 truncate font-mono text-[10px] text-stone-300"
                  title={event.summary}
                >
                  {event.summary}
                </span>
                {/* Skill pill — shown for UserPromptSubmit events with a skill */}
                {event.type === 'UserPromptSubmit' && event.originatingSkill && (
                  <span className="shrink-0 rounded bg-violet-950 px-1.5 py-0.5 font-mono text-[10px] text-violet-300 border border-violet-700">
                    {event.originatingSkill}
                  </span>
                )}
                {/* Agent ID — fixed column, always present */}
                <span
                  className="w-36 shrink-0 truncate font-mono text-[10px] text-stone-500"
                  title={event.agentId
                    ? `${event.agentType ?? "agent"}: ${event.agentId}`
                    : undefined}
                >
                  {event.agentId ?? "—"}
                </span>
                {/* Timestamp (24hr) */}
                <span className="shrink-0 font-mono text-[10px] text-stone-600">
                  {formatTimestamp(event.timestamp)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
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
  isNew: boolean;
  hiddenCols: Set<HideableCol>;
  taskMap: Map<string, TaskNode>;
  onToggleExpand: () => void;
  onToggleLogs: () => void;
  onToggleSelect: () => void;
  onFilterByAgent: (agentType: string) => void;
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
  isNew,
  hiddenCols,
  taskMap,
  onToggleExpand,
  onToggleLogs,
  onToggleSelect,
  onFilterByAgent,
  onAction,
}: TaskRowProps) {
  const isTerminal = task.status === "completed" || task.status === "cancelled";
  const isPaused = task.status === "paused";
  const isFailed = task.status === "failed";
  const elapsed = formatElapsed(task.startedAt, task.completedAt);

  const hasDetail = (task.events?.length ?? 0) > 0 || task.children.length > 0 || task.logs.length > 0;

  // For blocked tasks: look up the names of the tasks causing the block
  const blockingNames = task.blockedBy
    ?.map((id) => taskMap.get(id)?.name ?? id)
    .slice(0, 2) // show at most 2 names inline
  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      onClick={hasDetail ? onToggleLogs : undefined}
      onKeyDown={hasDetail ? (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleLogs(); } } : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      aria-expanded={hasDetail ? logsOpen : undefined}
      className={cn(
        hasDetail ? "cursor-pointer" : undefined,
        isNew && "animate-row-fade-in",
      )}
    >
      {/* Select */}
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onChange={onToggleSelect} />
      </TableCell>

      {/* Name */}
      {!hiddenCols.has("task") && <TableCell>
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
              className="shrink-0 flex h-5 w-5 items-center justify-center rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500 p-2 -m-2"
              aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"}
              aria-expanded={expanded}
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
          <span
            className="truncate font-medium text-stone-100"
            title={task.originatingSkill ? `initiated by ${task.originatingSkill}` : undefined}
          >
            {task.name}
          </span>
          {task.taskKind && TASK_KIND_ICON[task.taskKind] && (
            <span className="shrink-0 ml-2">
              {TASK_KIND_ICON[task.taskKind]}
            </span>
          )}
        </div>
      </TableCell>}

      {/* Agent Type */}
      {!hiddenCols.has("agent") && <TableCell className="w-32" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onFilterByAgent(task.agentType)}
          className="rounded-sm bg-stone-800 px-1.5 py-0.5 text-[11px] text-stone-400 font-medium hover:bg-stone-700 hover:text-stone-200 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
          title={`Filter by ${task.agentType}`}
        >
          {task.agentType}
        </button>
      </TableCell>}

      {/* Status */}
      {!hiddenCols.has("status") && <TableCell className="w-28">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {STATUS_ICON[task.status]}
            <span className={cn("text-sm", STATUS_TEXT[task.status])}>
              {STATUS_LABEL[task.status]}
            </span>
          </div>
          {task.status === "blocked" && blockingNames && blockingNames.length > 0 && (
            <span className="text-[10px] text-stone-500 truncate max-w-24" title={blockingNames.join(", ")}>
              waiting for: {blockingNames.join(", ")}
            </span>
          )}
        </div>
      </TableCell>}

      {/* Subtasks */}
      {!hiddenCols.has("subtasks") && <TableCell className="w-20">
        {task.children.length > 0 ? (
          <span className="font-mono text-[11px] tabular-nums text-stone-400">
            {task.children.filter(c => c.status === "completed").length}/{task.children.length}
          </span>
        ) : (
          <span className="text-stone-700 text-[11px]">—</span>
        )}
      </TableCell>}

      {/* Progress */}
      {!hiddenCols.has("progress") && <TableCell className="w-36">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-stone-800 min-w-0">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                PROGRESS_BAR[task.status],
              )}
              style={{ width: `${task.progressPercentage}%` }}
              role="progressbar"
              aria-valuenow={task.progressPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Task progress"
            />
          </div>
          <span className="shrink-0 w-8 text-right text-xs tabular-nums text-stone-500">
            {task.progressPercentage}%
          </span>
        </div>
      </TableCell>}

      {/* Duration */}
      {!hiddenCols.has("duration") && <TableCell className="w-20 text-xs tabular-nums text-stone-500">{elapsed}</TableCell>}

      {/* Actions */}
      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isBusy}
              aria-label="Task actions"
              className="h-8 w-8 data-state-open:bg-stone-800"
            >
              <IconDotsVertical size={13} aria-hidden="true" />
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

// ─── SortHeader ───────────────────────────────────────────────────────────────

function SortHeader({
  col,
  label,
  sort,
  onSort,
  onHide,
}: {
  col: SortCol;
  label: string;
  sort: SortState;
  onSort: (col: SortCol, dir: "asc" | "desc") => void;
  onHide: (col: HideableCol) => void;
}) {
  const isActive = sort.col === col;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 text-stone-400 hover:text-stone-200 transition-colors group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500 rounded">
          {label}
          <span className={cn("transition-opacity", isActive ? "opacity-100" : "opacity-40 group-hover:opacity-100")}>
            {isActive && sort.dir === "asc" ? (
              <IconArrowUp size={12} />
            ) : isActive && sort.dir === "desc" ? (
              <IconArrowDown size={12} />
            ) : (
              <IconArrowsSort size={12} />
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-36">
        <DropdownMenuItem onClick={() => onSort(col, "asc")}>
          <IconArrowUp size={13} />
          Asc
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSort(col, "desc")}>
          <IconArrowDown size={13} />
          Desc
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onHide(col as HideableCol)} className="text-stone-500">
          <IconEyeOff size={13} />
          Hide
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── TaskTable (main export) ──────────────────────────────────────────────────

export function TaskTable({
  tree,
  sessionEvents,
  loading,
  lastUpdated,
  onRefresh,
  onStatusChange,
  lightMode,
  onThemeToggle,
}: TaskTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<TaskStatus>>(new Set());
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ col: null, dir: "asc" });
  const [hiddenCols, setHiddenCols] = useState<Set<HideableCol>>(new Set());
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [sessionFilter, setSessionFilter] = useState<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const knownIds = useRef<Set<string>>(new Set());

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

  // Track newly-arrived task IDs to animate them in
  useEffect(() => {
    const all = collectIds(tree);
    const fresh = all.filter((id) => !knownIds.current.has(id));
    all.forEach((id) => knownIds.current.add(id));
    if (fresh.length > 0) {
      setNewIds(new Set(fresh));
      setTimeout(() => setNewIds(new Set()), 250);
    }
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

  // Flat map of all tasks for blocked reason lookup
  const taskMap = useMemo(() => {
    const map = new Map<string, TaskNode>();
    for (const t of collectAllTasks(tree)) map.set(t.id, t);
    return map;
  }, [tree]);

  // Sessions: one entry per unique sessionId, labeled by earliest root task's name
  const sessionOptions = useMemo(() => {
    const allTasks = collectAllTasks(tree);
    const groups = new Map<string, TaskNode[]>();
    for (const task of allTasks) {
      if (!task.sessionId) continue;
      if (!groups.has(task.sessionId)) groups.set(task.sessionId, []);
      groups.get(task.sessionId)!.push(task);
    }
    return [...groups.entries()]
      .map(([sid, tasks]) => {
        const rootTasks = tasks
          .filter((t) => !t.parentId)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const label = rootTasks[0]?.name ?? sid.slice(0, 8);
        return { id: sid, label };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
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
      if (sessionFilter.size > 0 && task.sessionId && !sessionFilter.has(task.sessionId)) return false;
      return true;
    });
  }, [tree, expandedRows, statusFilter, agentFilter, search, sort, sessionFilter]);

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
    } catch (err) {
      console.error("Bulk delete failed:", err);
    } finally {
      setBusy((prev) => {
        const n = { ...prev };
        for (const id of selectedRows) delete n[id];
        return n;
      });
    }
  };

  const handleClearCompleted = async () => {
    const done = collectAllTasks(tree).filter(
      (t) => t.status === "completed" || t.status === "cancelled",
    );
    await Promise.all(done.map((t) => deleteTask(t.id)));
    onRefresh();
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

  // ── Sort & column visibility ───────────────────────────────────────────────

  const handleSort = (col: SortCol, dir: "asc" | "desc") => setSort({ col, dir });

  const hideCol = (col: HideableCol) => {
    setHiddenCols((prev) => new Set([...prev, col]));
    if (sort.col === col) setSort({ col: null, dir: "asc" });
  };

  const showCol = (col: HideableCol) =>
    setHiddenCols((prev) => { const next = new Set(prev); next.delete(col); return next; });

  const totalCols = 8 - hiddenCols.size;

  const hasFilters = statusFilter.size > 0 || agentFilter.size > 0 || search !== "" || sessionFilter.size > 0;
  const hasCompletedTasks = collectAllTasks(tree).some(
    (t) => t.status === "completed" || t.status === "cancelled",
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <IconSearch
            size={13}
            aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none"
          />
          <Input
            placeholder="Filter tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8"
            aria-label="Filter tasks"
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
        {sessionOptions.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8">
                <IconClockPlay size={13} />
                Session
                {sessionFilter.size > 0 && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded bg-stone-600 px-1 text-[10px] font-semibold tabular-nums text-stone-100">
                    {sessionFilter.size}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 space-y-0.5">
              {sessionFilter.size > 0 && (
                <button
                  onClick={() => setSessionFilter(new Set())}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-stone-400 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
                >
                  <IconX size={11} />
                  Clear filter
                </button>
              )}
              {sessionOptions.map((s) => (
                <button
                  key={s.id}
                  onClick={() =>
                    setSessionFilter((prev) => {
                      const next = new Set(prev);
                      next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                      return next;
                    })
                  }
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
                >
                  <Checkbox checked={sessionFilter.has(s.id)} className="pointer-events-none" />
                  <span className="truncate text-stone-300" title={s.label}>{s.label}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter(new Set());
              setAgentFilter(new Set());
              setSearch("");
              setSessionFilter(new Set());
            }}
          >
            Reset
            <IconX size={12} />
          </Button>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {hasCompletedTasks && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearCompleted}
              className="gap-1.5 bg-rose-500 text-white hover:bg-rose-400"
            >
              <IconTrash size={13} />
              Clear done
            </Button>
          )}
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
          {/* View — column visibility toggle */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <IconAdjustmentsHorizontal size={13} />
                View
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-1">
              <p className="px-2 py-1.5 text-xs font-medium text-stone-500">Toggle columns</p>
              {HIDEABLE_COLS.map(({ col, label }) => {
                const visible = !hiddenCols.has(col);
                return (
                  <button
                    key={col}
                    onClick={() => visible ? hideCol(col) : showCol(col)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-stone-300 hover:bg-stone-800 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500"
                  >
                    <span className="w-3.5 shrink-0">
                      {visible && <IconCheck size={13} className="text-stone-400" />}
                    </span>
                    {label}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={onThemeToggle}
            aria-label={lightMode ? "Switch to dark mode" : "Switch to light mode"}
          >
            {lightMode ? <IconMoon size={14} /> : <IconSun size={14} />}
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
      <div className="rounded-md border border-stone-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-stone-900/60 bg-stone-900/60">
              <TableHead className="w-10">
                <Checkbox checked={headerChecked} onChange={toggleAll} />
              </TableHead>
              {!hiddenCols.has("task") && <TableHead>
                <SortHeader col="task" label="Task" sort={sort} onSort={handleSort} onHide={hideCol} />
              </TableHead>}
              {!hiddenCols.has("agent") && <TableHead className="w-32">
                <SortHeader col="agent" label="Agent" sort={sort} onSort={handleSort} onHide={hideCol} />
              </TableHead>}
              {!hiddenCols.has("status") && <TableHead className="w-28">
                <SortHeader col="status" label="Status" sort={sort} onSort={handleSort} onHide={hideCol} />
              </TableHead>}
              {!hiddenCols.has("subtasks") && <TableHead className="w-20">
                <SortHeader col="subtasks" label="Subtasks" sort={sort} onSort={handleSort} onHide={hideCol} />
              </TableHead>}
              {!hiddenCols.has("progress") && <TableHead className="w-36">
                <SortHeader col="progress" label="Progress" sort={sort} onSort={handleSort} onHide={hideCol} />
              </TableHead>}
              {!hiddenCols.has("duration") && <TableHead className="w-20">
                <SortHeader col="duration" label="Duration" sort={sort} onSort={handleSort} onHide={hideCol} />
              </TableHead>}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {flatTasks.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={totalCols} className="h-32 text-center text-stone-500">
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
                    isNew={newIds.has(task.id)}
                    depth={depth}
                    hasChildren={hasChildren}
                    expanded={expandedRows.has(task.id)}
                    logsOpen={expandedLogs.has(task.id)}
                    selected={selectedRows.has(task.id)}
                    isBusy={task.id in busy}
                    hiddenCols={hiddenCols}
                    taskMap={taskMap}
                    onToggleExpand={() => toggleExpand(task.id)}
                    onToggleLogs={() => toggleLogs(task.id)}
                    onToggleSelect={() => toggleRow(task.id)}
                    onFilterByAgent={toggleAgentFilter}
                    onAction={(action) => handleAction(task.id, action)}
                  />
                  {expandedLogs.has(task.id) && (
                    <>
                      {(task.events?.length ?? 0) > 0
                        ? <EventTrailRow task={task} colSpan={totalCols} />
                        : task.children.length > 0
                          ? <CheckpointRow task={task} colSpan={totalCols} />
                          : task.logs.length > 0
                            ? <LogDetailRow logs={task.logs} colSpan={totalCols} />
                            : null}
                      {task.lastAssistantMessage && <AgentSummaryRow message={task.lastAssistantMessage} colSpan={totalCols} />}
                    </>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-1 text-xs text-stone-500">
        <span>
          {selectedRows.size > 0
            ? `${selectedRows.size} of ${flatTasks.length} selected`
            : `${flatTasks.length} task${flatTasks.length !== 1 ? "s" : ""}`}
        </span>
        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Connecting…"}</span>
      </div>

      {/* Global session event strip */}
      <GlobalEventStrip events={sessionEvents} />
    </div>
  );
}
