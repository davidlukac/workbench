import { resolve } from "node:path";
import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { TaskLedger } from "../../task-store/index.js";
import { taskSchema } from "../../types.js";
import type { Task } from "../../types.js";

/** MCP input schema for the `create_task` tool. */
export const createTaskInputSchema = {
  id: z.string().min(1).describe("Unique task ID, e.g. task-WB-1-001."),
  story_id: z.string().min(1).describe("ID of the parent story."),
  spec_id: z.string().min(1).describe("ID of the associated spec."),
  title: z.string().min(1).describe("Short human-readable task title."),
  type: z.string().min(1).describe("Task type, e.g. backend_api, test_coverage."),
  tags: z.array(z.string()).optional().describe("Optional tags for sub-type detail."),
  persona: z.string().nullable().optional().describe("Persona to execute this task."),
  review_persona: z.string().nullable().optional().describe("Persona to review this task."),
  priority: z.number().int().min(1).optional().describe("Priority (1 = highest)."),
  planned_files: z.array(z.string()).optional().describe("Files this task is expected to modify."),
  ac_refs: z.array(z.string()).optional().describe("Acceptance criteria IDs this task satisfies."),
  fresh_context_required: z
    .boolean()
    .optional()
    .describe("Whether the agent needs an isolated context."),
  max_attempts: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum review-retry attempts before failing.")
};

/** MCP output schema for the `create_task` tool. */
export const createTaskOutputSchema = {
  task: taskSchema,
  file_path: z
    .string()
    .describe(
      "Absolute path where the agent should write the task Markdown file (.workbench/<story-id>/tasks/<task-id>.md)."
    )
};

/** Structured return type of the `create_task` tool handler. */
export type CreateTaskResult = { task: Task; file_path: string };

/** Creates a task in the in-memory ledger with `status: pending`. Seeds the ledger for lifecycle tool testing. */
export async function createTaskTool(
  args: {
    id: string;
    story_id: string;
    spec_id: string;
    title: string;
    type: string;
    tags?: string[] | undefined;
    persona?: string | null | undefined;
    review_persona?: string | null | undefined;
    priority?: number | undefined;
    planned_files?: string[] | undefined;
    ac_refs?: string[] | undefined;
    fresh_context_required?: boolean | undefined;
    max_attempts?: number | undefined;
  },
  logger: Logger,
  ledger: TaskLedger,
  workspacePath: string
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: CreateTaskResult;
}> {
  await logger.info("tool_invocation_started", {
    tool: "create_task",
    task_id: args.id,
    story_id: args.story_id
  });

  const input: Parameters<TaskLedger["createTask"]>[0] = {
    id: args.id,
    story_id: args.story_id,
    spec_id: args.spec_id,
    title: args.title,
    type: args.type,
    ...(args.tags !== undefined && { tags: args.tags }),
    ...(args.persona !== undefined && { persona: args.persona }),
    ...(args.review_persona !== undefined && { review_persona: args.review_persona }),
    ...(args.priority !== undefined && { priority: args.priority }),
    ...(args.planned_files !== undefined && { planned_files: args.planned_files }),
    ...(args.ac_refs !== undefined && { ac_refs: args.ac_refs }),
    ...(args.fresh_context_required !== undefined && {
      fresh_context_required: args.fresh_context_required
    }),
    ...(args.max_attempts !== undefined && { max_attempts: args.max_attempts })
  };
  const task = ledger.createTask(input);
  const file_path = resolve(workspacePath, task.story_id, "tasks", `${task.id}.md`);
  const structuredContent: CreateTaskResult = { task, file_path };

  await logger.info("tool_invocation_succeeded", {
    tool: "create_task",
    task_id: task.id,
    status: task.status,
    file_path
  });

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}
