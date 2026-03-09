export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'blocked' // computed client-side when dependencies are incomplete

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  timestamp: string // ISO string
  level: LogLevel
  message: string
}

// A single tool call event inside an agent task's execution trail
export interface HookEvent {
  id: string // tool_use_id
  toolName: string // 'Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', etc.
  phase: 'pre' | 'post'
  status: 'running' | 'completed' | 'failed'
  summary: string // first ~120 chars of tool_input (command, file path, etc.)
  timestamp: string // ISO string
  completedAt?: string // ISO string, set when post-hook fires
  model?: string // from hook payload if available
}

// Session-level lifecycle events that don't belong to a specific task
export type SessionEventType =
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Notification'
  | 'PermissionRequest'
  | 'PreCompact'
  | 'PostToolUseFailure'

export interface SessionEvent {
  id: string // timestamp-hash or uuid
  type: SessionEventType
  timestamp: string // ISO string
  sessionId: string
  summary: string // human-readable one-liner
  model?: string // from SessionStart payload
  tokenCount?: number // from PreCompact payload
  data?: Record<string, unknown> // raw payload fields
}

export interface Task {
  id: string
  name: string
  status: TaskStatus
  agentType: string
  parentId?: string | null
  sessionId?: string // Claude Code session this task belongs to
  createdAt: string // ISO string
  startedAt?: string | null
  completedAt?: string | null
  progressPercentage: number // 0–100
  logs: LogEntry[]
  events?: HookEvent[] // tool events fired during this task's execution
  dependencies?: string[] // IDs of tasks this task must wait for
}

export interface TaskNode extends Task {
  children: TaskNode[]
  blockedBy?: string[] // IDs of incomplete dependencies (computed client-side)
}
