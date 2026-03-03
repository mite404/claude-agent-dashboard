import { useCallback } from 'react'
import { RefreshCw, Activity } from 'lucide-react'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { TaskTree } from '@/components/TaskTree'
import { Button } from '@/components/ui/button'
import type { TaskStatus } from '@/types/task'

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-white/8 bg-white/4 px-3 py-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-white/50">{label}</span>
      <span className="text-sm font-semibold text-white tabular-nums">{value}</span>
    </div>
  )
}

export default function Dashboard() {
  const { tasks, tree, loading, lastUpdated, error, refresh } = useTaskPolling(2500)

  const handleStatusChange = useCallback(
    (_taskId: string, _newStatus: TaskStatus) => {
      // Optimistically refresh after a short delay for json-server to settle
      setTimeout(refresh, 300)
    },
    [refresh],
  )

  const counts = {
    total: tasks.length,
    running: tasks.filter((t) => t.status === 'running').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    paused: tasks.filter((t) => t.status === 'paused').length,
  }

  return (
    <div className="min-h-screen bg-[hsl(222,84%,5%)] px-4 py-6 md:px-8">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity size={16} className="text-blue-400" />
            <h1 className="text-base font-semibold tracking-tight text-white">
              Claude Agent Dashboard
            </h1>
            {/* Pulse when polling */}
            {!loading && !error && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            )}
          </div>
          <p className="text-xs text-white/30">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()}`
              : 'Connecting…'}
          </p>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading}
          title="Refresh now"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </header>

      {/* Stats strip */}
      <div className="mb-6 flex flex-wrap gap-2">
        <StatPill label="Total" value={counts.total} color="bg-white/20" />
        <StatPill label="Running" value={counts.running} color="bg-blue-400 animate-pulse" />
        <StatPill label="Completed" value={counts.completed} color="bg-green-400" />
        <StatPill label="Paused" value={counts.paused} color="bg-yellow-400" />
        <StatPill label="Failed" value={counts.failed} color="bg-red-400" />
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <strong>Connection error:</strong> {error}
          <br />
          <span className="text-xs text-red-400/70">
            Make sure json-server is running: <code>bun run server</code>
          </span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/8 bg-white/3 py-20 text-center">
          <Activity size={32} className="mb-3 text-white/20" />
          <p className="text-sm text-white/40">No tasks running</p>
          <p className="mt-1 text-xs text-white/25">
            Start a Claude Code agent to see tasks here
          </p>
        </div>
      )}

      {/* Task tree */}
      {tasks.length > 0 && (
        <TaskTree nodes={tree} onStatusChange={handleStatusChange} />
      )}
    </div>
  )
}
