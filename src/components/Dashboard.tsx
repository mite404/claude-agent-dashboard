import { useCallback } from 'react'
import { IconActivity } from '@tabler/icons-react'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { TaskTable } from '@/components/TaskTable'
import type { TaskStatus } from '@/types/task'

export default function Dashboard() {
  const { tasks, tree, loading, lastUpdated, error, refresh } = useTaskPolling(2500)

  const handleStatusChange = useCallback(
    (_taskId: string, _newStatus: TaskStatus) => {
      // Optimistically refresh after a short delay for json-server to settle
      setTimeout(refresh, 300)
    },
    [refresh],
  )

  const running   = tasks.filter(t => t.status === 'running').length
  const completed = tasks.filter(t => t.status === 'completed').length
  const failed    = tasks.filter(t => t.status === 'failed').length

  return (
    <div className="min-h-screen bg-stone-950 px-4 py-6 md:px-8">

      {/* Page header */}
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-0.5">
          <IconActivity size={15} className="text-stone-500" />
          <h1 className="text-sm font-semibold tracking-tight text-stone-300">
            Claude Agent Dashboard
          </h1>
          {!loading && !error && running > 0 && (
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
        </div>
        <p className="text-xs text-stone-600 ml-5">
          {tasks.length > 0
            ? `${running} running · ${completed} done · ${failed} failed`
            : 'No active session'}
        </p>
      </header>

      {/* Connection error */}
      {error && (
        <div className="mb-4 rounded-(--radius) border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          <strong>Connection error:</strong> {error}
          <br />
          <span className="text-xs text-red-500/70">
            Make sure json-server is running: <code className="font-mono">bun run server</code>
          </span>
        </div>
      )}

      {/* Main table — handles its own empty state */}
      <TaskTable
        tree={tree}
        loading={loading}
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        onStatusChange={handleStatusChange}
      />
    </div>
  )
}
