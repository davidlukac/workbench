import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { TaskLedger } from "../../task-store/index.js";
import type { Evidence, TaskOutput } from "../../types.js";

/** MCP input schema for the `submit_task` tool. */
export const submitTaskInputSchema = {
  task_id: z.string().min(1).describe("ID of the task to submit."),
  output: z
    .object({
      summary: z.string().min(1).describe("Summary of what was implemented."),
      changed_files: z
        .array(z.string())
        .describe("List of files that were changed during implementation.")
    })
    .describe("Task output with summary and changed files."),
  evidence: z
    .object({
      commands_run: z.array(z.string()).describe("Shell commands executed."),
      tests_passed: z.array(z.string()).describe("Test names that passed."),
      changed_files: z.array(z.string()).describe("Actual files modified."),
      notes: z.array(z.string()).describe("Decisions, deviations, open issues.")
    })
    .describe("Evidence of the implementation work.")
};

/** MCP output schema for the `submit_task` tool. */
export const submitTaskOutputSchema = {
  task: z.object({
    id: z.string(),
    story_id: z.string(),
    status: z.string(),
    output: z.object({ summary: z.string(), changed_files: z.array(z.string()) }).nullable(),
    revision: z.number()
  })
};

/** Structured return type of the `submit_task` tool handler. */
export type SubmitTaskResult = {
  task: {
    id: string;
    story_id: string;
    status: string;
    output: TaskOutput | null;
    revision: number;
  };
};

/** Transitions a task from `in_progress` to `implemented`, recording output and evidence. */
export async function submitTaskTool(
  args: { task_id: string; output: TaskOutput; evidence: Evidence },
  logger: Logger,
  ledger: TaskLedger
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: SubmitTaskResult;
  isError?: true;
}> {
  await logger.info("tool_invocation_started", { tool: "submit_task", task_id: args.task_id });

  const result = ledger.submitTask(args.task_id, args.output, args.evidence);

  if (!result.ok) {
    await logger.error("tool_invocation_failed", {
      tool: "submit_task",
      task_id: args.task_id,
      error: result.error.message
    });
    return { content: [{ type: "text", text: result.error.message }], isError: true };
  }

  const task = result.value;
  const structuredContent: SubmitTaskResult = {
    task: {
      id: task.id,
      story_id: task.story_id,
      status: task.status,
      output: task.output,
      revision: task.revision
    }
  };

  await logger.info("tool_invocation_succeeded", {
    tool: "submit_task",
    task_id: task.id,
    status: task.status,
    revision: task.revision
  });

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}
