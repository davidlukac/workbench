# AI Agent Workbench — Design Gaps

Identified during feasibility review. Each item is a decision or clarification needed before the relevant build phase can proceed. Address in order — earlier items unblock later ones.

---

## ~~Gap 1 — How does the CLI invoke the Spec and Planner Agents?~~ ✅ RESOLVED

**Decision:** The CLI never invokes a model. The entire pipeline (fetch → spec → plan → dispatch → review) runs inside the agent environment through Workflows and Skills. The CLI's scope is strictly infrastructure: `serve`, `verify`, `status`, `task next`, and provider-oriented setup through `install <provider>`.

The `workbench-spec` and `workbench-planner` Skills are invoked by the pipeline Workflow inside the agent host (Claude Code, Windsurf, Cursor), not from the Node process. `src/pipeline/` is removed from the planned source layout.

---

## ~~Gap 2 — What spawns sub-agents in auto mode?~~ ✅ RESOLVED

**Decision:** Sub-agent spawning uses the agent host's native mechanism — not the CLI. In Claude Code, the Story Manager Agent uses the Task tool. In Windsurf or Cursor, it opens parallel agent sessions. The MCP server and CLI have no spawning responsibility. The Story Manager is a Persona + Skill + MCP usage pattern, not CLI code.

---

## ~~Gap 3 — What does `sign_off_task` do in v1?~~ ✅ RESOLVED

**Decision:** Added `ready_for_signoff` as an explicit human-review gate between `verified` (AI accepted) and `signed_off` (human approved).

- Story Manager automatically calls `queue_for_signoff` after each `verify_task` → task moves to `ready_for_signoff`
- User reviews `workbench://tasks/ready_for_signoff` (via `workbench status` or Story Manager summary)
- User can approve one, many, or all tasks; agent calls `sign_off_task` (single) or `sign_off_tasks { all: true }` (batch) via MCP on user instruction
- User can reject a task by instructing the agent to call `request_changes` with notes → returns to `changes_requested → in_progress`
- Agent always uses MCP tools for these mutations, never file edits (lower token cost, atomic state change)
- `signed_off` in v1 means user-approved in the ledger; Jira write-back remains a non-goal

---

## Gap 4 — Spec Agent failure recovery *(Deferred implementation detail)*

**What the spec says:** Spec generation is "one-shot." Output is a structured Spec object.

**The problem:** LLM output can fail schema validation. No retry or repair loop is specified. If `spec-agent.ts` gets back malformed JSON or a Spec missing required fields, the pipeline halts with no recovery path.

**Related MCP contract gap:** The docs say the pipeline Workflow writes Story, Spec, and Tasks via MCP tools, but the MCP tool list currently covers task lifecycle mutations only. It does not define ingestion tools such as `fetch_story`, `update_spec`, or `update_tasks`.

See [`SequenceDiagrams.md`](SequenceDiagrams.md) for the proposed end-to-end write path in both auto and manual modes.

**Current best option:** Treat Spec and Task writes as typed MCP mutations, not as direct file writes by the agent. The Spec Agent should read the Story through `workbench://story`, draft a structured `Spec`, loop with the user for product corrections, and then progressively call `update_spec` with partial field updates. The Planner Agent should do the same through `update_tasks` for the transient task plan. MCP validates submitted fields, persists accepted fields, rejects invalid fields, returns the current full state, and reports whether the artifact is complete.

**Failure behavior to decide:** On validation failure, `update_spec` / `update_tasks` should return per-field results rather than failing the whole artifact:

- `updated[]`: field paths accepted and persisted.
- `rejected[]`: field paths rejected with structured issues.
- `current`: the current stored Spec or task draft after the update.
- `completeness`: `{ complete, missing[], invalid[] }`.
- `revision`: current artifact revision.

The Workflow should loop until `completeness.complete === true`, with a hard cap of 10 update attempts for Spec and 10 update attempts for Tasks. After the cap, it stops and presents the current state plus missing/invalid fields to the user. Schema failures are not the same as product ambiguity and should not be silently converted into `OpenQuestion[]`.

**Decision needed later:** Exact `update_spec` / `update_tasks` field shapes, per-field validation result schema, revision handling, and 10-attempt circuit breaker semantics. This is a system design detail, not a blocker for the current documentation stage.

---

## Gap 5 — Concurrent file write collisions in auto mode *(Resolved)*

**What the spec says:** Sub-agents "write files to the workbench directory" concurrently. `TaskOutput.changed_files` records which files were touched.

**The problem:** Two concurrent sub-agents can write to the same file (e.g., both modify `src/routes/user.ts`). The spec does not address this.

**Decision:** Use **Option A: declare in the task plan**. The Planner Agent must assign each task an intended, non-overlapping file scope. If two tasks need to modify the same file, the planner should either merge them into one task or express an explicit dependency so they do not run concurrently.

**Consequence:** File collisions are treated as planning errors. The Ledger Service does not need file-level runtime locks in v1, and auto mode can keep its concurrency model based on task dependencies and task locks. `TaskOutput.changed_files` remains evidence of what actually changed, and review can flag unexpected changes outside the planned file scope.

---

## Gap 5a — Workspace ledger store concurrency *(Resolved)*

**What the spec now says:** `workbench mcp` is launched from host MCP configuration over stdio. Multiple logical agents may share one server process through the host, but separate host sessions may also launch separate Workbench MCP subprocesses.

**The problem:** The authoritative task ledger cannot be process-local memory. Concurrent MCP subprocesses and CLI commands must coordinate through a workspace-scoped backing store without corrupting state or double-claiming tasks.

**Decision:** Use **SQLite** as the authoritative v1 workspace ledger store. The database lives under `.workbench/` or an equivalent workspace-scoped session directory. Enable WAL, use transactions for every mutation, and use conditional updates/revisions for claim and lifecycle transitions.

**Consequence:** The ledger is not process-local and not a set of ad hoc JSON files. CLI commands and multiple stdio MCP subprocesses share the same SQLite-backed `LedgerStore` library. Optional JSON/Markdown exports can exist for inspection or archival, but they are not the mutation source of truth.

**Repository layer (WB-29):** As a prerequisite to the SQLite migration, all disk I/O in `spec-store`, `story-source`, and `fetch-story` has been extracted behind an `IRepository` interface (`src/repository/`). Production code uses `FileSystemRepository`; tests inject `MemoryRepository`. A `MultiChannelRepository` fan-out adapter enables dual-write to multiple backends (e.g. JSON file + SQLite) without changing callers. Key design invariant: `readSpec()` and `writeSpec(spec)` take no path argument — the key is baked into the repository at construction time — so a `SqliteRepository` can swap in without modifying any tool or store.

---

## Gap 6 — Workflow file format for provider setup *(Deferred)*

**What the spec used to say:** `workbench install workflows` would install "bundled Windsurf / Cursor Workflow files" to `.windsurf/workflows/` or `.cursor/workflows/`.

**Current command shape:** Provider setup is now routed through `workbench install <provider>`. In WB-5, that command installs bundled Skills only. Future provider setup can add workflow files, config initialization, MCP configuration, and path setup behind the same command.

**The problem:** The format of these workflow files is not specified anywhere in the docs. Windsurf workflows use a specific YAML schema; Cursor workflows use markdown. Without a spec, the installer has nothing to install.

**Deferred decision:** Define the exact workflow file formats when adding workflow installation to provider setup. This is not a current blocker because the core Workbench design does not depend on installer file schemas.

---

## Gap 7 — Open question resolution surface *(Deferred)*

**What the spec says:** Spec generation flags `OpenQuestion[]` items on the Spec. They "do not block decomposition" but "should be reviewed."

**The problem:** No CLI command or MCP tool exists for a human or agent to resolve them. `resolved: bool` and `answer: string|null` fields are defined but never written.

**Deferred decision:** Decide during implementation whether `OpenQuestion[]` remains read-only display data in v1 or gets a `resolve_question` MCP tool and optional CLI surface. This does not block the pipeline design because open questions do not block decomposition.

---

## Gap 8 — `verify` skill lookup paths *(Deferred)*

**What the spec says:** `workbench verify` checks "every skill referenced in `personas[*].skills` is findable in the expected skills directory."

**The problem:** The lookup paths are platform-specific: `.claude/skills/` for Claude Code, `.windsurf/skills/` for Windsurf, `.cursor/skills/` for Cursor, `~/.claude/skills/` for personal scope. The spec does not define which paths are searched or in what order.

**Deferred decision:** Define the ordered skill resolution path list when implementing `verify` and `get_task_prompt`. This is a platform integration detail, not a blocker for the current system design.

---

## Gap 9 — Jira config and credential scope *(Deferred)*

**What the spec says:** `.workbench.yaml` can contain a `jira.base_url` and `jira.auth`, while token credentials come from `JIRA_EMAIL` and `JIRA_API_TOKEN`. The `fetch_story` MCP tool owns Jira API calls. `fetch_story` also accepts local Markdown/YAML/JSON story files, which do not require Jira configuration. The mock Jira adapter exists for test/local development and should not be framed as a primary user entrypoint.

**The problem:** It is not defined whether Jira configuration is per-project, global/user-level, or both. If MCP owns `fetch_story`, it needs a deterministic config lookup order for Jira URL, auth mode, mock mode, and credentials. Credentials also should not be committed into project config.

**Options to decide between:**

- **(A) Project-only config** — `.workbench.yaml` contains Jira URL/auth mode; credentials come from environment variables only. Simple, but repeated across repos.
- **(B) Global defaults + project override** — user-level Workbench config stores shared Jira defaults; project `.workbench.yaml` can override base URL/auth/mock behavior. Credentials still come from environment or OS keychain.
- **(C) MCP host env only** — no Jira config files; the agent host MCP config provides all Jira URL and credential environment variables. Keeps project clean, but makes repo-level verification and onboarding weaker.

**Deferred decision:** Define Jira config precedence, credential sources, local story file schema checks, and `workbench verify` checks when implementing `fetch_story`. This is a configuration detail, not a blocker for the current system design.

---

## Phasing impact summary

| Gap | Status | Blocks |
|-----|--------|--------|
| 1 — Skill invocation mechanism | ✅ Resolved | — |
| 2 — Sub-agent spawning in auto mode | ✅ Resolved | — |
| 3 — `sign_off_task` v1 behavior | ✅ Resolved | — |
| 4 — Spec Agent failure recovery | Deferred detail | Phase 3 implementation detail |
| 5 — Concurrent file write collisions | ✅ Resolved | — |
| 5a — Workspace ledger store concurrency | ✅ Resolved — repository layer implemented (WB-29); SQLite adapter pending | — |
| 6 — Workflow file format | Deferred detail | provider setup implementation |
| 7 — Open question resolution | Deferred detail | optional v1 polish |
| 8 — `verify` skill lookup paths | Deferred detail | `verify` / `get_task_prompt` implementation |
| 9 — Jira config and credential scope | Deferred detail | `fetch_story` / `verify` implementation |
