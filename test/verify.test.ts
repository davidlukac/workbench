import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchConfig } from "../src/config/schema.js";
import { verifyEnvironment } from "../src/verify.js";

const baseConfig: WorkbenchConfig = {
  dispatch_mode: "auto",
  jira: { mode: "mock" },
  personas: {},
  type_to_persona: {}
};

describe("verifyEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires Jira credentials for cloud token auth", async () => {
    vi.stubEnv("JIRA_EMAIL", "");
    vi.stubEnv("JIRA_API_TOKEN", "");

    const result = await verifyEnvironment({
      ...baseConfig,
      jira: {
        mode: "cloud",
        base_url: "https://example.atlassian.net",
        auth: "token"
      }
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        "JIRA_EMAIL is required when jira.mode is cloud and jira.auth is token.",
        "JIRA_API_TOKEN is required when jira.mode is cloud and jira.auth is token."
      ],
      warnings: []
    });
  });

  it("passes cloud verification when credentials exist", async () => {
    vi.stubEnv("JIRA_EMAIL", "user@example.com");
    vi.stubEnv("JIRA_API_TOKEN", "token");

    await expect(
      verifyEnvironment({
        ...baseConfig,
        jira: {
          mode: "cloud",
          base_url: "https://example.atlassian.net",
          auth: "token"
        }
      })
    ).resolves.toMatchObject({ ok: true, errors: [] });
  });

  it("warns when configured persona skills are missing", async () => {
    const result = await verifyEnvironment({
      ...baseConfig,
      personas: {
        engineer: {
          name: "Engineer",
          system_prompt: "Build",
          skills: ["missing-skill"]
        }
      }
    });

    expect(result).toEqual({
      ok: true,
      errors: [],
      warnings: ['Persona "engineer" references missing skill "missing-skill".']
    });
  });

  it("accepts configured persona skills that exist", async () => {
    const result = await verifyEnvironment({
      ...baseConfig,
      personas: {
        engineer: {
          name: "Engineer",
          system_prompt: "Build",
          skills: ["dev-ts"]
        }
      }
    });

    expect(result.warnings).toEqual([]);
  });
});
