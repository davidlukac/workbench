import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CliDependencies,
  createProgram,
  formatInstallResult,
  formatIssues,
  runCli
} from "../src/cli.js";
import type { WorkbenchConfig } from "../src/config/schema.js";
import type { WorkbenchServer, WorkbenchServerOptions } from "../src/server/index.js";

function createDependencies(
  overrides: Partial<CliDependencies> = {}
): CliDependencies & { stdoutLines: string[]; stderrLines: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const config: WorkbenchConfig = {
    dispatch_mode: "manual",
    jira: { mode: "mock" },
    type_to_persona: {},
    personas: {}
  };

  return {
    stdoutLines,
    stderrLines,
    loadConfig: vi.fn(async () => ({
      ok: true,
      path: "/tmp/.workbench.yaml",
      config,
      issues: []
    })),
    runMcpServer: vi.fn(async () => {}),
    verifyEnvironment: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
    installBundledSkills: vi.fn(async ({ provider, target }) => ({
      provider: provider as "claude",
      targetDir:
        target ??
        ({
          claude: ".claude/skills",
          codex: ".agents/skills",
          windsurf: ".windsurf/skills"
        }[provider] as string),
      installedSkills: ["workbench"]
    })),
    createToolServer: vi.fn((_opts?: WorkbenchServerOptions) =>
      createMockToolServer()
    ) as unknown as (opts?: WorkbenchServerOptions) => WorkbenchServer,
    stdout: { log: (message: string) => stdoutLines.push(message) },
    stderr: { error: (message: string) => stderrLines.push(message) },
    ...overrides
  };
}

function createMockToolServer() {
  return {
    listTools: vi.fn(() => [
      {
        name: "fetch_story",
        description: "Normalize a local story file.",
        fields: [{ name: "source_ref", description: "Path to the story file.", required: true }]
      },
      {
        name: "start_task",
        description: "Transition a task to in_progress.",
        fields: [{ name: "task_id", description: "ID of the task.", required: true }]
      }
    ]),
    callTool: vi.fn(async (name: string, _args: Record<string, unknown>) => {
      if (name === "fetch_story") {
        return {
          content: [{ type: "text" as const, text: '{"story":{"id":"WB-1"}}' }],
          structuredContent: { story: { id: "WB-1" } }
        };
      }
      return {
        content: [{ type: "text" as const, text: `Unknown tool: "${name}".` }],
        isError: true as const
      };
    }),
    listResources: vi.fn(() => [
      { uri: "workbench://server/info", description: "Debug information." }
    ]),
    callResource: vi.fn(async (uri: string) => {
      if (uri === "workbench://server/info") {
        return {
          ok: true as const,
          contents: [{ uri, mimeType: "application/json", text: '{"status":"ready"}' }]
        };
      }
      return { ok: false as const, error: `Unknown resource: "${uri}".` };
    })
  };
}

describe("createProgram", () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("configures the help command", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("Usage: workbench [options] [command]");
    expect(help).toContain("verify");
    expect(help).toContain("mcp");
    expect(help).toContain("task");
  });

  it("runs the MCP server command with parsed options", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(
      ["node", "workbench", "mcp", "--config", "custom.yaml", "--dev", "--log-file", "mcp.log"],
      { from: "node" }
    );

    expect(deps.runMcpServer).toHaveBeenCalledWith({
      configPath: "custom.yaml",
      dev: true,
      logFile: "mcp.log"
    });
  });

  it("reports task and status commands without an active session", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(["node", "workbench", "task", "next"], { from: "node" });
    expect(process.exitCode).toBe(1);
    expect(deps.stderrLines).toContain("No active workspace session found.");

    process.exitCode = undefined;
    await createProgram(deps).parseAsync(["node", "workbench", "status", "--watch"], {
      from: "node"
    });
    expect(process.exitCode).toBe(1);
  });

  it("runs the provider install command", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(["node", "workbench", "install", "codex"], {
      from: "node"
    });

    expect(deps.installBundledSkills).toHaveBeenCalledWith({ provider: "codex" });
    expect(deps.stdoutLines).toEqual([
      "Installed 1 bundled Workbench skills for codex.\nTarget: .agents/skills\n- workbench"
    ]);
  });

  it("passes target overrides to provider installs", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(
      ["node", "workbench", "install", "windsurf", "--target", ".custom/skills"],
      {
        from: "node"
      }
    );

    expect(deps.installBundledSkills).toHaveBeenCalledWith({
      provider: "windsurf",
      target: ".custom/skills"
    });
  });

  it("surfaces unsupported install providers", async () => {
    const deps = createDependencies({
      installBundledSkills: vi.fn(async () => {
        throw new Error(
          'Unsupported install provider "cursor". Expected one of: claude, codex, windsurf.'
        );
      })
    });

    await expect(
      createProgram(deps).parseAsync(["node", "workbench", "install", "cursor"], {
        from: "node"
      })
    ).rejects.toThrow(
      'Unsupported install provider "cursor". Expected one of: claude, codex, windsurf.'
    );
  });

  it("formats install results", () => {
    expect(
      formatInstallResult({
        provider: "codex",
        targetDir: "/repo/.agents/skills",
        installedSkills: ["workbench", "workbench-spec"]
      })
    ).toBe(
      "Installed 2 bundled Workbench skills for codex.\nTarget: /repo/.agents/skills\n- workbench\n- workbench-spec"
    );
  });

  it("reports workflow setup as an unsupported provider for now", async () => {
    const deps = createDependencies({
      installBundledSkills: vi.fn(async () => {
        throw new Error(
          'Unsupported install provider "workflows". Expected one of: claude, codex, windsurf.'
        );
      })
    });

    await expect(
      createProgram(deps).parseAsync(["node", "workbench", "install", "workflows"], {
        from: "node"
      })
    ).rejects.toThrow(
      'Unsupported install provider "workflows". Expected one of: claude, codex, windsurf.'
    );
  });

  it("rejects unsupported task output formats", async () => {
    const deps = createDependencies();

    await expect(
      createProgram(deps).parseAsync(["node", "workbench", "task", "next", "--format", "yaml"], {
        from: "node"
      })
    ).rejects.toThrow('Unsupported format "yaml". Expected text or json.');
  });

  it("validates configuration successfully and prints warnings", async () => {
    const deps = createDependencies({
      verifyEnvironment: vi.fn(async () => ({
        ok: true,
        errors: [],
        warnings: ["Persona references missing skill."]
      }))
    });

    await createProgram(deps).parseAsync(["node", "workbench", "verify", "--config", "ok.yaml"], {
      from: "node"
    });

    expect(deps.loadConfig).toHaveBeenCalledWith("ok.yaml");
    expect(deps.stdoutLines).toEqual(["OK /tmp/.workbench.yaml"]);
    expect(deps.stderrLines).toEqual(["Warnings:\n- Persona references missing skill."]);
  });

  it("reports configuration and verification failures", async () => {
    const configFailure = createDependencies({
      loadConfig: vi.fn(async () => ({
        ok: false,
        path: "/tmp/bad.yaml",
        issues: [{ path: "dispatch_mode", message: "Invalid option." }]
      }))
    });

    await createProgram(configFailure).parseAsync(["node", "workbench", "verify"], {
      from: "node"
    });

    expect(process.exitCode).toBe(1);
    expect(configFailure.stderrLines).toEqual(["Config errors\n- dispatch_mode: Invalid option."]);

    process.exitCode = undefined;
    const verificationFailure = createDependencies({
      verifyEnvironment: vi.fn(async () => ({
        ok: false,
        errors: ["JIRA_EMAIL is required."],
        warnings: []
      }))
    });

    await createProgram(verificationFailure).parseAsync(["node", "workbench", "verify"], {
      from: "node"
    });

    expect(process.exitCode).toBe(1);
    expect(verificationFailure.stderrLines).toEqual([
      "Verification errors:\n- JIRA_EMAIL is required."
    ]);
  });

  it("runs the CLI entry helper", async () => {
    const deps = createDependencies();

    await runCli(["node", "workbench", "verify"], deps);

    expect(deps.stdoutLines).toEqual(["OK /tmp/.workbench.yaml"]);
  });

  it("formats issue lists", () => {
    expect(formatIssues("Errors", [{ path: "<root>", message: "Required" }])).toBe(
      "Errors\n- <root>: Required"
    );
  });

  it("workbench tool (no args) lists all tools and resources", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(["node", "workbench", "tool"], { from: "node" });

    expect(deps.stdoutLines).toHaveLength(1);
    expect(deps.stdoutLines[0]).toContain("fetch_story");
    expect(deps.stdoutLines[0]).toContain("workbench://server/info");
  });

  it("workbench tool <name> (has required fields, no args) shows describe mode", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(["node", "workbench", "tool", "fetch_story"], {
      from: "node"
    });

    expect(deps.stdoutLines[0]).toContain("fetch_story");
    expect(deps.stdoutLines[0]).toContain("source_ref");
    expect(deps.stdoutLines[0]).toContain("(required)");
    expect(process.exitCode).toBeUndefined();
  });

  it("workbench tool <name> <firstArg> calls the tool and prints JSON", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(
      ["node", "workbench", "tool", "fetch_story", ".tasks/WB-1.md"],
      { from: "node" }
    );

    expect(deps.stderrLines).toHaveLength(0);
    expect(deps.stdoutLines[0]).toContain("WB-1");
  });

  it("workbench tool <name> --key=value passes named args", async () => {
    const deps = createDependencies();
    const mockServer = createMockToolServer();
    deps.createToolServer = vi.fn(() => mockServer) as unknown as typeof deps.createToolServer;

    await createProgram(deps).parseAsync(
      ["node", "workbench", "tool", "fetch_story", ".tasks/WB-1.md", "--agent_id=dev"],
      { from: "node" }
    );

    const callArgs = (mockServer.callTool as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs?.[1]).toMatchObject({ source_ref: ".tasks/WB-1.md", agent_id: "dev" });
  });

  it("workbench tool unknown-name exits 1 with error listing available tools", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(["node", "workbench", "tool", "no_such_tool"], {
      from: "node"
    });

    expect(process.exitCode).toBe(1);
    expect(deps.stderrLines[0]).toContain("no_such_tool");
    expect(deps.stderrLines[0]).toContain("fetch_story");
  });

  it("workbench tool exits 1 when the tool returns isError", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(["node", "workbench", "tool", "start_task", "bad-id"], {
      from: "node"
    });

    expect(process.exitCode).toBe(1);
    expect(deps.stderrLines).toHaveLength(1);
  });

  it("workbench tool --resource reads a resource and prints its text", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(
      ["node", "workbench", "tool", "--resource", "workbench://server/info"],
      { from: "node" }
    );

    expect(deps.stderrLines).toHaveLength(0);
    expect(deps.stdoutLines[0]).toContain("ready");
  });

  it("workbench tool --resource exits 1 for an unknown URI", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(
      ["node", "workbench", "tool", "--resource", "workbench://no/such"],
      { from: "node" }
    );

    expect(process.exitCode).toBe(1);
    expect(deps.stderrLines[0]).toContain("workbench://no/such");
  });

  it("workbench tool --format text prints content text instead of JSON", async () => {
    const deps = createDependencies();

    await createProgram(deps).parseAsync(
      ["node", "workbench", "tool", "fetch_story", ".tasks/WB-1.md", "--format", "text"],
      { from: "node" }
    );

    expect(deps.stdoutLines[0]).toBe('{"story":{"id":"WB-1"}}');
  });

  it("workbench tool prints content text as JSON when structuredContent is absent", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const mockServer = createMockToolServer();
    (mockServer.callTool as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [{ type: "text" as const, text: "plain text result" }]
    });

    await createProgram({
      createToolServer: () => mockServer as unknown as WorkbenchServer,
      stdout: { log: (m: string) => stdoutLines.push(m) },
      stderr: { error: (m: string) => stderrLines.push(m) }
    }).parseAsync(["node", "workbench", "tool", "fetch_story", ".tasks/WB-1.md"], {
      from: "node"
    });

    expect(stderrLines).toHaveLength(0);
    expect(stdoutLines[0]).toContain("plain text result");
  });

  it("workbench tool maps firstArg to first field when tool has no required fields", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    // update_spec has all-optional fields — exercises the ?? info.fields[0] fallback.
    // Uses the real server (no createToolServer override) so update_spec is in the tool list.
    // "not-a-number" is invalid for base_revision so the tool returns isError,
    // but (requiredFields[0] ?? info.fields[0]) is exercised before the call.
    await createProgram({
      stdout: { log: (m: string) => stdoutLines.push(m) },
      stderr: { error: (m: string) => stderrLines.push(m) }
    }).parseAsync(["node", "workbench", "tool", "update_spec", "not-a-number"], { from: "node" });

    expect(process.exitCode).toBe(1);
  });

  it("workbench tool uses the default createToolServer factory when not overridden", async () => {
    const stdoutLines: string[] = [];

    await createProgram({
      stdout: { log: (m: string) => stdoutLines.push(m) },
      stderr: { error: () => {} }
    }).parseAsync(["node", "workbench", "tool"], { from: "node" });

    expect(stdoutLines[0]).toContain("fetch_story");
  });
});
