import React from "react";
import {
  IconClockHour4,
  IconCircleCheck,
  IconCircleX,
  IconPlayerPause,
  IconCircle,
  IconCircleOff,
  IconBan,
  IconMicroscope,
  IconRuler,
} from "@tabler/icons-react";
import type { TaskStatus, LogEntry, HookEvent, SessionEventType, TaskKind } from "@/types/task";

// ─── Task Status ──────────────────────────────────────────────────────────────

export const ALL_STATUSES: TaskStatus[] = [
  "running",
  "paused",
  "blocked",
  "pending",
  "failed",
  "completed",
  "cancelled",
];

// Sort order: most urgent first
export const STATUS_ORDER: Record<TaskStatus, number> = {
  running: 0,
  paused: 1,
  blocked: 2,
  failed: 3,
  pending: 4,
  completed: 5,
  cancelled: 6,
};

export const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  running: <IconClockHour4 size={14} aria-hidden="true" className="text-lime-400" />,
  completed: <IconCircleCheck size={14} aria-hidden="true" className="text-stone-500" />,
  failed: <IconCircleX size={14} aria-hidden="true" className="text-red-500" />,
  paused: <IconPlayerPause size={14} aria-hidden="true" className="text-amber-400" />,
  pending: <IconCircle size={14} aria-hidden="true" className="text-stone-500" />,
  cancelled: <IconCircleOff size={14} aria-hidden="true" className="text-stone-500" />,
  blocked: <IconBan size={14} aria-hidden="true" className="text-orange-400" />,
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
  paused: "Paused",
  pending: "Pending",
  cancelled: "Cancelled",
  blocked: "Blocked",
};

export const STATUS_TEXT: Record<TaskStatus, string> = {
  running: "text-lime-400",   // lime — actively doing work
  failed: "text-red-500",     // red — needs attention
  paused: "text-amber-400",   // amber — suspended
  blocked: "text-orange-400", // orange — waiting on a dependency
  pending: "text-stone-500",
  completed: "text-stone-500",
  cancelled: "text-stone-500",
};

export const PROGRESS_BAR: Record<TaskStatus, string> = {
  running: "bg-stone-300",
  completed: "bg-stone-400",
  failed: "bg-stone-500",
  paused: "bg-stone-500",
  blocked: "bg-orange-900/50",
  pending: "bg-stone-700",
  cancelled: "bg-stone-800",
};

// ─── Logs ──────────────────────────────────────────────────────────────────────

export const LOG_LEVEL_STYLE: Record<LogEntry["level"], string> = {
  info: "text-stone-300",
  debug: "text-stone-500",
  warn: "text-amber-400",
  error: "text-red-400",
};

export const LOG_LEVEL_LABEL: Record<LogEntry["level"], string> = {
  info: "INFO ",
  debug: "DEBUG",
  warn: "WARN ",
  error: "ERROR",
};

// ─── Checkpoints (Subtasks) ───────────────────────────────────────────────────

export const CHECKPOINT_ICON: Record<TaskStatus, string> = {
  completed: "✓",
  running:   "●",
  pending:   "○",
  paused:    "◐",
  failed:    "✗",
  cancelled: "–",
  blocked:   "⊘",
};

export const CHECKPOINT_COLOR: Record<TaskStatus, string> = {
  completed: "text-green-400",
  running:   "text-blue-400",
  failed:    "text-red-400",
  paused:    "text-amber-400",
  blocked:   "text-orange-400",
  pending:   "text-stone-600",
  cancelled: "text-stone-700",
};

// ─── Tool Events ──────────────────────────────────────────────────────────────

export const TOOL_EMOJI: Record<string, string> = {
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

export const EVENT_STATUS_COLOR: Record<HookEvent["status"], string> = {
  running:   "text-blue-400",
  completed: "text-stone-500",
  failed:    "text-red-400",
};

// ─── Session Events ───────────────────────────────────────────────────────────

export const SESSION_EVENT_EMOJI: Record<SessionEventType, string> = {
  UserPromptSubmit:   "💬",
  SessionStart:       "🚀",
  Stop:               "🛑",
  SubagentStart:      "🟢",
  SubagentStop:       "👥",
  Notification:       "🔔",
  PermissionRequest:  "🔐",
  PreCompact:         "📦",
  PostToolUseFailure: "❌",
  SessionEnd:         "🏁",
  TeammateIdle:       "😴",
  TaskCompleted:      "✅",
  InstructionsLoaded: "📋",
  ConfigChange:       "⚙️",
  WorktreeCreate:     "🌿",
  WorktreeRemove:     "🍂",
};

// ─── Task Kinds ───────────────────────────────────────────────────────────────

export const TASK_KIND_ICON: Partial<Record<TaskKind, React.ReactNode>> = {
  evaluation: <IconMicroscope size={11} className="text-sky-400" />,
  planning:   <IconRuler size={11} className="text-violet-400" />,
};

// ─── Table Configuration ──────────────────────────────────────────────────────

export type HideableCol = "task" | "status" | "agent" | "id" | "subtasks" | "progress" | "duration";

export const HIDEABLE_COLS: { col: HideableCol; label: string }[] = [
  { col: "task", label: "Task" },
  { col: "agent", label: "Agent" },
  { col: "id", label: "Task ID" },
  { col: "status", label: "Status" },
  { col: "subtasks", label: "Subtasks" },
  { col: "progress", label: "Progress" },
  { col: "duration", label: "Duration" },
];
