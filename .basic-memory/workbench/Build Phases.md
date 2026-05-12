---
title: Build Phases
type: note
permalink: workbench/build-phases
tags:
- phases
- roadmap
- gaps
- planning
---

# Build Phases

## Phase 1 — Markdown Convention ✅ (current)
Define and validate by hand: task schema, status workflow, routing map, persona files, context pack format, final summary format. Proves the workflow before writing infrastructure.

## Phase 2 — Infrastructure CLI + MCP Server
CLI commands: `mcp`/`serve`, `verify`, `status`, `task next`, `install skills`, `install workflows`.
stdio MCP server with full ledger, tools, resources. Integration-tested with real stdio transport and concurrent access to the workspace-scoped ledger store.

Gap 5a is resolved: v1 uses a workspace-scoped SQLite ledger store with WAL, transactions, and conditional updates/revisions. Gap 8 skill lookup path details are deferred to `verify` / `get_task_prompt` implementation.
## Phase 3 — Workbench Skills + Workflows
Author and ship built-in Skills (`workbench`, `workbench-spec`, `workbench-planner`) and the pipeline Workflow. Prove full flow end-to-end from an agent session with a local Markdown/YAML/JSON story file, and separately with the mock Jira adapter for test/local development.

WB-4 ✅: Skill catalogue defined (`docs/WorkbenchSkills.md`); distributable stubs created in `resources/skills/` for all 6 pipeline skills.

Gap 4's exact field/result/revision shapes are deferred implementation details, not current documentation blockers. Gap 6 workflow file formats are also deferred to `install workflows` implementation.

## Phase 4 — Auto Dispatch + Review Loop
Story Manager Agent reads `workbench://tasks/pending`, spawns sub-agents natively, drives the review cycle, handles blockers/retries/user feedback, and generates the session summary. Lock expiry and retry eligibility are handled by the Ledger Service.

Gap 5 is resolved for v1: concurrent file write collisions are handled by planning. The Planner must assign non-overlapping `planned_files` for tasks that can run in parallel, or add dependencies/merge tasks when file scope overlaps.
## Phase 5 — Jira / PR Integration
Generate final summary for Jira comment, PR description, or Confluence. Optional Jira API write-back.

## Deferred Design Details
| Gap | Status |
|-----|--------|
| 4 — Spec Agent failure recovery and typed ingestion tools (`update_spec`, `update_tasks`) | `update_spec` ✅ implemented (WB-7); `update_tasks` and circuit breaker semantics remain deferred |
| 5 — Concurrent file write collisions | Resolved: Option A, declare non-overlapping planned file scope in task plan |
| 5a — Workspace ledger store concurrency | Resolved: SQLite ledger store with WAL, transactions, conditional updates/revisions |
| 6 — Workflow file format for `install workflows` | Deferred to installer implementation |
| 7 — Open question resolution surface (v1 scope?) | Deferred optional v1 polish |
| 8 — `verify` skill lookup paths (ordered search list?) | Deferred to `verify` / `get_task_prompt` implementation |
| 9 — Jira config and credential scope for `fetch_story` | Deferred to `fetch_story` / `verify` implementation |
## MCP Implementation Open Questions — added 2026-05-08
From `docs/reference/HowMcpWorks.codex.md`:
1. Should Workbench expose MCP prompts in v1, or keep only `get_task_prompt` as a tool?
2. What SQLite package and migration runner should v1 use?
3. Should `claim_task` return an `isError: true` tool result on dependency/lock conflicts, or should those be JSON-RPC errors?
4. Should `workbench://tasks/pending` include enough information for dispatch decisions, or only IDs plus summaries?
5. Should `resources/list_changed` notifications be implemented when tasks are created, or deferred until clients need reactive updates?

## Gap 4 Detail Status
`update_spec` is fully implemented (WB-7 ✅): validates partial Spec field updates, persists accepted fields, rejects unknown/invalid fields with reasons (including nested path in error messages), returns `updated[]`, `rejected[]`, `current`, `revision`, and `completeness { complete, missing[], invalid[] }`. Optimistic locking via `base_revision`.

`update_tasks` and circuit breaker semantics (10-attempt cap) remain deferred to the Phase 2 pipeline ingestion work.

## WB-26 Structural Improvements — 2026-05-10
Completed code cleanup and modularization of `src/server/`:
- **Per-tool modules**: `src/server/tools.ts` replaced by `src/server/tools/` with one file per tool (each owns inputSchema, outputSchema, Result type, handler).
- **WorkbenchServer class**: `createWorkbenchMcpServer` replaced by `WorkbenchServer` class with private fields (`#server`, `#toolNames`, `#logger`, `#specPath`, `#ledger`) and public `registerBuiltinTools()` / `registerBuiltinResources()` / `connect()` methods.
- **Dynamic tool registry**: `#toolNames[]` populated alongside each `registerTool` call; passed as `() => readonly string[]` callback to `serverInfoResource` — no hardcoded list.
- **Zod v4 imports**: All files migrated to `import * as z from "zod/v4"`.
- **Coding standards**: `docs/CodingStandards.md` documents six conventions (Zod import style, per-tool module layout, WorkbenchServer pattern, dynamic registry, JSDoc, logger lazy-init).
- **100% test coverage**: 100 tests passing across all `src/server/` modules.
