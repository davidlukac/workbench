import type { Result, Story, StoryStatus } from "../types.js";
import { STORY_STATUS_TRANSITIONS } from "../types.js";

export type StoryEntry = {
  story: Story;
  status: StoryStatus;
  source_file: string;
  updated_at: string;
};

export class StoryLedger {
  readonly #entries = new Map<string, StoryEntry>();

  registerStory(story: Story): void {
    if (this.#entries.has(story.id)) return;
    this.#entries.set(story.id, {
      story,
      status: "todo",
      source_file: story.source_ref,
      updated_at: new Date().toISOString()
    });
  }

  getEntry(story_id: string): StoryEntry | undefined {
    return this.#entries.get(story_id);
  }

  updateStatus(story_id: string, status: StoryStatus): Result<StoryEntry> {
    const entry = this.#entries.get(story_id);
    if (entry === undefined) {
      return { ok: false, error: new Error(`Story not found: ${story_id}`) };
    }
    const validNext = STORY_STATUS_TRANSITIONS[entry.status];
    if (validNext !== status) {
      const expected = validNext ?? "none (terminal state)";
      return {
        ok: false,
        error: new Error(
          `Invalid story status transition for '${story_id}': '${entry.status}' → '${status}'. Valid next status: '${expected}'`
        )
      };
    }
    const updated: StoryEntry = { ...entry, status, updated_at: new Date().toISOString() };
    this.#entries.set(story_id, updated);
    return { ok: true, value: updated };
  }
}
