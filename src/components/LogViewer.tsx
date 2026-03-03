import * as Accordion from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import { cn, formatTimestamp } from '@/lib/utils'
import type { LogEntry } from '@/types/task'

const levelStyle: Record<LogEntry['level'], string> = {
  info:  'text-white/70',
  debug: 'text-white/40',
  warn:  'text-yellow-400',
  error: 'text-red-400',
}

const levelLabel: Record<LogEntry['level'], string> = {
  info:  'INFO ',
  debug: 'DEBUG',
  warn:  'WARN ',
  error: 'ERROR',
}

interface LogViewerProps {
  logs: LogEntry[]
  taskId: string
}

export function LogViewer({ logs, taskId }: LogViewerProps) {
  if (logs.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-white/30 italic">No logs yet.</p>
    )
  }

  return (
    <Accordion.Root type="single" collapsible>
      <Accordion.Item value={`logs-${taskId}`}>
        <Accordion.Trigger
          className={cn(
            'group flex w-full items-center gap-2 px-3 py-2 text-xs text-white/50',
            'hover:text-white/80 transition-colors',
          )}
        >
          <ChevronDown
            size={12}
            className="transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
          <span>
            {logs.length} log {logs.length === 1 ? 'entry' : 'entries'}
          </span>
        </Accordion.Trigger>

        <Accordion.Content className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
          <div className="mx-3 mb-3 overflow-auto rounded-md bg-black/40 font-mono text-xs leading-relaxed max-h-64">
            {/* Header bar like GitHub Actions */}
            <div className="sticky top-0 flex items-center gap-2 border-b border-white/5 bg-black/60 px-3 py-1.5">
              <span className="text-white/30 uppercase tracking-widest text-[10px]">Logs</span>
              <span className="ml-auto text-white/20 text-[10px]">{logs.length} lines</span>
            </div>

            <table className="w-full border-collapse">
              <tbody>
                {logs.map((entry, i) => (
                  <tr
                    key={i}
                    className={cn(
                      'group hover:bg-white/5 transition-colors',
                      entry.level === 'error' && 'bg-red-500/5',
                      entry.level === 'warn' && 'bg-yellow-500/5',
                    )}
                  >
                    {/* Line number */}
                    <td className="select-none px-2 py-0.5 text-right text-[10px] text-white/20 w-8">
                      {i + 1}
                    </td>
                    {/* Timestamp */}
                    <td className="px-2 py-0.5 text-white/30 whitespace-nowrap w-24">
                      {formatTimestamp(entry.timestamp)}
                    </td>
                    {/* Level */}
                    <td className={cn('px-2 py-0.5 font-bold w-12', levelStyle[entry.level])}>
                      {levelLabel[entry.level]}
                    </td>
                    {/* Message */}
                    <td className={cn('px-2 py-0.5 pr-4 break-all', levelStyle[entry.level])}>
                      {entry.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  )
}
