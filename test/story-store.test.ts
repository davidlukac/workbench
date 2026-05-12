import { describe, expect, it } from "vitest";
import { StoryLedger } from "../src/story-store/index.js";
import type { Story } from "../src/types.js";

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "WB-28",
    source_type: "file",
    source_ref: "/tmp/WB-28.md",
    summary: "Story status MCP tool",
    description: "Implement update_story_status.",
    raw_ac: [],
    issue_type: "task",
    priority: "medium",
    labels: [],
    reporter: null,
    assignee: null,
    fetched_at: new Date().toISOString(),
    ...overrides
  };
}

describe("StoryLedger", () => {
  describe("registerStory", () => {
    it("stores the story at todo status", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      const entry = ledger.getEntry("WB-28");
      expect(entry?.status).toBe("todo");
      expect(entry?.story.id).toBe("WB-28");
    });

    it("sets source_file from story.source_ref", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory({ source_ref: "/some/path/WB-28.md" }));
      expect(ledger.getEntry("WB-28")?.source_file).toBe("/some/path/WB-28.md");
    });

    it("is idempotent: second call does not reset status", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      ledger.updateStatus("WB-28", "in_progress");
      ledger.registerStory(makeStory());
      expect(ledger.getEntry("WB-28")?.status).toBe("in_progress");
    });
  });

  describe("getEntry", () => {
    it("returns undefined for unknown story_id", () => {
      const ledger = new StoryLedger();
      expect(ledger.getEntry("UNKNOWN")).toBeUndefined();
    });
  });

  describe("updateStatus", () => {
    it("transitions todo → in_progress", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      const result = ledger.updateStatus("WB-28", "in_progress");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("in_progress");
    });

    it("walks the full FSM: todo → in_progress → in_review → done", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      expect(ledger.updateStatus("WB-28", "in_progress").ok).toBe(true);
      expect(ledger.updateStatus("WB-28", "in_review").ok).toBe(true);
      const done = ledger.updateStatus("WB-28", "done");
      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.value.status).toBe("done");
    });

    it("rejects a skip transition (in_progress → done)", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      ledger.updateStatus("WB-28", "in_progress");
      const result = ledger.updateStatus("WB-28", "done");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("in_progress");
      expect(result.error.message).toContain("done");
    });

    it("rejects a backwards transition (in_review → todo)", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      ledger.updateStatus("WB-28", "in_progress");
      ledger.updateStatus("WB-28", "in_review");
      const result = ledger.updateStatus("WB-28", "todo");
      expect(result.ok).toBe(false);
    });

    it("rejects transitioning from the terminal done state", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      ledger.updateStatus("WB-28", "in_progress");
      ledger.updateStatus("WB-28", "in_review");
      ledger.updateStatus("WB-28", "done");
      const result = ledger.updateStatus("WB-28", "done");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("terminal");
    });

    it("returns error for unknown story_id", () => {
      const ledger = new StoryLedger();
      const result = ledger.updateStatus("UNKNOWN", "in_progress");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.message).toContain("UNKNOWN");
    });

    it("returns updated_at as a valid ISO datetime string", () => {
      const ledger = new StoryLedger();
      ledger.registerStory(makeStory());
      const result = ledger.updateStatus("WB-28", "in_progress");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(() => new Date(result.value.updated_at).toISOString()).not.toThrow();
    });
  });
});
