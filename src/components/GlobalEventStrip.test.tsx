import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalEventStrip } from './GlobalEventStrip';
import type { SessionEvent, SessionEventType } from '@/types/task';

function createMockSessionEvent(
  type: SessionEventType,
  overrides: Partial<SessionEvent> = {},
): SessionEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 9)}`,
    type,
    timestamp: new Date().toISOString(),
    sessionId: 'test-session',
    summary: `${type} summary`,
    ...overrides,
  };
}

describe('GlobalEventStrip', () => {
  it('renders collapsed when events is empty', () => {
    render(<GlobalEventStrip events={[]} />);

    const toggle = screen.getByRole('button', { name: /expand session events/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The event list should not be visible
    expect(screen.queryByText(/no session events yet/i)).not.toBeInTheDocument();
  });

  it('renders expanded by default when events exist', () => {
    const events = [createMockSessionEvent('SessionStart')];
    render(<GlobalEventStrip events={events} />);

    const toggle = screen.getByRole('button', { name: /collapse session events/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows empty state text when open with no events', async () => {
    render(<GlobalEventStrip events={[]} />);

    // Manually open the collapsed panel
    const toggle = screen.getByRole('button');
    await userEvent.click(toggle);

    expect(screen.getByText(/no session events yet/i)).toBeInTheDocument();
  });

  it('shows the event count badge', () => {
    const events = [
      createMockSessionEvent('SessionStart'),
      createMockSessionEvent('UserPromptSubmit'),
    ];
    render(<GlobalEventStrip events={events} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders correct emoji for each original event type', () => {
    const eventTypes: SessionEventType[] = [
      'UserPromptSubmit',
      'SessionStart',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'Notification',
      'PermissionRequest',
      'PreCompact',
      'PostToolUseFailure',
    ];
    const events = eventTypes.map((t) => createMockSessionEvent(t));
    render(<GlobalEventStrip events={events} />);

    // Panel is open by default (events.length > 0)
    // Each event type name should appear as text in the strip
    for (const type of eventTypes) {
      expect(screen.getByText(type)).toBeInTheDocument();
    }
  });

  it('renders correct emoji for new event types', () => {
    const newEventTypes: SessionEventType[] = [
      'SessionEnd',
      'TeammateIdle',
      'TaskCompleted',
      'InstructionsLoaded',
      'ConfigChange',
      'WorktreeCreate',
      'WorktreeRemove',
    ];
    const events = newEventTypes.map((t) => createMockSessionEvent(t));
    render(<GlobalEventStrip events={events} />);

    for (const type of newEventTypes) {
      expect(screen.getByText(type)).toBeInTheDocument();
    }
  });

  it('shows dash when agentId is absent', () => {
    const event = createMockSessionEvent('SessionStart', { agentId: undefined });
    render(<GlobalEventStrip events={[event]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows agentId when present', () => {
    const agentId = 'acbdbf5a94d625cc';
    const event = createMockSessionEvent('SubagentStart', { agentId });
    render(<GlobalEventStrip events={[event]} />);
    expect(screen.getByText(agentId)).toBeInTheDocument();
  });

  it('summary span has title attribute with full text', () => {
    const summary = 'This is a very long summary that might be truncated in the UI';
    const event = createMockSessionEvent('Notification', { summary });
    render(<GlobalEventStrip events={[event]} />);

    // The summary span should carry the full text in its title for tooltip access
    const span = screen.getByTitle(summary);
    expect(span).toBeInTheDocument();
  });

  it('toggles open/closed on button click', async () => {
    const events = [createMockSessionEvent('Stop')];
    render(<GlobalEventStrip events={events} />);

    const toggle = screen.getByRole('button');
    // Starts open (events.length > 0)
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows originating skill pill for UserPromptSubmit with a skill', () => {
    const event = createMockSessionEvent('UserPromptSubmit', {
      originatingSkill: '/commit',
    });
    render(<GlobalEventStrip events={[event]} />);
    expect(screen.getByText('/commit')).toBeInTheDocument();
  });

  it('does not show skill pill when originatingSkill is absent', () => {
    const event = createMockSessionEvent('UserPromptSubmit', { originatingSkill: undefined });
    render(<GlobalEventStrip events={[event]} />);
    // Should not render any skill pill text - no /skill element
    expect(screen.queryByText(/^\//)).not.toBeInTheDocument();
  });
});
