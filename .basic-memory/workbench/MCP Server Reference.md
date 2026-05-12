---
title: MCP Server Reference
type: note
permalink: workbench/mcp-server-reference
tags:
- mcp
- server
- tools
- resources
- api
---

# MCP Server Reference

## Transport
Primary v1 transport is stdio via host MCP configuration, e.g. `codex mcp add workbench -- npx workbench mcp`.

`workbench mcp` and `workbench serve` are equivalent MCP server entry points. The server reads JSON-RPC from stdin, writes JSON-RPC to stdout, and logs only to stderr. It is not designed around one manually started singleton HTTP server.

State model: authoritative ledger/session state is workspace-scoped, not process-local. Multiple stdio MCP subprocesses and CLI commands coordinate through a SQLite ledger store under `.workbench/` or an equivalent session directory. Use WAL, transactions, and conditional updates/revisions for safe concurrent mutation. Streamable HTTP may be added later for daemon mode; HTTP+SSE is legacy/deprecated.
## Resources (read-only)
| URI | Description |
|-----|-------------|
| `workbench://story` | Current story |
| `workbench://spec` | Current spec |
| `workbench://tasks` | Full task list |
| `workbench://tasks/pending` | Claimable tasks (deps satisfied, unlocked) |
| `workbench://tasks/ready_for_signoff` | Awaiting human approval |
| `workbench://tasks/{id}` | Single task + evidence |
| `workbench://personas` | Resolved persona definitions |
| `workbench://skills` | Skills mapped per persona |

## Tools (write)
| Tool | Args | Effect |
|------|------|--------|
| `claim_task` | task_id, agent_id | pending → claimed. Implemented: `TaskLedger.claimTask()` in `src/task-store/index.ts` sets `claimed_by` to agent_id, creates a 30-minute lock (`lock.owner`, `lock.expires_at`), and increments `revision`. Tool handler: `claimTaskTool()` in `src/server/tools/claim-task.ts`. |
| `start_task` | task_id | claimed → in_progress. Implemented: `TaskLedger.startTask()` clears the claim lock and increments revision. Tool handler: `startTaskTool()` in `src/server/tools.ts`. |
| `submit_task` | task_id, output (`{ summary, changed_files }`), evidence (`{ commands_run, tests_passed, changed_files, notes }`) | in_progress → implemented. Also accepts `claimed` status (skip start). Sets `output`, `evidence`, clears `lock`, increments `revision`. Implemented: `TaskLedger.submitTask()` in `src/task-store/index.ts`. Tool handler: `submitTaskTool()` in `src/server/tools.ts`. |
| `route_for_review` | task_id | implemented → review_required |
| `verify_task` | task_id | review_required → verified |
| `queue_for_signoff` | task_id | verified → ready_for_signoff |
| `request_changes` | task_id, notes | review_required|ready_for_signoff → changes_requested |
| `resume_task` | task_id | changes_requested → in_progress |
| `sign_off_task` | task_id | ready_for_signoff → signed_off |
| `sign_off_tasks` | task_ids? \| `{all:true}` | batch sign-off |
| `fail_task` | task_id, error | in_progress → failed |
| `block_task` | task_id, reason | in_progress → blocked |
| `unblock_task` | task_id | blocked → pending |
| `retry_task` | task_id | manual re-queue of exhausted task |
| `append_evidence` | task_id, entry | accumulate evidence |
| `get_task_prompt` | task_id | fully resolved context pack |

## Pipeline ingestion tools
| Tool | Args | Effect |
|------|------|--------|
| `fetch_story` | source_ref | MCP fetches Jira or local file story source and normalizes it into the Story entity. Creates `<workspacePath>/<story_id>/tasks/` directory. Response includes `working_dir` (absolute path to `<workspacePath>/<story_id>/`) — agents write `story.md` there. |
| `update_spec` | base_revision?, fields | Validate partial Spec field updates; persist accepted fields; reject invalid fields; return current Spec, revision, per-field results, completeness, and `spec_file` — the absolute path where the agent should write `spec.md` (`<workspacePath>/<story_id>/spec.md`; `null` if `story_id` not yet set). |
| `update_tasks` | base_revision?, tasks/fields | Validate partial task draft updates; persist accepted fields; reject invalid fields; return current task draft, revision, per-field results, and completeness |

`fetch_story` makes source loading deterministic infrastructure work owned by MCP. First-class user sources are Jira keys and local story file paths. Local story files should include at least title and description, with the filename able to supply the Story id. The mock Jira adapter is for test/local development, so work can run without real Jira credentials. Jira config and credential precedence, plus local file schema checks, are deferred to `fetch_story` / `verify` implementation.

`update_spec` and `update_tasks` are progressive ingestion tools. They should return `updated[]`, `rejected[]`, `current`, `completeness: { complete, missing[], invalid[] }`, and `revision`. The Workflow loops until complete, capped at 10 update attempts per artifact before stopping with the current state and actionable issues.
## `get_task_prompt` — context pack contents
Persona system prompt, task (id/title/type/tags/description), dependency statuses, AC items, relevant constraints, evidence (if resuming), review notes (if resuming), allowed/disallowed actions, Definition of Done, skill invocations.

## Allowed/Disallowed by persona tier
- **Implementation**: may modify files, add tests, append evidence, call `submit_task`; may NOT call `verify_task`/`sign_off_task`
- **Review**: may read task/output/evidence, call `verify_task`/`request_changes`; may NOT implement new functionality

## Implementation Research — 2026-05-08
Documented in `docs/reference/HowMcpWorks.codex.md`.

Current key implementation decisions/findings:
- MCP is JSON-RPC 2.0; server exposes resources, tools, and optionally prompts. Workbench v1 should advertise resources + tools only unless MCP prompts are explicitly implemented.
- Primary transport is stdio via host MCP configuration (`codex mcp add workbench -- npx workbench mcp`).
- `workbench mcp` / `workbench serve` should not be designed around one manually started singleton HTTP server.
- Avoid REST duplicates such as `/tasks` or `/claim`; use MCP resources/tools plus CLI helpers that share the ledger library.
- Ledger state is workspace-scoped, not process-scoped. Multiple stdio subprocesses must coordinate through a backing store.
- Use `workbench://` resources for read-only state; resources must never claim or mutate tasks.
- Use tools for all ledger mutation. Successful tools should return `structuredContent` plus short JSON text for compatibility.
- Keep `get_task_prompt` as the v1 universal context entry point/tool. MCP-native prompts may be added later but should be additive.
- Do not use MCP Sampling from the Workbench server; it would violate the project boundary that the CLI/MCP server never invokes model work.
- Phase 2 integration tests should use real stdio MCP clients and prove initialization, resource listing/reading, tool listing/calling, and concurrent claim behavior across subprocesses.
## Transport Nuance — 2026-05-08
Superseded by Architecture Correction below. Final decision: stdio-primary with workspace-scoped backing store; Streamable HTTP optional future daemon mode.
## Architecture Correction — 2026-05-08
Corrected prior assumption: Workbench MCP is intended to be installed into host MCP configuration (`codex mcp add workbench -- npx workbench mcp`), like Basic Memory, not run as a single independent Streamable HTTP singleton. The principal implementation requirement is now a workspace-scoped concurrent ledger store. Stdio transport is fine for multiple agents when the host multiplexes them; when separate subprocesses exist, shared state must be handled by the backing store.

## Story Manager naming — 2026-05-09
`Orchestrator` is now **Story Manager Agent** in the product docs. It is the auto-mode coordination persona for one Jira Story. MCP still owns deterministic state validation, resources, locks, and mutation tools; the Story Manager owns judgment, sequencing, delegation, blocker handling, and user-facing signoff coordination.

## Ledger Service naming — 2026-05-09
`Dispatcher` has been renamed to **Ledger Service** in the product docs. It is not a scheduler and does not spawn agents. It is the deterministic domain layer behind MCP tools/resources: validates mutations, enforces task transitions, computes claimable task views, applies atomic store updates, tracks retry eligibility/backoff, and recovers expired locks. The Story Manager decides what should be worked on next and by whom.

## File Collision Strategy

Gap 5 is resolved for v1 with Option A: declare file scope during planning. Tasks carry `planned_files[]`; parallel claimability is driven by task dependencies and task locks, not file-level ledger locks. If two tasks need the same file, the Planner should merge them or add dependencies so they are not run concurrently. Review can compare `TaskOutput.changed_files[]` against `planned_files[]` and flag unexpected edits.


**Implemented tools:** `fetch_story`, `update_spec`, `claim_task`, `start_task`, `submit_task`, `route_for_review`, `create_task`, `update_story_status`. The remaining tools (`verify_task`, `queue_for_signoff`, `request_changes`, `resume_task`, `sign_off_task`, `sign_off_tasks`, `fail_task`, `block_task`, `unblock_task`, `retry_task`, `append_evidence`, `get_task_prompt`) are specified but not yet implemented.

## `update_story_status` — WB-28
Transitions a story through its lifecycle FSM. Enforces valid transitions only; syncs `source_file` on disk after each transition.

| Tool | Args | Effect |
|------|------|--------|
| `update_story_status` | `story_id`, `status` | Validates FSM transition (`todo → in_progress → in_review → done`), updates in-memory `StoryLedger`, syncs `source_file` on disk (YAML frontmatter or plain `Status:` line). Returns `{ story_id, status, updated_at }`. Disk sync failures are non-fatal. Story must be registered first via `fetch_story`. Tool handler: `updateStoryStatusTool()` in `src/server/tools/update-story-status.ts`. Ledger: `StoryLedger` in `src/story-store/index.ts`. |

`fetch_story` now seeds the `StoryLedger` (idempotent — duplicate fetch leaves current status unchanged).

`create_task` is a development/testing tool that seeds the in-memory ledger with a new pending task. Response includes `file_path` — the absolute path where the agent should write the task Markdown file (`<workspacePath>/<story_id>/tasks/<task_id>.md`). Agents must call `create_task` first to obtain `file_path`, then write the task file to that path.

## Path Ownership — WB-27
MCP tools own all path computation and directory creation. Agents must never compute workspace paths independently or run `mkdir`:
- `fetch_story` → creates `<workspacePath>/<story_id>/tasks/`; returns `working_dir`
- `create_task` → returns `file_path` for the task Markdown file
- `update_spec` → returns `spec_file` for the spec Markdown file
`workspacePath` defaults to `<cwd>/.workbench/`; configurable for test isolation.

## CLI Tool Command — WB-30

`workbench tool` exposes all registered MCP tools and resources as a direct CLI command, calling the same handler functions used by the MCP server (no duplication).

**Usage patterns:**
```sh
workbench tool                                    # list all tools + resources
workbench tool <name>                             # describe schema (if has required fields)
workbench tool fetch_story .tasks/WB-30.md        # call — first positional = primary required field
workbench tool claim_task task-001 --agent_id=dev # additional args as --key=value
workbench tool --resource workbench://server/info # read a resource
```

**Argument convention:** first positional → first required field (bare value); remaining args → `--key=value` flags; complex object fields accept a JSON string (`--output='{"summary":"done","changed_files":[]}'`).

**Describe mode:** calling `workbench tool <name>` with no args and required fields prints the tool description + field schema. Tools with zero required fields execute immediately.

**Implementation (`src/server/index.ts` — WB-30):**
- `WorkbenchServer` carries parallel `#toolRegistry` and `#resourceRegistry` populated in `registerBuiltinTools()` / `registerBuiltinResources()`.
- New public methods: `listTools()`, `callTool(name, args)`, `listResources()`, `callResource(uri)`.
- `callTool` validates args with the tool's Zod schema in each closure; returns `{ isError: true }` on failure.
- `callResource` returns `{ ok: true, contents }` or `{ ok: false, error }`.
- Exported types: `ToolInfo`, `ToolFieldInfo`, `ResourceInfo`, `ToolCallResult`, `ResourceReadResult`.

**CLI (`src/cli.ts` — WB-30):**
- `createToolServer` added to `CliDependencies` (injectable for tests).
- Commander command uses `.allowUnknownOption().allowExcessArguments()` — both required in Commander v14 for dynamic `--key=value` args after positionals.
- Exported helpers: `formatToolList`, `formatToolDescribe`, `parseExtraArgs`, `parseArgValue`.
