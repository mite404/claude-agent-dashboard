import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import type { TaskStatus } from '@/types/task'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-(--radius-sm) px-1.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        running:   'bg-blue-950/60  text-blue-300  border border-blue-800/50',
        completed: 'bg-green-950/60 text-green-300 border border-green-800/50',
        failed:    'bg-red-950/60   text-red-300   border border-red-800/50',
        paused:    'bg-amber-950/60 text-amber-300 border border-amber-800/50',
        pending:   'bg-stone-800/60 text-stone-400 border border-stone-700/50',
        cancelled: 'bg-stone-900/60 text-stone-500 border border-stone-800/50',
      },
    },
  },
)

const statusDot: Record<TaskStatus, string> = {
  running:   'bg-blue-400 animate-pulse',
  completed: 'bg-green-400',
  failed:    'bg-red-400',
  paused:    'bg-amber-400',
  pending:   'bg-stone-500',
  cancelled: 'bg-stone-600',
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
