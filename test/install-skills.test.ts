import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installBundledSkills,
  parseSkillProvider,
  resolveBundledSkillsDir
} from "../src/install/skills.js";

describe("installBundledSkills", () => {
  it("installs all bundled skills into the provider default target", async () => {
    const workspace = await createWorkspace();
    const bundledSkillsDir = await createBundledSkills(workspace);

    const result = await installBundledSkills({
      provider: "codex",
      cwd: workspace,
      bundledSkillsDir
    });

    expect(result).toEqual({
      provider: "codex",
      targetDir: join(workspace, ".agents/skills"),
      installedSkills: ["workbench", "workbench-spec"]
    });
    await expect(readFile(join(result.targetDir, "workbench", "SKILL.md"), "utf8")).resolves.toBe(
      "# Workbench\n"
    );
    await expect(
      readFile(join(result.targetDir, "workbench-spec", "SKILL.md"), "utf8")
    ).resolves.toBe("# Workbench Spec\n");
  });

  it("uses target overrides and overwrites existing skill folders", async () => {
    const workspace = await createWorkspace();
    const bundledSkillsDir = await createBundledSkills(workspace);
    const target = join(workspace, "custom-skills");
    await mkdir(join(target, "workbench"), { recursive: true });
    await writeFile(join(target, "workbench", "old.txt"), "remove me\n");

    const result = await installBundledSkills({
      provider: "claude",
      target,
      cwd: workspace,
      bundledSkillsDir
    });

    expect(result.targetDir).toBe(target);
    await expect(readFile(join(target, "workbench", "SKILL.md"), "utf8")).resolves.toBe(
      "# Workbench\n"
    );
    await expect(readFile(join(target, "workbench", "old.txt"), "utf8")).rejects.toThrow();
  });

  it("uses the process cwd when cwd is not provided", async () => {
    const workspace = await createWorkspace();
    const bundledSkillsDir = await createBundledSkills(workspace);
    const target = join(workspace, "absolute-skills");

    const result = await installBundledSkills({
      provider: "codex",
      target,
      bundledSkillsDir
    });

    expect(result.targetDir).toBe(target);
    await expect(readFile(join(target, "workbench", "SKILL.md"), "utf8")).resolves.toBe(
      "# Workbench\n"
    );
  });

  it("rejects unsupported providers", () => {
    expect(() => parseSkillProvider("cursor")).toThrow(
      'Unsupported install provider "cursor". Expected one of: claude, codex, windsurf.'
    );
  });

  it("resolves bundled skills from the package layout by default", async () => {
    const workspace = await createWorkspace();

    const result = await installBundledSkills({
      provider: "windsurf",
      cwd: workspace
    });

    expect(result.targetDir).toBe(join(workspace, ".windsurf/skills"));
    expect(result.installedSkills).toEqual([
      "workbench",
      "workbench-emulator",
      "workbench-manager",
      "workbench-planner",
      "workbench-reviewer",
      "workbench-spec"
    ]);
    await expect(
      readFile(join(result.targetDir, "workbench", "SKILL.md"), "utf8")
    ).resolves.toContain("name: workbench");
  });

  it("reports an error when bundled skills cannot be found", async () => {
    const workspace = await createWorkspace();

    await expect(resolveBundledSkillsDir(join(workspace, "dist/install"))).rejects.toThrow(
      `Unable to find bundled Workbench skills. Checked: ${join(
        workspace,
        "dist/resources/skills"
      )}, ${join(workspace, "resources/skills")}`
    );
  });
});

async function createWorkspace(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "workbench-install-test-"));
}

async function createBundledSkills(workspace: string): Promise<string> {
  const bundledSkillsDir = join(workspace, "resources/skills");
  await mkdir(join(bundledSkillsDir, "workbench"), { recursive: true });
  await mkdir(join(bundledSkillsDir, "workbench-spec"), { recursive: true });
  await writeFile(join(bundledSkillsDir, "workbench", "SKILL.md"), "# Workbench\n");
  await writeFile(join(bundledSkillsDir, "workbench-spec", "SKILL.md"), "# Workbench Spec\n");
  await writeFile(join(bundledSkillsDir, "README.md"), "not a skill directory\n");
  return bundledSkillsDir;
}
