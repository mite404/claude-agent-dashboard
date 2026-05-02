import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { TaskTable } from "@/components/TaskTable";
import { KanbanBoard } from "@/components/KanbanBoard";
import { IconLayoutList, IconLayoutColumns } from "@tabler/icons-react";
import type { TaskStatus } from "@/types/task";

export default function Dashboard() {
  const { tasks, tree, sessionEvents, loading, lastUpdated, error, refresh } = useTaskPolling(2500);
  const [lightMode, setLightMode]   = useState(false);
  const [viewMode, setViewMode]     = useState<"table" | "board">("board");

  // Cleanup: remove light class if component unmounts while in light mode
  useEffect(() => () => document.documentElement.classList.remove("light"), []);

  const handleThemeToggle = () => {
    const next = !lightMode;
    const root = document.documentElement;
    // Suppress all transition-colors for one paint cycle to prevent the
    // white flash caused by stone palette values animating through midpoints
    root.classList.add("no-transition");
    root.classList.toggle("light", next);
    setLightMode(next);
    // Double RAF: first fires before the new-theme paint, second fires after —
    // transitions only re-enable once the new palette is already on screen
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("no-transition")));
  };

  const handleStatusChange = useCallback(
    (_taskId: string, _newStatus: TaskStatus) => {
      // Optimistically refresh after a short delay for json-server to settle
      setTimeout(refresh, 300);
    },
    [refresh],
  );

  // Use the most recent task's sessionId for new pool tasks; server auto-upserts sessions
  const defaultSessionId =
    tasks.find((t) => t.sessionId)?.sessionId ?? "kanban-pool";

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
                ? "animate-pulse hue-rotate-280 saturate-[3]"
                : running > 0
                  ? "animate-pulse saturate-[2] brightness-[1.2]"
                  : paused > 0
                    ? "animate-pulse hue-rotate-[-37deg] saturate-[3] brightness-[1.3]"
                    : "grayscale opacity-40",
            )}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-stone-500">
            {tasks.length > 0 || sessionEvents.length > 0
              ? `${running} running · ${completed} done · ${failed} failed`
              : "No active session"}
          </p>
          {/* Table / Board toggle */}
          <div className="flex items-center rounded-md border border-stone-800 p-0.5">
            <button
              aria-label="Table view"
              onClick={() => setViewMode("table")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                viewMode === "table"
                  ? "bg-stone-700 text-stone-200"
                  : "text-stone-500 hover:text-stone-300",
              )}
            >
              <IconLayoutList size={13} />
              Table
            </button>
            <button
              aria-label="Board view"
              onClick={() => setViewMode("board")}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                viewMode === "board"
                  ? "bg-stone-700 text-stone-200"
                  : "text-stone-500 hover:text-stone-300",
              )}
            >
              <IconLayoutColumns size={13} />
              Board
            </button>
          </div>
        </div>
      </header>

      {/* Screen reader live region — announces polling updates */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {tasks.length > 0 || sessionEvents.length > 0
          ? `${running} running, ${completed} done, ${failed} failed`
          : "No active tasks"}
      </div>

      {/* Connection error */}
      {error && (
        <div className="mb-4 rounded-(--radius) border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          <strong>Connection error:</strong> {error}
          <br />
          <span className="text-xs text-red-500/70">
            Make sure the Hono server is running: <code className="font-mono">bun run dev</code>
          </span>
        </div>
      )}

      {/* Main content — table or board */}
      {viewMode === "board" ? (
        <KanbanBoard
          tasks={tasks}
          sessionId={defaultSessionId}
          onRefresh={refresh}
        />
      ) : (
        <TaskTable
          tree={tree}
          sessionEvents={sessionEvents}
          loading={loading}
          lastUpdated={lastUpdated}
          onRefresh={refresh}
          onStatusChange={handleStatusChange}
          lightMode={lightMode}
          onThemeToggle={handleThemeToggle}
        />
      )}
    </div>
  );
}
