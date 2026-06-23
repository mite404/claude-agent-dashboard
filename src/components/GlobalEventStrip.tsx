import React, { useState, useEffect, useRef } from 'react';
import { IconChevronRight, IconTrash } from '@tabler/icons-react';
import { cn, formatTimestamp } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SESSION_EVENT_EMOJI } from '@/lib/taskConfig';
import type { SessionEvent } from '@/types/task';

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
      console.error('Failed to clear session events:', err);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-stone-800">
      <div className="flex w-full items-center gap-2 bg-stone-900/60 px-3 py-2 transition-colors hover:bg-stone-900">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 rounded px-1 text-left focus-visible:ring-1 focus-visible:ring-stone-500 focus-visible:outline-none"
          aria-expanded={open}
          aria-label={open ? 'Collapse session events' : 'Expand session events'}
        >
          <IconChevronRight
            size={13}
            aria-hidden="true"
            className={cn(
              'text-stone-500 transition-transform duration-150 shrink-0',
              open && 'rotate-90',
            )}
          />
          <span className="font-mono text-[10px] font-bold tracking-widest text-stone-500 uppercase">
            Session Events
          </span>
          <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded bg-stone-800 px-1 text-[10px] font-semibold text-stone-400 tabular-nums">
            {events.length}
          </span>
        </button>
        {events.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleClearAll()}
            disabled={clearing}
            className="shrink-0 gap-1.5 bg-rose-500 text-white hover:bg-rose-400"
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
            <div className="flex h-10 items-center gap-2 border-b border-stone-800 bg-stone-900/60 px-3 text-xs font-medium text-stone-400">
              <span className="w-5 shrink-0" />
              <span className="w-40 shrink-0 text-left">Event</span>
              <span className="flex-1 truncate text-left">Summary</span>
              <span className="w-36 shrink-0 text-left">Agent ID</span>
              <span className="shrink-0 text-left font-mono">Time</span>
            </div>
          )}
          <div ref={scrollRef} className="max-h-96 divide-y divide-stone-800/40 overflow-auto">
            {events.length === 0 ? (
              <div className="px-3 py-3 text-xs text-stone-600 italic">
                No session events yet — submit a user prompt to start.
              </div>
            ) : (
              <>
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-stone-900/40"
                  >
                    {/* Emoji */}
                    <span className="w-5 shrink-0 text-center select-none" aria-hidden="true">
                      {SESSION_EVENT_EMOJI[event.type] ?? '📋'}
                    </span>
                    {/* Event type */}
                    <span className="w-40 shrink-0 text-[11px] text-stone-500">{event.type}</span>
                    {/* Summary */}
                    <span
                      className="flex-1 truncate font-mono text-[10px] text-stone-300"
                      title={event.summary}
                    >
                      {event.summary}
                    </span>
                    {/* Skill pill — shown for UserPromptSubmit events with a skill */}
                    {event.type === 'UserPromptSubmit' && event.originatingSkill && (
                      <span className="shrink-0 rounded border border-violet-700 bg-violet-950 px-1.5 py-0.5 font-mono text-[10px] text-violet-300">
                        {event.originatingSkill}
                      </span>
                    )}
                    {/* Agent ID — fixed column, always present */}
                    <span
                      className="w-36 shrink-0 truncate font-mono text-[10px] text-stone-500"
                      title={
                        event.agentId
                          ? `${event.agentType ?? 'agent'}: ${event.agentId}`
                          : undefined
                      }
                    >
                      {event.agentId ?? '—'}
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
