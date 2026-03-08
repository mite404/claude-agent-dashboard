import { vi } from 'vitest';
import userEvent from '@testing-library/user-event'
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
    const parentNode = createMockNode({ id: 'parentNode', children: [] });
    render(<TaskTree nodes={[parentNode]} />);

    expect(screen.getByText(parentNode.name)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: parentNode.name })).toBeInTheDocument();
  });

  it('renders parent and child tasks with indentation', () => {
    const childNode = createMockNode({
      id: 'childNode',
      name: 'Child Task',
      parentId: 'parentNode',
    });
    const parentNode = createMockNode({
      id: 'parentNode',
      name: 'Parent Task',
      children: [childNode],
    });

    render(<TaskTree nodes={[parentNode]} />);

    expect(screen.getByRole('heading', { name: parentNode.name })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: childNode.name })).toBeInTheDocument();
    const childContainer = screen.getByRole('heading', { name: childNode.name }).closest('.pl-6');
    expect(childContainer).toBeInTheDocument();
  });

  it('renders connector line between parent and children', () => {
    const childNode = createMockNode({
      id: 'childNode',
      name: 'Child Task',
      parentId: 'parentNode',
    });
    const parentNode = createMockNode({
      id: 'parentNode',
      name: 'Parent Task',
      children: [childNode],
    });

    render(<TaskTree nodes={[parentNode]} />);

    const connector = document.querySelector('.w-px.bg-white\\/10'); // is 1px wide and white
    expect(connector).toBeInTheDocument(); // is in dom
    expect(connector).toHaveClass('absolute'); // has class 'absolute'
  });

  it('calls onStatusChange when child status is updated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
       ok: true,
       status: 200,
     } as Response))

    const mockStatusChange = vi.fn()
    const childNode = createMockNode({
      id: 'childNode',
      name: 'Child Task',
      parentId: 'parentNode',
    });
    const parentNode = createMockNode({
      id: 'parentNode',
      name: 'Parent Task',
      children: [childNode],
    });

    const user = userEvent.setup()
    render(<TaskTree nodes={[parentNode]} onStatusChange={mockStatusChange} />)

    // find the child node's container and click the cancel button that triggers status change
    const childHeading = screen.getByRole('heading', { name: childNode.name })
    const button = within(childHeading.closest('.relative') || document.body).getByRole('button', { name: /cancel/i });
    await user.click(button)

    expect(mockStatusChange).toHaveBeenCalled()
  });

  it('renders multiple levels of nesting (grandchildren)', () => {
    const grandchildNode = createMockNode({
      id: 'grandchildNode',
      name: 'Grandchild Task',
      parentId: 'childNode'
    })
    const childNode = createMockNode({
      id: 'childNode',
      name: 'Child Task',
      parentId: 'parentNode',
      children: [grandchildNode]
    });
    const parentNode = createMockNode({
      id: 'parentNode',
      name: 'Parent Task',
      children: [childNode],
    });

    render(<TaskTree nodes={[parentNode]} />)

    // check all 3 nodes exist in DOM
    expect(screen.getByRole('heading', { name: parentNode.name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: childNode.name })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: grandchildNode.name })).toBeInTheDocument()

    // // check indentation increases with depth
    // const childHeading = screen.getByRole('heading', { name: childNode.name })
    // expect (childHeading.closest('.pl-6')).toBeInTheDocument() // child indented once

    // const grandchildHeading = screen.getByRole('heading', { name: grandchildNode.name })
    // expect(grandchildHeading.closest('.pl-12')).toBeInTheDocument() // grandchild indented twice
  })
});
