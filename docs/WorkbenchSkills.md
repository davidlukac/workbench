# AI Agent Workbench — Skills Reference

This document is the authoritative catalogue of Skills that ship with the AI Agent Workbench. It covers what each skill does, when it activates, and how it relates to the pipeline stage it serves.

For background on the Agent Skills open standard (SKILL.md format, progressive disclosure, invocation modes), see [`docs/reference/WhatAreSkills.md`](reference/WhatAreSkills.md).

---

## Two-Tier Skill Model

The Workbench uses two tiers of skills:

**Tier 1 — Built-in pipeline skills** ship with the Workbench tool and are installed via:

```sh
workbench install claude
workbench install codex
workbench install windsurf
# or to a non-default target:
workbench install codex --target .custom/skills
```

These skills drive the pipeline stages (spec generation, task planning, orchestration, review). Most are invoked programmatically by the pipeline Workflow — not by the user directly or by model auto-trigger. They live in `resources/skills/` inside the Workbench package and are copied into the provider's skills directory on install: `.claude/skills/`, `.agents/skills/`, or `.windsurf/skills/`. Pass `--target <dir>` to override that directory.

**Tier 2 — User persona skills** are installed independently by the user (from [agentskills.io](https://agentskills.io) or their own source). They are referenced by name in `.workbench.yaml` under `personas[*].skills` and invoked by the Workbench at dispatch time. Examples: a `be-dev` backend engineering skill, a `qa-test` testing skill. These are not defined or distributed by the Workbench itself.

---

## Skill Catalogue

| Name | Directory | Description | Purpose | Persona | Phase | Status | Invocation |
|---|---|---|---|---|---|---|---|
| `workbench` | `resources/skills/workbench` | Main pipeline Workflow — orchestrates story fetch, spec generation, task planning, dispatch, and signoff | Entry point for users; drives the full session lifecycle | — (user-facing) | 3 | stub | User-invoked (`/workbench`); `disable-model-invocation: true` |
| `workbench-spec` | `resources/skills/workbench-spec` | Spec Agent — expands a Story into a structured Spec and validates AC | Pipeline stage 2: story → spec | Spec Agent | 3 | stub | Programmatic only; `context: fork`, `disable-model-invocation: true` |
| `workbench-planner` | `resources/skills/workbench-planner` | Planner Agent — decomposes a Spec into typed, ordered Tasks with dependencies and persona assignments | Pipeline stage 3: spec → task list | Planner Agent | 3 | stub | Programmatic only; `context: fork`, `disable-model-invocation: true` |
| `workbench-manager` | `resources/skills/workbench-manager` | Story Manager — coordinates auto-mode dispatch, monitors task progress, routes implemented tasks for review, presents signoff summary | Auto-mode orchestration (stage 5–8) | Story Manager | 4 | stub | Loaded alongside Story Manager persona; auto or user-invoked |
| `workbench-reviewer` | `resources/skills/workbench-reviewer` | Reviewer Agent — inspects implemented work against acceptance criteria and either verifies or requests changes | Review gate (stage 7): implemented → verified or changes_requested | Reviewer | 4 | stub | Invoked by Story Manager or user; loaded alongside reviewer persona |
| `workbench-emulator` | `resources/skills/workbench-emulator` | Full pipeline emulation without MCP infrastructure — runs story → spec → plan → dispatch → review → signoff using only files under `.workbench/emulator/` | Development and testing: validates the workflow before Phase 2 infrastructure is built | — (dev utility) | 1/2 | full | User-invoked (`/workbench-emulator`); `disable-model-invocation: true` |

---

## Skill Details

### `workbench`

**Purpose:** The user-facing entry point for a Workbench session. Invoked as `/workbench <source-ref>` where `source-ref` is a Jira key (`PROJ-123`) or a local story file path (`./JIRA-123.md`).

**What it does:**
1. Calls the MCP `fetch_story` tool to load the Story
2. Invokes `workbench-spec` to generate the Spec (with user review loop)
3. Invokes `workbench-planner` to produce the task list (with user review loop)
4. Begins dispatch in the configured mode (`auto` or `manual`)
5. In auto mode: hands off to `workbench-manager` to drive dispatch and review
6. Presents the signoff summary and waits for user approval

**Invocation properties:**
- `disable-model-invocation: true` — the user must invoke this explicitly; it should not auto-trigger from conversation context
- Not `context: fork` — runs in the main conversation so it can interact with the user across the session

**Pipeline stage:** Orchestrator for stages 1–8 (the full session)

---

### `workbench-spec`

**Purpose:** The Spec Agent. Takes a fetched Story and expands it into a complete, structured Spec with validated acceptance criteria.

**What it does:**
1. Reads the Story from `workbench://story`
2. Generates: background, goals, non-goals, requirements, open questions, and verified AC
3. Flags ambiguities as `OpenQuestion[]` — does not block decomposition
4. Submits fields to the Ledger via `update_spec` (partial-update, validated)
5. Loops until the Spec is complete or 10 attempts are used

**Invocation properties:**
- `context: fork` — runs in an isolated subagent context with no access to main conversation history; the skill content is the complete task prompt
- `disable-model-invocation: true` — invoked programmatically by `workbench`, never auto-triggered

**Pipeline stage:** Stage 2 — Story → Spec

---

### `workbench-planner`

**Purpose:** The Planner Agent. Takes a validated Spec and decomposes it into a typed, ordered, dependency-aware Task list.

**What it does:**
1. Reads the Spec from `workbench://spec` and the task type registry from config
2. Produces a task list with: type, tags, priority, dependencies, persona assignment, planned file scope, and `fresh_context_required` flag
3. Resolves implementation persona and review persona config keys per task using `type_to_persona` from `.workbench.yaml`
4. Ensures concurrent tasks have non-overlapping `planned_files`
5. Submits tasks to the Ledger via `update_tasks` (partial-update, validated)

**Invocation properties:**
- `context: fork` — isolated subagent; skill content is the full task prompt
- `disable-model-invocation: true` — invoked programmatically by `workbench`, never auto-triggered

**Pipeline stage:** Stage 3 — Spec → Task list

---

### `workbench-manager`

**Purpose:** The Story Manager skill. Loaded by the Story Manager persona in auto dispatch mode. Provides the coordination procedure for reading the pending task queue, spawning sub-agents, routing review, and presenting signoff.

**What it does:**
1. Polls `workbench://tasks/pending`; spawns sub-agents for each claimable task using the host's native mechanism (e.g. Claude Code's Agent tool)
2. Monitors `implemented` tasks; calls `route_for_review` then invokes the reviewer persona
3. On `verified`: calls `queue_for_signoff`
4. On `changes_requested`: calls `resume_task` to route back to the implementation persona with reviewer notes
5. On all tasks `ready_for_signoff`: presents the signoff summary to the user
6. On user approval: calls `sign_off_tasks { all: true }` or `sign_off_task` per task

**Invocation properties:**
- Loaded alongside the Story Manager persona; not `context: fork` (runs in the main conversation)
- `disable-model-invocation: true` may be set to prevent accidental activation outside a pipeline session

**Pipeline stage:** Stages 5–8 (auto mode only) — Dispatch → Review → Signoff

---

### `workbench-reviewer`

**Purpose:** The Reviewer Agent skill. Provides the review procedure for inspecting implemented work against acceptance criteria. Loaded by the reviewer persona.

**What it does:**
1. Reads the task context pack via `get_task_prompt`
2. Inspects the changed files and accumulated evidence
3. Checks each `ac_refs` criterion against the implementation
4. Either calls `verify_task` (AC satisfied, no regressions) or `request_changes` with specific, actionable notes

**Review checklist (stub — full detail in Phase 4):**
- All `ac_refs` criteria satisfied
- Changed files match `planned_files` or deviation is justified
- Tests exist and pass
- No obvious regressions in adjacent code
- No unaddressed TODOs or stub implementations

**Invocation properties:**
- Loaded alongside the reviewer persona; invoked by `workbench-manager` in auto mode or by the user in manual mode
- May be `context: fork` when reviewer runs as a sub-agent in auto mode

**Pipeline stage:** Stage 7 — Review (implemented → verified or changes_requested)

---

### `workbench-emulator`

**Purpose:** Full pipeline emulation without any MCP infrastructure. Enables developing and testing the Workbench workflow before Phase 2 (the MCP server and CLI) is built. All state lives in files under `.workbench/emulator/<story-id>/`.

**What it does:**
Runs the complete pipeline sequentially, playing every role (Workflow, Spec Agent, Planner Agent, Story Manager, Implementation Sub-Agent, Reviewer):
1. Parses the story file
2. Generates and user-reviews the Spec
3. Generates and user-reviews the task plan
4. Executes each task in dependency order
5. Reviews each task against its AC
6. Presents signoff and writes a session summary

**Invocation:**
```
/workbench-emulator <story-file-or-id>
```
Where `<story-file-or-id>` is a path like `@.tasks/WB-4.md` or a story ID.

**Invocation properties:**
- `disable-model-invocation: true` — must be invoked explicitly by the user
- Not `context: fork` — runs in the main conversation across multiple user interaction checkpoints

**Pipeline stage:** Development utility — replaces all stages 1–8 in a single file-based session

---

## Invocation Properties Reference

| Property | Meaning |
|---|---|
| `context: fork` | Skill runs in an isolated subagent with no main conversation history; skill content is the complete task prompt |
| `disable-model-invocation: true` | Skill cannot be auto-triggered by the model; user or pipeline must invoke explicitly |
| `user-invocable: true` (default) | Skill appears in the `/` autocomplete menu |

Skills that are **programmatic-only** (invoked by the pipeline, not by the user) should set both `context: fork` and `disable-model-invocation: true`. This prevents the model from accidentally triggering an isolated subagent in the middle of an unrelated conversation.

---

## Phase Roadmap

| Phase | Skills delivered |
|---|---|
| 1/2 (current) | `workbench-emulator` (full); all others as stubs in `resources/skills/` |
| 3 | `workbench`, `workbench-spec`, `workbench-planner` (full implementation) |
| 4 | `workbench-manager`, `workbench-reviewer` (full implementation) |

See [`docs/Feature.md`](Feature.md) for the full build phase roadmap.
