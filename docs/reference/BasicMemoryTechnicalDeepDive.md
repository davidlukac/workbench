# Basic Memory Technical Deep Dive

Research date: 2026-05-09

This document summarizes a technical review of Basic Memory as a reference system for Workbench. The goal is not to clone Basic Memory. It is to identify architectural patterns, implementation practices, and failure modes that apply to Workbench's stdio MCP server and workspace-scoped task ledger.

## Executive Summary

Basic Memory is a local-first MCP server and CLI for persistent AI memory. Its central architectural move is simple and strong: user-owned Markdown files are the source of truth, while SQLite is a derived index for search, graph traversal, and fast tool responses. The MCP server exposes read/write tools over that local knowledge system, and startup reconciles config, database schema, and file state.

Workbench has a similar shape at the transport and coordination boundary: a host launches an MCP server over stdio, multiple agent sessions may touch the same local state, and the server must put all authoritative mutation behind tools rather than asking agents to edit internal files directly.

The important difference is state criticality. Basic Memory can tolerate eventually consistent indexing because files remain authoritative. Workbench cannot tolerate eventual consistency for core ledger transitions such as `claim_task`, `start_task`, `submit_task`, `verify_task`, and `sign_off_task`. A double claim or stale transition is a correctness bug, not a delayed index update. Workbench should borrow Basic Memory's composition and operational patterns, but its ledger store must have stronger transactional semantics.

## Sources Reviewed

Local installed package:

- Basic Memory version: `0.20.3`
- Installed source root: `/Users/Madar/.local/share/uv/tools/basic-memory/lib/python3.12/site-packages/basic_memory`
- Key modules reviewed:
  - `mcp/server.py`
  - `mcp/container.py`
  - `cli/commands/mcp.py`
  - `mcp/project_context.py`
  - `db.py`
  - `services/initialization.py`
  - `services/entity_service.py`
  - `services/file_service.py`
  - `sync/coordinator.py`
  - `sync/sync_service.py`
  - `sync/watch_service.py`
  - `services/search_service.py`
  - `repository/sqlite_search_repository.py`
  - `models/knowledge.py`
  - `models/search.py`
  - `markdown/entity_parser.py`
  - `markdown/markdown_processor.py`
  - `mcp/tools/write_note.py`
  - `mcp/tools/search.py`
  - `mcp/tools/build_context.py`
  - Alembic migrations under `alembic/versions/`

Official docs and repository:

- Technical information: https://docs.basicmemory.com/reference/technical-information
- GitHub repository / README: https://github.com/basicmachines-co/basic-memory

Official docs describe Basic Memory as a file-first system with a core knowledge engine, database, MCP server, CLI tools, and file watcher. They also explicitly state that Markdown files are the knowledge representation and the database is a secondary index. The README describes the runtime model as Markdown files plus SQLite indexing, semantic extraction into Entities, Observations, and Relations, bidirectional sync, MCP tools, and `memory://` URLs.

## Product And Runtime Model

Basic Memory solves persistent AI context. Humans and LLMs write the same Markdown files. The AI side uses MCP tools to search, read, edit, and connect notes. The human side can use any editor, Obsidian, Git, or direct filesystem access.

The runtime shape is:

```text
agent host
  -> launches: basic-memory mcp  (stdio by default)
      -> FastMCP server
          -> project routing / local-vs-cloud client selection
          -> local ASGI/API client or cloud client
              -> service layer
                  -> filesystem and database
```

Basic Memory also supports HTTP transports (`streamable-http`, `sse`) for server-style deployment, but local MCP usage is stdio-first. In stdio mode it is careful to keep logs out of stdout because stdout is reserved for MCP protocol frames.

For Workbench, this validates the current transport decision in `docs/HowMcpWorks.codex.md`: stdio is a normal production transport for local MCP tools, and durable/shared state must live outside the server process.

## Architecture

### Main Layers

Basic Memory is modular in a way that maps cleanly to Workbench:

| Layer | Basic Memory | Workbench analogue |
| --- | --- | --- |
| CLI entrypoint | Typer commands, including `basic-memory mcp` | Commander commands, including `workbench mcp` |
| MCP server | FastMCP server and registered tools/resources/prompts | MCP SDK server with tools/resources |
| Composition root | `McpContainer` resolves config and runtime mode | Proposed `server/container` or `app/context` |
| Project/session routing | `ProjectResolver`, `get_project_client` | Workspace/session resolver |
| Services | Entity, file, search, sync, project services | Ledger, config, Jira, prompt/context services |
| Repositories | SQLAlchemy repositories | Store abstractions over SQLite or files |
| Durable data | Markdown files plus SQLite index | `.workbench/` ledger store |
| Background work | sync watcher, embedding backfill | optional status watcher, stale lock cleanup |

### Composition Root

`mcp/container.py` is one of the cleaner pieces. It centralizes config access and runtime mode resolution:

- `McpContainer.create()` reads config once.
- Runtime mode determines whether file sync should start.
- Sync coordinator creation is owned by the container.
- Downstream modules receive dependencies through helpers rather than each tool independently reading global config.

Workbench should adopt this pattern. A v1 `WorkbenchContainer` should resolve:

- workspace root
- `.workbench.yaml`
- `.workbench/` state paths
- ledger store implementation
- lock/transaction policy
- Jira adapter mode
- MCP server options
- clock and ID generator for testability

This keeps MCP tool handlers thin and makes integration tests more direct.

### Lifespan Startup

`mcp/server.py` uses a FastMCP lifespan manager as the server lifecycle boundary. Startup does real infrastructure work:

- create the container
- log resolved config and project routing
- validate local cloud auth tokens without making network calls
- initialize the app
- run migrations
- reconcile projects
- initialize search index
- log semantic embedding status
- start background embedding backfill if needed
- start the sync coordinator

Shutdown cancels background tasks, stops sync, and closes DB connections if the server created them.

Workbench should use an explicit MCP server lifecycle hook even if the TypeScript SDK names differ. The equivalent startup should:

- resolve workspace root
- load config
- initialize `.workbench/`
- migrate or validate ledger schema
- recover expired locks
- reconcile session metadata
- expose deterministic readiness failures
- ensure logging goes to stderr

This is more robust than lazily initializing state in the first tool call.

## Data Model

Basic Memory's core graph model is:

- `Project`: named project with path, active/default flags, permalink, and scan watermark fields.
- `Entity`: one document or file, with title, note type, metadata, content type, project, permalink, file path, checksum, mtime, size, created/updated metadata, and optional cloud user metadata.
- `Observation`: categorized fact attached to an entity.
- `Relation`: directed edge from one entity to another entity or unresolved target name.
- Search index rows: derived rows for entities, observations, and relations.
- Vector chunks and embeddings: derived semantic-search state.

The notable modeling principle is separation between human source and machine index. Markdown keeps the durable human-facing representation. Database rows normalize identity, relationships, checksums, search, and traversal.

Workbench's analogous model should be more state-machine oriented:

- `Session`: one story execution session.
- `Story`: immutable source ticket.
- `Spec`: generated, user-approved requirements artifact.
- `Task`: mutable lifecycle record.
- `TaskEvent`: optional append-only audit record.
- `Lock` or claim fields: task ownership and expiry.
- `Evidence`: execution metadata.

The Basic Memory lesson is to keep a canonical normalized model and derive views from it. The Workbench-specific twist is that task transitions are authoritative writes, not derived index updates.

## Storage And Concurrency

### What Basic Memory Does

Basic Memory uses SQLite locally and Postgres in cloud mode. Local SQLite setup includes:

- SQLAlchemy async engine
- `PRAGMA journal_mode=WAL`
- `PRAGMA busy_timeout=10000`
- `PRAGMA synchronous=NORMAL`
- `PRAGMA cache_size=-64000`
- `PRAGMA temp_store=MEMORY`
- foreign keys enabled per session
- scoped sessions that commit on success and roll back on exception
- Alembic migrations at startup

WAL plus busy timeout is an important concurrency signal. Basic Memory expects separate processes and background tasks to interact with the same local database and chooses a proven concurrency primitive rather than inventing a process-local state model.

File writes use `file_utils.write_file_atomic()` through `FileService.write_file()`, and checksum tracking is used to identify changes. `MarkdownProcessor.write_file()` also supports an `expected_checksum` dirty check, although the MCP note-write path mostly works at the service/API level rather than requiring every write to pass a dirty token.

### Workbench Implication

Workbench should strongly consider SQLite for the v1 ledger store rather than JSON files plus ad hoc locks.

The existing design gap lists three options:

- JSON files + lock files + atomic rename
- SQLite
- append-only event log + snapshots

Basic Memory's implementation pushes the decision toward SQLite for Workbench because:

- stdio MCP can produce multiple subprocesses
- CLI helpers and MCP tools may run concurrently
- task claiming must be atomic
- transactions and uniqueness constraints are a better fit than lock-file discipline
- migrations are easier to reason about than hand-evolving JSON shapes

If Workbench still chooses JSON files, it should copy Basic Memory's discipline around atomic writes, checksums/revisions, and startup reconciliation. But JSON plus lock files must be proven with cross-process claim tests before being trusted.

Recommended Workbench ledger primitive:

```text
.workbench/
  workbench.db
```

With tables along these lines:

- `session`
- `story`
- `spec`
- `task`
- `task_dependency`
- `task_event`
- `task_evidence`
- `schema_version`

Use transactions for every lifecycle tool. `claim_task` should be one conditional update:

```sql
UPDATE task
SET status = 'claimed',
    claimed_by = ?,
    lock_owner = ?,
    lock_expires_at = ?,
    updated_at = ?
WHERE id = ?
  AND status = 'pending'
  AND dependencies_satisfied = 1
  AND (lock_expires_at IS NULL OR lock_expires_at < ?);
```

Then require `changes === 1` to return success. This is the task-ledger equivalent of Basic Memory's database-backed coordination.

## Sync, Reconciliation, And Watchers

Basic Memory has a sophisticated file sync pipeline:

1. scan project files
2. compare against DB mtime/size/checksum
3. detect new, modified, deleted, and moved files
4. parse Markdown into structured graph records
5. update DB rows
6. resolve relations
7. update text and vector search indexes
8. update project scan watermark

It includes several production-grade details:

- initial full scan, then incremental scan using watermarks
- quick file-count check to detect deletions
- mtime/size comparison before expensive checksum computation
- checksum-based move detection
- circuit breaker for repeatedly failing files
- bounded failure cache
- slow-file warnings
- background watcher with debounce
- ignore patterns
- project reload cycle
- explicit skip conditions for tests and cloud-only projects

Workbench probably does not need a filesystem watcher in v1. Agents should mutate the ledger through MCP tools, not by editing `.workbench` internals. Still, Workbench does need startup reconciliation:

- expired locks return to claimable state
- tasks stuck in `claimed` with expired locks become pending again
- incomplete writes from prior process exits are detected
- schema version is validated
- task dependency readiness is recalculated or queried dynamically

Basic Memory's scan-watermark idea maps to Workbench as a `ledger_revision` or `task.updated_at` strategy, not as a file watcher.

## MCP Design

Basic Memory registers tools via decorators imported by side effect in `cli/commands/mcp.py`. Tool modules import the global `mcp` server object and register themselves. Each tool has:

- a clear natural-language description
- typed parameters through Python typing and Pydantic validators
- FastMCP annotations such as `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`
- optional output format selection (`text` or `json`)
- context-aware caching through FastMCP `Context`
- telemetry around tool calls
- project resolution before service work

This is useful for Workbench even with the TypeScript MCP SDK:

- Register tools in focused modules, but keep actual business logic in services.
- Use schemas as the contract boundary, not handwritten argument parsing.
- Annotate tool behavior when the SDK supports it.
- Return structured data for agents, plus short text for compatibility where useful.
- Keep tool names aligned to user intent and state transitions.

Basic Memory exposes both broad "assistant ergonomics" tools (`search_notes`, `build_context`) and lower-level CRUD tools (`write_note`, `edit_note`, `delete_note`). Workbench should mirror that split:

- Lifecycle tools: `claim_task`, `start_task`, `submit_task`, `verify_task`, etc.
- Context tools: `get_task_prompt`, `list_ready_tasks`, `session_summary`.
- Ingestion tools: `fetch_story`, `update_spec`, `update_tasks`.

Do not let "ergonomic" tools blur mutation rules. In Basic Memory, `search_notes` is read-only. In Workbench, reading `workbench://tasks/pending` must never claim a task.

## Project Routing

Basic Memory has a mature project resolution story:

1. environment constraint: `BASIC_MEMORY_MCP_PROJECT`
2. explicit tool parameter
3. configured default project
4. discovery mode if allowed
5. error with available choices

It also supports cloud/local routing per project, workspace resolution, and context caching of active project/workspace.

Workbench needs a simpler version:

1. explicit CLI `--workspace` or MCP env constraint, if provided
2. nearest workspace root from current directory
3. `.workbench.yaml`
4. error with the resolved cwd and expected config path

The project resolver should be shared by CLI commands and MCP startup so `workbench status`, `workbench task next`, and MCP resources all point at the same ledger.

## Markdown And Human-Readable State

Basic Memory's Markdown parser is intentionally tolerant:

- YAML frontmatter is normalized because YAML scalars can become dates, numbers, booleans, lists, or dicts.
- malformed frontmatter falls back to plain Markdown instead of crashing sync
- BOM is stripped
- titles and types are coerced to strings
- observations and relations are extracted using markdown-it plugins
- file content is preserved while semantic sections can be normalized

The larger lesson is not "Workbench should store the ledger as Markdown." It is that if agents or humans are allowed to edit durable state, the parser must be forgiving and reconciliation must be explicit.

For Workbench, the authoritative ledger should not be hand-edited in normal operation. Human-readable exports are still valuable:

- `workbench status` for current state
- optional `session-summary.md`
- optional final archive under `.workbench/archive/`

But lifecycle state should stay in a validated store with transactions.

## Search And Context Assembly

Basic Memory's search stack is deeper than Workbench needs:

- SQLite FTS5 for local full-text search
- Postgres tsvector in cloud mode
- vector/hybrid search with FastEmbed/sqlite-vec
- metadata filtering
- relaxed FTS fallback for natural-language queries
- compact Markdown formatting for LLM consumption
- graph context traversal through `build_context`

Workbench does not need semantic search for the ledger. It does need context assembly. The closest analogue is Basic Memory's `build_context`: given a stable URI, resolve project, retrieve the primary item, traverse related context, and format it compactly for an LLM.

Workbench's `get_task_prompt` should follow the same principle:

- accept a stable task ID or `workbench://tasks/{id}`
- resolve workspace/session
- load task, story, spec ACs, dependencies, evidence, and prior review notes
- include persona and skill guidance
- return both structured JSON and compact text if useful

The important pattern is server-side context packing. Agents should not have to reconstruct task context through many ad hoc calls.

## Validation And Safety

Basic Memory contains several concrete safety patterns worth copying:

- Project path validation in `write_note` blocks path traversal.
- `write_note` defaults to conflict instead of overwrite, with explicit `overwrite=True`.
- Tool parameters use Pydantic validators for coercion and normalization.
- Config has migration logic for legacy formats.
- Startup logs config choices and route modes.
- Tool errors are often returned with actionable remediation.
- File sync circuit breaker prevents infinite retry loops on bad files.
- Test mode disables file watchers.
- MCP logging is file/stderr only, preserving stdout protocol safety.

Workbench-specific applications:

- Validate every tool payload with Zod.
- Reject invalid state transitions with structured errors.
- Require expected task revision on mutating tools, or perform conditional updates.
- Block path traversal for any evidence paths or changed files recorded by agents.
- Default to non-destructive behavior for reset/archive commands.
- Keep implementation, review, and sign-off tools permission-distinct in descriptions and prompts.
- Disable background cleanup/watch behavior in tests unless a test explicitly enables it.

## Observability And Operations

Basic Memory uses structured telemetry spans and logs throughout startup, routing, sync, search, and tool calls. It avoids stdout in MCP mode. It also exposes CLI commands such as `status`, `doctor`, `reindex`, project management, schema tools, and cloud sync helpers.

Workbench should add the operational equivalent early:

- `workbench verify`: config, ledger schema, skills, Jira env, write permissions
- `workbench status`: session/task summary
- `workbench doctor`: deeper ledger consistency checks
- `workbench task next`: claimable task discovery
- `workbench ledger inspect` or `workbench events`: useful if using event log

Basic Memory's `doctor` and `status` split is a good model: status is for everyday visibility; doctor is for consistency investigation.

## Unique Challenges Basic Memory Solves

Basic Memory's hard problems:

- maintaining bidirectional consistency between files and DB
- tolerating external human edits
- parsing loose Markdown/YAML safely
- resolving forward references
- scaling file scans across many notes
- offering both local and cloud routing without changing the MCP tool surface
- keeping MCP startup responsive while background indexing/backfill runs
- preserving protocol safety when launched over stdio

Workbench's hard problems differ:

- preventing duplicate task claims
- enforcing state-machine transitions
- coordinating multiple agents through separate stdio subprocesses
- keeping ephemeral state durable enough for process crashes
- making agent handoff context complete but compact
- separating implementation, review, and human sign-off authority
- representing failures, retries, blockers, and stale locks precisely

So the most useful Basic Memory patterns are infrastructural, not domain-model patterns.

## What Workbench Should Borrow

1. A real composition root.

   Centralize config, workspace, ledger store, runtime mode, and service construction. Avoid global config reads inside every tool.

2. Startup reconciliation.

   Use MCP server lifecycle to initialize storage, migrate schema, recover expired locks, and fail early on invalid setup.

3. SQLite with WAL for local concurrent state.

   Basic Memory's local SQLite configuration is a better starting point for Workbench than inventing cross-process JSON locking.

4. Thin MCP tools over service methods.

   Tool handlers should resolve context, validate args, call a service, and format output. State-machine logic belongs in ledger services.

5. Shared resolver between CLI and MCP.

   Basic Memory's project resolver prevents CLI/MCP drift. Workbench needs the same for workspace/session resolution.

6. Atomic writes and revision checks.

   If any Workbench artifact remains file-backed, use atomic write and expected revision/checksum semantics.

7. Context-pack tool.

   `get_task_prompt` should be Workbench's equivalent of `build_context`: one stable call that returns everything an agent needs.

8. Operational commands.

   Implement `status` and `doctor` as first-class tools for humans debugging agent workflows.

9. Helpful structured errors.

   Basic Memory's search error responses are verbose, but the principle is right: tool errors should say what failed and what the agent/user can do next.

10. Test-mode isolation.

   Disable background loops by default in tests and provide explicit lifecycle cleanup.

## What Workbench Should Not Copy Directly

1. File-first authority for mutable workflow state.

   Basic Memory's source of truth is human-owned Markdown. Workbench's source of truth should be transactional task state.

2. Eventual consistency for core transitions.

   Basic Memory can delay indexing. Workbench cannot delay or race task claims.

3. Broad tool surface too early.

   Basic Memory has many tools because knowledge management is exploratory. Workbench should keep v1 focused on the lifecycle and context API.

4. Cloud/local routing complexity.

   Basic Memory needs cloud because persistent knowledge crosses devices. Workbench is explicitly ephemeral and workspace-scoped in v1.

5. Search infrastructure.

   FTS/vector search is not necessary for a task ledger. Simple indexed queries and deterministic context assembly are enough.

6. Background watchers for internal state.

   Workbench should not expect humans or agents to edit ledger internals. Mutation should flow through MCP tools and CLI commands using the same store library.

## Recommended Workbench Architecture Adjustment

Gap 5a is resolved in favor of SQLite. Based on this deep dive, the v1 choice is:

```text
SQLite ledger store with WAL, transactions, and conditional updates.
```

Use SQLite as the authoritative ledger store, not merely an index. Keep optional Markdown/JSON exports for inspectability, not mutation.

Suggested source layout update:

```text
src/
  cli.ts
  server/
    mcp.ts
    container.ts
    resources.ts
    tools/
      taskLifecycle.ts
      ingestion.ts
      context.ts
  workspace/
    resolver.ts
    paths.ts
  ledger/
    store.ts
    sqliteStore.ts
    schema.ts
    migrations.ts
    transitions.ts
    contextPack.ts
    consistency.ts
  config/
    schema.ts
    loader.ts
```

Key constraints:

- Every lifecycle mutation runs inside one transaction.
- Every mutation validates current status, expected owner, and optional expected revision.
- `claim_task` is a conditional update and succeeds for exactly one caller.
- Expired locks are recovered at startup and before claim queries.
- Tools never bypass the LedgerStore to mutate the SQLite database.
- CLI commands and MCP tools share the same ledger service.

## Implementation Checklist For Workbench

- Add a ledger schema migration plan before implementing tools.
- Define task revision semantics (`revision` integer incremented on every mutation).
- Add cross-process tests for `claim_task`.
- Add stale lock recovery tests.
- Add a `WorkbenchContainer` composition root.
- Add explicit MCP lifecycle initialization.
- Define workspace resolution once and use it from CLI and MCP.
- Keep `get_task_prompt` as the primary context-pack surface.
- Document that `.workbench/` internals are not an agent editing interface.

## Final Takeaway

Basic Memory is most useful to Workbench as proof that local stdio MCP servers should treat transport as replaceable and state as an external, durable system. Its architecture succeeds because it has a clear source of truth, a derived query layer, a real lifecycle, project resolution, and a disciplined service boundary.

Workbench should adopt those principles, but with a stricter ledger model: the task store is not a cache and not a loose document index. It is a concurrent state machine. That makes SQLite transactions, schema validation, conditional updates, and focused lifecycle tools the best fit for v1.
