import { Terminal } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { LogViewer } from '@/components/LogViewer'
import { ControlButtons } from '@/components/ControlButtons'
import { formatElapsed } from '@/lib/utils'
import type { Task, TaskStatus } from '@/types/task'

interface TaskCardProps {
  task: Task
  depth?: number
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}

export function TaskCard({ task, depth = 0, onStatusChange }: TaskCardProps) {
  const isActive = task.status === 'running' || task.status === 'paused'
  const elapsed = formatElapsed(task.startedAt, task.completedAt)

  return (
    <div
      className="rounded-lg border border-white/8 bg-white/4 overflow-hidden"
      style={{ marginLeft: depth > 0 ? `${depth * 1.5}rem` : undefined }}
    >
      {/* Left accent bar by status */}
      <div className="flex">
        <div
          className="w-0.5 shrink-0"
          style={{
            backgroundColor:
              task.status === 'running'
                ? 'rgb(96 165 250)'     // blue-400
                : task.status === 'completed'
                  ? 'rgb(74 222 128)'   // green-400
                  : task.status === 'failed'
                    ? 'rgb(248 113 113)' // red-400
                    : task.status === 'paused'
                      ? 'rgb(250 204 21)' // yellow-400
                      : 'rgb(255 255 255 / 0.15)',
          }}
        />

        <div className="flex-1 min-w-0 p-3 space-y-2.5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-mono text-white/30 mb-0.5">{task.id}</p>
              <h3 className="text-sm font-medium text-white leading-tight truncate">{task.name}</h3>
            </div>
            <StatusBadge status={task.status} className="shrink-0 mt-0.5" />
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <Progress value={task.progressPercentage} status={task.status} />
            <div className="flex justify-between text-[10px] text-white/30">
              <span>{task.progressPercentage}% complete</span>
              {isActive && <span className="text-white/20">updating…</span>}
            </div>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-[11px] text-white/40">
            <span className="flex items-center gap-1">
              <Terminal size={10} />
              {task.agentType}
            </span>
            <span>Elapsed: {elapsed}</span>
            {task.completedAt && (
              <span className="text-white/25">
                Completed {new Date(task.completedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Logs accordion */}
          <LogViewer logs={task.logs} taskId={task.id} />

          {/* Controls */}
          <div className="flex justify-end pt-0.5">
            <ControlButtons
              taskId={task.id}
              status={task.status}
              onStatusChange={onStatusChange}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
