import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { Logger } from "../src/logging/logger.js";
import { MemorySpecRepository } from "../src/repository/index.js";
import { createWorkbenchMcpServer } from "../src/server/index.js";
import { updateSpecTool } from "../src/server/tools/index.js";

type LogEntry = { level: "info" | "error"; message: string };

class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];
  async info(message: string): Promise<void> {
    this.entries.push({ level: "info", message });
  }
  async error(message: string): Promise<void> {
    this.entries.push({ level: "error", message });
  }
}

const WORKSPACE = "/test-workspace";

describe("updateSpecTool", () => {
  it("persists a valid background field and increments revision", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool(
      { fields: { background: "The background." } },
      logger,
      repo,
      WORKSPACE
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.updated).toEqual(["background"]);
    expect(result.structuredContent?.revision).toBe(1);
    expect(result.structuredContent?.current.background).toBe("The background.");

    const persisted = await repo.readSpec();
    expect(persisted?.background).toBe("The background.");
    expect(persisted?.revision).toBe(1);
  });

  it("rejects unknown fields with reason 'unknown field'", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool(
      { fields: { unknown_field: "x" } },
      logger,
      repo,
      WORKSPACE
    );

    expect(result.structuredContent?.rejected).toEqual([
      { field: "unknown_field", reason: "unknown field" }
    ]);
    expect(result.structuredContent?.updated).toEqual([]);
    expect(result.structuredContent?.revision).toBe(0);
  });

  it("rejects fields with invalid values", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool({ fields: { background: 42 } }, logger, repo, WORKSPACE);

    expect(result.structuredContent?.rejected[0]?.field).toBe("background");
    expect(result.structuredContent?.updated).toEqual([]);
    expect(result.structuredContent?.revision).toBe(0);
  });

  it("includes nested path in rejection reason for invalid array item fields", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool(
      {
        fields: {
          requirements: [
            { id: "REQ-001", description: "Must work", type: "invalid_type", priority: "must" }
          ]
        }
      },
      logger,
      repo,
      WORKSPACE
    );

    const rejected = result.structuredContent?.rejected[0];
    expect(rejected?.field).toBe("requirements");
    expect(rejected?.reason).toMatch(/0\./);
  });

  it("returns isError on stale base_revision", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    await updateSpecTool({ fields: { background: "bg" } }, logger, repo, WORKSPACE);

    const result = await updateSpecTool(
      { base_revision: 0, fields: { background: "new" } },
      logger,
      repo,
      WORKSPACE
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Stale revision");
  });

  it("accepts write when base_revision matches current revision", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    await updateSpecTool({ fields: { background: "first" } }, logger, repo, WORKSPACE);

    const result = await updateSpecTool(
      { base_revision: 1, fields: { background: "second" } },
      logger,
      repo,
      WORKSPACE
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.revision).toBe(2);
    expect(result.structuredContent?.current.background).toBe("second");
  });

  it("increments revision on each successful write", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const r1 = await updateSpecTool({ fields: { background: "first" } }, logger, repo, WORKSPACE);
    expect(r1.structuredContent?.revision).toBe(1);

    const r2 = await updateSpecTool({ fields: { background: "second" } }, logger, repo, WORKSPACE);
    expect(r2.structuredContent?.revision).toBe(2);
  });

  it("does not increment revision when only invalid or unknown fields are sent", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool({ fields: { bad_field: "x" } }, logger, repo, WORKSPACE);
    expect(result.structuredContent?.revision).toBe(0);
  });

  it("handles mixed valid and invalid fields in one call", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool(
      { fields: { background: "Good background.", unknown: "bad" } },
      logger,
      repo,
      WORKSPACE
    );

    expect(result.structuredContent?.updated).toEqual(["background"]);
    expect(result.structuredContent?.rejected).toEqual([
      { field: "unknown", reason: "unknown field" }
    ]);
    expect(result.structuredContent?.revision).toBe(1);
  });

  it("reports completeness as incomplete when required fields are missing", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const r = await updateSpecTool({ fields: { background: "bg" } }, logger, repo, WORKSPACE);

    expect(r.structuredContent?.completeness.complete).toBe(false);
    expect(r.structuredContent?.completeness.missing).toContain("story_id");
    expect(r.structuredContent?.completeness.missing).toContain("goals");
    expect(r.structuredContent?.completeness.missing).toContain("acceptance_criteria");
  });

  it("reports completeness as complete when all required fields are set and non-empty", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    await updateSpecTool(
      { fields: { story_id: "WB-7", background: "bg" } },
      logger,
      repo,
      WORKSPACE
    );
    const r = await updateSpecTool(
      {
        fields: {
          goals: ["Implement update_spec"],
          acceptance_criteria: [
            { id: "ac-001", criterion: "tool works", testable: true, source: "generated" }
          ]
        }
      },
      logger,
      repo,
      WORKSPACE
    );

    expect(r.structuredContent?.completeness.complete).toBe(true);
    expect(r.structuredContent?.completeness.missing).toEqual([]);
  });

  it("treats an empty goals array as missing for completeness", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const r = await updateSpecTool({ fields: { goals: [] } }, logger, repo, WORKSPACE);

    expect(r.structuredContent?.completeness.missing).toContain("goals");
  });

  it("populates completeness.invalid from rejected field names", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const r = await updateSpecTool(
      { fields: { bad: "x", background: 0 } },
      logger,
      repo,
      WORKSPACE
    );

    expect(r.structuredContent?.completeness.invalid).toEqual(
      expect.arrayContaining(["bad", "background"])
    );
  });

  it("persists requirements and open_questions correctly", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool(
      {
        fields: {
          requirements: [
            { id: "REQ-001", description: "Must work", type: "functional", priority: "must" }
          ],
          open_questions: [{ id: "OQ-001", question: "Singleton?", resolved: false, answer: null }]
        }
      },
      logger,
      repo,
      WORKSPACE
    );

    expect(result.structuredContent?.updated).toEqual(
      expect.arrayContaining(["requirements", "open_questions"])
    );
    expect(result.structuredContent?.current.requirements).toHaveLength(1);
    expect(result.structuredContent?.current.open_questions).toHaveLength(1);
  });

  it("logs tool_invocation_started and tool_invocation_succeeded events", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    await updateSpecTool({ fields: { background: "bg" } }, logger, repo, WORKSPACE);

    const messages = logger.entries.map((e) => e.message);
    expect(messages).toContain("tool_invocation_started");
    expect(messages).toContain("tool_invocation_succeeded");
  });

  it("logs tool_invocation_stale_revision as error on revision mismatch", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    await updateSpecTool(
      { base_revision: 99, fields: { background: "bg" } },
      logger,
      repo,
      WORKSPACE
    );

    const errorEntries = logger.entries.filter((e) => e.level === "error");
    expect(errorEntries.map((e) => e.message)).toContain("tool_invocation_stale_revision");
  });

  it("treats null initial spec state as empty spec (revision 0)", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool({ fields: { background: "bg" } }, logger, repo, WORKSPACE);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.revision).toBe(1);
  });

  it("returns spec_file equal to resolve(workspacePath, story_id, 'spec.md') when story_id is set", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();
    const workspacePath = "/custom-workspace";

    const result = await updateSpecTool(
      { fields: { story_id: "WB-5", background: "Some background." } },
      logger,
      repo,
      workspacePath
    );

    expect(result.structuredContent?.spec_file).toBe(`${workspacePath}/WB-5/spec.md`);
  });

  it("returns spec_file as null when story_id is not yet set", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool(
      { fields: { background: "No story_id yet." } },
      logger,
      repo,
      WORKSPACE
    );

    expect(result.structuredContent?.spec_file).toBeNull();
  });

  it("includes spec_file in the text content JSON", async () => {
    const repo = new MemorySpecRepository();
    const logger = new MemoryLogger();

    const result = await updateSpecTool(
      { fields: { story_id: "WB-7", background: "Content." } },
      logger,
      repo,
      WORKSPACE
    );

    const text = result.content[0]?.text ?? "{}";
    const parsed = JSON.parse(text) as { spec_file?: string | null };
    expect(typeof parsed.spec_file).toBe("string");
  });
});

describe("update_spec MCP tool via InMemoryTransport", () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((c) => c.close()));
    clients.length = 0;
  });

  it("is registered and visible in listTools", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workbench-server-"));
    const server = createWorkbenchMcpServer({ workspacePath: dir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    clients.push(client);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("update_spec");
  });

  it("persists a spec field when called via MCP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workbench-server-"));
    const server = createWorkbenchMcpServer({ workspacePath: dir });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    clients.push(client);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({
      name: "update_spec",
      arguments: { fields: { background: "Written via MCP." } }
    });

    expect(result.structuredContent).toMatchObject({
      updated: ["background"],
      revision: 1,
      current: { background: "Written via MCP." }
    });
  });
});
