import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TaskTree } from './TaskTree';
import type { TaskNode } from '@/types/task';

function createMockNode(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: 'node-' + Math.random().toString(36).slice(2, 9),
    name: 'Test Node',
    status: 'pending',
    agentType: 'claude',
    parentId: null,
    createdAt: new Date().toISOString(),
    progressPercentage: 0,
    logs: [],
    children: [],
    ...overrides,
  };
}

describe('TaskTree', () => {
  it('renders a single task with no children', () => {
    const mockNode = createMockNode({ children: [] });
    render(
      <>
        <TaskTree nodes={[mockNode]} />
      </>,
    );

    expect(screen.getByText(mockNode.name)).toBeInTheDocument();
  });
});
