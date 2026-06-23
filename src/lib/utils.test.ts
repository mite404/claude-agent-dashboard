import { describe, it, expect } from 'vitest';
import { cn, formatElapsed, formatTimestamp } from './utils';

// ─── cn (class name merge) Tests ──────────────────────────────────────────────

describe('cn', () => {
  it('returns an empty string when called with no arguments', () => {
    expect(cn()).toBe('');
  });

  it('returns the class name unchanged for a single string', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  it('joins multiple class names with a space', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('merges conflicting Tailwind classes (last wins)', () => {
    // tailwind-merge keeps the last padding wins over earlier one
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('handles undefined and null without throwing', () => {
    expect(cn('base', undefined, null)).toBe('base');
  });

  it('handles object syntax from clsx', () => {
    expect(cn({ 'text-green-400': true, 'text-red-400': false })).toBe('text-green-400');
  });
});

// ─── formatElapsed Tests ──────────────────────────────────────────────────────

describe('formatElapsed', () => {
  it('returns — when startedAt is null', () => {
    expect(formatElapsed(null, null)).toBe('—');
  });

  it('returns — when startedAt is undefined', () => {
    expect(formatElapsed(undefined, undefined)).toBe('—');
  });

  it('formats elapsed seconds under one minute', () => {
    const start = new Date('2025-01-01T00:00:00.000Z').toISOString();
    const end = new Date('2025-01-01T00:00:45.000Z').toISOString();
    expect(formatElapsed(start, end)).toBe('45s');
  });

  it('formats elapsed time between one and 59 minutes', () => {
    const start = new Date('2025-01-01T00:00:00.000Z').toISOString();
    const end = new Date('2025-01-01T00:02:30.000Z').toISOString();
    expect(formatElapsed(start, end)).toBe('2m 30s');
  });

  it('formats elapsed time of exactly one minute', () => {
    const start = new Date('2025-01-01T00:00:00.000Z').toISOString();
    const end = new Date('2025-01-01T00:01:00.000Z').toISOString();
    expect(formatElapsed(start, end)).toBe('1m 0s');
  });

  it('formats elapsed time over one hour', () => {
    const start = new Date('2025-01-01T00:00:00.000Z').toISOString();
    const end = new Date('2025-01-01T01:30:00.000Z').toISOString();
    expect(formatElapsed(start, end)).toBe('1h 30m');
  });

  it('formats elapsed time of exactly two hours', () => {
    const start = new Date('2025-01-01T00:00:00.000Z').toISOString();
    const end = new Date('2025-01-01T02:00:00.000Z').toISOString();
    expect(formatElapsed(start, end)).toBe('2h 0m');
  });

  it('uses current time when completedAt is null (live timer)', () => {
    // Just verify it does not throw and returns a non-dash value
    const recentStart = new Date(Date.now() - 5000).toISOString();
    const result = formatElapsed(recentStart, null);
    expect(result).toMatch(/^\d+s$/); // e.g. "5s"
  });
});

// ─── formatTimestamp Tests ────────────────────────────────────────────────────

describe('formatTimestamp', () => {
  it('returns a string in HH:MM:SS 24-hour format', () => {
    // Freeze a UTC midnight — local tz doesn't matter; we just check the shape
    const result = formatTimestamp(new Date('2025-06-01T00:00:00.000Z').toISOString());
    // Should match HH:MM:SS pattern
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('produces different strings for different times', () => {
    const t1 = formatTimestamp(new Date('2025-06-01T10:00:00.000Z').toISOString());
    const t2 = formatTimestamp(new Date('2025-06-01T11:00:00.000Z').toISOString());
    expect(t1).not.toBe(t2);
  });

  it('does not include AM/PM markers', () => {
    const result = formatTimestamp(new Date('2025-06-01T10:00:00.000Z').toISOString());
    expect(result).not.toMatch(/am|pm/i);
  });
});
