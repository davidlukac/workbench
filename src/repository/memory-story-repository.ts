import type { Story } from "../types.js";
import type { StoryRepository } from "./story-repository.js";

export class MemoryStoryRepository implements StoryRepository {
  readonly #stories = new Map<string, Story>();

  async upsertStory(story: Story): Promise<void> {
    this.#stories.set(story.id, structuredClone(story));
  }

  async findStory(id: string): Promise<Story | null> {
    return structuredClone(this.#stories.get(id) ?? null);
  }
}
