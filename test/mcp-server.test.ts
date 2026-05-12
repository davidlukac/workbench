import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../src/logging/logger.js";
import {
  type ProcessSignalHooks,
  type WorkbenchServer,
  createWorkbenchMcpServer,
  runMcpServer
} from "../src/server/index.js";

type LogEntry = {
  level: "info" | "error";
  message: string;
  fields?: Record<string, unknown>;
};

class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];

  async info(message: string, fields?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: "info", message, fields });
  }

  async error(message: string, fields?: Record<string, unknown>): Promise<void> {
    this.entries.push({ level: "error", message, fields });
  }
}

class FakeTransport {
  started = false;
  closed = false;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {
    this.started = true;
  }

  async send(): Promise<void> {}

  async close(): Promise<void> {
    this.closed = true;
    this.onclose?.();
  }
}

describe("Workbench MCP server", () => {
  const clients: Client[] = [];

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.close()));
    clients.length = 0;
  });

  it("can be constructed with its default logger", () => {
    expect(createWorkbenchMcpServer()).toBeDefined();
  });

  it("exposes server info and fetch_story over MCP", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "workbench-server-"));
    const logger = new MemoryLogger();
    const server = createWorkbenchMcpServer({ logger, workspacePath });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "workbench-test-client", version: "0.1.0" });
    clients.push(client);

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("fetch_story");

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      "workbench://server/info"
    );

    const info = await client.readResource({ uri: "workbench://server/info" });
    expect(info.contents[0]).toMatchObject({
      uri: "workbench://server/info",
      mimeType: "application/json"
    });

    const result = await client.callTool({
      name: "fetch_story",
      arguments: {
        source_ref: "test/fixtures/WB-2.md"
      }
    });

    expect(result.structuredContent).toMatchObject({
      story: {
        id: "WB-2",
        source_type: "file",
        summary: "Minimal MCP server implementation"
      },
      working_dir: expect.stringContaining("WB-2")
    });
    expect(logger.entries.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        "resource_read",
        "tool_invocation_started",
        "tool_invocation_succeeded"
      ])
    );
  });

  it("runs with injected transport and handles shutdown signals", async () => {
    const logger = new MemoryLogger();
    const transport = new FakeTransport();
    const handlers = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void | Promise<void>>();
    const exits: number[] = [];
    const processHooks: ProcessSignalHooks = {
      once: (signal, handler) => handlers.set(signal, handler),
      exit: (code) => {
        exits.push(code ?? 0);
      }
    };

    await runMcpServer({
      configPath: ".workbench.yaml",
      logger,
      transport,
      processHooks
    });

    expect(transport.started).toBe(true);
    expect(handlers.has("SIGINT")).toBe(true);
    expect(handlers.has("SIGTERM")).toBe(true);
    expect(logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "server_connected",
          fields: expect.objectContaining({ transport: "stdio", dev: false })
        })
      ])
    );

    await handlers.get("SIGINT")?.("SIGINT");

    expect(transport.closed).toBe(true);
    expect(exits).toEqual([0]);
    expect(logger.entries.map((entry) => entry.message)).toEqual(
      expect.arrayContaining(["server_shutdown_started", "server_shutdown_completed"])
    );
  });

  it("logs and throws on invalid server config", async () => {
    const logger = new MemoryLogger();

    await expect(
      runMcpServer({
        configPath: "/tmp/workbench-missing-config.yaml",
        logger,
        transport: new FakeTransport()
      })
    ).rejects.toThrow("Invalid Workbench config:");

    expect(logger.entries).toEqual([
      expect.objectContaining({
        level: "error",
        message: "server_config_invalid"
      })
    ]);
  });

  it("creates a logger from server options when one is not injected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workbench-server-"));
    const logFile = join(dir, "mcp.log");
    const transport = new FakeTransport();
    const processHooks: ProcessSignalHooks = {
      once: () => {},
      exit: () => {}
    };

    await runMcpServer({
      configPath: ".workbench.yaml",
      dev: false,
      logFile,
      transport,
      processHooks
    });

    await expect(readFile(logFile, "utf8")).resolves.toContain('"message":"server_connected"');
  });

  it("passes workspacePath to createWorkbenchMcpServer when provided", async () => {
    const logger = new MemoryLogger();
    const transport = new FakeTransport();
    const processHooks: ProcessSignalHooks = {
      once: () => {},
      exit: () => {}
    };

    await runMcpServer({
      configPath: ".workbench.yaml",
      logger,
      transport,
      processHooks,
      workspacePath: "/tmp/workbench-test-ws"
    });

    expect(transport.started).toBe(true);
  });
});

describe("WorkbenchServer — direct callTool / callResource API", () => {
  let server: WorkbenchServer;
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "wb-api-"));
    server = createWorkbenchMcpServer({ workspacePath });
  });

  it("listTools returns metadata for all registered tools", () => {
    const tools = server.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "fetch_story",
        "update_spec",
        "claim_task",
        "start_task",
        "submit_task",
        "route_for_review",
        "create_task",
        "update_story_status"
      ])
    );
    const first = tools[0];
    expect(first?.fields).toBeDefined();
    expect(typeof first?.description).toBe("string");
  });

  it("callTool returns isError for an unknown tool name", async () => {
    const result = await server.callTool("no_such_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("no_such_tool");
  });

  const invalidArgsCases: [string, Record<string, unknown>][] = [
    ["fetch_story", {}],
    ["update_spec", { base_revision: "not-a-number" }],
    ["claim_task", {}],
    ["start_task", {}],
    ["submit_task", {}],
    ["route_for_review", {}],
    ["create_task", {}],
    ["update_story_status", {}]
  ];

  it.each(invalidArgsCases)(
    "callTool('%s') returns isError for invalid args",
    async (toolName, args) => {
      const result = await server.callTool(toolName, args);
      expect(result.isError).toBe(true);
    }
  );

  it("callTool fetch_story succeeds with a valid fixture file", async () => {
    const result = await server.callTool("fetch_story", { source_ref: "test/fixtures/WB-2.md" });
    expect(result.isError).toBeUndefined();
    const data = result.structuredContent as { story: { id: string } };
    expect(data.story.id).toBe("WB-2");
  });

  it("callTool update_spec succeeds with valid fields", async () => {
    const result = await server.callTool("update_spec", {
      fields: { background: "test background" }
    });
    expect(result.isError).toBeUndefined();
  });

  it("callTool exercises the full task lifecycle via create → claim → start → submit → route_for_review", async () => {
    const taskId = "task-WB-1-001";

    const created = await server.callTool("create_task", {
      id: taskId,
      story_id: "WB-1",
      spec_id: "spec-WB-1",
      title: "Coverage task",
      type: "backend_api"
    });
    expect(created.isError).toBeUndefined();

    const claimed = await server.callTool("claim_task", {
      task_id: taskId,
      agent_id: "emulator"
    });
    expect(claimed.isError).toBeUndefined();

    const started = await server.callTool("start_task", { task_id: taskId });
    expect(started.isError).toBeUndefined();

    const submitted = await server.callTool("submit_task", {
      task_id: taskId,
      output: { summary: "Done", changed_files: [] },
      evidence: { commands_run: [], tests_passed: [], changed_files: [], notes: [] }
    });
    expect(submitted.isError).toBeUndefined();

    const routed = await server.callTool("route_for_review", { task_id: taskId });
    expect(routed.isError).toBeUndefined();
  });

  it("callTool update_story_status succeeds after fetch_story seeds the ledger", async () => {
    await server.callTool("fetch_story", { source_ref: "test/fixtures/WB-2.md" });
    const result = await server.callTool("update_story_status", {
      story_id: "WB-2",
      status: "in_progress"
    });
    expect(result.isError).toBeUndefined();
  });

  it("listResources returns the registered resource URIs", () => {
    const resources = server.listResources();
    expect(resources.map((r) => r.uri)).toContain("workbench://server/info");
    expect(typeof resources[0]?.description).toBe("string");
  });

  it("callResource returns server info for a valid URI", async () => {
    const result = await server.callResource("workbench://server/info");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contents[0]?.uri).toBe("workbench://server/info");
      expect(result.contents[0]?.mimeType).toBe("application/json");
    }
  });

  it("callResource returns {ok: false} for an unknown URI", async () => {
    const result = await server.callResource("workbench://unknown/resource");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("workbench://unknown/resource");
    }
  });
});
