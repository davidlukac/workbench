# AI Agent Workbench — Tech Stack

For the feature spec and domain model see [`Feature.md`](Feature.md). For commands, options, and exit codes see [`CLI.md`](CLI.md).

## Summary

Strict TypeScript CLI + in-process MCP server. Four runtime dependencies, all zero-dependency themselves. Ships via npm; zero-install via `npx`.

---

## Runtime

| Concern | Choice | Version | Notes |
|---------|--------|---------|-------|
| Language | TypeScript | `^5.8` | `strict: true` + full strict flags (see tsconfig below) |
| Node.js | LTS | `>=22.0.0` | Node 22 (Maintenance LTS, EOL April 2027) as minimum; Node 24 (Active LTS) recommended |
| Module system | ESM | — | `"type": "module"` in package.json |
| Distribution | npm + npx | — | Published to npm; runnable as `npx workbench` without install |

Node 22 is the conservative minimum: it's the oldest non-EOL LTS as of May 2026, universally present in CI/CD environments, and past the ESM stability curve. Node 20 reached EOL in April 2026 and is excluded.

---

## Production Dependencies

Four packages. All are zero-dependency themselves — no transitive bloat.

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | MCP server + transport (stdio primary; Streamable HTTP optional later) |
| `commander` | `^14.0.0` | CLI subcommands, option parsing, help text |
| `zod` | `^4.4.0` | Schema validation — config file, domain models, MCP tool args |
| `yaml` | `^2.7.0` | `.workbench.yaml` config parsing and stringification |

### Why these four

**`@modelcontextprotocol/sdk`** — The official TypeScript SDK for MCP. Ships server primitives, resource/tool/prompt registration, protocol lifecycle handling, stdio transport, and optional Streamable HTTP transport. Stable v1.x is the production target; v2 exists on the upstream main branch but is not the v1 implementation target.

**`commander`** — De facto standard for Node.js CLI tools. Zero dependencies, built-in TypeScript types (no `@types/` needed), ~35M weekly downloads. Fits this tool's command surface (a handful of subcommands) without the overhead of Ink/Yargs/Clipanion.

**`zod` v4** — 57% smaller than v3, 14× faster string parsing. `z.object()` shapes double as TypeScript types via `z.infer<>`, which keeps domain model types and runtime validation co-located. Standard Schema compliant — works directly with the MCP SDK's schema integration. Replaces any bespoke validation layer.

**`yaml`** — Full YAML 1.2 parser, zero dependencies, actively maintained. Used only for `.workbench.yaml` config; not bundled into the main MCP server path.

---

## Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Compiler |
| `tsup` | Build — esbuild-backed, CJS + ESM dual output, `.d.ts` generation |
| `vitest` | Tests — native ESM, TypeScript-native, no transform config |
| `@types/node` | Node.js built-in type definitions |
| `@biomejs/biome` | Lint + format — single tool, replaces ESLint + Prettier |

---

## TypeScript Configuration

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",

    // Strict
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,

    // Quality
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": false,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`NodeNext` module resolution is required for ESM in Node.js — it enforces explicit `.js` extensions on imports (which resolve to `.ts` at compile time) and correctly handles `package.json` `exports` maps.

---

## MCP Transport

The MCP server uses **stdio transport** as the primary v1 transport. Users add it to their agent host's MCP configuration, for example:

```sh
codex mcp add workbench -- npx workbench mcp
```

`workbench mcp` and `workbench serve` are the same MCP server entry point. It is not intended to be manually started once as an independent singleton that all agents connect to over HTTP. The host launches it as configured, the same way local MCPs such as Basic Memory are commonly used.

The important implementation consequence is that the ledger cannot depend on process-local memory if separate host sessions may launch separate stdio server subprocesses. Shared coordination state must live in a workspace-scoped SQLite ledger store under `.workbench/` or an equivalent session directory. Use WAL, transactions, and conditional updates/revisions for safe concurrent access.

Streamable HTTP remains a possible future or compatibility transport, but it is not the v1 default. HTTP+SSE is legacy/deprecated and should not be used for new implementation work.

```
agent host
  └─ launches: npx workbench mcp  (stdio)
       └─ Workbench MCP reads/writes workspace-scoped SQLite ledger
            ├─ Spec / Planner tools update session state
            ├─ Implementation agents claim and submit tasks
            └─ Review agents verify or request changes
```

---

## CLI Entry Points

Commander is the top-level CLI framework. It owns command parsing, help/version output, option validation, and routing commands to implementation functions. It does not own MCP protocol behavior.

The official MCP SDK owns the MCP server implementation for `workbench mcp` / `workbench serve`: server creation, tool/resource registration, lifecycle negotiation, and stdio transport.

Boundary:

| Layer | Owns | Must not own |
|-------|------|--------------|
| `src/cli.ts` / Commander | CLI parsing, subcommand routing, exit codes | MCP JSON-RPC framing, ledger mutation rules |
| `src/server/*` / MCP SDK | MCP server, stdio transport, tools/resources | CLI help text, process-wide command routing |
| `src/ledger/*` | Workspace store, locking, task FSM | Transport-specific concerns |

```json
// package.json (excerpt)
{
  "name": "@workbench/cli",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "bin": {
    "workbench": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

The CLI binary is `dist/cli.js` (ESM entry; `#!/usr/bin/env node` shebang injected by tsup). For installation, commands, options, environment variables, and exit codes see [`CLI.md`](CLI.md).

---

## Build

```ts
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,           // injects CJS shims (__dirname, __filename) for ESM compat
  splitting: false,      // keep output predictable for a CLI binary
});
```

Dual CJS + ESM output covers both `require()` consumers (older tooling) and native ESM. The CLI binary (`dist/cli.js`) is the ESM entry; `#!/usr/bin/env node` shebang is injected by tsup.

---

## Testing

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    coverage: { provider: 'v8' },
  },
});
```

- Unit tests for ledger state machine, config schema, task status transitions
- Integration tests start the MCP server over stdio and connect a real test client
- No mocking of the MCP SDK — test the real transport layer

---

## Source Layout

```
src/
  cli.ts                  # Commander program, all subcommands; mcp/serve call runMcpServer()
  index.ts                # Public API surface (library consumers)

  types.ts                # Domain types: Story, Spec, Task, … (Zod schemas → inferred TS types)

  config/
    schema.ts             # Zod schema for .workbench.yaml
    loader.ts             # Parse, validate, merge with defaults

  repository/             # Persistence layer — four domain interfaces + implementations
    story-repository.ts               — StoryRepository interface (upsertStory, findStory)
    spec-repository.ts                — SpecRepository interface (upsertSpec with merge, readSpec)
    task-repository.ts                — TaskRepository interface (upsertTask, findTask, listTasks)
    file-adapter.ts                   — FileAdapter interface (readFile, writeFile, mkdir)
    fs-story-repository.ts            — FileSystemStoryRepository
    memory-story-repository.ts        — MemoryStoryRepository
    multi-channel-story-repository.ts — fan-out, implements StoryRepository
    fs-spec-repository.ts             — FileSystemSpecRepository (specPath baked in)
    memory-spec-repository.ts         — MemorySpecRepository (merge-capable)
    multi-channel-spec-repository.ts  — fan-out, implements SpecRepository
    fs-task-repository.ts             — FileSystemTaskRepository
    memory-task-repository.ts         — MemoryTaskRepository
    multi-channel-task-repository.ts  — fan-out, implements TaskRepository
    fs-file-adapter.ts                — FileSystemFileAdapter (node:fs/promises)
    memory-file-adapter.ts            — MemoryFileAdapter (Map + .seed())
    index.ts                          — re-exports all interfaces and implementations

  server/
    index.ts              # WorkbenchServer: MCP SDK setup, tool + resource registration
    resources.ts          # workbench:// resource handlers
    tools/                # One file per MCP tool handler

  story-source/
    local-file.ts         # Parse local Markdown/YAML/JSON story files into Story

  story-store/
    index.ts              # StoryLedger — in-memory FSM for story status transitions

  task-store/
    index.ts              # TaskLedger — in-memory task lifecycle store

  install/
    skills.ts             # Bundle + install Skills

  verify.ts               # Config + environment verification logic
```

### Repository Design

The repository layer is organised around domain entities. Each entity has its own interface (`StoryRepository`, `SpecRepository`, `TaskRepository`) plus a separate `FileAdapter` for raw file I/O. Three implementation tiers exist for each interface:

- **FileSystem** — production default; writes to `.workbench/` on disk.
- **Memory** — used in tests; in-process, no disk I/O. `MemoryFileAdapter.seed()` pre-populates file content.
- **MultiChannel** — fan-out wrapper; writes to primary then all secondaries; secondary failures are logged and swallowed so the primary path always succeeds.

Key design decisions:
- `StoryLedger` remains the in-memory FSM orchestrator (status transitions, locking). `StoryRepository` is write-through persistence only — it does not enforce FSM rules.
- `MultiChannelXxxRepository implements XxxRepository`, so callers are unaware of fan-out.
- `FileAdapter` is injected into tool handlers that need raw file I/O (`fetch_story`, `update_story_status`, `story-source/local-file`), keeping domain repositories free of utility file operations.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Module system | ESM | Modern Node.js standard; avoids CJS/ESM interop at runtime |
| CLI framework | Commander | Top-level command parser/router; thin wrapper over implementation functions |
| MCP server framework | Official MCP TypeScript SDK | Owns protocol lifecycle, server registration APIs, and stdio transport |
| MCP transport | stdio primary | Matches host MCP configuration flow: `npx workbench mcp` |
| Ledger persistence | Workspace-scoped ephemeral files | Allows multiple stdio server subprocesses to coordinate safely; files can be cleaned after session |
| HTTP server | Not v1 default | Streamable HTTP can be added later without changing ledger/tool semantics |
| Validation | Zod v4 | Types + runtime validation co-located; v4 is 57% smaller, 14× faster than v3 |
| Linting | Biome | Single tool replaces ESLint + Prettier; 10–100× faster |
| Testing | Vitest | Native ESM, no transform config, TypeScript-native |
| `noUncheckedIndexedAccess` | Enabled | Forces null checks on all array/record access — catches a class of runtime bugs at compile time |
| Node minimum | `>=22.0.0` | Oldest non-EOL LTS (April 2026); `>=24.0.0` recommended for new installs |
