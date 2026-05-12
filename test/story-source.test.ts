import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FileSystemFileAdapter, MemoryFileAdapter } from "../src/repository/index.js";
import { fetchLocalStory, parseLocalStory } from "../src/story-source/local-file.js";

describe("fetchLocalStory", () => {
  it("normalizes a local markdown task file into a Story", async () => {
    const fileAdapter = new FileSystemFileAdapter();
    const story = await fetchLocalStory(
      "test/fixtures/WB-2.md",
      fileAdapter,
      new Date("2026-05-09T00:00:00.000Z")
    );

    expect(story).toMatchObject({
      id: "WB-2",
      source_type: "file",
      summary: "Minimal MCP server implementation",
      issue_type: "task",
      priority: "medium",
      fetched_at: "2026-05-09T00:00:00.000Z"
    });
    expect(story.description).toContain("Implement a basic MCP server");
    expect(story.raw_ac).toContain("MCP server can be started locally with autoreload");
  });

  it("normalizes JSON and YAML story files", async () => {
    const fileAdapter = new MemoryFileAdapter();

    const jsonPath = resolve("test/JSON-1.json");
    fileAdapter.seed(
      jsonPath,
      JSON.stringify({
        id: "CUSTOM-1",
        summary: "JSON story",
        description: "From JSON",
        acceptanceCriteria: ["works", "", 123],
        issue_type: "story",
        priority: "high",
        labels: ["json"],
        reporter: "Madar",
        assignee: "Agent"
      })
    );

    await expect(
      fetchLocalStory(jsonPath, fileAdapter, new Date("2026-05-09T00:00:00.000Z"))
    ).resolves.toMatchObject({
      id: "CUSTOM-1",
      summary: "JSON story",
      priority: "high",
      raw_ac: ["works"],
      reporter: "Madar",
      assignee: "Agent"
    });

    const yamlPath = resolve("test/YAML-1.yaml");
    fileAdapter.seed(
      yamlPath,
      `
title: YAML story
description: From YAML
acceptance_criteria:
  - passes
issue_type: spike
priority: low
`
    );

    await expect(fetchLocalStory(yamlPath, fileAdapter)).resolves.toMatchObject({
      id: "YAML-1",
      source_type: "file",
      summary: "YAML story",
      issue_type: "spike",
      priority: "low",
      labels: [],
      reporter: null,
      assignee: null
    });
  });

  it("parses markdown sections and ignores unsupported list items", () => {
    const parsed = parseLocalStory(
      [
        "Title: Markdown story",
        "Description:",
        "First line",
        "Second line",
        "Acceptance Criteria:",
        "- [ ] accepted criterion",
        "- plain bullet ignored",
        "Status: TODO",
        "ignored after status"
      ].join("\n"),
      "TASK-1.md"
    );

    expect(parsed).toMatchObject({
      title: "Markdown story",
      description: "First line\nSecond line",
      raw_ac: ["accepted criterion"]
    });
  });

  it("rejects stories without summary or description", async () => {
    const fileAdapter = new MemoryFileAdapter();

    const noTitlePath = resolve("test/NO-TITLE.md");
    fileAdapter.seed(noTitlePath, "Description: Missing title\n");
    await expect(fetchLocalStory(noTitlePath, fileAdapter)).rejects.toThrow(
      "Local story file must include a title or summary."
    );

    const noDescriptionPath = resolve("test/NO-DESC.md");
    fileAdapter.seed(noDescriptionPath, "Title: Missing description\n");
    await expect(fetchLocalStory(noDescriptionPath, fileAdapter)).rejects.toThrow(
      "Local story file must include a description."
    );
  });
});
