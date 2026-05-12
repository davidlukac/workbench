import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../src/logging/logger.js";
import { FileSystemFileAdapter } from "../src/repository/index.js";
import { createWorkbenchMcpServer } from "../src/server/index.js";
import { updateStoryStatusTool } from "../src/server/tools/index.js";
import { StoryLedger } from "../src/story-store/index.js";
import type { Story } from "../src/types.js";

const fsAdapter = new FileSystemFileAdapter();

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

const silentLogger: Logger = { info: async () => {}, error: async () => {} };

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "WB-28",
    source_type: "file",
    source_ref: "/nonexistent/WB-28.md",
    summary: "Story status MCP tool",
    description: "Test story.",
    raw_ac: [],
    issue_type: "task",
    priority: "medium",
    labels: [],
    reporter: null,
    assignee: null,
    fetched_at: new Date().toISOString(),
    ...overrides
  };
}

describe("updateStoryStatusTool (handler)", () => {
  it("returns success for a valid transition", async () => {
    const ledger = new StoryLedger();
    ledger.registerStory(makeStory());
    const result = await updateStoryStatusTool(
      { story_id: "WB-28", status: "in_progress" },
      silentLogger,
      ledger,
      fsAdapter
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.status).toBe("in_progress");
    expect(result.structuredContent?.story_id).toBe("WB-28");
    expect(typeof result.structuredContent?.updated_at).toBe("string");
  });

  it("returns isError for an invalid (skip) transition", async () => {
    const ledger = new StoryLedger();
    ledger.registerStory(makeStory());
    ledger.updateStatus("WB-28", "in_progress");
    const result = await updateStoryStatusTool(
      { story_id: "WB-28", status: "done" },
      silentLogger,
      ledger,
      fsAdapter
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("WB-28");
  });

  it("returns isError for unknown story_id", async () => {
    const ledger = new StoryLedger();
    const result = await updateStoryStatusTool(
      { story_id: "UNKNOWN-99", status: "in_progress" },
      silentLogger,
      ledger,
      fsAdapter
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("UNKNOWN-99");
  });

  it("walks the full FSM: todo → in_progress → in_review → done", async () => {
    const ledger = new StoryLedger();
    ledger.registerStory(makeStory());
    for (const status of ["in_progress", "in_review", "done"] as const) {
      const result = await updateStoryStatusTool(
        { story_id: "WB-28", status },
        silentLogger,
        ledger,
        fsAdapter
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent?.status).toBe(status);
    }
  });

  describe("disk sync — plain Markdown source_file", () => {
    let tmpDir: string;
    let sourceFile: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "wb-story-sync-"));
      sourceFile = join(tmpDir, "WB-28.md");
    });

    it("appends Status: line when none exists", async () => {
      await writeFile(sourceFile, "Title: Story status MCP tool\nDescription: A test.\n");
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory({ source_ref: sourceFile }));
      await updateStoryStatusTool(
        { story_id: "WB-28", status: "in_progress" },
        silentLogger,
        ledger,
        fsAdapter
      );
      const content = await readFile(sourceFile, "utf8");
      expect(content).toMatch(/Status:\s*in_progress/i);
    });

    it("replaces existing Status: line", async () => {
      await writeFile(sourceFile, "Title: Story\nDescription: Desc.\nStatus: todo\n");
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory({ source_ref: sourceFile }));
      await updateStoryStatusTool(
        { story_id: "WB-28", status: "in_progress" },
        silentLogger,
        ledger,
        fsAdapter
      );
      const content = await readFile(sourceFile, "utf8");
      expect(content).toMatch(/Status:\s*in_progress/i);
      expect(content).not.toMatch(/Status:\s*todo/i);
    });
  });

  describe("disk sync — YAML frontmatter source_file", () => {
    let tmpDir: string;
    let sourceFile: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), "wb-story-sync-yaml-"));
      sourceFile = join(tmpDir, "WB-28.md");
    });

    it("updates the status: key in YAML frontmatter", async () => {
      await writeFile(sourceFile, "---\nid: WB-28\nstatus: todo\n---\n\n# WB-28\n");
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory({ source_ref: sourceFile }));
      await updateStoryStatusTool(
        { story_id: "WB-28", status: "in_progress" },
        silentLogger,
        ledger,
        fsAdapter
      );
      const content = await readFile(sourceFile, "utf8");
      expect(content).toContain("status: in_progress");
      expect(content).not.toContain("status: todo");
    });

    it("inserts status: key when absent from frontmatter", async () => {
      await writeFile(sourceFile, "---\nid: WB-28\ntitle: Foo\n---\n\n# WB-28\n");
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory({ source_ref: sourceFile }));
      await updateStoryStatusTool(
        { story_id: "WB-28", status: "in_progress" },
        silentLogger,
        ledger,
        fsAdapter
      );
      const content = await readFile(sourceFile, "utf8");
      expect(content).toContain("status: in_progress");
    });
  });

  it("returns isError when status is not a valid StoryStatus value", async () => {
    const logger = new MemoryLogger();
    const ledger = new StoryLedger();
    ledger.registerStory(makeStory());
    const result = await updateStoryStatusTool(
      { story_id: "WB-28", status: "invalid_status" },
      logger,
      ledger,
      fsAdapter
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid status value");
    expect(
      logger.entries.some((e) => e.level === "error" && e.message === "tool_invocation_failed")
    ).toBe(true);
  });

  it("logs sync failure but returns success when source file is read-only", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "wb-story-sync-ro-"));
    const sourceFile = join(tmpDir, "WB-28.md");
    await writeFile(sourceFile, "Title: Story\nDescription: Desc.\n", "utf8");
    await chmod(sourceFile, 0o444);
    const logger = new MemoryLogger();
    const ledger = new StoryLedger();
    ledger.registerStory(makeStory({ source_ref: sourceFile }));
    try {
      const result = await updateStoryStatusTool(
        { story_id: "WB-28", status: "in_progress" },
        logger,
        ledger,
        fsAdapter
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent?.status).toBe("in_progress");
      expect(
        logger.entries.some(
          (e) => e.level === "error" && e.message === "update_story_status_sync_failed"
        )
      ).toBe(true);
    } finally {
      await chmod(sourceFile, 0o644);
    }
  });

  it("returns success even when source_file does not exist (non-fatal sync failure)", async () => {
    const logger = new MemoryLogger();
    const ledger = new StoryLedger();
    ledger.registerStory(makeStory({ source_ref: "/nonexistent/path/WB-28.md" }));
    const result = await updateStoryStatusTool(
      { story_id: "WB-28", status: "in_progress" },
      logger,
      ledger,
      fsAdapter
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.status).toBe("in_progress");
    expect(
      logger.entries.some(
        (e) => e.level === "error" && e.message === "update_story_status_sync_failed"
      )
    ).toBe(true);
  });
});

describe("update_story_status via MCP client", () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.close()));
    clients.length = 0;
  });

  it("is listed in the server's tool list", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "wb-mcp-story-"));
    const server = createWorkbenchMcpServer({ workspacePath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    clients.push(client);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("update_story_status");
  });

  it("returns isError when story has not been fetched first", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "wb-mcp-story-"));
    const server = createWorkbenchMcpServer({ workspacePath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    clients.push(client);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "update_story_status",
      arguments: { story_id: "WB-99", status: "in_progress" }
    });
    expect(result.isError).toBe(true);
  });

  it("transitions story to in_progress after fetch_story seeds the ledger", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "wb-mcp-story-"));
    const tmpDir = await mkdtemp(join(tmpdir(), "wb-mcp-story-src-"));
    const storyFile = join(tmpDir, "WB-55.md");
    await writeFile(
      storyFile,
      "Title: Integration test story\nDescription: A story for MCP integration testing.\n"
    );

    const server = createWorkbenchMcpServer({ workspacePath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    clients.push(client);
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({ name: "fetch_story", arguments: { source_ref: storyFile } });

    const result = await client.callTool({
      name: "update_story_status",
      arguments: { story_id: "WB-55", status: "in_progress" }
    });
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as { story_id: string; status: string };
    expect(data.story_id).toBe("WB-55");
    expect(data.status).toBe("in_progress");
  });
});
