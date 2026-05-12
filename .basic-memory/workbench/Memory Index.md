---
title: Memory Index
type: guide
permalink: workbench/memory-index
tags:
- index
- memory
---

# Workbench Project Memory Index

Initialized: 2026-05-08

## Notes

| Note | Permalink | Summary |
|------|-----------|---------|
| Project Overview | `workbench/project-overview` | Vision, two-layer architecture, dispatch modes, repo state |
| Domain Model | `workbench/domain-model` | Story, Spec, Task, Persona, Skill — fields and sub-types |
| Task Status FSM | `workbench/task-status-fsm` | All statuses, transitions, MCP tools, retry backoff, dep checking |
| MCP Server Reference | `workbench/mcp-server-reference` | All resources, tools, context pack structure, MCP implementation findings from `docs/reference/HowMcpWorks.codex.md` |
| Tech Stack | `workbench/tech-stack` | Runtime, deps, tsconfig, build, source layout |
| Build Phases | `workbench/build-phases` | Phase 1–5 plan + open design gaps, including MCP implementation open questions |

## Installed skills (`.claude/skills/`)
- `ba`, `ba-workspace` — BA / requirements skill
- `dev-ts`, `dev-ts-workspace` — TypeScript dev skill
- `skill-creator` — skill authoring + evals

## Current state
- Branch: `feature/init`
- Phase 2 (Infrastructure CLI + MCP Server) in progress — `src/` is active
- `src/` layout: `cli.ts`, `index.ts`, `types.ts`, `verify.ts`, `config/`, `install/`, `logging/`, `server/`, `server/tools/`, `spec-store/`, `story-source/`, `task-store/`
- Implemented MCP tools: `fetch_story`, `update_spec`, `claim_task`, `start_task`, `submit_task`, `route_for_review`, `create_task`
- 100% test coverage across all `src/` modules (101 tests)
- `docs/` is authoritative; `CLAUDE.md` is the project guide
