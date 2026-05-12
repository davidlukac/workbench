import { access } from "node:fs/promises";
import { join } from "node:path";
import type { WorkbenchConfig } from "./config/schema.js";

export type VerificationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export async function verifyEnvironment(config: WorkbenchConfig): Promise<VerificationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.jira.mode === "cloud" && config.jira.auth === "token") {
    const { JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
    if (!JIRA_EMAIL) {
      errors.push("JIRA_EMAIL is required when jira.mode is cloud and jira.auth is token.");
    }
    if (!JIRA_API_TOKEN) {
      errors.push("JIRA_API_TOKEN is required when jira.mode is cloud and jira.auth is token.");
    }
  }

  for (const [personaId, persona] of Object.entries(config.personas)) {
    for (const skillName of persona.skills) {
      const skillPath = join(".claude", "skills", skillName, "SKILL.md");
      try {
        await access(skillPath);
      } catch {
        warnings.push(`Persona "${personaId}" references missing skill "${skillName}".`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
