import { describe, expect, it } from "vitest";
import * as workbench from "../src/index.js";

describe("public index exports", () => {
  it("exports the public API surface", () => {
    expect(workbench).toMatchObject({
      createProgram: expect.any(Function),
      runCli: expect.any(Function),
      loadConfig: expect.any(Function),
      validateConfigReferences: expect.any(Function),
      createWorkbenchMcpServer: expect.any(Function),
      runMcpServer: expect.any(Function),
      fetchLocalStory: expect.any(Function),
      parseLocalStory: expect.any(Function),
      TaskLedger: expect.any(Function),
      storySchema: expect.any(Object),
      taskSchema: expect.any(Object),
      taskStatusSchema: expect.any(Object),
      verifyEnvironment: expect.any(Function)
    });
  });
});
