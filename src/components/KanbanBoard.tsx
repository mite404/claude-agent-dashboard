import { useState, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { toast } from "sonner";
import { IconGripVertical, IconPlus, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { patchTask, createTask, claimTask } from "@/lib/taskApi";
import type { Task, TaskStatus, TaskPriority } from "@/types/task";

// ─── Transition rules ─────────────────────────────────────────────────────────
// Defines which columns a card can be dragged into from its current status.
// Terminal statuses (completed, cancelled) have no valid moves — they're done.
// Blocked is computed client-side and can be manually overridden to running.
const VALID_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  unassigned: ["claimed", "cancelled"],
  claimed:    ["running", "unassigned", "cancelled"],
  running:    ["completed", "cancelled"],
  blocked:    ["running", "cancelled"],
  // pending: legacy hook-created tasks, not managed via the board
};

// ─── Column config ────────────────────────────────────────────────────────────
interface ColumnConfig {
  id: string;
  label: string;
  statuses: TaskStatus[];
  dropStatus: TaskStatus;        // status applied when a card lands here
  readonly?: boolean;            // cannot be dragged into (computed status)
  terminal?: boolean;            // cannot be dragged out
  showNewCard?: boolean;         // renders the + card at the bottom
}

// Paused column intentionally omitted — see docs/kanban-column-tutorial.md
const COLUMNS: ColumnConfig[] = [
  {
    id:          "unassigned",
    label:       "Unassigned",
    statuses:    ["unassigned"],
    dropStatus:  "unassigned",
    showNewCard: true,
  },
  {
    id:         "claimed",
    label:      "Claimed",
    statuses:   ["claimed"],
    dropStatus: "claimed",
  },
  {
    id:         "running",
    label:      "Running",
    statuses:   ["running"],
    dropStatus: "running",
  },
  {
    id:       "blocked",
    label:    "Blocked",
    statuses: ["blocked"],
    dropStatus: "blocked",
    readonly: true,
  },
  // ── Add the Paused column here (tutorial step 3) ──────────────────────────
  {
    id:       "done",
    label:    "Done",
    statuses: ["completed", "cancelled"],
    dropStatus: "completed",
    terminal: true,
  },
];

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  urgent: "text-red-400",
  high:   "text-amber-400",
  normal: "text-stone-400",
  low:    "text-stone-600",
};

// ─── KanbanCard ───────────────────────────────────────────────────────────────
interface KanbanCardProps {
  task: Task;
  overlay?: boolean;   // true when rendered inside DragOverlay
  onClaim: (taskId: string) => Promise<void>;
}

function KanbanCard({ task, overlay = false, onClaim }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id:   task.id,
    data: { status: task.status },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-start gap-2 rounded-md border border-stone-800 bg-stone-900 p-3",
        "transition-colors",
        isDragging && !overlay && "opacity-40",
        overlay && "rotate-1 shadow-xl shadow-black/50 ring-1 ring-stone-600",
      )}
    >
      {/* Drag handle — listeners attached here only, not to the whole card */}
      <button
        {...listeners}
        {...attributes}
        aria-label="Drag to reorder"
        className={cn(
          "mt-0.5 shrink-0 cursor-grab touch-none text-stone-700 active:cursor-grabbing",
          "opacity-0 transition-opacity group-hover:opacity-100",
          overlay && "opacity-100",
        )}
      >
        <IconGripVertical size={14} />
      </button>

      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Priority + status row */}
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={task.status} />
          {task.priority && task.priority !== "normal" && (
            <span className={cn("text-xs font-medium", PRIORITY_COLOR[task.priority])}>
              {task.priority}
            </span>
          )}
        </div>

        {/* Task name */}
        <p className="truncate text-sm font-medium text-stone-200">{task.name}</p>

        {/* Description preview */}
        {task.description && (
          <p className="line-clamp-2 text-xs text-stone-500">{task.description}</p>
        )}

        {/* Footer meta */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {task.createdBy && (
            <span className="truncate text-xs text-stone-600">by {task.createdBy}</span>
          )}
          {task.claimedBy && (
            <span className="truncate text-xs text-violet-500">→ {task.claimedBy}</span>
          )}
        </div>

        {/* Claim button — only on unassigned cards */}
        {task.status === "unassigned" && !overlay && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1 h-6 w-full text-xs"
            onClick={() => onClaim(task.id)}
          >
            Claim
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── NewTaskCard ──────────────────────────────────────────────────────────────
interface NewTaskCardProps {
  sessionId: string;
  onCreated: () => void;
}

function NewTaskCard({ sessionId, onCreated }: NewTaskCardProps) {
  const [open, setOpen]   = useState(false);
  const [name, setName]   = useState("");
  const [busy, setBusy]   = useState(false);
  const inputRef          = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await createTask({ name: trimmed, sessionId, status: "unassigned" });
      setName("");
      setOpen(false);
      onCreated();
    } catch {
      toast.error("Failed to create task");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md border border-dashed border-stone-800",
          "px-3 py-2.5 text-xs text-stone-600 transition-colors hover:border-stone-600",
          "hover:text-stone-400",
        )}
      >
        <IconPlus size={12} />
        New task
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-stone-700 bg-stone-900 p-3">
      <Input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") { setOpen(false); setName(""); }
        }}
        placeholder="Task name…"
        className="h-7 text-xs"
      />
      <div className="flex gap-2">
        <Button size="sm" className="h-6 flex-1 text-xs" disabled={busy || !name.trim()} onClick={handleSubmit}>
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2"
          onClick={() => { setOpen(false); setName(""); }}
        >
          <IconX size={12} />
        </Button>
      </div>
    </div>
  );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────
interface KanbanColumnProps {
  config: ColumnConfig;
  tasks: Task[];
  sessionId: string;
  onClaim: (taskId: string) => Promise<void>;
  onCreated: () => void;
  isDragTarget: boolean;
}

function KanbanColumn({ config, tasks, sessionId, onClaim, onCreated, isDragTarget }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: config.id });

  return (
    <div className="flex w-64 shrink-0 flex-col gap-2">
      {/* Column header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold tracking-wide text-stone-400 uppercase">
          {config.label}
        </span>
        <span className="rounded-full bg-stone-800 px-1.5 py-0.5 text-xs text-stone-500">
          {tasks.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-col gap-2 rounded-lg p-2 transition-colors",
          "border border-transparent",
          isOver && isDragTarget && "border-stone-600 bg-stone-900/60",
          config.readonly && "opacity-75",
        )}
      >
        {tasks.map((task) => (
          <KanbanCard key={task.id} task={task} onClaim={onClaim} />
        ))}

        {tasks.length === 0 && !config.showNewCard && (
          <p className="py-4 text-center text-xs text-stone-700">Empty</p>
        )}

        {config.showNewCard && (
          <NewTaskCard sessionId={sessionId} onCreated={onCreated} />
        )}
      </div>
    </div>
  );
}

// ─── KanbanBoard ──────────────────────────────────────────────────────────────
interface KanbanBoardProps {
  tasks: Task[];
  sessionId: string;
  onRefresh: () => void;
}

export function KanbanBoard({ tasks, sessionId, onRefresh }: KanbanBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [dragTargetColumn, setDragTargetColumn] = useState<string | null>(null);

  // Group the flat task list into columns
  const tasksByColumn = (colId: string): Task[] => {
    const col = COLUMNS.find((c) => c.id === colId);
    if (!col) return [];
    return tasks.filter((t) => col.statuses.includes(t.status));
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveTask(tasks.find((t) => t.id === active.id) ?? null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveTask(null);
    setDragTargetColumn(null);
    if (!over) return;

    const task       = tasks.find((t) => t.id === active.id);
    const targetCol  = COLUMNS.find((c) => c.id === over.id);
    if (!task || !targetCol) return;
    if (task.status === targetCol.dropStatus) return;   // no-op: same column

    // Check readonly (blocked is computed — can't drag into it)
    if (targetCol.readonly) {
      toast.error(`Cannot move tasks into "${targetCol.label}" — it's computed automatically`);
      return;
    }

    // Check terminal (done tasks stay done)
    if (VALID_TRANSITIONS[task.status] === undefined) {
      toast.error(`"${task.status}" tasks cannot be moved`);
      return;
    }

    const allowed = VALID_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(targetCol.dropStatus)) {
      toast.error(`Cannot move from ${task.status} → ${targetCol.dropStatus}`);
      return;
    }

    try {
      await patchTask(task.id, { status: targetCol.dropStatus });
      onRefresh();
    } catch {
      toast.error("Failed to update task status");
    }
  };

  const handleClaim = async (taskId: string) => {
    const claimedBy = `manual-${Date.now()}`;
    const result = await claimTask(taskId, claimedBy);
    if (!result.ok) {
      toast.error(`Already claimed by ${result.claimedBy}`);
      return;
    }
    toast.success("Task claimed");
    onRefresh();
  };

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={({ over }) => setDragTargetColumn(over?.id as string ?? null)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveTask(null); setDragTargetColumn(null); }}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            config={col}
            tasks={tasksByColumn(col.id)}
            sessionId={sessionId}
            onClaim={handleClaim}
            onCreated={onRefresh}
            isDragTarget={dragTargetColumn === col.id}
          />
        ))}
      </div>

      {/* Ghost card rendered at cursor position while dragging */}
      <DragOverlay>
        {activeTask && (
          <KanbanCard task={activeTask} overlay onClaim={handleClaim} />
        )}
      </DragOverlay>
    </DndContext>
  );
}
