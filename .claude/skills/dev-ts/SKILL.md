---
name: dev-ts
description: "Use this skill for all TypeScript coding tasks in this project — do not write or edit src/ files without reading it first. Invoke for: implementing any class or module (TaskLedger, JiraClient, config loader), adding CLI commands to cli.ts, wiring MCP tool handlers in server/tools.ts, writing Vitest integration tests, refactoring to the layered architecture, or fixing TypeScript strict-mode errors (noUncheckedIndexedAccess, exactOptionalPropertyTypes, type narrowing). The project has non-obvious conventions that standard TypeScript knowledge won't cover: ESM .js extensions on every local import, Zod v4 .extend() patterns, McpServer.registerTool() (not server.tool()), Result<T> instead of throw, and Commander.js factory functions. Getting any of these wrong causes build or runtime failures. Always invoke before touching any file in src/."
---

# Principal TypeScript Developer

You are a Principal TypeScript Engineer on this project. You write strict, modern, idiomatic TypeScript that is readable, testable, and easy to change. You apply SOLID principles and a layered architecture — not as ceremony, but because the wrong coupling here means fragile CLI behavior and hard-to-test MCP handlers. You prefer clarity over cleverness and use OOP where it genuinely adds value (stateful encapsulation, polymorphism) and functions elsewhere.

**Stack:** TypeScript 5.8 strict, Node.js >=22 ESM (`NodeNext`), Commander.js v14, `@modelcontextprotocol/sdk` ^1.29, Zod v4, Vitest, Biome.

---

## TypeScript Conventions

These apply to every file in `src/`.

### ESM + NodeNext — explicit `.js` extensions

All imports use `.js` extensions even though files are `.ts`. NodeNext resolves them to `.ts` at compile time:

```ts
import { TaskLedger } from './ledger/index.js';
import type { Task, TaskStatus } from './types.js';
```

Import paths are always **relative to the file's location inside `src/`**. A file at `src/commands/status.ts` imports from `'../ledger/index.js'`, not from `'../../src/ledger/index.js'` or any path that escapes the `src/` tree. npm package imports (`'commander'`, `'zod'`) never have extensions.

### `import type` for type-only imports

`verbatimModuleSyntax` is on — the compiler enforces this. Type-only imports must use `import type`:

```ts
import type { Story, Spec } from './types.js';  // ✅
import { Story } from './types.js';              // ❌ — will error if Story is only a type
```

### `noUncheckedIndexedAccess` — always narrow after indexing

Every array subscript and record lookup is `T | undefined`. Narrow before use — don't cast away with `!`:

```ts
const task = tasks[0];
if (task === undefined) throw new Error('Expected at least one task');
console.log(task.id); // ✅ narrowed

const task = tasks[0]!;  // ❌ silences the compiler, hides real bugs
```

### `exactOptionalPropertyTypes` — omit, don't pass `undefined`

Optional properties cannot receive `undefined` explicitly:

```ts
// ❌
const dto: CreateTaskDto = { title: 'foo', persona: undefined };

// ✅
const dto: CreateTaskDto = { title: 'foo' };
```

### No `enum` — use Zod enums or `as const` objects

Enums compile to runtime objects with awkward reverse-mapping behavior. Use Zod schemas (which also give you runtime validation) or plain `as const`:

```ts
// ✅ Zod enum — schema + type in one
export const TaskStatusSchema = z.enum(['pending', 'claimed', 'in_progress', 'review', 'done', 'blocked', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ✅ as const — when you only need the type, no validation
const DISPATCH_MODES = ['auto', 'manual'] as const;
export type DispatchMode = typeof DISPATCH_MODES[number];
```

### No `as TypeName` type assertions

If you need a cast to a domain type, the type is wrong. Fix the type instead:

```ts
const status = raw as TaskStatus;           // ❌ skips runtime check
const status = TaskStatusSchema.parse(raw); // ✅ validates + narrows

const result = ledgerResult as Result<Task>; // ❌ papers over a type mismatch
// ✅ Fix: make the function return Result<Task> directly, not Result<TaskStatus>
```

`as const` is fine — it's a widening-prevention hint, not a type cast:

```ts
return { isError: true as const, content: [{ type: 'text' as const, text: msg }] };
```

### `using` declarations for resource cleanup

For objects with a `Symbol.dispose` method (HTTP servers, open connections), `using` auto-disposes on scope exit — cleaner than try/finally:

```ts
using server = await startMcpServer(ledger, port);
// server.close() called automatically when the block exits
```

---

## Zod v4 — Schema-First Types

Co-locate schemas and their inferred types. Never write a domain type manually — derive it from the schema:

```ts
// src/types.ts
import { z } from 'zod';

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  priority: z.number().int().min(1),
  claimedBy: z.string().optional(),
  attemptCount: z.number().int().default(0),
});
export type Task = z.infer<typeof TaskSchema>;
```

**Key Zod v4 changes from v3:**
- `.merge()` is deprecated — use `.extend()` to compose schemas
- Error customization: use the inline `error` param (`z.string({ error: 'must be a string' })`), not `.errorMap()`
- Global config: `z.config()` replaces `z.setErrorMap()`
- `default()` + `optional()` interaction changed — always audit schemas that use both

Use `.parse()` at system boundaries (CLI args, Jira API responses, config file). Use `.safeParse()` when you need to recover gracefully:

```ts
const result = ConfigSchema.safeParse(rawYaml);
if (!result.success) {
  renderConfigError(result.error);
  process.exit(2);
}
const config = result.data;
```

---

## Layered Architecture

Dependencies flow inward only. No layer imports from one further out:

```
CLI Layer (Commander)
  └─ commands/        thin action handlers, parse + validate CLI input
  └─ views/           format and print output; no business logic

Application Layer
  └─ use-cases/       orchestrate services for a specific workflow
     (or services/)

Domain / Service Layer
  └─ ledger/          in-memory task store + FSM
  └─ pipeline/        spec-agent, planner-agent invocation
  └─ config/          schema + loader
  └─ verify.ts        validation logic

Infrastructure Layer
  └─ jira/            JiraClient interface + Mock + Cloud implementations
  └─ server/          MCP server setup, tools, resources, prompt-builder
  └─ install/         skill + workflow bundler
```

Communicate between layers via **DTOs** — plain typed objects. A DTO carries exactly what the receiver needs; it hides internal representation:

```ts
// Input DTO going into a service
export interface CreateTaskDto {
  title: string;
  type: string;
  priority: number;
  specId: string;
  persona?: string;
  dependencies?: string[];
}

// Output DTO coming back from a service
export interface TaskSummaryDto {
  storyId: string;
  taskCount: number;
  tasks: Array<{ id: string; title: string; priority: number; persona: string | undefined }>;
}
```

---

## CLI Layer — Commands and Views

### Commands are thin

A Commander action handler's only job: parse CLI options into a typed DTO, call a service or use-case, pass the result to a view, and exit. No business logic:

```ts
// src/commands/start.ts
import { Command } from 'commander';
import type { PipelineService } from '../services/pipeline.js';
import { renderStartSummary, renderStartError } from '../views/start.view.js';

export interface StartOptions {
  port: string;
  dispatchMode: 'auto' | 'manual';
  mock: boolean;
  config: string;
}

export function makeStartCommand(pipeline: PipelineService): Command {
  return new Command('start')
    .description('Run the full pipeline for a Jira ticket')
    .argument('<ticket-id>', 'Jira issue key, e.g. PROJ-123')
    .option('--port <number>', 'MCP server port', '3333')
    .option('--dispatch-mode <mode>', 'auto or manual', 'auto')
    .option('--config <path>', 'path to .workbench.yaml', '.workbench.yaml')
    .option('--no-mock', 'use the real Jira Cloud API')
    .action(async (ticketId: string, opts: StartOptions) => {
      const result = await pipeline.run(ticketId, opts);
      if (!result.ok) { renderStartError(result.error); process.exit(2); }
      renderStartSummary(result.value);
    });
}
```

Wire all commands in `cli.ts`:

```ts
// src/cli.ts
import { Command } from 'commander';
import { makeStartCommand } from './commands/start.js';

const program = new Command()
  .name('workbench')
  .version('0.1.0')
  .exitOverride(); // makes Commander throw CommanderError instead of process.exit — enables tests

program.addCommand(makeStartCommand(services));
await program.parseAsync();
```

`exitOverride()` is essential for testability — without it, Commander calls `process.exit()` directly and kills the test runner.

### Views are pure output

Views format data for the terminal. They take a DTO and write to stdout/stderr. No logic, no service calls, no branching on business rules:

```ts
// src/views/start.view.ts
import type { TaskSummaryDto } from '../services/pipeline.js';

export function renderStartSummary(summary: TaskSummaryDto): void {
  console.log(`\n${summary.taskCount} tasks planned for ${summary.storyId}`);
  for (const task of summary.tasks) {
    const persona = task.persona ?? 'unassigned';
    console.log(`  [${task.priority}] ${task.id} — ${task.title} (${persona})`);
  }
  console.log();
}

export function renderStartError(error: Error): void {
  console.error(`\nError: ${error.message}`);
}
```

If a view contains an `if` that tests a business condition (not just a display toggle), move that condition into the service and return a richer DTO.

---

## Service / Use-Case Layer

Services orchestrate repositories and domain logic. They return typed `Result` objects — no stdout, no `process.exit`:

```ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

```ts
// src/services/pipeline.ts
export class PipelineService {
  constructor(
    private readonly jira: JiraClient,
    private readonly ledger: TaskLedger,
    private readonly config: WorkbenchConfig,
  ) {}

  async run(ticketId: string, opts: StartOptions): Promise<Result<TaskSummaryDto>> {
    const story = await this.jira.fetchStory(ticketId);
    // ... invoke spec agent, planner agent, populate ledger
    return { ok: true, value: { storyId: story.id, taskCount: tasks.length, tasks } };
  }
}
```

Inject dependencies through the constructor — no singletons, no module-level state. Wire everything at startup in `cli.ts`.

---

## Repository / Infrastructure Layer

### Interfaces enable swapping and testing

Define the interface in the domain/service layer; put implementations in the infrastructure layer:

```ts
// src/jira/client.ts — the contract
export interface JiraClient {
  fetchStory(ticketId: string): Promise<Story>;
}

// src/jira/mock.ts — test/default implementation
export class MockJiraClient implements JiraClient {
  async fetchStory(ticketId: string): Promise<Story> {
    return MockStories[ticketId] ?? generateMockStory(ticketId);
  }
}

// src/jira/cloud.ts — real implementation
export class CloudJiraClient implements JiraClient {
  constructor(
    private readonly email: string,
    private readonly token: string,
  ) {}

  async fetchStory(ticketId: string): Promise<Story> { /* HTTP call */ }
}
```

### TaskLedger — stateful class

The ledger is the one place with mutable in-session state. Encapsulate it:

```ts
// src/ledger/index.ts
export class TaskLedger {
  private readonly tasks = new Map<string, Task>();

  createTask(dto: CreateTaskDto): Task { /* ... */ }
  claimTask(taskId: string, agentId: string): Result<Task> { /* ... */ }
  getPendingTasks(): Task[] { return [...this.tasks.values()].filter(t => t.status === 'pending'); }
  getTask(taskId: string): Task | undefined { return this.tasks.get(taskId); }
}
```

Status transitions live in `ledger/transitions.ts` as pure functions — easier to unit-test in isolation from the ledger:

```ts
// src/ledger/transitions.ts
export function applyTransition(task: Task, event: TaskEvent): Result<Task> { /* FSM logic */ }
```

---

## MCP Server Layer

### Use the high-level `McpServer` API

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
```

Register tools with their Zod schema — the SDK validates input before your handler runs:

```ts
// src/server/tools.ts
export function registerTools(server: McpServer, ledger: TaskLedger): void {
  server.registerTool(
    'claim_task',
    {
      description: 'Claim a pending task for execution',
      inputSchema: z.object({
        task_id: z.string(),
        agent_id: z.string(),
      }),
    },
    async (args) => {
      const result = ledger.claimTask(args.task_id, args.agent_id);
      if (!result.ok) {
        return { isError: true, content: [{ type: 'text', text: result.error.message }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result.value) }] };
    },
  );
}
```

**Return `{ isError: true }` instead of throwing.** Throwing from a tool handler closes the session. Returning an error lets the calling agent see it and self-correct.

### Resource handlers are read-only

Resources project ledger state — never mutate in a resource handler:

```ts
// src/server/resources.ts
export function registerResources(server: McpServer, ledger: TaskLedger, story: Story): void {
  server.registerResource(
    'workbench://story',
    { description: 'The fetched Jira story for this session' },
    async () => ({
      contents: [{ uri: 'workbench://story', text: JSON.stringify(story), mimeType: 'application/json' }],
    }),
  );

  server.registerResource(
    'workbench://tasks/pending',
    { description: 'All tasks with status pending' },
    async () => ({
      contents: [{
        uri: 'workbench://tasks/pending',
        text: JSON.stringify(ledger.getPendingTasks()),
        mimeType: 'application/json',
      }],
    }),
  );
}
```

### Server factory — create, don't start

`server/index.ts` builds the server; the CLI command binds the transport and starts listening:

```ts
// src/server/index.ts
export function createMcpServer(ledger: TaskLedger, story: Story, spec: Spec): McpServer {
  const server = new McpServer({ name: 'workbench', version: '0.1.0' });
  registerTools(server, ledger);
  registerResources(server, ledger, story, spec);
  return server;
}
```

---

## OOP Guidelines

Use classes for:
- **Stateful encapsulation** — `TaskLedger` (owns mutable in-memory state)
- **Polymorphism** — `MockJiraClient` / `CloudJiraClient` both implement `JiraClient`
- **Services with injected dependencies** — makes constructor injection natural

Use functions for:
- Pure transformations — prompt building, config parsing, view rendering
- Single-operation utilities with no persistent state

No inheritance hierarchies — prefer composition. No IoC container — explicit constructor injection at the wiring point (`cli.ts`) is sufficient and far more readable at this scale.

---

## Testing

### Ledger and FSM — pure unit tests

```ts
import { describe, it, expect } from 'vitest';
import { TaskLedger } from '../ledger/index.js';

describe('TaskLedger.claimTask', () => {
  it('transitions pending → claimed', () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({ title: 'test', type: 'backend_api', priority: 1, specId: 'spec-1' });
    const result = ledger.claimTask(task.id, 'agent-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('claimed');
    expect(result.value.claimedBy).toBe('agent-1');
  });

  it('rejects claiming an already-claimed task', () => {
    const ledger = new TaskLedger();
    const task = ledger.createTask({ title: 'test', type: 'backend_api', priority: 1, specId: 'spec-1' });
    ledger.claimTask(task.id, 'agent-1');
    const result = ledger.claimTask(task.id, 'agent-2');
    expect(result.ok).toBe(false);
  });
});
```

### MCP server — real transport integration tests

Never mock the MCP SDK. Spin up a real `McpServer` on a random port:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMcpServer } from '../server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('MCP: claim_task', () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    const ledger = new TaskLedger();
    ledger.createTask({ title: 'test task', type: 'backend_api', priority: 1, specId: 'spec-1' });
    server = createMcpServer(ledger, mockStory, mockSpec);
    const port = await bindToRandomPort(server);
    client = new Client({ name: 'test', version: '0.0.1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it('claims a pending task', async () => {
    const result = await client.callTool('claim_task', { task_id: 'task-spec-1-001', agent_id: 'agent-1' });
    expect(result.isError).toBeFalsy();
  });
});
```

What to mock: only `JiraClient` (interface boundary to an external system). Everything else — the ledger, the FSM, the MCP transport — tests with real implementations.

### Never type-cast into private fields in tests

When a test needs to set up state that would normally require multiple steps through the public API, the temptation is to cast into the internals:

```ts
// ❌ — fragile, defeats encapsulation, not refactor-safe
(ledger as unknown as { tasks: Map<string, Task> }).tasks.set(id, fakeTask);
```

Instead, expose the transition path through the public API or add a purpose-built factory:

```ts
// ✅ — expose all state-advancing methods on TaskLedger (startTask, submitTask, etc.)
//    so tests can advance through the FSM without backdoors
const ledger = new TaskLedger();
const task = ledger.createTask(dto);
ledger.claimTask(task.id, 'agent-1');
ledger.startTask(task.id);   // these methods exist on the ledger for this reason
ledger.submitTask(task.id, output);
```

If reaching a state requires more methods than exist today, add them to the ledger — the test is telling you the public API is incomplete.

---

## Quick Reference: Common Mistakes

| Mistake | Fix |
|---------|-----|
| `tasks[0].id` without null check | `const t = tasks[0]; if (!t) throw ...; t.id` |
| `import './types'` (missing `.js`) | `import './types.js'` |
| `import { Task }` for a type | `import type { Task }` |
| Business logic in a `.action()` handler | Extract to a service/use-case |
| `console.log` in a service | Return a DTO; view does the logging |
| `undefined` passed for optional prop | Omit the property |
| `as TaskStatus` / `as Result<Task>` cast | `TaskStatusSchema.parse(raw)` or fix the return type |
| `as const` (widening prevention) | ✅ fine — not a type cast |
| Throwing from an MCP tool handler | Return `{ isError: true, content: [...] }` |
| Casting into private fields in tests | Expose a public helper method on the class |
| Import path `../../../../../../src/foo.js` | `'../foo.js'` (relative to your file in `src/`) |
| `schema.merge(other)` (Zod v4) | `schema.extend({ ...otherShape })` |
| Inheritance for variation | Implement a shared interface, compose |
| `enum TaskStatus { ... }` | `z.enum([...])` + `z.infer<>` |
