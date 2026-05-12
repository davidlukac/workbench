import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../src/logging/logger.js";
import {
  claimTaskTool,
  createTaskTool,
  routeForReviewTool,
  startTaskTool,
  submitTaskTool
} from "../src/server/tools/index.js";
import { TaskLedger } from "../src/task-store/index.js";
import type { Task } from "../src/types.js";

class MemoryLogger implements Logger {
  readonly entries: { level: "info" | "error"; message: string }[] = [];
  async info(message: string): Promise<void> {
    this.entries.push({ level: "info", message });
  }
  async error(message: string): Promise<void> {
    this.entries.push({ level: "error", message });
  }
}

function makeTask(ledger: TaskLedger, id = "task-1"): void {
  const task: Task = {
    id,
    story_id: "WB-8",
    spec_id: "spec-WB-8",
    title: "Test task",
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
    completed_at: null
  };
  ledger.addTask(task);
}

describe("claimTaskTool", () => {
  it("transitions a pending task to claimed", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    const logger = new MemoryLogger();

    const result = await claimTaskTool({ task_id: "task-1", agent_id: "agent-x" }, logger, ledger);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.status).toBe("claimed");
    expect(result.structuredContent?.claimed_by).toBe("agent-x");
    expect(result.structuredContent?.lock.owner).toBe("agent-x");
    expect(result.structuredContent?.revision).toBe(1);
  });

  it("returns isError when task does not exist", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const result = await claimTaskTool({ task_id: "missing", agent_id: "agent-x" }, logger, ledger);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Task not found");
    const errorMessages = logger.entries.filter((e) => e.level === "error").map((e) => e.message);
    expect(errorMessages).toContain("tool_invocation_failed");
  });

  it("returns isError when task is not pending", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    ledger.claimTask("task-1", "agent-1");
    const logger = new MemoryLogger();

    const result = await claimTaskTool({ task_id: "task-1", agent_id: "agent-2" }, logger, ledger);

    expect(result.isError).toBe(true);
  });

  it("logs started and succeeded events", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    const logger = new MemoryLogger();

    await claimTaskTool({ task_id: "task-1", agent_id: "agent-x" }, logger, ledger);

    const messages = logger.entries.map((e) => e.message);
    expect(messages).toContain("tool_invocation_started");
    expect(messages).toContain("tool_invocation_succeeded");
  });
});

describe("startTaskTool", () => {
  it("transitions a claimed task to in_progress", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    ledger.claimTask("task-1", "agent-1");
    const logger = new MemoryLogger();

    const result = await startTaskTool({ task_id: "task-1" }, logger, ledger);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.status).toBe("in_progress");
    expect(result.structuredContent?.revision).toBe(2);
  });

  it("returns isError when task does not exist", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const result = await startTaskTool({ task_id: "missing" }, logger, ledger);

    expect(result.isError).toBe(true);
    const errorMessages = logger.entries.filter((e) => e.level === "error").map((e) => e.message);
    expect(errorMessages).toContain("tool_invocation_failed");
  });

  it("returns isError when task is not in claimed status", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    const logger = new MemoryLogger();

    const result = await startTaskTool({ task_id: "task-1" }, logger, ledger);

    expect(result.isError).toBe(true);
  });
});

describe("submitTaskTool", () => {
  it("transitions an in_progress task to implemented", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    ledger.claimTask("task-1", "agent-1");
    ledger.startTask("task-1");
    const logger = new MemoryLogger();

    const result = await submitTaskTool(
      {
        task_id: "task-1",
        output: { summary: "Done", changed_files: ["src/a.ts"] },
        evidence: {
          commands_run: ["npm test"],
          tests_passed: ["test A"],
          changed_files: ["src/a.ts"],
          notes: []
        }
      },
      logger,
      ledger
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.task.status).toBe("implemented");
    expect(result.structuredContent?.task.output?.summary).toBe("Done");
  });

  it("returns isError when task does not exist", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const result = await submitTaskTool(
      {
        task_id: "missing",
        output: { summary: "x", changed_files: [] },
        evidence: { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
      },
      logger,
      ledger
    );

    expect(result.isError).toBe(true);
    const errorMessages = logger.entries.filter((e) => e.level === "error").map((e) => e.message);
    expect(errorMessages).toContain("tool_invocation_failed");
  });

  it("returns isError when task is in wrong status", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    const logger = new MemoryLogger();

    const result = await submitTaskTool(
      {
        task_id: "task-1",
        output: { summary: "x", changed_files: [] },
        evidence: { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
      },
      logger,
      ledger
    );

    expect(result.isError).toBe(true);
  });
});

describe("routeForReviewTool", () => {
  it("transitions an implemented task to review_required", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    ledger.claimTask("task-1", "agent-1");
    ledger.startTask("task-1");
    ledger.submitTask(
      "task-1",
      { summary: "Done", changed_files: [] },
      { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
    );
    const logger = new MemoryLogger();

    const result = await routeForReviewTool({ task_id: "task-1" }, logger, ledger);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.status).toBe("review_required");
    expect(result.structuredContent?.task_id).toBe("task-1");
  });

  it("returns isError when task does not exist", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const result = await routeForReviewTool({ task_id: "missing" }, logger, ledger);

    expect(result.isError).toBe(true);
    const errorMessages = logger.entries.filter((e) => e.level === "error").map((e) => e.message);
    expect(errorMessages).toContain("tool_invocation_failed");
  });

  it("returns isError when task is not in implemented status", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    const logger = new MemoryLogger();

    const result = await routeForReviewTool({ task_id: "task-1" }, logger, ledger);

    expect(result.isError).toBe(true);
  });

  it("logs started and succeeded events", async () => {
    const ledger = new TaskLedger();
    makeTask(ledger);
    ledger.claimTask("task-1", "agent-1");
    ledger.startTask("task-1");
    ledger.submitTask(
      "task-1",
      { summary: "Done", changed_files: [] },
      { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
    );
    const logger = new MemoryLogger();

    await routeForReviewTool({ task_id: "task-1" }, logger, ledger);

    const messages = logger.entries.map((e) => e.message);
    expect(messages).toContain("tool_invocation_started");
    expect(messages).toContain("tool_invocation_succeeded");
  });
});

describe("full task lifecycle via create_task", () => {
  it("create → claim → start → submit → route_for_review all succeed in sequence", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const created = await createTaskTool(
      {
        id: "task-lifecycle-001",
        story_id: "WB-26",
        spec_id: "spec-WB-26",
        title: "Lifecycle test task",
        type: "backend_api"
      },
      logger,
      ledger,
      "/tmp"
    );
    expect(created.structuredContent.task.status).toBe("pending");
    expect(created.structuredContent.task.id).toBe("task-lifecycle-001");

    const claimed = await claimTaskTool(
      { task_id: "task-lifecycle-001", agent_id: "test-agent" },
      logger,
      ledger
    );
    expect(claimed.isError).toBeUndefined();
    expect(claimed.structuredContent?.status).toBe("claimed");
    expect(claimed.structuredContent?.claimed_by).toBe("test-agent");

    const started = await startTaskTool({ task_id: "task-lifecycle-001" }, logger, ledger);
    expect(started.isError).toBeUndefined();
    expect(started.structuredContent?.status).toBe("in_progress");

    const submitted = await submitTaskTool(
      {
        task_id: "task-lifecycle-001",
        output: {
          summary: "Lifecycle test complete",
          changed_files: ["src/server/tools/create-task.ts"]
        },
        evidence: {
          commands_run: ["npm run build", "npm run test"],
          tests_passed: ["full task lifecycle via create_task"],
          changed_files: ["src/server/tools/create-task.ts"],
          notes: ["create_task enables end-to-end ledger testing"]
        }
      },
      logger,
      ledger
    );
    expect(submitted.isError).toBeUndefined();
    expect(submitted.structuredContent?.task.status).toBe("implemented");

    const routed = await routeForReviewTool({ task_id: "task-lifecycle-001" }, logger, ledger);
    expect(routed.isError).toBeUndefined();
    expect(routed.structuredContent?.status).toBe("review_required");
  });

  it("create_task persists all optional fields when provided", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const created = await createTaskTool(
      {
        id: "task-optional-001",
        story_id: "WB-26",
        spec_id: "spec-WB-26",
        title: "Optional fields test",
        type: "test_coverage",
        tags: ["tag-a"],
        persona: "test_engineer",
        review_persona: "reviewer",
        priority: 2,
        planned_files: ["src/a.ts"],
        ac_refs: ["ac-001"],
        fresh_context_required: true,
        max_attempts: 3
      },
      logger,
      ledger,
      "/tmp"
    );

    const task = created.structuredContent.task;
    expect(task.tags).toEqual(["tag-a"]);
    expect(task.persona).toBe("test_engineer");
    expect(task.review_persona).toBe("reviewer");
    expect(task.priority).toBe(2);
    expect(task.planned_files).toEqual(["src/a.ts"]);
    expect(task.ac_refs).toEqual(["ac-001"]);
    expect(task.fresh_context_required).toBe(true);
    expect(task.max_attempts).toBe(3);
  });
});

describe("createTaskTool file_path", () => {
  const WORKSPACE = "/tmp/wb-test-workspace";

  it("returns file_path equal to resolve(workspacePath, story_id, 'tasks', id + '.md')", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const { structuredContent } = await createTaskTool(
      {
        id: "task-WB-1-001",
        story_id: "WB-1",
        spec_id: "spec-WB-1",
        title: "File path test",
        type: "backend_api"
      },
      logger,
      ledger,
      WORKSPACE
    );

    expect(structuredContent.file_path).toBe(
      resolve(WORKSPACE, "WB-1", "tasks", "task-WB-1-001.md")
    );
  });

  it("file_path reflects different story_id and task id values", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const { structuredContent } = await createTaskTool(
      {
        id: "task-PROJ-5-002",
        story_id: "PROJ-5",
        spec_id: "spec-PROJ-5",
        title: "Another task",
        type: "test_coverage"
      },
      logger,
      ledger,
      WORKSPACE
    );

    expect(structuredContent.file_path).toBe(
      resolve(WORKSPACE, "PROJ-5", "tasks", "task-PROJ-5-002.md")
    );
  });

  it("includes file_path in the text content JSON", async () => {
    const ledger = new TaskLedger();
    const logger = new MemoryLogger();

    const { content } = await createTaskTool(
      {
        id: "task-WB-2-001",
        story_id: "WB-2",
        spec_id: "spec-WB-2",
        title: "JSON test",
        type: "backend_api"
      },
      logger,
      ledger,
      WORKSPACE
    );

    const text = content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { file_path?: string };
    expect(typeof parsed.file_path).toBe("string");
  });
});
