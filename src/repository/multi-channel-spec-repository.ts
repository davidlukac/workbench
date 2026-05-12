import type { Logger } from "../logging/logger.js";
import type { Spec } from "../types.js";
import type { SpecRepository } from "./spec-repository.js";

export class MultiChannelSpecRepository implements SpecRepository {
  readonly #logger: Logger;
  readonly #primary: SpecRepository;
  readonly #secondaries: readonly SpecRepository[];

  constructor(logger: Logger, primary: SpecRepository, ...secondaries: SpecRepository[]) {
    this.#logger = logger;
    this.#primary = primary;
    this.#secondaries = secondaries;
  }

  async readSpec(storyId?: string): Promise<Spec | null> {
    return this.#primary.readSpec(storyId);
  }

  async upsertSpec(fields: Partial<Spec>): Promise<Spec> {
    const result = await this.#primary.upsertSpec(fields);
    for (const secondary of this.#secondaries) {
      await secondary.upsertSpec(fields).catch((err: unknown) => {
        void this.#logger.error("repository_secondary_write_failed", {
          method: "upsertSpec",
          error: String(err)
        });
      });
    }
    return result;
  }
}
