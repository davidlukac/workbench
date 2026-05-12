import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const CLI = resolve(import.meta.dirname, "../dist/cli.js");
const ROOT = resolve(import.meta.dirname, "..");

async function run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI, ...args], {
      cwd: ROOT
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout: string;
      stderr: string;
      code: number;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1
    };
  }
}

describe("workbench tool — integration", () => {
  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(`dist/cli.js not found — run 'npm run build' before integration tests`);
    }
  });

  it("tool (no args) lists tools and resources", async () => {
    const { stdout, exitCode } = await run(["tool"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Tools:");
    expect(stdout).toContain("Resources:");
    expect(stdout).toContain("fetch_story");
    expect(stdout).toContain("workbench://server/info");
  });

  it("tool fetch_story (no args) shows describe mode", async () => {
    const { stdout, exitCode } = await run(["tool", "fetch_story"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Arguments:");
    expect(stdout).toContain("source_ref");
    expect(stdout).toContain("(required)");
  });

  it("tool fetch_story <path> calls handler and returns JSON", async () => {
    const { stdout, exitCode } = await run(["tool", "fetch_story", ".tasks/WB-30.md"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { story: { id: string } };
    expect(parsed.story.id).toBe("WB-30");
  });

  it("tool claim_task <id> --agent_id=<val> propagates named arg and exits 1 on missing task", async () => {
    const { stderr, exitCode } = await run([
      "tool",
      "claim_task",
      "nonexistent-task",
      "--agent_id=test"
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/not found/i);
  });

  it("tool unknown-tool exits 1 with available tools listed", async () => {
    const { stderr, exitCode } = await run(["tool", "unknown-tool"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown tool");
    expect(stderr).toContain("fetch_story");
  });

  it("tool --resource workbench://server/info returns JSON with transport key", async () => {
    const { stdout, exitCode } = await run(["tool", "--resource", "workbench://server/info"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty("transport");
    expect(parsed).toHaveProperty("tools");
  });

  it("tool --resource unknown URI exits 1 with error on stderr", async () => {
    const { stderr, exitCode } = await run([
      "tool",
      "--resource",
      "workbench://server/nonexistent"
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
