import { cn } from '@/lib/utils'
import type { TaskStatus } from '@/types/task'

const trackColor: Partial<Record<TaskStatus, string>> = {
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  paused: 'bg-yellow-500',
}

interface ProgressProps {
  value: number // 0–100
  status: TaskStatus
  className?: string
}

export function Progress({ value, status, className }: ProgressProps) {
  const fill = trackColor[status] ?? 'bg-white/30'
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div className={cn('relative h-1 w-full overflow-hidden rounded-full bg-white/10', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', fill)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
