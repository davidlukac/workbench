---
title: Tech Stack
type: config
permalink: workbench/tech-stack
tags:
- tech-stack
- typescript
- mcp
- dependencies
---

# Tech Stack

## Runtime
- **Language**: TypeScript `^5.8`, strict mode + full strict flags
- **Node.js**: `>=22.0.0` minimum; `.nvmrc` pins Node 24 (Active LTS)
- **Module system**: ESM (`"type": "module"`, `NodeNext` resolution — explicit `.js` extensions required)
- **Package name**: `@workbench/cli`

## Production dependencies (4 total, all zero-dependency)
| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server + stdio transport; Streamable HTTP optional later |
| `commander` | `^14.0.0` | CLI subcommands, option parsing |
| `zod` | `^4.4.0` | Schema validation + inferred domain types |
| `yaml` | `^2.7.0` | `.workbench.yaml` config parsing |

## Dev dependencies
- `typescript`, `tsup` (esbuild-backed build, CJS+ESM dual output), `vitest`, `@types/node`, `@biomejs/biome`

## Key tsconfig flags
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`
- `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`
- `module: "NodeNext"`, `moduleResolution: "NodeNext"`

## MCP transport
Primary v1 transport is stdio. Users add Workbench to agent host MCP configuration, e.g. `codex mcp add workbench -- npx workbench mcp`.

`workbench mcp` and `workbench serve` are equivalent entry points. The server is not intended to be manually started once as a singleton HTTP daemon. The host launches it as needed.

Because separate host sessions may launch separate stdio subprocesses, the ledger must not be process-local memory. Authoritative session state should live in a workspace-scoped SQLite ledger store under `.workbench/` or an equivalent session directory, with WAL, transactions, and conditional updates/revisions. Streamable HTTP remains optional/future; HTTP+SSE is legacy/deprecated.
## Build commands
```sh
npm run build        # tsup → dist/ (CJS+ESM)
npm run dev          # tsup --watch
npm run lint         # biome check src/
npm run format       # biome format src/ --write
npm run test         # vitest run
npm run test:watch   # vitest
```

## Repository Layer
`src/repository/` organises persistence around domain entities. Each entity has its own interface, three implementation tiers (FileSystem, Memory, MultiChannel), and a separate `FileAdapter` for raw file I/O.

```
src/repository/
├── story-repository.ts               — StoryRepository interface (upsertStory, findStory)
├── spec-repository.ts                — SpecRepository interface (upsertSpec with merge, readSpec)
├── task-repository.ts                — TaskRepository interface (upsertTask, findTask, listTasks)
├── file-adapter.ts                   — FileAdapter interface (readFile, writeFile, mkdir)
├── fs-story-repository.ts            — FileSystemStoryRepository
├── memory-story-repository.ts        — MemoryStoryRepository
├── multi-channel-story-repository.ts — fan-out, implements StoryRepository
├── fs-spec-repository.ts             — FileSystemSpecRepository (specPath baked in at construction)
├── memory-spec-repository.ts         — MemorySpecRepository (merge-capable)
├── multi-channel-spec-repository.ts  — fan-out, implements SpecRepository
├── fs-task-repository.ts             — FileSystemTaskRepository
├── memory-task-repository.ts         — MemoryTaskRepository
├── multi-channel-task-repository.ts  — fan-out, implements TaskRepository
├── fs-file-adapter.ts                — FileSystemFileAdapter (node:fs/promises)
├── memory-file-adapter.ts            — MemoryFileAdapter (Map + .seed())
└── index.ts                          — re-exports all interfaces and implementations
```

Key design decisions:
- `StoryLedger` remains the in-memory FSM orchestrator (status transitions, locking). `StoryRepository` is write-through persistence only — it does not enforce FSM rules.
- `MultiChannelXxxRepository implements XxxRepository` — callers are unaware of fan-out; secondaries fail silently (logged via Logger).
- `FileAdapter` is injected into tool handlers that need raw file I/O (`fetch_story`, `update_story_status`, `story-source/local-file`), keeping domain repositories free of utility file operations.
- `SpecRepository.upsertSpec(fields: Partial<Spec>)` merges partial fields onto the existing record and increments revision; `story_id` is part of `Partial<Spec>` (optional, used when available).
- `WorkbenchServer` constructs `FileSystemFileAdapter`, `FileSystemSpecRepository`, and `FileSystemStoryRepository` and injects them into the relevant tool handlers. Tests inject Memory implementations directly.

## Source layout (planned)
```
src/
  cli.ts / index.ts
  types.ts                 # Zod schemas → inferred types
  config/schema.ts, loader.ts
  ledger/index.ts, transitions.ts
  server/index.ts, resources.ts, tools.ts, prompt-builder.ts
  jira/client.ts, mock.ts, cloud.ts      # mock is for tests/local development
  story-source/local-file.ts, normalize.ts
  install/skills.ts, workflows.ts
  verify.ts
```

## Framework Boundary — 2026-05-08
Commander is the top-level CLI framework. It owns command parsing, help/version output, option validation, and routing commands to implementation functions. `workbench mcp` / `workbench serve` should be thin Commander subcommands that call `runMcpServer({ configPath })`.

The official MCP TypeScript SDK owns MCP server behavior: `McpServer`, tool/resource registration, protocol lifecycle, and `StdioServerTransport`. Workbench code owns config loading, workspace ledger store, locking, task transitions, and prompt/context assembly.

Boundary:
- `src/cli.ts`: Commander only; no MCP JSON-RPC framing or ledger mutation rules.
- `src/server/*`: official MCP SDK server setup and handlers; no CLI command routing.
- `src/ledger/*`: workspace store, locking, task FSM; no transport-specific concerns.
