import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logging/logger.js";

describe("createLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes JSON log entries to the configured file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workbench-logs-"));
    const logFile = join(dir, "nested", "workbench.log");
    const logger = createLogger({ logFile });

    await logger.info("started", { port: 123 });
    await logger.error("failed");

    const lines = (await readFile(logFile, "utf8")).trim().split("\n");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "info",
      message: "started",
      port: 123
    });
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({
      level: "error",
      message: "failed"
    });
  });

  it("also writes to stderr in dev mode", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "workbench-logs-"));
    const logger = createLogger({ dev: true, logFile: join(dir, "dev.log") });

    await logger.info("visible");

    expect(error).toHaveBeenCalledWith(expect.stringContaining('"message":"visible"'));
  });

  it("uses the default log file when none is configured", async () => {
    const logger = createLogger();

    await logger.info("default-log-file");

    await expect(readFile(".workbench/logs/workbench-mcp.log", "utf8")).resolves.toContain(
      '"message":"default-log-file"'
    );
  });
});
