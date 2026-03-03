import { TaskCard } from '@/components/TaskCard'
import type { TaskNode, TaskStatus } from '@/types/task'

interface TaskTreeProps {
  nodes: TaskNode[]
  depth?: number
  onStatusChange?: (taskId: string, newStatus: TaskStatus) => void
}

export function TaskTree({ nodes, depth = 0, onStatusChange }: TaskTreeProps) {
  if (nodes.length === 0) return null

  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <div key={node.id}>
          <TaskCard task={node} depth={depth} onStatusChange={onStatusChange} />

          {/* Connector line + children */}
          {node.children.length > 0 && (
            <div className="relative mt-2 pl-6">
              {/* Vertical connector */}
              <div
                className="absolute left-3 top-0 bottom-2 w-px bg-white/10"
                aria-hidden="true"
              />
              <TaskTree
                nodes={node.children}
                depth={depth + 1}
                onStatusChange={onStatusChange}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
