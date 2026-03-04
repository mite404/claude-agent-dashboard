import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { TaskTable } from "@/components/TaskTable";
import type { TaskStatus } from "@/types/task";

export default function Dashboard() {
  const { tasks, tree, loading, lastUpdated, error, refresh } = useTaskPolling(2500);

  const handleStatusChange = useCallback(
    (_taskId: string, _newStatus: TaskStatus) => {
      // Optimistically refresh after a short delay for json-server to settle
      setTimeout(refresh, 300);
    },
    [refresh],
  );

  const running = tasks.filter((t) => t.status === "running").length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const paused = tasks.filter((t) => t.status === "paused").length;

  return (
    <div className="min-h-screen bg-stone-950 px-4 py-6 md:px-8">
      {/* Page header */}
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-0.5">
          <h1 className="text-sm font-semibold tracking-tight text-stone-300">
            Claude Agent Dashboard
          </h1>
          <img
            src="/crab_gameboy.png"
            alt="crab icon"
            aria-hidden="true"
            className={cn(
              "h-15 w-15 object-contain",
              error || failed > 0
                ? "animate-pulse hue-rotate-[280deg] saturate-[3]"
                : running > 0
                  ? "animate-pulse saturate-[2] brightness-[1.2]"
                  : paused > 0
                    ? "animate-pulse hue-rotate-[-37deg] saturate-[3] brightness-[1.3]"
                    : "grayscale opacity-40",
            )}
          />
        </div>
        <p className="text-xs text-stone-500">
          {tasks.length > 0
            ? `${running} running · ${completed} done · ${failed} failed`
            : "No active session"}
        </p>
      </header>

      {/* Screen reader live region — announces polling updates */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {tasks.length > 0
          ? `${running} running, ${completed} done, ${failed} failed`
          : "No active tasks"}
      </div>

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
  );
}
