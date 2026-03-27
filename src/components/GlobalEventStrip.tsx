import React, { useState, useEffect, useRef } from "react";
import { IconChevronRight, IconTrash } from "@tabler/icons-react";
import { cn, formatTimestamp } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SESSION_EVENT_EMOJI } from "@/lib/taskConfig";
import type { SessionEvent } from "@/types/task";

export function GlobalEventStrip({
  events,
  onClearAllEvents,
}: {
  events: SessionEvent[];
  onClearAllEvents?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(() => events.length > 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [clearing, setClearing] = useState(false);

  // Auto-scroll to bottom whenever new events arrive or the panel opens
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events.length, open]);

  const handleClearAll = async () => {
    if (!onClearAllEvents) return;
    setClearing(true);
    try {
      await onClearAllEvents();
    } catch (err) {
      console.error("Failed to clear session events:", err);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-md border border-stone-800 overflow-hidden">
      <div className="flex w-full items-center gap-2 px-3 py-2 bg-stone-900/60 hover:bg-stone-900 transition-colors">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-500 rounded px-1"
          aria-expanded={open}
          aria-label={open ? "Collapse session events" : "Expand session events"}
        >
          <IconChevronRight
            size={13}
            aria-hidden="true"
            className={cn("text-stone-500 transition-transform duration-150 shrink-0", open && "rotate-90")}
          />
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-stone-500">
            Session Events
          </span>
          <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded bg-stone-800 px-1 text-[10px] font-semibold tabular-nums text-stone-400">
            {events.length}
          </span>
        </button>
        {events.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            disabled={clearing}
            className="gap-1.5 bg-rose-500 text-white hover:bg-rose-400 shrink-0"
          >
            <IconTrash size={13} />
            Clear all
          </Button>
        )}
      </div>

      {open && (
        <>
          {/* Header row — outside scrollable container, no overlap */}
          {events.length > 0 && (
            <div className="flex items-center gap-2 px-3 h-10 bg-stone-900/60 border-b border-stone-800 text-stone-400 text-xs font-medium">
              <span className="shrink-0 w-5" />
              <span className="w-40 shrink-0 text-left">Event</span>
              <span className="flex-1 truncate text-left">Summary</span>
              <span className="w-36 shrink-0 text-left">Agent ID</span>
              <span className="shrink-0 text-left font-mono">Time</span>
            </div>
          )}
          <div ref={scrollRef} className="max-h-96 overflow-auto divide-y divide-stone-800/40">
            {events.length === 0 ? (
              <div className="px-3 py-3 text-xs text-stone-600 italic">
                No session events yet — submit a user prompt to start.
              </div>
            ) : (
              <>
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-stone-900/40 transition-colors"
                  >
                    {/* Emoji */}
                    <span className="shrink-0 w-5 text-center select-none" aria-hidden="true">
                      {SESSION_EVENT_EMOJI[event.type] ?? "📋"}
                    </span>
                    {/* Event type */}
                    <span className="w-40 shrink-0 text-[11px] text-stone-500">
                      {event.type}
                    </span>
                    {/* Summary */}
                    <span
                      className="flex-1 truncate font-mono text-[10px] text-stone-300"
                      title={event.summary}
                    >
                      {event.summary}
                    </span>
                    {/* Skill pill — shown for UserPromptSubmit events with a skill */}
                    {event.type === 'UserPromptSubmit' && event.originatingSkill && (
                      <span className="shrink-0 rounded bg-violet-950 px-1.5 py-0.5 font-mono text-[10px] text-violet-300 border border-violet-700">
                        {event.originatingSkill}
                      </span>
                    )}
                    {/* Agent ID — fixed column, always present */}
                    <span
                      className="w-36 shrink-0 truncate font-mono text-[10px] text-stone-500"
                      title={event.agentId
                        ? `${event.agentType ?? "agent"}: ${event.agentId}`
                        : undefined}
                    >
                      {event.agentId ?? "—"}
                    </span>
                    {/* Timestamp (24hr) */}
                    <span className="shrink-0 font-mono text-[10px] text-stone-600">
                      {formatTimestamp(event.timestamp)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
