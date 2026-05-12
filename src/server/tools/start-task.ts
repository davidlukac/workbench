import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { TaskLedger } from "../../task-store/index.js";

/** MCP input schema for the `start_task` tool. */
export const startTaskInputSchema = {
  task_id: z.string().min(1).describe("ID of the task to start.")
};

/** MCP output schema for the `start_task` tool. */
export const startTaskOutputSchema = {
  task_id: z.string(),
  status: z.literal("in_progress"),
  revision: z.number()
};

/** Structured return type of the `start_task` tool handler. */
export type StartTaskResult = {
  task_id: string;
  status: "in_progress";
  revision: number;
};

/** Transitions a task from `claimed` to `in_progress`. Requires a prior `claim_task` call. */
export async function startTaskTool(
  args: { task_id: string },
  logger: Logger,
  ledger: TaskLedger
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: StartTaskResult;
  isError?: true;
}> {
  await logger.info("tool_invocation_started", { tool: "start_task", task_id: args.task_id });

  const result = ledger.startTask(args.task_id);

  if (!result.ok) {
    await logger.error("tool_invocation_failed", {
      tool: "start_task",
      task_id: args.task_id,
      error: result.error.message
    });
    return { content: [{ type: "text", text: result.error.message }], isError: true };
  }

  const task = result.value;
  const structuredContent: StartTaskResult = {
    task_id: task.id,
    status: "in_progress",
    revision: task.revision
  };

  await logger.info("tool_invocation_succeeded", {
    tool: "start_task",
    task_id: task.id,
    revision: task.revision
  });

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}
