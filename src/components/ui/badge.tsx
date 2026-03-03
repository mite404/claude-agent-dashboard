import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '@/types/task'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        running: 'bg-blue-500/20 text-blue-400',
        completed: 'bg-green-500/20 text-green-400',
        failed: 'bg-red-500/20 text-red-400',
        paused: 'bg-yellow-500/20 text-yellow-400',
        pending: 'bg-white/10 text-white/50',
        cancelled: 'bg-white/10 text-white/30',
      },
    },
  },
)

const statusDot: Record<TaskStatus, string> = {
  running: 'bg-blue-400 animate-pulse',
  completed: 'bg-green-400',
  failed: 'bg-red-400',
  paused: 'bg-yellow-400',
  pending: 'bg-white/30',
  cancelled: 'bg-white/20',
}

interface StatusBadgeProps extends VariantProps<typeof badgeVariants> {
  status: TaskStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant: status }), className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', statusDot[status])} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
