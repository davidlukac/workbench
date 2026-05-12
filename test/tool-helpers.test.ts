import { describe, expect, it } from "vitest";
import { formatToolDescribe, formatToolList, parseArgValue, parseExtraArgs } from "../src/cli.js";

describe("parseArgValue", () => {
  it("returns the raw string for plain values", () => {
    expect(parseArgValue("hello")).toBe("hello");
    expect(parseArgValue(".tasks/WB-1.md")).toBe(".tasks/WB-1.md");
    expect(parseArgValue("123")).toBe("123");
  });

  it("parses JSON objects", () => {
    expect(parseArgValue('{"key":"val"}')).toEqual({ key: "val" });
  });

  it("parses JSON arrays", () => {
    expect(parseArgValue('["a","b"]')).toEqual(["a", "b"]);
  });

  it("returns raw string when JSON parse fails", () => {
    expect(parseArgValue("{not-json}")).toBe("{not-json}");
  });
});

describe("parseExtraArgs", () => {
  it("parses --key=value pairs", () => {
    expect(parseExtraArgs(["--agent_id=dev"])).toEqual({ agent_id: "dev" });
  });

  it("parses --key value pairs", () => {
    expect(parseExtraArgs(["--agent_id", "dev"])).toEqual({ agent_id: "dev" });
  });

  it("parses multiple flags", () => {
    expect(parseExtraArgs(["--task_id=t-1", "--agent_id=me"])).toEqual({
      task_id: "t-1",
      agent_id: "me"
    });
  });

  it("treats a bare --flag (no value) as true", () => {
    expect(parseExtraArgs(["--dry-run"])).toEqual({ "dry-run": true });
  });

  it("skips non-flag tokens", () => {
    expect(parseExtraArgs(["tool", "fetch_story", "--agent_id=dev"])).toEqual({ agent_id: "dev" });
  });

  it("parses JSON values in flags", () => {
    const result = parseExtraArgs(['--output={"summary":"done","changed_files":[]}']);
    expect(result.output).toEqual({ summary: "done", changed_files: [] });
  });

  it("returns empty object for empty input", () => {
    expect(parseExtraArgs([])).toEqual({});
  });
});

describe("formatToolList", () => {
  const mockServer = {
    listTools: () => [
      { name: "fetch_story", description: "Normalize a local story file.", fields: [] },
      { name: "claim_task", description: "Claim a pending task.", fields: [] }
    ],
    listResources: () => [{ uri: "workbench://server/info", description: "Server debug info." }]
  };

  it("includes tool names and descriptions", () => {
    const output = formatToolList(mockServer as Parameters<typeof formatToolList>[0]);
    expect(output).toContain("fetch_story");
    expect(output).toContain("Normalize a local story file.");
    expect(output).toContain("claim_task");
  });

  it("includes resource URIs", () => {
    const output = formatToolList(mockServer as Parameters<typeof formatToolList>[0]);
    expect(output).toContain("workbench://server/info");
    expect(output).toContain("Server debug info.");
  });

  it("labels sections Tools and Resources", () => {
    const output = formatToolList(mockServer as Parameters<typeof formatToolList>[0]);
    expect(output).toContain("Tools:");
    expect(output).toContain("Resources:");
  });
});

describe("formatToolDescribe", () => {
  const info = {
    name: "fetch_story",
    description: "Normalize a local story file.",
    fields: [
      { name: "source_ref", description: "Path to the story file.", required: true },
      { name: "format", description: "Output format.", required: false }
    ]
  };

  it("includes the tool name and description", () => {
    const output = formatToolDescribe(info);
    expect(output).toContain("fetch_story");
    expect(output).toContain("Normalize a local story file.");
  });

  it("marks required and optional fields", () => {
    const output = formatToolDescribe(info);
    expect(output).toContain("(required)");
    expect(output).toContain("(optional)");
  });

  it("includes field descriptions", () => {
    const output = formatToolDescribe(info);
    expect(output).toContain("Path to the story file.");
    expect(output).toContain("Output format.");
  });
});
