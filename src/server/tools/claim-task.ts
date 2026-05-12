import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { TaskLedger } from "../../task-store/index.js";

/** MCP input schema for the `claim_task` tool. */
export const claimTaskInputSchema = {
  task_id: z.string().min(1).describe("ID of the task to claim."),
  agent_id: z.string().min(1).describe("ID of the agent claiming the task.")
};

/** MCP output schema for the `claim_task` tool. */
export const claimTaskOutputSchema = {
  task_id: z.string(),
  status: z.literal("claimed"),
  claimed_by: z.string(),
  lock: z.object({ owner: z.string(), expires_at: z.string() }),
  revision: z.number()
};

/** Structured return type of the `claim_task` tool handler. */
export type ClaimTaskResult = {
  task_id: string;
  status: "claimed";
  claimed_by: string;
  lock: { owner: string; expires_at: string };
  revision: number;
};

/** Transitions a task from `pending` to `claimed`, setting `claimed_by` and a 30-minute lock. */
export async function claimTaskTool(
  args: { task_id: string; agent_id: string },
  logger: Logger,
  ledger: TaskLedger
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: ClaimTaskResult;
  isError?: true;
}> {
  await logger.info("tool_invocation_started", {
    tool: "claim_task",
    task_id: args.task_id,
    agent_id: args.agent_id
  });

  const result = ledger.claimTask(args.task_id, args.agent_id);

  if (!result.ok) {
    await logger.error("tool_invocation_failed", {
      tool: "claim_task",
      task_id: args.task_id,
      error: result.error.message
    });
    return { content: [{ type: "text", text: result.error.message }], isError: true };
  }

  const task = result.value;
  const structuredContent: ClaimTaskResult = {
    task_id: task.id,
    status: "claimed",
    // biome-ignore lint/style/noNonNullAssertion: claimTask guarantees claimed_by and lock are non-null on success
    claimed_by: task.claimed_by!,
    // biome-ignore lint/style/noNonNullAssertion: claimTask guarantees claimed_by and lock are non-null on success
    lock: { owner: task.lock!.owner, expires_at: task.lock!.expires_at },
    revision: task.revision
  };

  await logger.info("tool_invocation_succeeded", {
    tool: "claim_task",
    task_id: task.id,
    revision: task.revision
  });

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}
