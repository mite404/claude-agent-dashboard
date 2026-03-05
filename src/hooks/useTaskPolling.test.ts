import { buildTree } from "./useTaskPolling";
import type { Task, TaskStatus } from "@/types/task";

function createMockTask(overrides: Partial<Task>): Task {
  return {
    id: "1",
    name: "Test Task",
    status: "pending",
    agentType: "Explore",
    parentId: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    progressPercentage: 0,
    logs: [],
    ...overrides,
  };
}

describe("buildTree", () => {
  it("creates a single root for a task with no parentId", () => {
    const task = createMockTask({ id: "1", parentId: null });
    const result = buildTree([task]);
    console.log(
      "creates a single root for a task with no parentId:",
      JSON.stringify(result, null, 2),
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("creates parent-child relationships based on parentId", () => {
    const parent = createMockTask({ id: "parent-1", parentId: null });
    const child = createMockTask({ id: "child-1", parentId: "parent-1" });
    const grandchild = createMockTask({
      id: "grandchild-1",
      parentId: "child-1",
    });
    const result = buildTree([parent, child, grandchild]);
    console.log(
      "creates parent-child relationships based on parentId:",
      JSON.stringify(result, null, 2),
    );

    expect(result).toHaveLength(1);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children[0].children).toHaveLength(1);

    expect(result[0].id).toBe("parent-1"); // root is parent
    expect(result[0].children[0].id).toBe("child-1"); // child nested inside
    expect(result[0].children[0].children[0].id).toBe("grandchild-1"); // final nested object's id should be grandchild of result[0]
  });

  it("treats orphaned children as roots", () => {
    const orphanedTask = createMockTask({ id: "1", parentId: "non-existent-parent" });
    const result = buildTree([orphanedTask]);
    console.log("treats orphaned children as roots:", JSON.stringify(result, null, 2));

    expect(result).toHaveLength(1); // there is 1 root in the array of TaskNodes (orphaned task elevated to root status)
    expect(result[0].id).toBe("1"); // the orphaned task IS the root
  });
});
