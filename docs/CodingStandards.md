# Coding Standards

Conventions established during WB-26 and enforced going forward. All rules apply to code in `src/`.

---

## 1. Zod v4 Import Style

**Rule:** Always import Zod via the `zod/v4` subpath using namespace import syntax.

```ts
// ✅ correct
import * as z from "zod/v4";

// ❌ wrong — uses the v3-compatible main entrypoint
import { z } from "zod";
```

**Rationale:** The project targets Zod v4. Importing from `"zod/v4"` makes the version dependency explicit, avoids any v3-compatibility shim overhead, and is consistent with the import style already used in `src/server/`.

---

## 2. Per-Tool Module Layout

**Rule:** Each MCP tool lives in its own file under `src/server/tools/<tool-name>.ts`. The file owns the tool's input schema, output schema, result type, and handler function — nothing else. A barrel `src/server/tools/index.ts` re-exports all of them.

```
src/server/tools/
  fetch-story.ts       # fetchStoryInputSchema, fetchStoryOutputSchema, FetchStoryResult, fetchStoryTool
  claim-task.ts        # claimTaskInputSchema, claimTaskOutputSchema, ClaimTaskResult, claimTaskTool
  create-task.ts       # createTaskInputSchema, createTaskOutputSchema, CreateTaskResult, createTaskTool
  ...
  index.ts             # export * from each tool file
```

**Rationale:** Keeping types, schemas, and handler co-located per tool makes each tool self-contained and easy to review. The barrel keeps imports clean at call sites.

---

## 3. `WorkbenchServer` Class Pattern

**Rule:** All MCP server setup goes through the `WorkbenchServer` class. Do not instantiate `McpServer` directly outside of `WorkbenchServer`. The startup sequence is always:

```ts
const server = new WorkbenchServer({ logger, workspacePath });
server.registerBuiltinTools();
server.registerBuiltinResources();
await server.connect(transport);
```

**Rationale:** Encapsulating `McpServer` in `WorkbenchServer` gives a single place to add cross-cutting concerns (auth, metrics, lifecycle hooks) without touching every tool registration site. It also owns the tool registry that drives dynamic server info.

---

## 4. Dynamic Tool Registry

**Rule:** Never hardcode a list of tool names in `serverInfoResource` or anywhere else. Register tools via `WorkbenchServer`'s `registerBuiltinTools()` method, which pushes each name to `#toolNames`. The resource reads `getToolNames()` at request time.

```ts
// ✅ correct — tool automatically appears in server info
this.#server.registerTool("my_tool", config, handler);
this.#toolNames.push("my_tool");

// ❌ wrong — forgetting to update this list is a recurring bug
export function serverInfoResource() {
  return { tools: ["fetch_story", "claim_task" /*, ...manually maintained */] };
}
```

**Rationale:** A hardcoded list drifts out of sync every time a tool is added or removed. The dynamic callback eliminates the maintenance step entirely.

---

## 5. JSDoc on `src/server/` Public Exports

**Rule:** Every exported function, class, type, and constant in `src/server/` must have a JSDoc comment (`/** */`). Private helpers and internal variables do not require JSDoc.

```ts
// ✅ correct
/** Transitions a task from `pending` to `claimed`, setting `claimed_by` and a 30-minute lock. */
export async function claimTaskTool(...) { ... }

/** MCP input schema for the `claim_task` tool. */
export const claimTaskInputSchema = { ... };

// ❌ wrong — no JSDoc on a public export
export async function claimTaskTool(...) { ... }
```

**Rationale:** `src/server/` is the public API surface consumed by tests, the CLI, and potentially external integrations. JSDoc makes the contract visible in IDEs without reading the implementation.

---

## 6. Logger Lazy-Init Pattern

**Rule:** Create the log directory at most once per logger instance using a cached `Promise`. Do not call `mkdir` inside the per-message write path.

```ts
// ✅ correct — mkdir fires once; all concurrent writes await the same Promise
let dirReady: Promise<void> | undefined;

async function write(level: string, message: string) {
  dirReady ??= mkdir(dirname(logFile), { recursive: true }).then(() => undefined);
  await dirReady;
  await appendFile(logFile, ...);
}

// ❌ wrong — mkdir called on every single log line
async function write(level: string, message: string) {
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, ...);
}
```

**Rationale:** `mkdir` with `recursive: true` is a syscall. Calling it on every log entry wastes I/O, especially in tests and high-throughput sessions. The `??=` pattern is idiomatic, race-condition-safe, and adds no complexity.
