import type { Spec } from "../types.js";
import type { SpecRepository } from "./spec-repository.js";

export class MemorySpecRepository implements SpecRepository {
  #spec: Spec | null = null;

  async readSpec(_storyId?: string): Promise<Spec | null> {
    return this.#spec;
  }

  async upsertSpec(fields: Partial<Spec>): Promise<Spec> {
    const existing = this.#spec ?? { revision: 0 };
    const merged: Spec = { ...existing, ...fields, revision: existing.revision + 1 };
    this.#spec = merged;
    return merged;
  }
}
