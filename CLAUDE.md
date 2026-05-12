# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Agent Memory Management

When accessing and managing memories, always use @mcp:basic-memory instead of of Agents internal memory.

Use project **workbench** in basic-memory. Key notes:
- `workbench/memory-index` — index of all notes
- `workbench/project-overview` — vision, architecture, dispatch modes, repo state
- `workbench/domain-model` — Story, Spec, Task, Persona, Skill fields
- `workbench/task-status-fsm` — status transitions, MCP tools, retry backoff
- `workbench/mcp-server-reference` — all resources + tools with args
- `workbench/tech-stack` — runtime, deps, tsconfig, source layout
- `workbench/build-phases` — phase roadmap + open design gaps (3–8)

---

## Project Overview

AI Agent Workbench — an agent-session workflow with TypeScript CLI/MCP infrastructure that bridges Jira tickets or local story files to AI sub-agent execution via spec expansion, task decomposition, and persona-matched agent dispatch. The coordination layer is a stdio MCP server exposing a workspace-scoped task ledger.

**Status**: Specification/planning phase. `docs/` is authoritative. `src/` does not exist yet.

The CLI is **infrastructure only** — it never calls a model. All AI work (fetch → spec → plan → dispatch → review) runs inside the agent environment through Workflows and Skills.

---

## Commands

**Requires Node.js `>=22.0.0`** (`.nvmrc` pins 24)

```sh
npm install          # install deps
npm run build        # tsup — outputs CJS+ESM to dist/
npm run dev          # tsup --watch
npm run lint         # biome check src/
npm run format       # biome format src/ --write
npm run test         # vitest run
npm run test:watch   # vitest
npx vitest run src/ledger/transitions.test.ts   # single test file
```

CLI (after build):
```sh
npx @workbench/cli mcp                         # stdio MCP server entry point
npx @workbench/cli serve                       # alias for mcp
npx @workbench/cli status --watch
npx @workbench/cli task next
npx @workbench/cli verify
npx @workbench/cli install skills
```

---

## Skills

Installed in `.claude/skills/`: `ba`, `ba-workspace`, `dev-ts`, `dev-ts-workspace`, `skill-creator`, `workbench-emulator`

**`workbench-emulator`** — Run the full workbench pipeline (story → spec → plan → dispatch → review → signoff) without any MCP infrastructure. Use `/workbench-emulator <story-file-or-id>` to emulate a complete session using only files under `.workbench/emulator/<story-id>/`. State is tracked in YAML frontmatter of Markdown files; no server or database required. Useful for developing and testing the workflow before Phase 2 infrastructure is built.

Built-in workbench skills (not yet implemented — Phase 3):
- `workbench-spec` — Spec Agent (`context: fork`, `disable-model-invocation: true`)
- `workbench-planner` — Planner Agent (`context: fork`, `disable-model-invocation: true`)

Use `/skill-creator` to create/evaluate/improve skills. See `docs/reference/WhatAreSkills.md` for the Agent Skills open standard.

---

## Configuration

`.workbench.yaml` in the project root. Validate with `workbench verify`. See `docs/Feature.md` for the full annotated schema.

Environment variables for real Jira: `JIRA_EMAIL`, `JIRA_API_TOKEN`.
