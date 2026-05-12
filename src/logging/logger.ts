import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): Promise<void>;
  error(message: string, fields?: Record<string, unknown>): Promise<void>;
};

export type CreateLoggerOptions = {
  dev?: boolean;
  logFile?: string;
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const logFile = resolve(options.logFile ?? ".workbench/logs/workbench-mcp.log");
  let dirReady: Promise<void> | undefined;

  async function write(level: "info" | "error", message: string, fields?: Record<string, unknown>) {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...fields
    });

    if (options.dev) {
      console.error(entry);
    }

    dirReady ??= mkdir(dirname(logFile), { recursive: true }).then(() => undefined);
    await dirReady;
    await appendFile(logFile, `${entry}\n`, "utf8");
  }

  return {
    info: (message, fields) => write("info", message, fields),
    error: (message, fields) => write("error", message, fields)
  };
}
