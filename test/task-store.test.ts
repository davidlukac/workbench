import { describe, expect, it } from "vitest";
import { TaskLedger } from "../src/task-store/index.js";
import type { Task } from "../src/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    story_id: "WB-8",
    spec_id: "spec-WB-8",
    title: "Implement claim_task",
    type: "backend_api",
    tags: [],
    persona: null,
    review_persona: null,
    status: "pending",
    priority: 1,
    dependencies: [],
    planned_files: [],
    ac_refs: [],
    fresh_context_required: false,
    claimed_by: null,
    lock: null,
    attempt_count: 0,
    max_attempts: 2,
    output: null,
    evidence: { commands_run: [], tests_passed: [], changed_files: [], notes: [] },
    error: null,
    revision: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    ...overrides
  };
}

describe("TaskLedger", () => {
  it("adds a task and retrieves it", () => {
    const ledger = new TaskLedger();
    const task = makeTask();
    ledger.addTask(task);
    expect(ledger.getTask("task-1")).toEqual(task);
  });

  describe("createTask", () => {
    it("creates a task with defaults and stores it", () => {
      const ledger = new TaskLedger();
      const task = ledger.createTask({
        id: "t-new",
        story_id: "WB-10",
        spec_id: "spec-WB-10",
        title: "New task",
        type: "backend_api"
      });

      expect(task.id).toBe("t-new");
      expect(task.status).toBe("pending");
      expect(task.tags).toEqual([]);
      expect(task.persona).toBeNull();
      expect(task.review_persona).toBeNull();
      expect(task.priority).toBe(1);
      expect(task.dependencies).toEqual([]);
      expect(task.planned_files).toEqual([]);
      expect(task.ac_refs).toEqual([]);
      expect(task.fresh_context_required).toBe(false);
      expect(task.claimed_by).toBeNull();
      expect(task.lock).toBeNull();
      expect(task.attempt_count).toBe(0);
      expect(task.max_attempts).toBe(2);
      expect(task.output).toBeNull();
      expect(task.evidence).toEqual({
        commands_run: [],
        tests_passed: [],
        changed_files: [],
        notes: []
      });
      expect(task.error).toBeNull();
      expect(task.revision).toBe(0);
      expect(task.completed_at).toBeNull();
      expect(ledger.getTask("t-new")).toBe(task);
    });

    it("creates a task with provided optional fields", () => {
      const ledger = new TaskLedger();
      const task = ledger.createTask({
        id: "t-opts",
        story_id: "WB-10",
        spec_id: "spec-WB-10",
        title: "Task with options",
        type: "frontend",
        tags: ["ui"],
        persona: "engineer",
        review_persona: "reviewer",
        priority: 3,
        dependencies: [{ taskId: "dep-1", requiredStatus: "verified" }],
        planned_files: ["src/a.ts"],
        ac_refs: ["AC-1"],
        fresh_context_required: true,
        max_attempts: 5
      });

      expect(task.tags).toEqual(["ui"]);
      expect(task.persona).toBe("engineer");
      expect(task.review_persona).toBe("reviewer");
      expect(task.priority).toBe(3);
      expect(task.dependencies).toEqual([{ taskId: "dep-1", requiredStatus: "verified" }]);
      expect(task.planned_files).toEqual(["src/a.ts"]);
      expect(task.ac_refs).toEqual(["AC-1"]);
      expect(task.fresh_context_required).toBe(true);
      expect(task.max_attempts).toBe(5);
    });
  });

  describe("claimTask", () => {
    it("transitions pending → claimed and sets claimed_by and lock", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());

      const result = ledger.claimTask("task-1", "agent-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status).toBe("claimed");
      expect(result.value.claimed_by).toBe("agent-1");
      expect(result.value.lock).toBeDefined();
      expect(result.value.lock?.owner).toBe("agent-1");
      expect(result.value.lock?.expires_at).toBeDefined();
      expect(result.value.revision).toBe(1);
    });

    it("rejects claiming a non-existent task", () => {
      const ledger = new TaskLedger();
      const result = ledger.claimTask("nonexistent", "agent-1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("Task not found");
    });

    it("rejects claiming an already-claimed task", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());
      ledger.claimTask("task-1", "agent-1");

      const result = ledger.claimTask("task-1", "agent-2");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("expected pending");
      expect(result.error.message).toContain("claimed");
    });

    it("rejects claiming a task in in_progress status", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());
      ledger.claimTask("task-1", "agent-1");
      ledger.startTask("task-1");

      const result = ledger.claimTask("task-1", "agent-2");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("in_progress");
    });

    it("increments revision on claim", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask({ revision: 0 }));

      const result = ledger.claimTask("task-1", "agent-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(1);
    });

    it("sets lock with 30-minute expiry", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());

      const before = Date.now();
      const result = ledger.claimTask("task-1", "agent-1");
      const after = Date.now();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const expiresAt = new Date(result.value.lock?.expires_at ?? "").getTime();
      const expectedMin = before + 30 * 60 * 1000;
      const expectedMax = after + 30 * 60 * 1000;
      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe("submitTask", () => {
    it("transitions in_progress → implemented with output and evidence", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());
      ledger.claimTask("task-1", "agent-1");
      ledger.startTask("task-1");

      const result = ledger.submitTask(
        "task-1",
        { summary: "Done", changed_files: ["src/a.ts"] },
        {
          commands_run: ["npm test"],
          tests_passed: ["test A"],
          changed_files: ["src/a.ts"],
          notes: []
        }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("implemented");
      expect(result.value.output?.summary).toBe("Done");
      expect(result.value.evidence.commands_run).toEqual(["npm test"]);
      expect(result.value.lock).toBeNull();
      expect(result.value.revision).toBe(3);
    });

    it("transitions claimed → implemented (skip start)", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());
      ledger.claimTask("task-1", "agent-1");

      const result = ledger.submitTask(
        "task-1",
        { summary: "Quick", changed_files: [] },
        { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("implemented");
    });

    it("rejects submitting a non-existent task", () => {
      const ledger = new TaskLedger();
      const result = ledger.submitTask(
        "nonexistent",
        { summary: "x", changed_files: [] },
        { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("Task not found");
    });

    it("rejects submitting a task in wrong status", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());

      const result = ledger.submitTask(
        "task-1",
        { summary: "x", changed_files: [] },
        { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("pending");
    });
  });

  describe("routeForReview", () => {
    it("transitions implemented → review_required", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());
      ledger.claimTask("task-1", "agent-1");
      ledger.startTask("task-1");
      ledger.submitTask(
        "task-1",
        { summary: "Done", changed_files: [] },
        { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
      );

      const result = ledger.routeForReview("task-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status).toBe("review_required");
      expect(result.value.revision).toBe(4);
    });

    it("rejects routing a non-existent task", () => {
      const ledger = new TaskLedger();
      const result = ledger.routeForReview("nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("Task not found");
    });

    it("rejects routing a task not in implemented status", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());

      const result = ledger.routeForReview("task-1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("implemented");
    });

    it("preserves review_persona from the task", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask({ review_persona: "reviewer" }));
      ledger.claimTask("task-1", "agent-1");
      ledger.startTask("task-1");
      ledger.submitTask(
        "task-1",
        { summary: "Done", changed_files: [] },
        { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
      );

      const result = ledger.routeForReview("task-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.review_persona).toBe("reviewer");
    });
  });

  describe("startTask", () => {
    it("transitions claimed → in_progress and clears lock", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());
      ledger.claimTask("task-1", "agent-1");

      const result = ledger.startTask("task-1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status).toBe("in_progress");
      expect(result.value.lock).toBeNull();
      expect(result.value.revision).toBe(2);
    });

    it("rejects starting a non-existent task", () => {
      const ledger = new TaskLedger();
      const result = ledger.startTask("nonexistent");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("Task not found");
    });

    it("rejects starting a pending task", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());

      const result = ledger.startTask("task-1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("claimed");
    });

    it("rejects starting an already in_progress task", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask());
      ledger.claimTask("task-1", "agent-1");
      ledger.startTask("task-1");

      const result = ledger.startTask("task-1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("in_progress");
    });
  });

  describe("getPendingTasks / getClaimedTasks", () => {
    it("getPendingTasks returns only pending tasks", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask({ id: "t1" }));
      ledger.addTask(makeTask({ id: "t2" }));
      ledger.claimTask("t1", "agent-1");

      const pending = ledger.getPendingTasks();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.id).toBe("t2");
    });

    it("getClaimedTasks returns only claimed tasks", () => {
      const ledger = new TaskLedger();
      ledger.addTask(makeTask({ id: "t1" }));
      ledger.addTask(makeTask({ id: "t2" }));
      ledger.claimTask("t1", "agent-1");

      const claimed = ledger.getClaimedTasks();
      expect(claimed).toHaveLength(1);
      expect(claimed[0]?.id).toBe("t1");
      expect(claimed[0]?.claimed_by).toBe("agent-1");
    });
  });
});
