---
title: Project Overview
type: guide
permalink: workbench/project-overview
tags:
- overview
- architecture
- status
---

# AI Agent Workbench — Project Overview

## Status
Specification/planning phase. `docs/` contains authoritative spec. `src/` does not exist yet.

## What it is
AI Agent Workbench starts inside an agent session and bridges Jira tickets or local story files to AI sub-agent execution. A ticket or story enters as a raw description and exits as completed, verified work via spec expansion, task decomposition, and persona-matched agent dispatch. The TypeScript CLI is infrastructure only; the coordination layer is a stdio MCP server exposing a workspace-scoped task ledger. Users add it to MCP configuration, e.g. `codex mcp add workbench -- npx workbench mcp`.

## Two-layer architecture
| Layer | What | Runs where |
|-------|------|------------|
| CLI | Infrastructure: install, verify, MCP entry point, status | Terminal / host-launched Node process |
| Pipeline | Session: fetch → spec → plan → dispatch → review | Inside agent env (Workflow + Skills) |

The CLI **never calls a model**. All AI work happens through Workflows and Skills inside Claude Code, Windsurf, Cursor, etc.

## Pipeline flow
```
Jira Ticket or Local Story File → Fetch Story → Spec Agent → Planner Agent → Task Ledger (MCP) → Dispatch → Sub-Agents → Summary
```

## Dispatch modes
- **auto**: Story Manager Agent spawns sub-agents natively (Claude Code Task tool or host equivalent), monitors progress, routes review, handles blockers/retries, and manages human signoff
- **manual**: Agents pull tasks independently via MCP; no Story Manager

## Repository state
- Branch: `feature/init`
- Installed skills: `ba`, `ba-workspace`, `dev-ts`, `dev-ts-workspace`, `skill-creator`
- `skills-lock.json` tracks `skill-creator` from `anthropics/skills`
- No `src/` yet — Phase 1 (spec/markdown) in progress

## Naming updates — 2026-05-09
`Orchestrator` has been renamed to **Story Manager Agent** in the authoritative docs. It is a coordination persona for one Jira Story, implemented as Persona + Skill + MCP usage guidance rather than a fixed workflow.

The pipeline entry skill/workflow is named **`workbench`** (previously `workbench-start`) — invoked as `/workbench <source-ref>`.

WB-4 ✅: Skill catalogue published at `docs/WorkbenchSkills.md`; distributable stubs in `resources/skills/` (6 skills: `workbench`, `workbench-spec`, `workbench-planner`, `workbench-manager`, `workbench-reviewer`, `workbench-emulator`).

## Pipeline entity clarification — 2026-05-09
There is no separate persisted `Plan` entity in the current domain model. The Planner Agent produces a transient task plan (`Task[]` draft) from a saved Spec. After user approval, MCP progressively validates and persists accepted task fields through `update_tasks`; once complete and valid, that draft becomes individual claimable Tasks in the ledger.
