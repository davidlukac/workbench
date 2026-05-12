import { Command } from "commander";
import { type LoadConfigResult, loadConfig } from "./config/loader.js";
import { type InstallSkillsResult, installBundledSkills } from "./install/skills.js";
import { WorkbenchServer, type WorkbenchServerOptions, runMcpServer } from "./server/index.js";
import { type VerificationResult, verifyEnvironment } from "./verify.js";

export type CliDependencies = {
  loadConfig: (configPath?: string) => Promise<LoadConfigResult>;
  runMcpServer: typeof runMcpServer;
  verifyEnvironment: (
    config: Parameters<typeof verifyEnvironment>[0]
  ) => Promise<VerificationResult>;
  installBundledSkills: typeof installBundledSkills;
  createToolServer: (options?: WorkbenchServerOptions) => WorkbenchServer;
  stdout: Pick<typeof console, "log">;
  stderr: Pick<typeof console, "error">;
};

export function createProgram(dependencies: Partial<CliDependencies> = {}): Command {
  const deps: CliDependencies = {
    loadConfig,
    runMcpServer,
    verifyEnvironment,
    installBundledSkills,
    createToolServer: (opts) => {
      const s = new WorkbenchServer(opts);
      s.registerBuiltinTools();
      s.registerBuiltinResources();
      return s;
    },
    stdout: console,
    stderr: console,
    ...dependencies
  };
  const program = new Command();

  program.name("workbench").description("AI Agent Workbench infrastructure CLI").version("0.1.0");

  program
    .command("mcp")
    .alias("serve")
    .description("Run the Workbench MCP server over stdio")
    .option("--config <path>", "path to .workbench.yaml", ".workbench.yaml")
    .option("--dev", "enable dev/debug logging to stderr and a log file")
    .option(
      "--log-file <path>",
      "path to the MCP debug log file",
      ".workbench/logs/workbench-mcp.log"
    )
    .action(async (options: { config: string; dev?: boolean; logFile: string }) => {
      await deps.runMcpServer({
        configPath: options.config,
        dev: options.dev === true,
        logFile: options.logFile
      });
    });

  const task = program.command("task").description("Task ledger commands");

  task
    .command("next")
    .description("Print the next claimable task prompt")
    .option("--format <format>", "output format: text or json", "text")
    .action((options: { format: string }) => {
      if (!["text", "json"].includes(options.format)) {
        throw new Error(`Unsupported format "${options.format}". Expected text or json.`);
      }
      deps.stderr.error("No active workspace session found.");
      process.exitCode = 1;
    });

  program
    .command("status")
    .description("Print the current workspace ledger status")
    .option("--watch", "poll and re-render until interrupted")
    .action(() => {
      deps.stderr.error("No active workspace session found.");
      process.exitCode = 1;
    });

  program
    .command("install <provider>")
    .description("Install Workbench for an AI provider")
    .option("--target <dir>", "override the provider default skills directory")
    .action(async (provider: string, options: { target?: string }) => {
      const installOptions =
        options.target === undefined ? { provider } : { provider, target: options.target };
      const result = await deps.installBundledSkills(installOptions);
      deps.stdout.log(formatInstallResult(result));
    });

  program
    .command("verify")
    .description("Validate Workbench configuration")
    .option("--config <path>", "path to .workbench.yaml", ".workbench.yaml")
    .action(async (options: { config: string }) => {
      const configResult = await deps.loadConfig(options.config);
      if (!configResult.ok) {
        deps.stderr.error(formatIssues("Config errors", configResult.issues));
        process.exitCode = 1;
        return;
      }

      const verification = await deps.verifyEnvironment(configResult.config);
      if (!verification.ok) {
        deps.stderr.error(
          ["Verification errors:", ...verification.errors.map((error) => `- ${error}`)].join("\n")
        );
        process.exitCode = 1;
        return;
      }

      if (verification.warnings.length > 0) {
        deps.stderr.error(
          ["Warnings:", ...verification.warnings.map((warning) => `- ${warning}`)].join("\n")
        );
      }
      deps.stdout.log(`OK ${configResult.path}`);
    });

  program
    .command("tool [name] [firstArg]")
    .description("List or call MCP tools and resources")
    .option("--resource <uri>", "read a registered MCP resource by URI")
    .option("--format <format>", "output format: json or text", "json")
    .allowUnknownOption()
    .allowExcessArguments()
    .action(
      async (
        name: string | undefined,
        firstArg: string | undefined,
        options: { resource?: string; format: string },
        cmd: Command
      ) => {
        const server = deps.createToolServer();

        // --resource: read a specific resource
        if (options.resource !== undefined) {
          const result = await server.callResource(options.resource);
          if (!result.ok) {
            deps.stderr.error(result.error);
            process.exitCode = 1;
            return;
          }
          const first = result.contents[0];
          /* v8 ignore next -- resource handlers always return at least one content item */
          deps.stdout.log(first !== undefined ? first.text : "");
          return;
        }

        // No tool name: list all tools and resources
        if (name === undefined) {
          deps.stdout.log(formatToolList(server));
          return;
        }

        const info = server.listTools().find((t) => t.name === name);

        // Unknown tool name
        if (info === undefined) {
          const available = server
            .listTools()
            .map((t) => t.name)
            .join(", ");
          deps.stderr.error(`Unknown tool: "${name}". Available tools: ${available}`);
          process.exitCode = 1;
          return;
        }

        // No args provided and tool has required fields → describe mode
        const requiredFields = info.fields.filter((f) => f.required);
        if (firstArg === undefined && requiredFields.length > 0) {
          deps.stdout.log(formatToolDescribe(info));
          return;
        }

        // Build args: firstArg maps to the first required (or first overall) field
        const extraArgTokens = parseExtraArgs(cmd.args);
        const args: Record<string, unknown> = { ...extraArgTokens };

        if (firstArg !== undefined) {
          /* v8 ignore next -- V8 does not record the ?? rhs as a separate branch here */
          const primaryField = requiredFields[0] ?? info.fields[0];
          if (primaryField !== undefined) {
            args[primaryField.name] = parseArgValue(firstArg);
          }
        }

        const result = await server.callTool(name, args);

        if (result.isError === true) {
          /* v8 ignore next -- tool handlers always return at least one content item */
          const msg = result.content[0]?.text ?? "Tool call failed.";
          deps.stderr.error(msg);
          process.exitCode = 1;
          return;
        }

        if (options.format === "text") {
          /* v8 ignore next -- tool handlers always return at least one content item */
          deps.stdout.log(result.content[0]?.text ?? "");
        } else {
          const output =
            result.structuredContent !== undefined
              ? result.structuredContent
              : /* v8 ignore next -- tool handlers always return at least one content item */
                (result.content[0]?.text ?? "");
          deps.stdout.log(JSON.stringify(output, null, 2));
        }
      }
    );

  return program;
}

export async function runCli(
  argv = process.argv,
  dependencies: Partial<CliDependencies> = {}
): Promise<void> {
  const program = createProgram(dependencies);
  await program.parseAsync(argv);
}

export function formatIssues(title: string, issues: { path: string; message: string }[]): string {
  return [title, ...issues.map((issue) => `- ${issue.path}: ${issue.message}`)].join("\n");
}

export function formatInstallResult(result: InstallSkillsResult): string {
  return [
    `Installed ${result.installedSkills.length} bundled Workbench skills for ${result.provider}.`,
    `Target: ${result.targetDir}`,
    ...result.installedSkills.map((skill) => `- ${skill}`)
  ].join("\n");
}

/** Formats the tool+resource listing for `workbench tool` with no args. */
export function formatToolList(server: WorkbenchServer): string {
  const tools = server.listTools();
  const resources = server.listResources();

  const toolPad = Math.max(...tools.map((t) => t.name.length), 0) + 2;
  const toolLines = tools.map((t) => `  ${t.name.padEnd(toolPad)}${t.description}`);

  const resPad = Math.max(...resources.map((r) => r.uri.length), 0) + 2;
  const resLines = resources.map((r) => `  ${r.uri.padEnd(resPad)}${r.description}`);

  const parts: string[] = [];
  if (toolLines.length > 0) parts.push(`Tools:\n${toolLines.join("\n")}`);
  if (resLines.length > 0) parts.push(`Resources:\n${resLines.join("\n")}`);
  return parts.join("\n\n");
}

/** Formats describe mode output for `workbench tool <name>` with no args. */
export function formatToolDescribe(info: {
  name: string;
  description: string;
  fields: Array<{ name: string; description: string; required: boolean }>;
}): string {
  const fieldLines = info.fields.map((f) => {
    const req = f.required ? "(required)" : "(optional)";
    return `  ${f.name.padEnd(24)}${req.padEnd(12)}${f.description}`;
  });
  return [`${info.name}  ${info.description}`, "", "Arguments:", ...fieldLines].join("\n");
}

/**
 * Parses `--key=value` and `--key value` tokens from Commander's remaining args.
 * Values that look like JSON objects/arrays are parsed; everything else is a string.
 */
export function parseExtraArgs(argv: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) {
      i++;
      continue;
    }
    const eqIdx = token.indexOf("=");
    if (eqIdx !== -1) {
      const key = token.slice(2, eqIdx);
      const val = token.slice(eqIdx + 1);
      result[key] = parseArgValue(val);
      i++;
    } else {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        result[key] = parseArgValue(next);
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    }
  }
  return result;
}

/** Tries to JSON-parse a string value; returns the raw string if it is not valid JSON. */
export function parseArgValue(raw: string): unknown {
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      // not valid JSON — fall through
    }
  }
  return raw;
}

/* v8 ignore next 7 -- full process startup is deferred integration-test tech debt */
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
