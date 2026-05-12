import type { Logger } from "../logging/logger.js";
import type { Story } from "../types.js";
import type { StoryRepository } from "./story-repository.js";

export class MultiChannelStoryRepository implements StoryRepository {
  readonly #logger: Logger;
  readonly #primary: StoryRepository;
  readonly #secondaries: readonly StoryRepository[];

  constructor(logger: Logger, primary: StoryRepository, ...secondaries: StoryRepository[]) {
    this.#logger = logger;
    this.#primary = primary;
    this.#secondaries = secondaries;
  }

  async findStory(id: string): Promise<Story | null> {
    return this.#primary.findStory(id);
  }

  async upsertStory(story: Story): Promise<void> {
    await this.#primary.upsertStory(story);
    for (const secondary of this.#secondaries) {
      await secondary.upsertStory(story).catch((err: unknown) => {
        void this.#logger.error("repository_secondary_write_failed", {
          method: "upsertStory",
          error: String(err)
        });
      });
    }
  }
}
