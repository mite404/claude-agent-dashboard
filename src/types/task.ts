export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
  timestamp: string // ISO string
  level: LogLevel
  message: string
}

export interface Task {
  id: string
  name: string
  status: TaskStatus
  agentType: string
  parentId?: string | null
  createdAt: string // ISO string
  startedAt?: string | null
  completedAt?: string | null
  progressPercentage: number // 0–100
  logs: LogEntry[]
}

export interface TaskNode extends Task {
  children: TaskNode[]
}
