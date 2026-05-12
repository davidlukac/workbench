import type { Evidence, Result, Task, TaskOutput } from "../types.js";

type CreateTaskInput = {
  id: string;
  story_id: string;
  spec_id: string;
  title: string;
  type: string;
  tags?: string[];
  persona?: string | null;
  review_persona?: string | null;
  priority?: number;
  dependencies?: Task["dependencies"];
  planned_files?: string[];
  ac_refs?: string[];
  fresh_context_required?: boolean;
  max_attempts?: number;
};

export class TaskLedger {
  readonly #tasks = new Map<string, Task>();

  createTask(input: CreateTaskInput): Task {
    const ts = new Date().toISOString();
    const task: Task = {
      id: input.id,
      story_id: input.story_id,
      spec_id: input.spec_id,
      title: input.title,
      type: input.type,
      tags: input.tags ?? [],
      persona: input.persona ?? null,
      review_persona: input.review_persona ?? null,
      status: "pending",
      priority: input.priority ?? 1,
      dependencies: input.dependencies ?? [],
      planned_files: input.planned_files ?? [],
      ac_refs: input.ac_refs ?? [],
      fresh_context_required: input.fresh_context_required ?? false,
      claimed_by: null,
      lock: null,
      attempt_count: 0,
      max_attempts: input.max_attempts ?? 2,
      output: null,
      evidence: { commands_run: [], tests_passed: [], changed_files: [], notes: [] },
      error: null,
      revision: 0,
      created_at: ts,
      updated_at: ts,
      completed_at: null
    };
    this.#tasks.set(task.id, task);
    return task;
  }

  addTask(task: Task): void {
    this.#tasks.set(task.id, task);
  }

  getTask(task_id: string): Task | undefined {
    return this.#tasks.get(task_id);
  }

  getPendingTasks(): Task[] {
    return [...this.#tasks.values()].filter((t) => t.status === "pending");
  }

  getClaimedTasks(): Task[] {
    return [...this.#tasks.values()].filter((t) => t.status === "claimed");
  }

  claimTask(task_id: string, agent_id: string, at?: Date): Result<Task> {
    const task = this.#tasks.get(task_id);
    if (!task) {
      return { ok: false, error: new Error(`Task not found: ${task_id}`) };
    }
    if (task.status !== "pending") {
      return {
        ok: false,
        error: new Error(
          `Cannot claim task ${task_id}: expected pending but current status is '${task.status}'`
        )
      };
    }
    const base = at ?? new Date();
    const expires_at = new Date(base.getTime() + 30 * 60 * 1000).toISOString();
    const updated_at = base.toISOString();
    const updated: Task = {
      ...task,
      status: "claimed",
      claimed_by: agent_id,
      lock: { owner: agent_id, expires_at },
      revision: task.revision + 1,
      updated_at
    };
    this.#tasks.set(task_id, updated);
    return { ok: true, value: updated };
  }

  startTask(task_id: string): Result<Task> {
    const task = this.#tasks.get(task_id);
    if (!task) {
      return { ok: false, error: new Error(`Task not found: ${task_id}`) };
    }
    if (task.status !== "claimed") {
      return {
        ok: false,
        error: new Error(
          `start_task requires status 'claimed', but task ${task_id} has status '${task.status}'`
        )
      };
    }
    const updated: Task = {
      ...task,
      status: "in_progress",
      lock: null,
      revision: task.revision + 1,
      updated_at: new Date().toISOString()
    };
    this.#tasks.set(task_id, updated);
    return { ok: true, value: updated };
  }

  submitTask(task_id: string, output: TaskOutput, evidence: Evidence): Result<Task> {
    const task = this.#tasks.get(task_id);
    if (!task) {
      return { ok: false, error: new Error(`Task not found: ${task_id}`) };
    }
    if (task.status !== "in_progress" && task.status !== "claimed") {
      return {
        ok: false,
        error: new Error(
          `submit_task requires status 'in_progress' or 'claimed', but task ${task_id} has status '${task.status}'`
        )
      };
    }
    const updated: Task = {
      ...task,
      status: "implemented",
      output,
      evidence,
      lock: null,
      revision: task.revision + 1,
      updated_at: new Date().toISOString()
    };
    this.#tasks.set(task_id, updated);
    return { ok: true, value: updated };
  }

  routeForReview(task_id: string): Result<Task> {
    const task = this.#tasks.get(task_id);
    if (!task) {
      return { ok: false, error: new Error(`Task not found: ${task_id}`) };
    }
    if (task.status !== "implemented") {
      return {
        ok: false,
        error: new Error(
          `route_for_review requires status 'implemented', but task ${task_id} has status '${task.status}'`
        )
      };
    }
    const updated: Task = {
      ...task,
      status: "review_required",
      revision: task.revision + 1,
      updated_at: new Date().toISOString()
    };
    this.#tasks.set(task_id, updated);
    return { ok: true, value: updated };
  }
}
