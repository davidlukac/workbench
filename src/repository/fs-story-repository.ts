import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { storySchema } from "../types.js";
import type { Story } from "../types.js";
import type { StoryRepository } from "./story-repository.js";

export class FileSystemStoryRepository implements StoryRepository {
  readonly #storiesDir: string;

  constructor(storiesDir: string) {
    this.#storiesDir = storiesDir;
  }

  async upsertStory(story: Story): Promise<void> {
    await mkdir(this.#storiesDir, { recursive: true });
    await writeFile(
      join(this.#storiesDir, `${story.id}.json`),
      JSON.stringify(story, null, 2),
      "utf-8"
    );
  }

  async findStory(id: string): Promise<Story | null> {
    try {
      const raw = await readFile(join(this.#storiesDir, `${id}.json`), "utf-8");
      const parsed = storySchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
