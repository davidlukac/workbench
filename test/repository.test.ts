import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Logger } from "../src/logging/logger.js";
import {
  FileSystemFileAdapter,
  FileSystemSpecRepository,
  FileSystemStoryRepository,
  FileSystemTaskRepository,
  MemoryFileAdapter,
  MemorySpecRepository,
  MemoryStoryRepository,
  MemoryTaskRepository,
  MultiChannelSpecRepository,
  MultiChannelStoryRepository,
  MultiChannelTaskRepository
} from "../src/repository/index.js";
import type { Story, Task } from "../src/types.js";

function makeStory(id = "WB-1"): Story {
  return {
    id,
    source_type: "file",
    source_ref: `.tasks/${id}.md`,
    summary: "Test story",
    description: "A test story description.",
    raw_ac: [],
    issue_type: "story",
    priority: "medium",
    labels: [],
    reporter: null,
    assignee: null,
    fetched_at: new Date().toISOString()
  };
}

function makeTask(id = "task-WB-1-001", storyId = "WB-1"): Task {
  return {
    id,
    story_id: storyId,
    spec_id: "spec-WB-1",
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
}

type LogEntry = { level: "info" | "error"; message: string; fields?: Record<string, unknown> };

class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];
  async info(message: string, fields?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: "info", message, fields });
  }
  async error(message: string, fields?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: "error", message, fields });
  }
}

// ---------------------------------------------------------------------------
// MemoryFileAdapter
// ---------------------------------------------------------------------------

describe("MemoryFileAdapter", () => {
  it("readFile throws ENOENT for unseeded paths", async () => {
    const adapter = new MemoryFileAdapter();
    await expect(adapter.readFile("/not/seeded")).rejects.toThrow("ENOENT");
  });

  it("seed(path, content) allows readFile to return seeded content", async () => {
    const adapter = new MemoryFileAdapter();
    adapter.seed("/fake/path.md", "hello world");
    expect(await adapter.readFile("/fake/path.md")).toBe("hello world");
  });

  it("writeFile then readFile roundtrip", async () => {
    const adapter = new MemoryFileAdapter();
    await adapter.writeFile("/path/file.txt", "content");
    expect(await adapter.readFile("/path/file.txt")).toBe("content");
  });

  it("mkdir is a no-op and does not throw", async () => {
    const adapter = new MemoryFileAdapter();
    await expect(adapter.mkdir("/any/path", { recursive: true })).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FileSystemFileAdapter
// ---------------------------------------------------------------------------

describe("FileSystemFileAdapter", () => {
  it("writeFile then readFile roundtrip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-fs-file-adapter-"));
    const adapter = new FileSystemFileAdapter();
    await adapter.writeFile(join(dir, "out.txt"), "hello from adapter");
    expect(await adapter.readFile(join(dir, "out.txt"))).toBe("hello from adapter");
  });

  it("mkdir creates the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-fs-file-adapter-"));
    const adapter = new FileSystemFileAdapter();
    const sub = join(dir, "a", "b");
    await adapter.mkdir(sub, { recursive: true });
    await expect(adapter.writeFile(join(sub, "f.txt"), "ok")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MemorySpecRepository
// ---------------------------------------------------------------------------

describe("MemorySpecRepository", () => {
  it("readSpec returns null before any write", async () => {
    const repo = new MemorySpecRepository();
    expect(await repo.readSpec()).toBeNull();
  });

  it("upsertSpec creates a new spec with revision 1", async () => {
    const repo = new MemorySpecRepository();
    const result = await repo.upsertSpec({ story_id: "WB-1", background: "test bg" });
    expect(result.revision).toBe(1);
    expect(result.story_id).toBe("WB-1");
    expect(result.background).toBe("test bg");
  });

  it("upsertSpec merges partial fields and increments revision", async () => {
    const repo = new MemorySpecRepository();
    await repo.upsertSpec({ story_id: "WB-1", background: "original" });
    const result = await repo.upsertSpec({ story_id: "WB-1", goals: ["goal 1"] });
    expect(result.revision).toBe(2);
    expect(result.background).toBe("original");
    expect(result.goals).toEqual(["goal 1"]);
  });

  it("readSpec returns the stored spec", async () => {
    const repo = new MemorySpecRepository();
    await repo.upsertSpec({ story_id: "WB-1", background: "bg" });
    const spec = await repo.readSpec();
    expect(spec?.story_id).toBe("WB-1");
    expect(spec?.background).toBe("bg");
  });

  it("readSpec accepts an optional storyId without error", async () => {
    const repo = new MemorySpecRepository();
    await repo.upsertSpec({ story_id: "WB-1" });
    await expect(repo.readSpec("WB-1")).resolves.not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FileSystemSpecRepository
// ---------------------------------------------------------------------------

describe("FileSystemSpecRepository", () => {
  it("readSpec returns null when file does not exist", async () => {
    const repo = new FileSystemSpecRepository("/nonexistent/spec.json");
    expect(await repo.readSpec()).toBeNull();
  });

  it("readSpec returns null when file contains invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-spec-repo-"));
    const specPath = join(dir, "spec.json");
    await writeFile(specPath, "not json", "utf-8");
    const repo = new FileSystemSpecRepository(specPath);
    expect(await repo.readSpec()).toBeNull();
  });

  it("readSpec returns null when JSON is valid but fails schema validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-spec-repo-"));
    const specPath = join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify({ revision: "not-a-number" }), "utf-8");
    const repo = new FileSystemSpecRepository(specPath);
    expect(await repo.readSpec()).toBeNull();
  });

  it("upsertSpec creates spec and writes to disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-spec-repo-"));
    const repo = new FileSystemSpecRepository(join(dir, "spec.json"));
    const result = await repo.upsertSpec({ story_id: "WB-1", background: "bg" });
    expect(result.revision).toBe(1);
    expect(result.story_id).toBe("WB-1");
  });

  it("upsertSpec merges partial fields on second call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-spec-repo-"));
    const repo = new FileSystemSpecRepository(join(dir, "spec.json"));
    await repo.upsertSpec({ story_id: "WB-1", background: "original" });
    const result = await repo.upsertSpec({ story_id: "WB-1", goals: ["goal 1"] });
    expect(result.revision).toBe(2);
    expect(result.background).toBe("original");
    expect(result.goals).toEqual(["goal 1"]);
  });

  it("readSpec returns stored spec after upsert", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-spec-repo-"));
    const repo = new FileSystemSpecRepository(join(dir, "spec.json"));
    await repo.upsertSpec({ story_id: "WB-2", background: "persisted" });
    const spec = await repo.readSpec();
    expect(spec?.story_id).toBe("WB-2");
    expect(spec?.background).toBe("persisted");
  });
});

// ---------------------------------------------------------------------------
// MultiChannelSpecRepository
// ---------------------------------------------------------------------------

describe("MultiChannelSpecRepository", () => {
  it("upsertSpec writes to primary and secondary", async () => {
    const primary = new MemorySpecRepository();
    const secondary = new MemorySpecRepository();
    const logger = new MemoryLogger();
    const multi = new MultiChannelSpecRepository(logger, primary, secondary);

    await multi.upsertSpec({ story_id: "WB-1", background: "bg" });

    expect((await primary.readSpec())?.background).toBe("bg");
    expect((await secondary.readSpec())?.background).toBe("bg");
  });

  it("readSpec returns primary value", async () => {
    const primary = new MemorySpecRepository();
    const secondary = new MemorySpecRepository();
    const logger = new MemoryLogger();
    const multi = new MultiChannelSpecRepository(logger, primary, secondary);

    await primary.upsertSpec({ story_id: "WB-1", background: "from primary" });
    await secondary.upsertSpec({ story_id: "WB-1", background: "from secondary" });

    expect((await multi.readSpec())?.background).toBe("from primary");
  });

  it("readSpec accepts an optional storyId", async () => {
    const primary = new MemorySpecRepository();
    const logger = new MemoryLogger();
    const multi = new MultiChannelSpecRepository(logger, primary);
    await primary.upsertSpec({ story_id: "WB-1" });
    await expect(multi.readSpec("WB-1")).resolves.not.toBeNull();
  });

  it("secondary upsertSpec failure logs error but does not throw", async () => {
    const primary = new MemorySpecRepository();
    const logger = new MemoryLogger();
    const failingSecondary: import("../src/repository/index.js").SpecRepository = {
      readSpec: async () => null,
      upsertSpec: async () => {
        throw new Error("secondary down");
      }
    };
    const multi = new MultiChannelSpecRepository(logger, primary, failingSecondary);

    await expect(multi.upsertSpec({ story_id: "WB-1", background: "bg" })).resolves.toBeDefined();

    const errors = logger.entries.filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toBe("repository_secondary_write_failed");
    expect(String(errors[0]?.fields?.error)).toContain("secondary down");
  });
});

// ---------------------------------------------------------------------------
// MemoryStoryRepository
// ---------------------------------------------------------------------------

describe("MemoryStoryRepository", () => {
  it("findStory returns null when empty", async () => {
    const repo = new MemoryStoryRepository();
    expect(await repo.findStory("WB-1")).toBeNull();
  });

  it("upsertStory stores and retrieves a story", async () => {
    const repo = new MemoryStoryRepository();
    const story = makeStory("WB-2");
    await repo.upsertStory(story);
    expect(await repo.findStory("WB-2")).toEqual(story);
  });

  it("upsertStory stores a deep copy — mutation does not affect stored value", async () => {
    const repo = new MemoryStoryRepository();
    const story = makeStory("WB-3");
    await repo.upsertStory(story);
    story.summary = "mutated";
    const found = await repo.findStory("WB-3");
    expect(found?.summary).toBe("Test story");
  });
});

// ---------------------------------------------------------------------------
// FileSystemStoryRepository
// ---------------------------------------------------------------------------

describe("FileSystemStoryRepository", () => {
  it("findStory returns null for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-stories-"));
    const repo = new FileSystemStoryRepository(dir);
    expect(await repo.findStory("missing")).toBeNull();
  });

  it("findStory returns null when JSON is valid but fails schema validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-stories-"));
    await writeFile(join(dir, "WB-1.json"), JSON.stringify({ not_a_story: true }), "utf-8");
    const repo = new FileSystemStoryRepository(dir);
    expect(await repo.findStory("WB-1")).toBeNull();
  });

  it("upsertStory writes and findStory reads back the story", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-stories-"));
    const repo = new FileSystemStoryRepository(dir);
    const story = makeStory("WB-5");
    await repo.upsertStory(story);
    expect(await repo.findStory("WB-5")).toEqual(story);
  });

  it("upsertStory creates the directory if it does not exist", async () => {
    const base = await mkdtemp(join(tmpdir(), "wb-stories-"));
    const dir = join(base, "nested", "stories");
    const repo = new FileSystemStoryRepository(dir);
    const story = makeStory("WB-6");
    await repo.upsertStory(story);
    expect(await repo.findStory("WB-6")).toEqual(story);
  });
});

// ---------------------------------------------------------------------------
// MultiChannelStoryRepository
// ---------------------------------------------------------------------------

describe("MultiChannelStoryRepository", () => {
  it("upsertStory fans out to all channels", async () => {
    const logger = new MemoryLogger();
    const primary = new MemoryStoryRepository();
    const secondary = new MemoryStoryRepository();
    const multi = new MultiChannelStoryRepository(logger, primary, secondary);

    const story = makeStory("WB-7");
    await multi.upsertStory(story);

    expect(await primary.findStory("WB-7")).toEqual(story);
    expect(await secondary.findStory("WB-7")).toEqual(story);
  });

  it("findStory reads from primary only", async () => {
    const logger = new MemoryLogger();
    const primary = new MemoryStoryRepository();
    const secondary = new MemoryStoryRepository();
    const multi = new MultiChannelStoryRepository(logger, primary, secondary);

    const story = makeStory("WB-8");
    await primary.upsertStory(story);

    expect(await multi.findStory("WB-8")).toEqual(story);
    expect(await secondary.findStory("WB-8")).toBeNull();
  });

  it("upsertStory logs secondary failures and continues", async () => {
    const logger = new MemoryLogger();
    const primary = new MemoryStoryRepository();
    const failingSecondary: import("../src/repository/story-repository.js").StoryRepository = {
      upsertStory: async () => {
        throw new Error("story secondary down");
      },
      findStory: async () => null
    };
    const multi = new MultiChannelStoryRepository(logger, primary, failingSecondary);

    await expect(multi.upsertStory(makeStory("WB-9"))).resolves.toBeUndefined();

    const errors = logger.entries.filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toBe("repository_secondary_write_failed");
    expect(String(errors[0]?.fields?.error)).toContain("story secondary down");
  });
});

// ---------------------------------------------------------------------------
// MemoryTaskRepository
// ---------------------------------------------------------------------------

describe("MemoryTaskRepository", () => {
  it("findTask returns null when empty", async () => {
    const repo = new MemoryTaskRepository();
    expect(await repo.findTask("task-WB-1-001")).toBeNull();
  });

  it("upsertTask stores and retrieves a task", async () => {
    const repo = new MemoryTaskRepository();
    const task = makeTask("task-WB-1-001");
    await repo.upsertTask(task);
    expect(await repo.findTask("task-WB-1-001")).toEqual(task);
  });

  it("upsertTask stores a deep copy — mutation does not affect stored value", async () => {
    const repo = new MemoryTaskRepository();
    const task = makeTask("task-WB-1-002");
    await repo.upsertTask(task);
    task.title = "mutated";
    expect((await repo.findTask("task-WB-1-002"))?.title).toBe("Test task");
  });

  it("listTasks returns tasks filtered by storyId", async () => {
    const repo = new MemoryTaskRepository();
    await repo.upsertTask(makeTask("task-WB-1-001", "WB-1"));
    await repo.upsertTask(makeTask("task-WB-2-001", "WB-2"));
    const tasks = await repo.listTasks("WB-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task-WB-1-001");
  });

  it("listTasks returns empty array when no tasks match", async () => {
    const repo = new MemoryTaskRepository();
    await repo.upsertTask(makeTask("task-WB-1-001", "WB-1"));
    expect(await repo.listTasks("WB-99")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// FileSystemTaskRepository
// ---------------------------------------------------------------------------

describe("FileSystemTaskRepository", () => {
  it("findTask returns null for a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-tasks-"));
    const repo = new FileSystemTaskRepository(dir);
    expect(await repo.findTask("missing")).toBeNull();
  });

  it("findTask returns null when JSON is valid but fails schema validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-tasks-"));
    await writeFile(join(dir, "bad.json"), JSON.stringify({ not_a_task: true }), "utf-8");
    const repo = new FileSystemTaskRepository(dir);
    expect(await repo.findTask("bad")).toBeNull();
  });

  it("upsertTask writes and findTask reads back the task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-tasks-"));
    const repo = new FileSystemTaskRepository(dir);
    const task = makeTask("task-WB-1-001");
    await repo.upsertTask(task);
    expect(await repo.findTask("task-WB-1-001")).toEqual(task);
  });

  it("listTasks returns empty array when directory does not exist", async () => {
    const repo = new FileSystemTaskRepository("/tmp/no-such-dir-wb-test");
    expect(await repo.listTasks("WB-1")).toEqual([]);
  });

  it("listTasks returns tasks filtered by storyId", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-tasks-"));
    const repo = new FileSystemTaskRepository(dir);
    await repo.upsertTask(makeTask("task-WB-1-001", "WB-1"));
    await repo.upsertTask(makeTask("task-WB-2-001", "WB-2"));
    const tasks = await repo.listTasks("WB-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe("task-WB-1-001");
  });

  it("listTasks skips non-json files in the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-tasks-"));
    const repo = new FileSystemTaskRepository(dir);
    await writeFile(join(dir, "README.md"), "ignore me", "utf-8");
    await repo.upsertTask(makeTask("task-WB-1-001", "WB-1"));
    const tasks = await repo.listTasks("WB-1");
    expect(tasks).toHaveLength(1);
  });

  it("listTasks skips entries where task schema fails validation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-tasks-"));
    await writeFile(join(dir, "corrupt.json"), JSON.stringify({ not_a_task: true }), "utf-8");
    const repo = new FileSystemTaskRepository(dir);
    const tasks = await repo.listTasks("WB-1");
    expect(tasks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MultiChannelTaskRepository
// ---------------------------------------------------------------------------

describe("MultiChannelTaskRepository", () => {
  it("upsertTask fans out to all channels", async () => {
    const logger = new MemoryLogger();
    const primary = new MemoryTaskRepository();
    const secondary = new MemoryTaskRepository();
    const multi = new MultiChannelTaskRepository(logger, primary, secondary);

    const task = makeTask("task-WB-1-001");
    await multi.upsertTask(task);

    expect(await primary.findTask("task-WB-1-001")).toEqual(task);
    expect(await secondary.findTask("task-WB-1-001")).toEqual(task);
  });

  it("findTask reads from primary only", async () => {
    const logger = new MemoryLogger();
    const primary = new MemoryTaskRepository();
    const secondary = new MemoryTaskRepository();
    const multi = new MultiChannelTaskRepository(logger, primary, secondary);

    const task = makeTask("task-WB-1-002");
    await primary.upsertTask(task);

    expect(await multi.findTask("task-WB-1-002")).toEqual(task);
    expect(await secondary.findTask("task-WB-1-002")).toBeNull();
  });

  it("listTasks reads from primary only", async () => {
    const logger = new MemoryLogger();
    const primary = new MemoryTaskRepository();
    const secondary = new MemoryTaskRepository();
    const multi = new MultiChannelTaskRepository(logger, primary, secondary);

    await primary.upsertTask(makeTask("task-WB-1-003", "WB-1"));

    expect(await multi.listTasks("WB-1")).toHaveLength(1);
    expect(await secondary.listTasks("WB-1")).toHaveLength(0);
  });

  it("upsertTask logs secondary failures and continues", async () => {
    const logger = new MemoryLogger();
    const primary = new MemoryTaskRepository();
    const failingSecondary: import("../src/repository/task-repository.js").TaskRepository = {
      upsertTask: async () => {
        throw new Error("task secondary down");
      },
      findTask: async () => null,
      listTasks: async () => []
    };
    const multi = new MultiChannelTaskRepository(logger, primary, failingSecondary);

    await expect(multi.upsertTask(makeTask("task-WB-1-004"))).resolves.toBeUndefined();

    const errors = logger.entries.filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toBe("repository_secondary_write_failed");
    expect(String(errors[0]?.fields?.error)).toContain("task secondary down");
  });
});
