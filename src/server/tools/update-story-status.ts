import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { FileAdapter } from "../../repository/index.js";
import type { StoryLedger } from "../../story-store/index.js";
import { storyStatusSchema } from "../../types.js";

export const updateStoryStatusInputSchema = {
  story_id: z.string().min(1).describe("ID of the story to update."),
  status: storyStatusSchema.describe(
    "New status for the story. Must follow the FSM: todo → in_progress → in_review → done."
  )
};

export const updateStoryStatusOutputSchema = {
  story_id: z.string(),
  status: z.string(),
  updated_at: z.string()
};

export type UpdateStoryStatusResult = {
  story_id: string;
  status: string;
  updated_at: string;
};

async function syncSourceFile(
  source_file: string,
  status: string,
  logger: Logger,
  fileAdapter: FileAdapter
): Promise<void> {
  let raw: string;
  try {
    raw = await fileAdapter.readFile(source_file, "utf8");
  } catch (err) {
    await logger.error("update_story_status_sync_failed", {
      source_file,
      /* v8 ignore next -- fs errors are always Error instances */
      error: err instanceof Error ? err.message : String(err)
    });
    return;
  }

  let updated: string;
  if (raw.trimStart().startsWith("---")) {
    // YAML frontmatter: replace the status: key inside the frontmatter block
    updated = raw.replace(
      /^(---[\s\S]*?)^(status:\s*.*)$/m,
      (_match, before, _statusLine) => `${before}status: ${status}`
    );
    if (updated === raw) {
      // No existing status key in frontmatter — insert after opening ---
      updated = raw.replace(/^---\n/, `---\nstatus: ${status}\n`);
    }
  } else {
    // Plain Markdown: update or append Status: line
    const statusLineRegex = /^Status:\s*.*/im;
    if (statusLineRegex.test(raw)) {
      updated = raw.replace(statusLineRegex, `Status: ${status}`);
    } else {
      updated = `${raw.trimEnd()}\nStatus: ${status}\n`;
    }
  }

  try {
    await fileAdapter.writeFile(source_file, updated);
  } catch (err) {
    await logger.error("update_story_status_sync_failed", {
      source_file,
      /* v8 ignore next -- fs errors are always Error instances */
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export async function updateStoryStatusTool(
  args: { story_id: string; status: string },
  logger: Logger,
  storyLedger: StoryLedger,
  fileAdapter: FileAdapter
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: UpdateStoryStatusResult;
  isError?: true;
}> {
  await logger.info("tool_invocation_started", {
    tool: "update_story_status",
    story_id: args.story_id,
    status: args.status
  });

  const parsed = storyStatusSchema.safeParse(args.status);
  if (!parsed.success) {
    const msg = `Invalid status value: '${args.status}'`;
    await logger.error("tool_invocation_failed", { tool: "update_story_status", error: msg });
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  const result = storyLedger.updateStatus(args.story_id, parsed.data);

  if (!result.ok) {
    await logger.error("tool_invocation_failed", {
      tool: "update_story_status",
      story_id: args.story_id,
      error: result.error.message
    });
    return { content: [{ type: "text", text: result.error.message }], isError: true };
  }

  const entry = result.value;

  if (entry.story.source_type === "file") {
    await syncSourceFile(entry.source_file, entry.status, logger, fileAdapter);
  }

  const structuredContent: UpdateStoryStatusResult = {
    story_id: entry.story.id,
    status: entry.status,
    updated_at: entry.updated_at
  };

  await logger.info("tool_invocation_succeeded", {
    tool: "update_story_status",
    story_id: entry.story.id,
    status: entry.status
  });

  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}
