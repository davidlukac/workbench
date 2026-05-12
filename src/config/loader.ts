import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";
import type { ZodError } from "zod/v4";
import {
  type ConfigIssue,
  type WorkbenchConfig,
  validateConfigReferences,
  workbenchConfigSchema
} from "./schema.js";

export type LoadConfigResult =
  | {
      ok: true;
      path: string;
      config: WorkbenchConfig;
      issues: ConfigIssue[];
    }
  | {
      ok: false;
      path: string;
      issues: ConfigIssue[];
    };

export async function loadConfig(configPath = ".workbench.yaml"): Promise<LoadConfigResult> {
  const resolvedPath = resolve(configPath);

  let raw: string;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (error) {
    /* v8 ignore next -- fs errors are expected to be Error instances in supported Node versions */
    const message = error instanceof Error ? error.message : "Unable to read config file.";
    return {
      ok: false,
      path: resolvedPath,
      issues: [{ path: configPath, message }]
    };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    /* v8 ignore next -- yaml parse errors are expected to be Error instances */
    const message = error instanceof Error ? error.message : "Invalid YAML.";
    return {
      ok: false,
      path: resolvedPath,
      issues: [{ path: configPath, message }]
    };
  }

  const schemaResult = workbenchConfigSchema.safeParse(parsed);
  if (!schemaResult.success) {
    return {
      ok: false,
      path: resolvedPath,
      issues: flattenZodIssues(schemaResult.error)
    };
  }

  const referenceIssues = validateConfigReferences(schemaResult.data);
  return {
    ok: referenceIssues.length === 0,
    path: resolvedPath,
    config: schemaResult.data,
    issues: referenceIssues
  };
}

function flattenZodIssues(error: ZodError): ConfigIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "<root>",
    message: issue.message
  }));
}
