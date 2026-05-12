import { resolve } from "node:path";
import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { FileAdapter, StoryRepository } from "../../repository/index.js";
import { fetchLocalStory } from "../../story-source/local-file.js";
import type { StoryLedger } from "../../story-store/index.js";
import type { Story } from "../../types.js";

/** MCP input schema for the `fetch_story` tool. */
export const fetchStoryInputSchema = {
  source_ref: z.string().min(1).describe("Path to a local Jira/story markdown, YAML, or JSON file.")
};

/** MCP output schema for the `fetch_story` tool. */
export const fetchStoryOutputSchema = {
  story: z.object({
    id: z.string(),
    source_type: z.enum(["jira", "mock", "file"]),
    source_ref: z.string(),
    summary: z.string(),
    description: z.string(),
    raw_ac: z.array(z.string()),
    issue_type: z.enum(["story", "bug", "task", "spike"]),
    priority: z.enum(["critical", "high", "medium", "low"]),
    labels: z.array(z.string()),
    reporter: z.string().nullable(),
    assignee: z.string().nullable(),
    fetched_at: z.string()
  }),
  working_dir: z
    .string()
    .describe(
      "Absolute path to the session working directory (.workbench/<story-id>/). Created by the server."
    )
};

/** Structured return type of the `fetch_story` tool handler. */
export type FetchStoryResult = { story: Story; working_dir: string };

/** Reads and normalizes a local story file into a typed `Story` object. Creates the session working directory as a side effect. Registers the story in the StoryLedger (idempotent). Persists the story via StoryRepository. */
export async function fetchStoryTool(
  args: { source_ref: string },
  logger: Logger,
  workspacePath: string,
  storyLedger: StoryLedger,
  fileAdapter: FileAdapter,
  storyRepo: StoryRepository
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: FetchStoryResult;
}> {
  await logger.info("tool_invocation_started", {
    tool: "fetch_story",
    source_ref: args.source_ref
  });
  const story = await fetchLocalStory(args.source_ref, fileAdapter);
  const working_dir = resolve(workspacePath, story.id);
  await fileAdapter.mkdir(resolve(working_dir, "tasks"), { recursive: true });
  storyLedger.registerStory(story);
  await storyRepo.upsertStory(story);
  const structuredContent: FetchStoryResult = { story, working_dir };
  await logger.info("tool_invocation_succeeded", {
    tool: "fetch_story",
    story_id: story.id,
    working_dir,
    acceptance_criteria_count: story.raw_ac.length
  });
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}
