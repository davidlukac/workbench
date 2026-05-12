import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { TaskLedger } from "../../task-store/index.js";

/** MCP input schema for the `route_for_review` tool. */
export const routeForReviewInputSchema = {
  task_id: z.string().min(1).describe("ID of the task to route for review.")
};

/** MCP output schema for the `route_for_review` tool. */
export const routeForReviewOutputSchema = {
  task_id: z.string(),
  status: z.string(),
  review_persona: z.string().nullable(),
  updated_at: z.string()
};

/** Structured return type of the `route_for_review` tool handler. */
export type RouteForReviewResult = {
  task_id: string;
  status: string;
  review_persona: string | null;
  updated_at: string;
};

/** Transitions a task from `implemented` to `review_required`. */
export async function routeForReviewTool(
  args: { task_id: string },
  logger: Logger,
  ledger: TaskLedger
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: RouteForReviewResult;
  isError?: true;
}> {
  await logger.info("tool_invocation_started", {
    tool: "route_for_review",
    task_id: args.task_id
  });

  const result = ledger.routeForReview(args.task_id);

  if (!result.ok) {
    await logger.error("tool_invocation_failed", {
      tool: "route_for_review",
      task_id: args.task_id,
      error: result.error.message
    });
    return { content: [{ type: "text", text: result.error.message }], isError: true };
  }

  const task = result.value;
  const structuredContent: RouteForReviewResult = {
    task_id: task.id,
    status: task.status,
    review_persona: task.review_persona,
    updated_at: task.updated_at
  };

  await logger.info("tool_invocation_succeeded", {
    tool: "route_for_review",
    task_id: task.id,
    status: task.status
  });

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}
