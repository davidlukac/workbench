import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { validateConfigReferences } from "../src/config/schema.js";

describe("loadConfig", () => {
  it("loads a valid workbench config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workbench-config-"));
    const configPath = join(dir, ".workbench.yaml");
    await writeFile(
      configPath,
      `
dispatch_mode: manual
jira:
  mode: mock
personas:
  engineer:
    name: Engineer
    system_prompt: Build the task.
    skills: []
type_to_persona:
  backend_api: engineer
`,
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.dispatch_mode).toBe("manual");
      expect(result.config.type_to_persona.backend_api).toBe("engineer");
    }
  });

  it("reports unknown persona mappings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workbench-config-"));
    const configPath = join(dir, ".workbench.yaml");
    await writeFile(
      configPath,
      `
dispatch_mode: auto
jira:
  mode: mock
personas: {}
type_to_persona:
  backend_api: missing
`,
      "utf8"
    );

    const result = await loadConfig(configPath);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      path: "type_to_persona.backend_api",
      message: 'Unknown persona "missing".'
    });
  });

  it("reports unreadable, malformed, and schema-invalid config files", async () => {
    const missing = await loadConfig("/tmp/workbench-missing-config.yaml");
    expect(missing.ok).toBe(false);
    expect(missing.issues[0]?.path).toBe("/tmp/workbench-missing-config.yaml");

    const dir = await mkdtemp(join(tmpdir(), "workbench-config-"));
    const malformedPath = join(dir, "malformed.yaml");
    await writeFile(malformedPath, "dispatch_mode: [", "utf8");

    const malformed = await loadConfig(malformedPath);
    expect(malformed.ok).toBe(false);
    expect(malformed.issues[0]?.message).toContain("Flow sequence");

    const invalidPath = join(dir, "invalid.yaml");
    await writeFile(
      invalidPath,
      `
dispatch_mode: sometimes
jira:
  mode: mock
`,
      "utf8"
    );

    const invalid = await loadConfig(invalidPath);
    expect(invalid.ok).toBe(false);
    expect(invalid.issues).toContainEqual({
      path: "dispatch_mode",
      message: expect.stringContaining("Invalid option")
    });

    const emptyPath = join(dir, "empty.yaml");
    await writeFile(emptyPath, "", "utf8");

    const empty = await loadConfig(emptyPath);
    expect(empty.ok).toBe(false);
    expect(empty.issues).toContainEqual({
      path: "<root>",
      message: expect.stringContaining("Invalid input")
    });
  });

  it("validates default persona references", () => {
    const issues = validateConfigReferences({
      dispatch_mode: "auto",
      jira: { mode: "mock" },
      defaults: {
        implementation_persona: "missing-impl",
        review_persona: "missing-review"
      },
      personas: {},
      type_to_persona: {}
    });

    expect(issues).toEqual([
      {
        path: "defaults.implementation_persona",
        message: 'Unknown persona "missing-impl".'
      },
      {
        path: "defaults.review_persona",
        message: 'Unknown persona "missing-review".'
      }
    ]);
  });
});
