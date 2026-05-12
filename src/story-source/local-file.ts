import { basename, extname, resolve } from "node:path";
import YAML from "yaml";
import type { FileAdapter } from "../repository/index.js";
import { type Story, storySchema } from "../types.js";

type LocalStoryData = {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  description?: unknown;
  acceptanceCriteria?: unknown;
  acceptance_criteria?: unknown;
  raw_ac?: unknown;
  issue_type?: unknown;
  priority?: unknown;
  labels?: unknown;
  reporter?: unknown;
  assignee?: unknown;
};

export async function fetchLocalStory(
  sourceRef: string,
  fileAdapter: FileAdapter,
  now = new Date()
): Promise<Story> {
  const sourcePath = resolve(sourceRef);
  const raw = await fileAdapter.readFile(sourcePath, "utf8");
  const data = parseLocalStory(raw, sourcePath);
  const story = normalizeLocalStory(data, sourcePath, now);
  return storySchema.parse(story);
}

export function parseLocalStory(raw: string, sourcePath: string): LocalStoryData {
  const extension = extname(sourcePath).toLowerCase();
  if (extension === ".json") {
    return JSON.parse(raw) as LocalStoryData;
  }
  if (extension === ".yaml" || extension === ".yml") {
    return YAML.parse(raw) as LocalStoryData;
  }
  return parseMarkdownStory(raw);
}

function parseMarkdownStory(raw: string): LocalStoryData {
  const lines = raw.split(/\r?\n/);
  const data: LocalStoryData = {};
  const acceptanceCriteria: string[] = [];
  const descriptionLines: string[] = [];
  let section: "description" | "acceptance" | undefined;

  for (const line of lines) {
    const title = line.match(/^Title:\s*(.+)$/i);
    if (title?.[1]) {
      data.title = title[1].trim();
      section = undefined;
      continue;
    }

    const description = line.match(/^Description:\s*(.*)$/i);
    if (description) {
      if (description[1]) {
        descriptionLines.push(description[1].trim());
      }
      section = "description";
      continue;
    }

    if (/^Acceptance Criteria:\s*$/i.test(line)) {
      section = "acceptance";
      continue;
    }

    if (/^Status:\s*(.+)$/i.test(line)) {
      section = undefined;
      continue;
    }

    if (section === "acceptance") {
      const criterion = line.match(/^-\s+\[[ xX]\]\s+(.+)$/);
      if (criterion?.[1]) {
        acceptanceCriteria.push(criterion[1].trim());
      }
      continue;
    }

    if (section === "description" && line.trim().length > 0) {
      descriptionLines.push(line.trim());
    }
  }

  data.description = descriptionLines.join("\n").trim();
  data.raw_ac = acceptanceCriteria;
  return data;
}

function normalizeLocalStory(data: LocalStoryData, sourcePath: string, now: Date): Story {
  const id = asOptionalString(data.id) ?? idFromFilename(sourcePath);
  const summary = asOptionalString(data.summary) ?? asOptionalString(data.title);
  const description = asOptionalString(data.description);

  if (!summary) {
    throw new Error("Local story file must include a title or summary.");
  }
  if (!description) {
    throw new Error("Local story file must include a description.");
  }

  return {
    id,
    source_type: "file",
    source_ref: sourcePath,
    summary,
    description,
    raw_ac: parseStringList(data.raw_ac ?? data.acceptanceCriteria ?? data.acceptance_criteria),
    issue_type: parseEnum(data.issue_type, ["story", "bug", "task", "spike"], "task"),
    priority: parseEnum(data.priority, ["critical", "high", "medium", "low"], "medium"),
    labels: parseStringList(data.labels),
    reporter: asOptionalString(data.reporter) ?? null,
    assignee: asOptionalString(data.assignee) ?? null,
    fetched_at: now.toISOString()
  };
}

function idFromFilename(sourcePath: string): string {
  return basename(sourcePath, extname(sourcePath));
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item !== "string") {
      return [];
    }
    const trimmed = item.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  });
}

function parseEnum<const T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}
