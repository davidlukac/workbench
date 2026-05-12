import { cp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_PROVIDER_TARGETS = {
  claude: ".claude/skills",
  codex: ".agents/skills",
  windsurf: ".windsurf/skills"
} as const;

export type SkillProvider = keyof typeof SKILL_PROVIDER_TARGETS;

export type InstallSkillsOptions = {
  provider: string;
  target?: string;
  cwd?: string;
  bundledSkillsDir?: string;
};

export type InstallSkillsResult = {
  provider: SkillProvider;
  targetDir: string;
  installedSkills: string[];
};

export async function installBundledSkills(
  options: InstallSkillsOptions
): Promise<InstallSkillsResult> {
  const provider = parseSkillProvider(options.provider);
  const cwd = options.cwd ?? process.cwd();
  const targetDir = resolve(cwd, options.target ?? SKILL_PROVIDER_TARGETS[provider]);
  const bundledSkillsDir = options.bundledSkillsDir ?? (await resolveBundledSkillsDir());
  const installedSkills: string[] = [];

  for (const skill of await listBundledSkillNames(bundledSkillsDir)) {
    const source = join(bundledSkillsDir, skill);
    const destination = join(targetDir, skill);

    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true });
    installedSkills.push(skill);
  }

  return { provider, targetDir, installedSkills };
}

export function parseSkillProvider(provider: string): SkillProvider {
  if (isSkillProvider(provider)) {
    return provider;
  }

  throw new Error(
    `Unsupported install provider "${provider}". Expected one of: ${Object.keys(
      SKILL_PROVIDER_TARGETS
    ).join(", ")}.`
  );
}

async function listBundledSkillNames(bundledSkillsDir: string): Promise<string[]> {
  const entries = await readdir(bundledSkillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function isSkillProvider(provider: string): provider is SkillProvider {
  return Object.hasOwn(SKILL_PROVIDER_TARGETS, provider);
}

export async function resolveBundledSkillsDir(
  currentDir = dirname(fileURLToPath(import.meta.url))
): Promise<string> {
  const candidates = [
    resolve(currentDir, "../resources/skills"),
    resolve(currentDir, "../../resources/skills")
  ];

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to find bundled Workbench skills. Checked: ${candidates.join(", ")}`);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
