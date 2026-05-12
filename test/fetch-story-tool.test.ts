import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../src/logging/logger.js";
import { MemoryFileAdapter, MemoryStoryRepository } from "../src/repository/index.js";
import { fetchStoryTool } from "../src/server/tools/index.js";
import { StoryLedger } from "../src/story-store/index.js";

const logger: Logger = { info: async () => {}, error: async () => {} };

const MINIMAL_STORY = "Title: Test Story\nDescription: A minimal story for testing.\n";
const WORKSPACE = "/test-workspace";

function makeAdapters(
  storyFileName: string,
  content: string
): { fileAdapter: MemoryFileAdapter; storyRepo: MemoryStoryRepository } {
  const fileAdapter = new MemoryFileAdapter();
  fileAdapter.seed(resolve(storyFileName), content);
  return { fileAdapter, storyRepo: new MemoryStoryRepository() };
}

describe("fetchStoryTool", () => {
  it("returns working_dir equal to resolve(workspacePath, story.id)", async () => {
    const storyFile = "test/WB-99.md";
    const storyLedger = new StoryLedger();
    const { fileAdapter, storyRepo } = makeAdapters(storyFile, MINIMAL_STORY);

    const { structuredContent } = await fetchStoryTool(
      { source_ref: storyFile },
      logger,
      WORKSPACE,
      storyLedger,
      fileAdapter,
      storyRepo
    );

    expect(structuredContent.working_dir).toBe(resolve(WORKSPACE, "WB-99"));
  });

  it("does not throw when creating the working directory (mkdir is delegated to fileAdapter)", async () => {
    const storyFile = "test/WB-99.md";
    const storyLedger = new StoryLedger();
    const { fileAdapter, storyRepo } = makeAdapters(storyFile, MINIMAL_STORY);

    await expect(
      fetchStoryTool(
        { source_ref: storyFile },
        logger,
        WORKSPACE,
        storyLedger,
        fileAdapter,
        storyRepo
      )
    ).resolves.toBeDefined();
  });

  it("is idempotent — does not throw when called twice on the same story", async () => {
    const storyFile = "test/WB-99.md";
    const storyLedger = new StoryLedger();
    const { fileAdapter, storyRepo } = makeAdapters(storyFile, MINIMAL_STORY);

    await fetchStoryTool(
      { source_ref: storyFile },
      logger,
      WORKSPACE,
      storyLedger,
      fileAdapter,
      storyRepo
    );
    await expect(
      fetchStoryTool(
        { source_ref: storyFile },
        logger,
        WORKSPACE,
        storyLedger,
        fileAdapter,
        storyRepo
      )
    ).resolves.toBeDefined();
  });

  it("includes working_dir in the text content JSON", async () => {
    const storyFile = "test/WB-99.md";
    const storyLedger = new StoryLedger();
    const { fileAdapter, storyRepo } = makeAdapters(storyFile, MINIMAL_STORY);

    const { content } = await fetchStoryTool(
      { source_ref: storyFile },
      logger,
      WORKSPACE,
      storyLedger,
      fileAdapter,
      storyRepo
    );

    const text = content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { working_dir?: string };
    expect(typeof parsed.working_dir).toBe("string");
  });

  it("still returns all story fields unchanged", async () => {
    const storyFile = "test/WB-42.md";
    const storyLedger = new StoryLedger();
    const fileAdapter = new MemoryFileAdapter();
    fileAdapter.seed(resolve(storyFile), "Title: My Story\nDescription: My description.\n");
    const storyRepo = new MemoryStoryRepository();

    const { structuredContent } = await fetchStoryTool(
      { source_ref: storyFile },
      logger,
      WORKSPACE,
      storyLedger,
      fileAdapter,
      storyRepo
    );

    expect(structuredContent.story.id).toBe("WB-42");
    expect(structuredContent.story.summary).toBe("My Story");
    expect(structuredContent.story.source_type).toBe("file");
  });

  it("persists the story via storyRepo.upsertStory", async () => {
    const storyFile = "test/WB-55.md";
    const storyLedger = new StoryLedger();
    const { fileAdapter, storyRepo } = makeAdapters(storyFile, MINIMAL_STORY);

    await fetchStoryTool(
      { source_ref: storyFile },
      logger,
      WORKSPACE,
      storyLedger,
      fileAdapter,
      storyRepo
    );

    expect(await storyRepo.findStory("WB-55")).not.toBeNull();
  });
});
