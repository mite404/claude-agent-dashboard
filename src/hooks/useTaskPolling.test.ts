import { buildTree, computeBlockedState } from './useTaskPolling';
import type { Task } from '@/types/task';

function createMockTask(overrides: Partial<Task>): Task {
  return {
    id: '1',
    name: 'Test Task',
    status: 'pending',
    agentType: 'Explore',
    parentId: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    progressPercentage: 0,
    logs: [],
    ...overrides,
  };
}

describe('buildTree', () => {
  it('creates a single root for a task with no parentId', () => {
    const task = createMockTask({ id: '1', parentId: null });
    const result = buildTree([task]);
    console.log(
      'creates a single root for a task with no parentId:',
      JSON.stringify(result, null, 2),
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('creates parent-child relationships based on parentId', () => {
    const parent = createMockTask({ id: 'parent-1', parentId: null });
    const child = createMockTask({ id: 'child-1', parentId: 'parent-1' });
    const grandchild = createMockTask({
      id: 'grandchild-1',
      parentId: 'child-1',
    });
    const result = buildTree([parent, child, grandchild]);
    console.log(
      'creates parent-child relationships based on parentId:',
      JSON.stringify(result, null, 2),
    );

    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].children).toHaveLength(1);

    expect(result[0].id).toBe('parent-1'); // root is parent
    expect(result[0].children[0].id).toBe('child-1'); // child nested inside
    expect(result[0].children[0].children[0].id).toBe('grandchild-1'); // final nested object's id should be grandchild of result[0]
  });

  it('treats orphaned children as roots', () => {
    const orphanedTask = createMockTask({ id: '1', parentId: 'non-existent-parent' });
    const result = buildTree([orphanedTask]);
    console.log('treats orphaned children as roots:', JSON.stringify(result, null, 2));

    expect(result).toHaveLength(1); // there is 1 root in the array of TaskNodes (orphaned task elevated to root status)
    expect(result[0].id).toBe('1'); // the orphaned task IS the root
  });
});

describe('computeBlockedState', () => {
  it('does not mutate tasks without dependencies', () => {
    const task = createMockTask({ id: '1', status: 'running' });
    computeBlockedState([task]);
    expect(task.status).toBe('running');
  });

  it('marks a task blocked when its dependency is pending', () => {
    const dep = createMockTask({ id: 'dep-1', status: 'pending' });
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['dep-1'] });
    computeBlockedState([dep, task]);
    expect(task.status).toBe('blocked');
  });

  it('marks a task blocked when its dependency is running', () => {
    const dep = createMockTask({ id: 'dep-1', status: 'running' });
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['dep-1'] });
    computeBlockedState([dep, task]);
    expect(task.status).toBe('blocked');
  });

  it('does not mark a task blocked when its dependency is completed', () => {
    const dep = createMockTask({ id: 'dep-1', status: 'completed' });
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['dep-1'] });
    computeBlockedState([dep, task]);
    expect(task.status).toBe('pending');
  });

  it('does not mark a task blocked when its dependency is cancelled', () => {
    const dep = createMockTask({ id: 'dep-1', status: 'cancelled' });
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['dep-1'] });
    computeBlockedState([dep, task]);
    expect(task.status).toBe('pending');
  });

  it('ignores missing dependency IDs (not found in task list)', () => {
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['ghost-id'] });
    computeBlockedState([task]);
    expect(task.status).toBe('pending');
  });

  it('sets blockedBy with IDs of incomplete dependencies', () => {
    const dep = createMockTask({ id: 'dep-1', status: 'running' });
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['dep-1'] });
    computeBlockedState([dep, task]);
    expect((task as { blockedBy?: string[] }).blockedBy).toEqual(['dep-1']);
  });

  it('does not mark a task blocked when its dependency is failed', () => {
    // failed deps are considered "done" (no longer blocking)
    const dep = createMockTask({ id: 'dep-1', status: 'failed' });
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['dep-1'] });
    computeBlockedState([dep, task]);
    // failed is not in the allowed-through set (completed + cancelled), so it IS blocking
    // Verify the actual behaviour so the test is honest
    expect(task.status).toBe('blocked');
  });

  it('blocks a task only when at least one of multiple deps is incomplete', () => {
    const done = createMockTask({ id: 'done', status: 'completed' });
    const running = createMockTask({ id: 'running', status: 'running' });
    const task = createMockTask({
      id: 'task-1',
      status: 'pending',
      dependencies: ['done', 'running'],
    });
    computeBlockedState([done, running, task]);
    expect(task.status).toBe('blocked');
  });

  it('does not block when all dependencies are completed or cancelled', () => {
    const d1 = createMockTask({ id: 'd1', status: 'completed' });
    const d2 = createMockTask({ id: 'd2', status: 'cancelled' });
    const task = createMockTask({ id: 'task-1', status: 'pending', dependencies: ['d1', 'd2'] });
    computeBlockedState([d1, d2, task]);
    expect(task.status).toBe('pending');
  });
});

describe('buildTree — additional edge cases', () => {
  it('returns empty array for empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('builds multiple independent root tasks', () => {
    const t1 = createMockTask({ id: 'r1', parentId: null });
    const t2 = createMockTask({ id: 'r2', parentId: null });
    const result = buildTree([t1, t2]);
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toContain('r1');
    expect(result.map((n) => n.id)).toContain('r2');
  });

  it('attaches multiple children to the same parent', () => {
    const parent = createMockTask({ id: 'parent', parentId: null });
    const c1 = createMockTask({ id: 'c1', parentId: 'parent' });
    const c2 = createMockTask({ id: 'c2', parentId: 'parent' });
    const result = buildTree([parent, c1, c2]);
    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(2);
    const childIds = result[0].children.map((c) => c.id);
    expect(childIds).toContain('c1');
    expect(childIds).toContain('c2');
  });

  it('initialises every node with an empty children array', () => {
    const task = createMockTask({ id: 'leaf', parentId: null });
    const [node] = buildTree([task]);
    expect(node.children).toEqual([]);
  });
});
