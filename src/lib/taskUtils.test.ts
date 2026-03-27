import { describe, it, expect } from 'vitest';
import { sortNodes, flattenVisible, collectAllTasks, collectIds } from './taskUtils';
import type { TaskNode } from '@/types/task';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function createTask(
  id: string,
  overrides: Partial<TaskNode> = {},
): TaskNode {
  return {
    id,
    name: `Task ${id}`,
    status: 'pending',
    agentType: 'Agent',
    agentId: `agent-${id}`,
    startedAt: null,
    completedAt: null,
    progressPercentage: 0,
    children: [],
    summary: '',
    agentSummary: null,
    logs: [],
    events: [],
    ...overrides,
  };
}

// ─── sortNodes Tests ──────────────────────────────────────────────────────────

describe('sortNodes', () => {
  it('returns nodes unchanged when sort.col is null', () => {
    const nodes = [
      createTask('a', { status: 'running' }),
      createTask('b', { status: 'pending' }),
    ];
    const sorted = sortNodes(nodes, { col: null, dir: 'asc' });
    expect(sorted).toEqual(nodes);
  });

  it('sorts by status in urgency order (running > paused > blocked > failed > pending > completed > cancelled)', () => {
    const nodes = [
      createTask('a', { status: 'pending' }),
      createTask('b', { status: 'completed' }),
      createTask('c', { status: 'running' }),
      createTask('d', { status: 'failed' }),
    ];

    const sorted = sortNodes(nodes, { col: 'status', dir: 'asc' });

    expect(sorted[0].status).toBe('running');
    expect(sorted[1].status).toBe('failed');
    expect(sorted[2].status).toBe('pending');
    expect(sorted[3].status).toBe('completed');
  });

  it('reverses sort direction when dir is desc', () => {
    const nodes = [
      createTask('a', { status: 'running' }),
      createTask('b', { status: 'pending' }),
      createTask('c', { status: 'completed' }),
    ];

    const sorted = sortNodes(nodes, { col: 'status', dir: 'desc' });

    expect(sorted[0].status).toBe('completed');
    expect(sorted[1].status).toBe('pending');
    expect(sorted[2].status).toBe('running');
  });

  it('sorts by task name alphabetically ascending', () => {
    const nodes = [
      createTask('a', { name: 'Zebra Task' }),
      createTask('b', { name: 'Apple Task' }),
      createTask('c', { name: 'Mango Task' }),
    ];

    const sorted = sortNodes(nodes, { col: 'task', dir: 'asc' });

    expect(sorted[0].name).toBe('Apple Task');
    expect(sorted[1].name).toBe('Mango Task');
    expect(sorted[2].name).toBe('Zebra Task');
  });

  it('sorts by task name alphabetically descending', () => {
    const nodes = [
      createTask('a', { name: 'Zebra Task' }),
      createTask('b', { name: 'Apple Task' }),
    ];

    const sorted = sortNodes(nodes, { col: 'task', dir: 'desc' });

    expect(sorted[0].name).toBe('Zebra Task');
    expect(sorted[1].name).toBe('Apple Task');
  });

  it('sorts by agent type', () => {
    const nodes = [
      createTask('a', { agentType: 'Subagent' }),
      createTask('b', { agentType: 'Agent' }),
    ];

    const sorted = sortNodes(nodes, { col: 'agent', dir: 'asc' });

    expect(sorted[0].agentType).toBe('Agent');
    expect(sorted[1].agentType).toBe('Subagent');
  });

  it('sorts by agent ID', () => {
    const nodes = [
      createTask('a', { agentId: 'zzz' }),
      createTask('b', { agentId: 'aaa' }),
    ];

    const sorted = sortNodes(nodes, { col: 'id', dir: 'asc' });

    expect(sorted[0].agentId).toBe('aaa');
    expect(sorted[1].agentId).toBe('zzz');
  });

  it('sorts by number of children (subtasks)', () => {
    const nodes = [
      createTask('a', { children: [createTask('a1'), createTask('a2')] }),
      createTask('b', { children: [createTask('b1')] }),
      createTask('c', { children: [] }),
    ];

    const sorted = sortNodes(nodes, { col: 'subtasks', dir: 'asc' });

    expect(sorted[0].children.length).toBe(0);
    expect(sorted[1].children.length).toBe(1);
    expect(sorted[2].children.length).toBe(2);
  });

  it('sorts by progress percentage', () => {
    const nodes = [
      createTask('a', { progressPercentage: 50 }),
      createTask('b', { progressPercentage: 25 }),
      createTask('c', { progressPercentage: 100 }),
    ];

    const sorted = sortNodes(nodes, { col: 'progress', dir: 'asc' });

    expect(sorted[0].progressPercentage).toBe(25);
    expect(sorted[1].progressPercentage).toBe(50);
    expect(sorted[2].progressPercentage).toBe(100);
  });

  it('sorts children recursively', () => {
    const parent = createTask('parent', {
      children: [
        createTask('child-b', { status: 'pending' }),
        createTask('child-a', { status: 'running' }),
      ],
    });

    const sorted = sortNodes([parent], { col: 'status', dir: 'asc' });

    expect(sorted[0].children[0].id).toBe('child-a');
    expect(sorted[0].children[1].id).toBe('child-b');
  });
});

// ─── flattenVisible Tests ─────────────────────────────────────────────────────

describe('flattenVisible', () => {
  it('flattens a tree into a single level list', () => {
    const nodes = [
      createTask('a'),
      createTask('b'),
    ];
    const expanded = new Set<string>();

    const flat = flattenVisible(nodes, expanded);

    expect(flat).toHaveLength(2);
    expect(flat[0].task.id).toBe('a');
    expect(flat[1].task.id).toBe('b');
  });

  it('marks hasChildren correctly', () => {
    const parent = createTask('parent', {
      children: [createTask('child')],
    });
    const leaf = createTask('leaf');

    const flat = flattenVisible([parent, leaf], new Set());

    expect(flat[0].hasChildren).toBe(true);
    expect(flat[1].hasChildren).toBe(false);
  });

  it('hides children when parent is not in expanded set', () => {
    const parent = createTask('parent', {
      children: [createTask('child')],
    });
    const expanded = new Set<string>();

    const flat = flattenVisible([parent], expanded);

    expect(flat).toHaveLength(1);
    expect(flat[0].task.id).toBe('parent');
  });

  it('shows children when parent is in expanded set', () => {
    const child = createTask('child');
    const parent = createTask('parent', { children: [child] });
    const expanded = new Set(['parent']);

    const flat = flattenVisible([parent], expanded);

    expect(flat).toHaveLength(2);
    expect(flat[0].task.id).toBe('parent');
    expect(flat[1].task.id).toBe('child');
  });

  it('tracks depth correctly', () => {
    const grandchild = createTask('grandchild');
    const child = createTask('child', { children: [grandchild] });
    const parent = createTask('parent', { children: [child] });
    const expanded = new Set(['parent', 'child']);

    const flat = flattenVisible([parent], expanded);

    expect(flat[0].depth).toBe(0);
    expect(flat[1].depth).toBe(1);
    expect(flat[2].depth).toBe(2);
  });

  it('expands only specified parents, hiding unexpanded subtrees', () => {
    const grandchild = createTask('grandchild');
    const child = createTask('child', { children: [grandchild] });
    const parent = createTask('parent', { children: [child] });
    // parent expanded, but child is not
    const expanded = new Set(['parent']);

    const flat = flattenVisible([parent], expanded);

    expect(flat).toHaveLength(2);
    expect(flat[0].task.id).toBe('parent');
    expect(flat[1].task.id).toBe('child');
    // grandchild should not appear
    expect(flat.map((f) => f.task.id)).not.toContain('grandchild');
  });
});

// ─── collectAllTasks Tests ────────────────────────────────────────────────────

describe('collectAllTasks', () => {
  it('collects a single task with no children', () => {
    const nodes = [createTask('a')];
    const collected = collectAllTasks(nodes);

    expect(collected).toHaveLength(1);
    expect(collected[0].id).toBe('a');
  });

  it('collects parent and children recursively', () => {
    const child1 = createTask('child1');
    const child2 = createTask('child2');
    const parent = createTask('parent', { children: [child1, child2] });

    const collected = collectAllTasks([parent]);

    expect(collected).toHaveLength(3);
    expect(collected.map((t) => t.id)).toEqual(['parent', 'child1', 'child2']);
  });

  it('collects deeply nested tasks', () => {
    const grandchild = createTask('grandchild');
    const child = createTask('child', { children: [grandchild] });
    const parent = createTask('parent', { children: [child] });

    const collected = collectAllTasks([parent]);

    expect(collected).toHaveLength(3);
    expect(collected.map((t) => t.id)).toEqual(['parent', 'child', 'grandchild']);
  });

  it('handles multiple root nodes with mixed depths', () => {
    const child1 = createTask('child1');
    const parent1 = createTask('parent1', { children: [child1] });
    const parent2 = createTask('parent2');

    const collected = collectAllTasks([parent1, parent2]);

    expect(collected).toHaveLength(3);
    expect(collected.map((t) => t.id)).toEqual(['parent1', 'child1', 'parent2']);
  });
});

// ─── collectIds Tests ─────────────────────────────────────────────────────────

describe('collectIds', () => {
  it('collects a single task ID', () => {
    const nodes = [createTask('a')];
    const ids = collectIds(nodes);

    expect(ids).toEqual(['a']);
  });

  it('collects parent and children IDs recursively', () => {
    const child = createTask('child');
    const parent = createTask('parent', { children: [child] });

    const ids = collectIds([parent]);

    expect(ids).toEqual(['parent', 'child']);
  });

  it('collects deeply nested IDs', () => {
    const grandchild = createTask('grandchild');
    const child = createTask('child', { children: [grandchild] });
    const parent = createTask('parent', { children: [child] });

    const ids = collectIds([parent]);

    expect(ids).toEqual(['parent', 'child', 'grandchild']);
  });

  it('preserves order: parent then child', () => {
    const child1 = createTask('c1');
    const child2 = createTask('c2');
    const parent = createTask('p', { children: [child1, child2] });

    const ids = collectIds([parent]);

    expect(ids[0]).toBe('p');
    expect(ids.includes('c1')).toBe(true);
    expect(ids.includes('c2')).toBe(true);
  });
});
