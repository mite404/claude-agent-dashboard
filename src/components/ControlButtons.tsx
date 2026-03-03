import { useState } from 'react'
import { XCircle, PauseCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TaskStatus } from '@/types/task'

interface ControlButtonsProps {
  taskId: string
  status: TaskStatus
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}

async function patchTask(taskId: string, patch: object) {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`PATCH failed: HTTP ${res.status}`)
}

export function ControlButtons({ taskId, status, onStatusChange }: ControlButtonsProps) {
  const [busy, setBusy] = useState<string | null>(null)

  const handle = async (action: 'cancel' | 'pause' | 'retry') => {
    setBusy(action)
    try {
      const patch =
        action === 'cancel'
          ? { status: 'cancelled' as TaskStatus }
          : action === 'pause'
            ? { status: 'paused' as TaskStatus }
            : { status: 'running' as TaskStatus, progressPercentage: 0 }

      await patchTask(taskId, patch)
      onStatusChange?.(taskId, patch.status)
    } catch (err) {
      console.error(`Failed to ${action} task ${taskId}:`, err)
    } finally {
      setBusy(null)
    }
  }

  const isTerminal = status === 'completed' || status === 'cancelled'
  const isRunning = status === 'running'
  const isPaused = status === 'paused'

  return (
    <div className="flex items-center gap-1">
      {/* Cancel */}
      <Button
        variant="destructive"
        size="sm"
        onClick={() => handle('cancel')}
        disabled={isTerminal || busy !== null}
        title="Cancel task"
      >
        <XCircle size={11} />
        Cancel
      </Button>

      {/* Pause / Resume */}
      <Button
        variant="warning"
        size="sm"
        onClick={() => handle(isPaused ? 'retry' : 'pause')}
        disabled={isTerminal || (!isRunning && !isPaused) || busy !== null}
        title={isPaused ? 'Resume task' : 'Pause task'}
      >
        <PauseCircle size={11} />
        {isPaused ? 'Resume' : 'Pause'}
      </Button>

      {/* Retry */}
      <Button
        variant="default"
        size="sm"
        onClick={() => handle('retry')}
        disabled={(status !== 'failed' && status !== 'cancelled') || busy !== null}
        title="Retry task"
      >
        <RotateCcw size={11} />
        Retry
      </Button>
    </div>
  )
}
