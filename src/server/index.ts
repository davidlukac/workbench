import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as z from "zod/v4";
import { loadConfig } from "../config/loader.js";
import { type CreateLoggerOptions, type Logger, createLogger } from "../logging/logger.js";
import {
  FileSystemFileAdapter,
  FileSystemSpecRepository,
  FileSystemStoryRepository
} from "../repository/index.js";
import { StoryLedger } from "../story-store/index.js";
import { TaskLedger } from "../task-store/index.js";
import { serverInfoResource } from "./resources.js";
import {
  claimTaskInputSchema,
  claimTaskOutputSchema,
  claimTaskTool,
  createTaskInputSchema,
  createTaskOutputSchema,
  createTaskTool,
  fetchStoryInputSchema,
  fetchStoryOutputSchema,
  fetchStoryTool,
  routeForReviewInputSchema,
  routeForReviewOutputSchema,
  routeForReviewTool,
  startTaskInputSchema,
  startTaskOutputSchema,
  startTaskTool,
  submitTaskInputSchema,
  submitTaskOutputSchema,
  submitTaskTool,
  updateSpecInputSchema,
  updateSpecOutputSchema,
  updateSpecTool,
  updateStoryStatusInputSchema,
  updateStoryStatusOutputSchema,
  updateStoryStatusTool
} from "./tools/index.js";

type SignalHandler = (signal: NodeJS.Signals) => void | Promise<void>;

/** Subset of the Node.js `process` object required for signal handling and clean exit. */
export type ProcessSignalHooks = {
  once(signal: NodeJS.Signals, handler: SignalHandler): unknown;
  exit(code?: number): void;
};

/** Options accepted by {@link WorkbenchServer} and {@link createWorkbenchMcpServer}. */
export type WorkbenchServerOptions = {
  logger?: Logger;
  workspacePath?: string;
};

/** Options accepted by {@link runMcpServer}. */
export type RunMcpServerOptions = {
  configPath?: string;
  dev?: boolean;
  logFile?: string;
  logger?: Logger;
  transport?: Transport;
  processHooks?: ProcessSignalHooks;
  workspacePath?: string;
};

/** Metadata for a single field in a registered MCP tool's input schema. */
export type ToolFieldInfo = {
  name: string;
  description: string;
  required: boolean;
};

/** Metadata and field schema for a registered MCP tool. */
export type ToolInfo = {
  name: string;
  description: string;
  fields: ToolFieldInfo[];
};

/** Metadata for a registered MCP resource. */
export type ResourceInfo = {
  uri: string;
  description: string;
};

/** Result returned by {@link WorkbenchServer.callTool}. */
export type ToolCallResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: unknown;
  isError?: true;
};

/**
 * Result returned by {@link WorkbenchServer.callResource}.
 * Discriminated by `ok` so callers can pattern-match without instanceof checks.
 */
export type ResourceReadResult =
  | { ok: true; contents: Array<{ uri: string; mimeType: string; text: string }> }
  | { ok: false; error: string };

// ── Private registry types ──────────────────────────────────────────────────

type ToolEntry = {
  description: string;
  fields: ToolFieldInfo[];
  call: (args: Record<string, unknown>) => Promise<ToolCallResult>;
};

type RawResourceResult = {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
};

type ResourceEntry = {
  description: string;
  call: (uri: URL) => Promise<RawResourceResult>;
};

/** Converts an input schema object into field metadata used by describe mode. */
function computeFields(schema: Record<string, z.ZodTypeAny>): ToolFieldInfo[] {
  return Object.entries(schema).map(([name, field]) => ({
    name,
    /* v8 ignore next -- all registered tool schemas call .describe() on every field */
    description: field.description ?? "",
    required: !field.isOptional()
  }));
}

/**
 * Wraps an MCP `McpServer` instance with Workbench-specific tool and resource registration.
 * Maintains a live registry of registered tool names so `serverInfoResource` can report them
 * dynamically without a hardcoded list.
 *
 * The `#toolRegistry` and `#resourceRegistry` parallel the MCP registrations and power the
 * `listTools()` / `callTool()` / `listResources()` / `callResource()` methods used by the CLI
 * `tool` command for in-process tool dispatch.
 *
 * Typical usage:
 * ```ts
 * const server = new WorkbenchServer({ logger, workspacePath });
 * server.registerBuiltinTools();
 * server.registerBuiltinResources();
 * await server.connect(transport);
 * ```
 */
export class WorkbenchServer {
  readonly #server: McpServer;
  readonly #toolNames: string[] = [];
  readonly #toolRegistry: Map<string, ToolEntry> = new Map();
  readonly #resourceRegistry: Map<string, ResourceEntry> = new Map();
  readonly #logger: Logger;
  readonly #workspacePath: string;
  readonly #fileAdapter: FileSystemFileAdapter;
  readonly #specRepo: FileSystemSpecRepository;
  readonly #storyRepo: FileSystemStoryRepository;
  readonly #ledger: TaskLedger;
  readonly #storyLedger: StoryLedger;

  constructor(options: WorkbenchServerOptions = {}) {
    this.#logger = options.logger ?? createLogger();
    this.#workspacePath = options.workspacePath ?? join(process.cwd(), ".workbench");
    this.#fileAdapter = new FileSystemFileAdapter();
    this.#specRepo = new FileSystemSpecRepository(join(this.#workspacePath, "spec.json"));
    this.#storyRepo = new FileSystemStoryRepository(join(this.#workspacePath, "stories"));
    this.#ledger = new TaskLedger();
    this.#storyLedger = new StoryLedger();
    this.#server = new McpServer(
      { name: "@workbench/cli", version: "0.1.0" },
      {
        instructions:
          "Workbench exposes local story ingestion and the task ledger. Use fetch_story to normalize a local Jira/story file. Use create_task to add a task to the ledger. Use claim_task, start_task, submit_task, and route_for_review to advance tasks through the lifecycle."
      }
    );
  }

  /** Returns the names of all tools registered via this server instance. */
  getToolNames(): readonly string[] {
    return this.#toolNames;
  }

  /** Returns metadata for all registered tools, including field info for describe mode. */
  listTools(): ToolInfo[] {
    return [...this.#toolRegistry.entries()].map(([name, entry]) => ({
      name,
      description: entry.description,
      fields: entry.fields
    }));
  }

  /**
   * Calls a registered tool by name with the given raw args.
   * Validation is performed inside each tool's handler closure using its specific Zod schema.
   * Returns `{ isError: true }` when the tool name is not found.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const entry = this.#toolRegistry.get(name);
    if (entry === undefined) {
      const available = [...this.#toolRegistry.keys()].join(", ");
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: "${name}". Available tools: ${available}`
          }
        ],
        isError: true
      };
    }
    try {
      return await entry.call(args);
      /* v8 ignore next 4 -- tool handlers return {isError:true}, they never throw */
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  }

  /** Returns metadata for all registered resources. */
  listResources(): ResourceInfo[] {
    return [...this.#resourceRegistry.entries()].map(([uri, entry]) => ({
      uri,
      description: entry.description
    }));
  }

  /**
   * Reads a registered resource by URI.
   * Returns `{ ok: false }` when the URI is not found or the handler throws.
   */
  async callResource(uri: string): Promise<ResourceReadResult> {
    const entry = this.#resourceRegistry.get(uri);
    if (entry === undefined) {
      const available = [...this.#resourceRegistry.keys()].join(", ");
      return {
        ok: false,
        error: `Unknown resource: "${uri}". Available resources: ${available}`
      };
    }
    try {
      const result = await entry.call(new URL(uri));
      return { ok: true, contents: result.contents };
      /* v8 ignore next 4 -- resource handlers return data, they never throw */
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /** Registers all built-in Workbench MCP tools and tracks their names in the registry. */
  registerBuiltinTools(): void {
    const logger = this.#logger;
    const ledger = this.#ledger;
    const storyLedger = this.#storyLedger;
    const fileAdapter = this.#fileAdapter;
    const specRepo = this.#specRepo;
    const storyRepo = this.#storyRepo;
    const workspacePath = this.#workspacePath;

    {
      const description =
        "Normalize a local Jira/story Markdown, YAML, or JSON file into a Workbench Story.";
      this.#server.registerTool(
        "fetch_story",
        {
          title: "Fetch Story",
          description,
          inputSchema: fetchStoryInputSchema,
          outputSchema: fetchStoryOutputSchema
        },
        async (args) =>
          fetchStoryTool(args, logger, workspacePath, storyLedger, fileAdapter, storyRepo)
      );
      this.#toolNames.push("fetch_story");
      this.#toolRegistry.set("fetch_story", {
        description,
        fields: computeFields(fetchStoryInputSchema),
        call: async (rawArgs) => {
          const result = z.object(fetchStoryInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return fetchStoryTool(
            result.data,
            logger,
            workspacePath,
            storyLedger,
            fileAdapter,
            storyRepo
          );
        }
      });
    }

    {
      const description =
        "Validate and persist partial Spec field updates. Returns updated fields, rejected fields with reasons, current spec state, completeness report, and revision number. Supports optimistic locking via base_revision.";
      this.#server.registerTool(
        "update_spec",
        {
          title: "Update Spec",
          description,
          inputSchema: updateSpecInputSchema,
          outputSchema: updateSpecOutputSchema
        },
        async (args) => updateSpecTool(args, logger, specRepo, workspacePath)
      );
      this.#toolNames.push("update_spec");
      this.#toolRegistry.set("update_spec", {
        description,
        fields: computeFields(updateSpecInputSchema),
        call: async (rawArgs) => {
          const result = z.object(updateSpecInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return updateSpecTool(result.data, logger, specRepo, workspacePath);
        }
      });
    }

    {
      const description =
        "Claim a pending task for execution. Transitions the task from pending to claimed, sets the claimed_by field and a lock with a 30-minute expiry.";
      this.#server.registerTool(
        "claim_task",
        {
          title: "Claim Task",
          description,
          inputSchema: claimTaskInputSchema,
          outputSchema: claimTaskOutputSchema
        },
        async (args) => claimTaskTool(args, logger, ledger)
      );
      this.#toolNames.push("claim_task");
      this.#toolRegistry.set("claim_task", {
        description,
        fields: computeFields(claimTaskInputSchema),
        call: async (rawArgs) => {
          const result = z.object(claimTaskInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return claimTaskTool(result.data, logger, ledger);
        }
      });
    }

    {
      const description =
        "Transition a task from claimed to in_progress. The task must have been claimed first via claim_task.";
      this.#server.registerTool(
        "start_task",
        {
          title: "Start Task",
          description,
          inputSchema: startTaskInputSchema,
          outputSchema: startTaskOutputSchema
        },
        async (args) => startTaskTool(args, logger, ledger)
      );
      this.#toolNames.push("start_task");
      this.#toolRegistry.set("start_task", {
        description,
        fields: computeFields(startTaskInputSchema),
        call: async (rawArgs) => {
          const result = z.object(startTaskInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return startTaskTool(result.data, logger, ledger);
        }
      });
    }

    {
      const description =
        "Transition a task from in_progress to implemented. Provide output (summary + changed files) and evidence (commands run, tests passed, changed files, notes).";
      this.#server.registerTool(
        "submit_task",
        {
          title: "Submit Task",
          description,
          inputSchema: submitTaskInputSchema,
          outputSchema: submitTaskOutputSchema
        },
        async (args) => submitTaskTool(args, logger, ledger)
      );
      this.#toolNames.push("submit_task");
      this.#toolRegistry.set("submit_task", {
        description,
        fields: computeFields(submitTaskInputSchema),
        call: async (rawArgs) => {
          const result = z.object(submitTaskInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return submitTaskTool(result.data, logger, ledger);
        }
      });
    }

    {
      const description =
        "Transition a task from implemented to review_required. Resolves and records the review_persona for the task.";
      this.#server.registerTool(
        "route_for_review",
        {
          title: "Route for Review",
          description,
          inputSchema: routeForReviewInputSchema,
          outputSchema: routeForReviewOutputSchema
        },
        async (args) => routeForReviewTool(args, logger, ledger)
      );
      this.#toolNames.push("route_for_review");
      this.#toolRegistry.set("route_for_review", {
        description,
        fields: computeFields(routeForReviewInputSchema),
        call: async (rawArgs) => {
          const result = z.object(routeForReviewInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return routeForReviewTool(result.data, logger, ledger);
        }
      });
    }

    {
      const description =
        "Create a new task in the in-memory ledger with status pending. Use this to seed the ledger before calling claim_task.";
      this.#server.registerTool(
        "create_task",
        {
          title: "Create Task",
          description,
          inputSchema: createTaskInputSchema,
          outputSchema: createTaskOutputSchema
        },
        async (args) => createTaskTool(args, logger, ledger, workspacePath)
      );
      this.#toolNames.push("create_task");
      this.#toolRegistry.set("create_task", {
        description,
        fields: computeFields(createTaskInputSchema),
        call: async (rawArgs) => {
          const result = z.object(createTaskInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return createTaskTool(result.data, logger, ledger, workspacePath);
        }
      });
    }

    {
      const description =
        "Transition a story through its lifecycle: todo → in_progress → in_review → done. Enforces valid FSM transitions and syncs the source file on disk when set.";
      this.#server.registerTool(
        "update_story_status",
        {
          title: "Update Story Status",
          description,
          inputSchema: updateStoryStatusInputSchema,
          outputSchema: updateStoryStatusOutputSchema
        },
        async (args) => updateStoryStatusTool(args, logger, storyLedger, fileAdapter)
      );
      this.#toolNames.push("update_story_status");
      this.#toolRegistry.set("update_story_status", {
        description,
        fields: computeFields(updateStoryStatusInputSchema),
        call: async (rawArgs) => {
          const result = z.object(updateStoryStatusInputSchema).safeParse(rawArgs);
          if (!result.success)
            return {
              content: [{ type: "text" as const, text: result.error.message }],
              isError: true as const
            };
          return updateStoryStatusTool(result.data, logger, storyLedger, fileAdapter);
        }
      });
    }
  }

  /** Registers the `workbench://server/info` resource with a dynamic tool list. */
  registerBuiltinResources(): void {
    const description = "Debug information for the local Workbench MCP server.";
    const handler = serverInfoResource(this.#logger, () => this.getToolNames());

    this.#server.registerResource(
      "server_info",
      "workbench://server/info",
      {
        title: "Workbench MCP server info",
        description,
        mimeType: "application/json"
      },
      handler
    );

    this.#resourceRegistry.set("workbench://server/info", { description, call: handler });
  }

  /** Connects the server to the given MCP transport and begins serving requests. */
  async connect(transport: Transport): Promise<void> {
    await this.#server.connect(transport);
  }
}

/** @deprecated Use `new WorkbenchServer(options)` + `registerBuiltinTools()` + `registerBuiltinResources()` directly. */
export function createWorkbenchMcpServer(options: WorkbenchServerOptions = {}): WorkbenchServer {
  const server = new WorkbenchServer(options);
  server.registerBuiltinTools();
  server.registerBuiltinResources();
  return server;
}

/**
 * Starts the Workbench MCP server: loads config, registers tools and resources,
 * binds signal handlers for graceful shutdown, then connects to the transport.
 */
export async function runMcpServer(options: RunMcpServerOptions = {}): Promise<void> {
  const loggerOptions: CreateLoggerOptions = {};
  if (options.dev !== undefined) loggerOptions.dev = options.dev;
  if (options.logFile !== undefined) loggerOptions.logFile = options.logFile;
  const logger = options.logger ?? createLogger(loggerOptions);

  const configResult = await loadConfig(options.configPath);
  if (!configResult.ok) {
    await logger.error("server_config_invalid", { issues: configResult.issues });
    throw new Error(
      /* v8 ignore next -- loadConfig failures currently always include at least one issue */
      `Invalid Workbench config: ${configResult.issues[0]?.message ?? "unknown error"}`
    );
  }

  /* v8 ignore next 2 -- defaults only apply in the real stdio entry point, not in tests */
  const transport = options.transport ?? new StdioServerTransport();
  const processHooks = options.processHooks ?? process;

  const serverOpts: WorkbenchServerOptions = { logger };
  if (options.workspacePath !== undefined) serverOpts.workspacePath = options.workspacePath;

  const server = createWorkbenchMcpServer(serverOpts);

  const shutdown = async (signal: NodeJS.Signals) => {
    await logger.info("server_shutdown_started", { signal });
    await transport.close();
    await logger.info("server_shutdown_completed", { signal });
    processHooks.exit(0);
  };

  processHooks.once("SIGINT", shutdown);
  processHooks.once("SIGTERM", shutdown);

  await server.connect(transport);
  await logger.info("server_connected", {
    config_path: configResult.path,
    transport: "stdio",
    dev: options.dev === true
  });
}
