import type { Story } from "../types.js";

export interface StoryRepository {
  upsertStory(story: Story): Promise<void>;
  findStory(id: string): Promise<Story | null>;
}
