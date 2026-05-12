import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { specSchema } from "../types.js";
import type { Spec } from "../types.js";
import type { SpecRepository } from "./spec-repository.js";

export class FileSystemSpecRepository implements SpecRepository {
  readonly #specPath: string;

  constructor(specPath: string) {
    this.#specPath = specPath;
  }

  async readSpec(_storyId?: string): Promise<Spec | null> {
    try {
      const raw = await readFile(this.#specPath, "utf-8");
      const parsed = specSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async upsertSpec(fields: Partial<Spec>): Promise<Spec> {
    const existing = (await this.readSpec()) ?? { revision: 0 };
    const merged: Spec = { ...existing, ...fields, revision: existing.revision + 1 };
    await mkdir(dirname(this.#specPath), { recursive: true });
    await writeFile(this.#specPath, JSON.stringify(merged, null, 2), "utf-8");
    return merged;
  }
}
