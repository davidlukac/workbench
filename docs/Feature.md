# AI Agent Workbench — Feature Spec

## Vision

An ephemeral task ledger and orchestration workbench that starts inside an agent session and bridges Jira tickets or local story files to AI sub-agent execution. A ticket or story file enters as a raw description and exits as completed, verified work — with spec expansion, AC validation, task decomposition, and persona-matched agent dispatch in between.

Ephemeral: the ledger lives only for the lifecycle of a work session. No long-term persistence beyond the files sub-agents write.

```
Jira remembers the commitment.
Git remembers the code.
The local ledger remembers the agent workflow.
After sign-off, the ledger can disappear.
```

Durability responsibilities:

| System | Responsibility |
|--------|----------------|
| Jira | Business request, stakeholder state, final comments, long-term tracking |
| Git | Code changes, PR history, durable implementation diff |
| Local Ledger | Temporary AI execution state, task decomposition, evidence, routing, handoffs |
| Confluence / Docs | Durable design notes if needed |

---

## Responsibility Split

The workbench is split into two layers with a clean boundary:

| Layer | What it is | Runs where |
|-------|-----------|------------|
| **CLI** | Infrastructure tooling: install, verify, MCP entry point, status | Terminal / host-launched Node process |
| **Pipeline** | Session execution: fetch → spec → plan → dispatch → review | Inside the agent environment (Workflow + Skills) |

The CLI never calls a model. It sets up the environment, provides the host-launched MCP server entry point, and provides observability. All agent work happens through Workflows and Skills invoked from within Claude Code, Windsurf, Cursor, or any other agent host.

---

## High-Level Flow

For renderable end-to-end sequence diagrams covering both auto and manual dispatch modes, see [`SequenceDiagrams.md`](SequenceDiagrams.md).

```
User invokes the workbench Workflow inside their agent environment
      │
      ▼
[1] Fetch Story             ← MCP `fetch_story` tool; Jira Cloud API or local story file
      │
      ▼
[2] Generate Spec           ← /workbench-spec Skill (Spec Agent) expands into structured spec + verifies AC
      │
      ▼
[3] Decompose into Tasks    ← /workbench-planner Skill (Planner Agent) produces typed, ordered task list
      │
      ▼
[4] Task Ledger (MCP)       ← Workspace-scoped session store; MCP server exposes tools + resources to all agents
      │
      ▼
[5] Dispatch                ← Auto (agent host spawns sub-agents natively) OR Manual (agents pull via MCP)
      │
      ▼
[6] Sub-Agents              ← Each claims a task, writes files, records evidence, updates task status
      │
      ▼
[7] Review                  ← Story Manager (auto) or reviewer persona (manual) verifies output vs AC
      │
      ▼
[8] Summary                 ← Final output pushed to Jira / PR / Confluence; ledger archived or discarded
```

---

## Domain Model

### Story
The raw source request normalized into Workbench. First-class user entrypoints are Jira Cloud and local Markdown/YAML/JSON story files. The mock Jira adapter exists for test/local development. Immutable once fetched.

| Field       | Type     | Notes                                    |
|-------------|----------|------------------------------------------|
| id          | string   | Jira key or file-derived key, e.g. `PROJ-123` |
| source_type | enum     | `jira` `mock` `file`                    |
| url         | string   |                                          |
| summary     | string   | Ticket title                             |
| description | string   | Raw description normalized from Jira markup, Markdown, YAML, or JSON |
| raw_ac      | string[] | Acceptance criteria as written in the source, if present |
| issue_type  | enum     | `story` `bug` `task` `spike`            |
| priority    | enum     | `critical` `high` `medium` `low`        |
| labels      | string[] |                                          |
| reporter    | string   |                                          |
| assignee    | string   | Optional                                 |
| fetched_at  | datetime |                                          |

Local story files are a first-class alternative to fetching from Jira for bootstrapping the same Workflow. Supported source formats are Markdown, YAML, and JSON. The minimum required data is a title and description. A filename such as `JIRA-123.md` can provide `id` when the file does not include one.

Example Markdown:

```md
# Add user export

Users need to export their profile data from account settings.

## Acceptance Criteria

- Export includes profile and billing metadata.
- Export is available as JSON.
```

Example YAML:

```yaml
id: JIRA-123
title: Add user export
description: Users need to export their profile data from account settings.
acceptance_criteria:
  - Export includes profile and billing metadata.
  - Export is available as JSON.
```

### Spec
Generated artifact derived from a Story. One spec per session.

| Field          | Type                  | Notes                                          |
|----------------|-----------------------|------------------------------------------------|
| id             | string                | `spec-{story_id}`                             |
| story_id       | string                |                                                |
| background     | string                | Why this work exists                           |
| goals          | string[]              |                                                |
| non_goals      | string[]              |                                                |
| requirements   | Requirement[]         |                                                |
| open_questions | OpenQuestion[]        | Flagged but do not block decomposition         |
| verified_ac    | AcceptanceCriterion[] |                                                |
| created_at     | datetime              |                                                |
| version        | int                   | Increments if spec is regenerated              |

**Requirement**
```
{ id, description, type: functional|non_functional|constraint, priority: must|should|could }
```

**OpenQuestion**
```
{ id, question, resolved: bool, answer: string|null }
```

**AcceptanceCriterion**
```
{ id, criterion, testable: bool, notes: string|null, source: jira|generated }
```

### Task
Atomic unit of work. Lives in the ledger.

There is no separate persisted `Plan` entity in the current domain model. The Planner Agent produces a transient task plan (`Task[]` draft) from the Spec. After user approval and MCP validation, that draft is persisted as individual Tasks in the ledger.

| Field                  | Type             | Notes                                                                                    |
|------------------------|------------------|------------------------------------------------------------------------------------------|
| id                     | string           | `task-{story_id}-{seq}`, e.g. `task-PROJ-123-001`                                      |
| spec_id                | string           |                                                                                          |
| story_id               | string           | Denormalized for convenience                                                             |
| title                  | string           |                                                                                          |
| type                   | string           | From built-in or custom task type registry                                               |
| tags                   | string[]         | Supplementary metadata (e.g. `nestjs`, `redis`); avoids task type explosion             |
| description            | string           | What the agent must do                                                                   |
| ac_refs                | string[]         | IDs of AcceptanceCriteria this task satisfies                                            |
| persona                | string\|null     | Config key (e.g. `backend_engineer`); set by Planner; null if no mapping found          |
| review_persona         | string\|null     | Config key for reviewer; resolved at routing time; null if no mapping found             |
| planned_files          | string[]         | Intended file scope assigned by Planner; should not overlap concurrent tasks             |
| dependencies           | TaskDependency[] | See below                                                                                |
| status                 | TaskStatus       | See workflow below                                                                       |
| priority               | int              | Lower = higher priority (1..n, set by planner)                                           |
| fresh_context_required | bool             | Whether this task requires an isolated sub-agent context; default `true`                |
| claimed_by             | string\|null     | Agent ID, null if unclaimed                                                              |
| lock                   | TaskLock\|null   | See below; null when unclaimed                                                           |
| attempt_count          | int              | Default `0`                                                                              |
| max_attempts           | int              | Default `2`; after that → manual trigger                                                 |
| output                 | TaskOutput\|null | Lightweight result record; attached on `submit_task`                                    |
| evidence               | Evidence         | Accumulated during execution; feeds reviewer context pack                               |
| error                  | string\|null     | Last error message                                                                       |
| return_to_persona      | string\|null     | Set when `changes_requested`; routes task back to the implementation persona            |
| reviewed_by            | string\|null     | Config key of the persona that last reviewed this task                                  |
| created_at             | datetime         |                                                                                          |
| updated_at             | datetime         |                                                                                          |
| completed_at           | datetime\|null   |                                                                                          |

**TaskDependency**
```
{ taskId: string, requiredStatus?: TaskStatus }
```
Default `requiredStatus` when omitted is `verified`. Setting it to `implemented` lets a parallel task (e.g. tests) begin before the upstream task's review is complete.

Planner output should assign non-overlapping `planned_files` to tasks that can run concurrently. If two tasks must touch the same file, the planner should merge them or add an explicit dependency so the Story Manager does not run them in parallel. The Ledger Service does not implement file-level locks in v1.

**TaskLock**
```
{ owner: string, expires_at: datetime }
```
A task whose lock has expired is treated as `pending` — dead agent recovery without manual intervention.

**TaskOutput** — lightweight, no full file contents
```
{ summary: string, changed_files: string[] }
```

**Evidence** — accumulated during execution; feeds the reviewer's context pack
```
{
  commands_run: string[],
  tests_passed: string[],
  changed_files: string[],
  notes: string[]
}
```

### Task Types
A registry, not a closed enum. Built-in defaults are provided; projects extend or override via `.workbench.yaml`.

**Built-in defaults**
```
backend_api | frontend_ui | schema_migration | test_coverage |
spec_writing | security_review | code_review | infra_change | research
```

Custom types defined in config are **merged** with the defaults. Set `extend: false` in config to replace entirely.

Use `tags` on tasks for detail within a type instead of creating very specific task types:
```yaml
# prefer this:
type: backend_api
tags: [nestjs, redis, room-membership]

# over this:
type: nestjs_redis_backend_api
```

### Persona
Defined in config (inline or file ref). Not a ledger entity — resolved at dispatch time and surfaced read-only via MCP.

```yaml
personas:
  backend_engineer:
    name: Backend Engineer
    system_prompt: |
      You are a senior backend engineer...
    skills: [code_implementation, test_writing]
```

### Skill
An agentic Skill per the [Agent Skills open standard](https://agentskills.io/home). A Skill is a **folder** containing a `SKILL.md` file (YAML frontmatter + markdown instructions) and optionally scripts, reference files, and templates. Skills load via progressive disclosure — only the `name` and `description` are in context at startup (~100 tokens each); the full `SKILL.md` body loads only when the skill is triggered (<5,000 tokens recommended); bundled resource files load on demand. See [`WhatAreSkills.md`](WhatAreSkills.md) for the full Skills reference.

**Invocation is platform-dependent.** The config stores only the skill name (e.g. `be-dev`). The workbench resolves the correct invocation format at runtime:
- Claude Code: `/be-dev`
- Windsurf / Cascade: `@be-dev`
- Auto-triggered: agent matches the request against the skill's `description`

**Two tiers of skills:**

- **Built-in workbench skills** — real skill folders that ship with the tool, placed in `.claude/skills/`. Used internally to run the pipeline; not user-mapped via config. Both use `context: fork` (isolated subagent) and `disable-model-invocation: true` (programmatic invocation only, never auto-triggered):
  - `workbench-spec` — Spec Agent: expands a Story into a full Spec and verifies AC
  - `workbench-planner` — Planner Agent: decomposes a Spec into typed, ordered Tasks

- **User persona skills** — skills the user has installed in their agentic environment (from agentskills.io or their own). Referenced by name in `.workbench.yaml` and invoked by the workbench at dispatch time.

### Task Type → Persona → Skills Mapping

Defined in `.workbench.yaml`. No built-in defaults — the mapping is entirely user-configured since skills depend on what the user has installed in their agentic context.

```yaml
# Example mapping
type_to_persona:
  backend_api: backend_engineer
  frontend_ui: frontend_engineer
  test_coverage: qa_engineer

personas:
  backend_engineer:
    name: Backend Engineer
    system_prompt: |
      You are a senior backend engineer...
    skills:
      - be-dev          # skill name only; invocation format resolved at runtime
  qa_engineer:
    name: QA Engineer
    system_prompt: |
      You are a senior QA engineer...
    skills:
      - qa-test
      - qa-e2e
```

### Persona Resolution Order

Resolved separately for the implementation persona and the review persona.

**Implementation persona** (used when task status is `pending` / `changes_requested`):
```
1. task.persona_override (if set)
2. type_to_persona[task.type] from config
3. config.defaults.default_persona
4. fallback: no system prompt (warn user)
```

**Review persona** (used when task status is `implemented` → routed to `review_required`):
```
1. task.review_persona_override (if set)
2. type_to_persona[task.type].review_persona from config (if extended form used)
3. config.defaults.review_persona
4. fallback: quality_reviewer (warn if not installed)
```

**Fallback chain** (each level warns to user, never hard errors):
```
task.type → persona lookup    → [WARN: no persona mapped, using default prompt]
persona   → skills list       → [WARN: no skills mapped, skipping skill invocation]
skill name → installed?       → [WARN: skill not found in environment, skipping]
```

---

## Task Status & Workflow

### Status Enum
```
pending → claimed → in_progress → implemented → review_required → verified → ready_for_signoff → signed_off
                               ↘ changes_requested → in_progress (return_to_persona)
                               ↘ blocked → pending
                               ↘ failed → (retry ×2) → pending | failed[manual]

ready_for_signoff → changes_requested → in_progress  (user rejects during signoff review)
```

| Status               | Description                                                                                   |
|----------------------|-----------------------------------------------------------------------------------------------|
| pending              | Ready to be claimed; all dependencies met                                                     |
| claimed              | Agent has reserved the task; lock is active                                                   |
| in_progress          | Agent is actively working                                                                      |
| implemented          | Implementation agent believes work is complete; awaiting review routing                       |
| review_required      | Routed to reviewer persona; awaiting verdict                                                  |
| changes_requested    | Reviewer or user rejected output; `return_to_persona` set; routes back to implementation     |
| verified             | AI reviewer accepted the output; AC satisfied; awaiting human sign-off                       |
| ready_for_signoff    | Queued for human review; user can approve (→ `signed_off`) or reject (→ `changes_requested`) |
| signed_off           | User approved; output committed to durable system (Jira/PR/Confluence); truly complete        |
| blocked              | Agent hit an external blocker (missing dep, ambiguous spec, etc.)                             |
| failed               | Agent errored; retry logic applies                                                             |

Two distinct checkpoints:
- `verified` — AI reviewer has accepted the output and confirmed AC satisfaction
- `ready_for_signoff` — human gate; the user reviews one, many, or all tasks and either approves or sends back for rework

`signed_off` is the terminal state. Tasks move there only after explicit human approval.

### Transitions

| From                | To                  | Tool / Trigger                                                                  |
|---------------------|---------------------|---------------------------------------------------------------------------------|
| pending             | claimed             | `claim_task` — sets lock with expiry                                           |
| claimed             | in_progress         | `start_task`                                                                    |
| in_progress         | implemented         | `submit_task` with output + evidence                                           |
| implemented         | review_required     | `route_for_review` (Story Manager) — resolves review_persona                  |
| review_required     | verified            | `verify_task` (Story Manager / reviewer persona)                               |
| review_required     | changes_requested   | `request_changes` with notes — sets `return_to_persona`                       |
| verified            | ready_for_signoff   | `queue_for_signoff` (Story Manager, automatic after `verify_task`)             |
| ready_for_signoff   | signed_off          | `sign_off_task` — single task; user or agent acting on user instruction        |
| ready_for_signoff   | signed_off          | `sign_off_tasks` — batch; accepts task ID list or `{ all: true }`              |
| ready_for_signoff   | changes_requested   | `request_changes` with notes — user rejects during signoff review              |
| changes_requested   | in_progress         | `resume_task` — re-claims task to `return_to_persona`                         |
| in_progress         | blocked             | `block_task` with reason                                                       |
| blocked             | pending             | `unblock_task`                                                                  |
| in_progress         | failed              | `fail_task` with error                                                         |
| failed              | pending             | Auto-retry with backoff (`attempt_count < max_attempts`)                       |
| failed              | pending             | Manual `retry_task` (after exhaustion)                                         |

### Retry Backoff
- Attempt 1 fail → retry after 5s
- Attempt 2 fail → retry after 30s
- Attempt 3+ → status stays `failed`; requires manual `retry_task`

---

## Dispatch Modes

Dispatch mode is set per session in `.workbench.yaml` or at CLI invocation. It controls only how tasks are picked up — the ledger and MCP server are identical in both modes.

### Auto Mode (Claude Code / sub-agent capable)
- Story Manager Agent polls `workbench://tasks/pending` continuously
- Spawns sub-agents concurrently for all claimable tasks
- Each sub-agent receives a fully resolved context pack (via `get_task_prompt`)
- Story Manager monitors `implemented` queue, calls `route_for_review`
- Story Manager reviews `review_required` queue, calls `verify_task` or `request_changes`
- On `changes_requested`: calls `resume_task` to route back to implementation persona
- On all tasks `verified`: calls `sign_off_task`, generates session summary, presents file edits to user

### Manual Mode (Windsurf, Cursor, any single-agent environment)
- No Story Manager; agents pull work themselves via MCP
- Each agent session: connects to MCP → reads pending tasks → claims one → works → submits
- Parallel execution via multiple independent sessions (each claims a different task)
- Review routing is triggered manually by the user or by the reviewing agent session
- User triggers each session manually; sessions do not coordinate beyond the shared ledger

### `get_task_prompt` — universal entry point
Both modes use this MCP tool. Returns a fully self-contained context pack for a given task.

- Auto mode: Story Manager calls it when building a sub-agent invocation
- Manual mode: agent calls it as its first step; `workbench task next` prints it for copy-paste into any agent

---

## Context Packs — `get_task_prompt`

Returns a fully self-contained, ready-to-execute prompt string. Content structure:

```
# Persona
<persona system prompt from config>

# Task
<task id, title, type, tags, description>

# Dependencies
<list of dependency tasks with their current status>

# Acceptance Criteria
<AC items this task must satisfy, sourced from spec>

# Relevant Constraints
<requirements from spec that apply to this task>

# Evidence So Far
<populated if this is a resumed changes_requested task; empty otherwise>

# Review Notes
<populated if this is a resumed changes_requested task; the reviewer's notes>

# Allowed Actions
<what this persona may do — varies by persona tier>

# Disallowed Actions
<what this persona must not do — varies by persona tier>

# Definition of Done
<concrete checklist the agent must satisfy before calling submit_task>

# Skill Invocations
<resolved skill invocations for this platform, e.g. /be-dev or @be-dev>
```

**Allowed / Disallowed Actions by persona tier:**

Implementation persona:
- Allowed: modify source files, add or update tests, record evidence via `append_evidence`, call `submit_task`
- Disallowed: change product scope, update Jira directly, call `verify_task` or `sign_off_task`

Review persona:
- Allowed: read task, output, and evidence; call `verify_task` or `request_changes`
- Disallowed: implement new functionality, modify source files

---

## MCP Server

The coordination layer. All agents interact with the ledger exclusively through it.

### Resources (read-only)

| URI                                    | Description                                              |
|----------------------------------------|----------------------------------------------------------|
| `workbench://story`                    | Current story                                            |
| `workbench://spec`                     | Current spec                                             |
| `workbench://tasks`                    | Full task list with statuses                             |
| `workbench://tasks/pending`            | Claimable tasks (all deps satisfied, not locked)         |
| `workbench://tasks/ready_for_signoff`  | Tasks awaiting human sign-off approval                   |
| `workbench://tasks/{id}`               | Single task detail including evidence                    |
| `workbench://personas`                 | Resolved persona definitions (from config)               |
| `workbench://skills`                   | Skill references mapped to each persona                  |

### Tools (write)

Pipeline ingestion tools:

| Tool           | Args        | Description                                                                 |
|----------------|-------------|-----------------------------------------------------------------------------|
| `fetch_story`  | source_ref  | Fetch Jira or local file story source and normalize it into the Story entity; mock Jira adapter is for test/local development |
| `update_spec`  | base_revision?, fields | Validate partial Spec field updates and return current completeness |
| `update_tasks` | base_revision?, tasks/fields | Validate partial task draft updates and return current completeness |

Task lifecycle tools:

| Tool                | Args                                  | Description                                                                        |
|---------------------|---------------------------------------|------------------------------------------------------------------------------------|
| `claim_task`        | task_id, agent_id                     | pending → claimed; sets lock with expiry                                          |
| `start_task`        | task_id                               | claimed → in_progress                                                              |
| `submit_task`       | task_id, output, evidence             | in_progress → implemented; attaches TaskOutput + Evidence                          |
| `route_for_review`  | task_id                               | implemented → review_required; resolves and records review_persona                |
| `verify_task`       | task_id                               | review_required → verified; Story Manager then calls `queue_for_signoff`          |
| `queue_for_signoff` | task_id                               | verified → ready_for_signoff; called automatically by Story Manager after verify  |
| `request_changes`   | task_id, notes                        | review_required \| ready_for_signoff → changes_requested; sets return_to_persona  |
| `resume_task`       | task_id                               | changes_requested → in_progress; re-claims to return_to_persona                  |
| `sign_off_task`     | task_id                               | ready_for_signoff → signed_off; single task                                       |
| `sign_off_tasks`    | task_ids? \| `{ all: true }`          | ready_for_signoff → signed_off; batch; omit task_ids or pass `all: true` for all  |
| `fail_task`         | task_id, error                        | in_progress → failed; triggers retry                                              |
| `block_task`        | task_id, reason                       | in_progress → blocked                                                              |
| `unblock_task`      | task_id                               | blocked → pending                                                                  |
| `retry_task`        | task_id                               | Manual re-queue of exhausted failed task                                           |
| `append_evidence`   | task_id, entry                        | Append a command run, test result, or note to task evidence                       |
| `get_task_prompt`   | task_id                               | Returns fully resolved, self-contained context pack                                |

---

## Configuration — `.workbench.yaml`

```yaml
# Dispatch mode: auto | manual
dispatch_mode: auto

# Jira connection (local story files do not require Jira config; tests can use mock mode)
jira:
  base_url: https://yourorg.atlassian.net
  auth: token   # token | oauth
  # token and credentials via env vars: JIRA_EMAIL, JIRA_API_TOKEN

# Default personas when no type-specific mapping is found
defaults:
  default_persona: generalist
  review_persona: quality_reviewer

# Task type registry — merged with built-ins by default
# Set extend: false to replace built-ins entirely
task_types:
  extend: true
  custom:
    - id: data_pipeline
      description: Data pipeline or ETL task

# Task type → persona mapping (simple form: implementation persona only)
type_to_persona:
  data_pipeline: data_engineer

# Extended form allows per-type review persona override:
# type_to_persona:
#   backend_api:
#     default: backend_engineer
#     review: quality_reviewer

# Persona definitions
# skills: list of agentskills.io invocation references available in your agentic context
personas:
  data_engineer:
    name: Data Engineer
    system_prompt: |
      You are a senior data engineer specializing in pipeline design...
    skills:
      - data-eng        # skill name; invocation resolved at runtime per platform

  generalist:
    name: Generalist Engineer
    system_prompt: |
      You are a generalist software engineer...
    skills: []

  quality_reviewer:
    name: Quality Reviewer
    system_prompt: |
      You are a strict principal-level quality reviewer.
      You do not implement new functionality unless explicitly asked.
      Verify acceptance criteria, check tests, look for architectural drift.
    skills: []

# Retry settings
retry:
  max_attempts: 2
  backoff:
    attempt_1: 5s
    attempt_2: 30s
```

---

## Agents

### Spec Agent
- Input: Story
- Expands into full Spec; validates AC for testability
- Flags OpenQuestions — does not block decomposition
- Output: Spec → written to ledger

### Planner Agent
- Input: Spec + task type registry (from config)
- Produces ordered task list with types, tags, dependencies, and priorities
- Resolves implementation persona and review persona config keys for each task from the type→persona mapping
- Sets `fresh_context_required` per task based on type and complexity
- Output: Task[] → written to ledger via MCP

### Ledger Service (MCP — deterministic domain layer)
The Ledger Service sits behind the MCP tools/resources. It is deterministic code, not an AI agent:
- Validates tool inputs and state transitions
- Computes `pending` / claimable task views from dependencies, status, and locks
- Sorts claimable tasks in order: priority ascending → dependency depth ascending → created_at ascending
- Applies atomic mutations to the workspace session store
- Tracks retry eligibility and backoff state on failures
- Moves exhausted retries to `failed` and surfaces them for manual trigger
- Expires stale locks and returns tasks to `pending` (dead agent recovery)

The Ledger Service does **not** spawn agents or choose work strategically. In auto mode, the Story Manager Agent (running inside the agent host) reads `workbench://tasks/pending` and spawns sub-agents natively using whatever mechanism the host provides (Claude Code's Task tool, Windsurf parallel sessions, etc.).

### Story Manager Agent (auto mode — runs inside agent host)
A coordination persona for one Jira Story that handles the judgment layer. It is a Persona + Skill + MCP usage pattern, not just a fixed Workflow. It lives entirely inside the agent environment — not in the CLI or MCP server:
- Reads `workbench://tasks/pending` and spawns sub-agents natively (platform-dependent)
- Understands available task types, persona mappings, and skills
- Routes `implemented` tasks → `review_required` via `route_for_review`
- Reviews `review_required` tasks against AC — calls `verify_task` or `request_changes` with notes
- After each `verify_task`: calls `queue_for_signoff` to move task to `ready_for_signoff`
- On `changes_requested`: calls `resume_task` to route back to the implementation persona with reviewer's notes
- Periodically checks progress, revives expired or blocked tasks where appropriate, and suggests how to unblock persistent failures
- Once all tasks are `ready_for_signoff`: presents a summary to the user and waits for sign-off instruction
- On user instruction: calls `sign_off_task` (single), `sign_off_tasks` (batch), or `request_changes` (reject) via MCP — never by editing task files directly

### Sub-Agents / Manual Agents
- Receive task context pack (via `get_task_prompt` — called by Story Manager or agent directly)
- Write files to workbench directory
- Call `append_evidence` during execution (commands run, tests passed, changed files)
- Call `submit_task` with output + evidence → transitions to `implemented`
- On unrecoverable errors: call `fail_task` or `block_task`
- Never touch ledger state directly — MCP only

---

## Session Lifecycle

The lifecycle below is the compact textual version. [`SequenceDiagrams.md`](SequenceDiagrams.md) expands this into Mermaid diagrams from Jira ticket or local story input through `signed_off`.

```
Pre-session (terminal):
  codex mcp add workbench -- npx workbench mcp
                           ← host launches stdio MCP server from config
  workbench verify         ← CLI checks config + installed skills

Session (agent environment — Workflow drives all steps):
1.  Agent invokes workbench Workflow (e.g. /workbench-start PROJ-123 or /workbench-start ./JIRA-123.md)
2.  Workflow: calls MCP `fetch_story`; MCP fetches Jira or parses local story file and stores Story
3.  Workflow: invokes /workbench-spec Skill → Spec written to MCP
4.  Workflow: invokes /workbench-planner Skill → Tasks written to MCP through task creation tooling
5.  Workflow: prints task summary; begins dispatch per dispatch_mode

Auto mode (agent host supports sub-agents):
6.  Story Manager reads workbench://tasks/pending; spawns sub-agents natively
7.  Sub-agents claim tasks, write files, record evidence, submit
8.  Story Manager routes implemented → review_required; reviewer runs
9.  Review cycles: changes_requested → in_progress → implemented → verified as needed
10. Story Manager calls queue_for_signoff on each verified task → ready_for_signoff
11. Story Manager presents signoff summary to user; waits for instruction

Human signoff (applies to both modes):
12. User reviews workbench://tasks/ready_for_signoff (via workbench status or agent summary)
13. User approves: instructs agent to sign_off_task / sign_off_tasks { all: true } via MCP
14. User rejects: instructs agent to request_changes with notes → task returns to implementation
15. Repeat until all tasks signed_off

Manual mode (single-agent environment):
6.  Agent calls get_task_prompt for next task; works it; submits
7.  Agent (or user) triggers review; cycles to verified → ready_for_signoff
8.  Repeat until all tasks ready_for_signoff; then proceed to human signoff (step 12)

Post-session:
16. Summary output suitable for Jira comment, PR description, or Confluence
17. Session ends: workspace session state can be cleaned/archived; written files persist
```

---

## TypeScript Reference — Dependency Checking

```ts
const statusRank: Partial<Record<TaskStatus, number>> = {
  pending: 0,
  claimed: 1,
  in_progress: 2,
  implemented: 3,
  review_required: 4,
  changes_requested: 4,  // still in-flight; same rank as review_required
  verified: 5,
  ready_for_signoff: 6,
  signed_off: 7,
};

function hasReachedStatus(actual: TaskStatus, required: TaskStatus): boolean {
  const actualRank = statusRank[actual];
  const requiredRank = statusRank[required];
  if (actualRank === undefined || requiredRank === undefined) return actual === required;
  return actualRank >= requiredRank;
}

function dependenciesSatisfied(task: Task, tasksById: Map<string, Task>): boolean {
  return task.dependencies.every((dep) => {
    const upstream = tasksById.get(dep.taskId);
    if (!upstream) throw new Error(`Missing dependency: ${dep.taskId}`);
    return hasReachedStatus(upstream.status, dep.requiredStatus ?? 'verified');
  });
}
```

---

## Build Phases

### Phase 1 — Markdown Convention (no code)
Define and validate by hand: task schema, status workflow, routing map, persona files, context pack format, final summary format. Proves the workflow before writing infrastructure.

### Phase 2 — Infrastructure CLI + MCP Server
CLI commands for setup and observability. stdio MCP server with full ledger, tools, and resources. Integration-tested with real stdio transport and concurrent access to the workspace-scoped SQLite ledger store.

Remaining skill lookup path details are deferred to `verify` / `get_task_prompt` implementation.

```sh
workbench mcp                # stdio MCP server entry point for host config
workbench serve              # alias for workbench mcp
workbench verify             # validate config + skill resolution
workbench status             # live ledger state
workbench task next          # print next task prompt (copy-paste for manual mode)
workbench install <provider> # install Workbench assets for claude, codex, or windsurf
```

### Phase 3 — Workbench Skills + Workflows
Author and ship the built-in Skills (`workbench-spec`, `workbench-planner`) and the pipeline Workflow (`workbench-start`). Prove the full flow end-to-end inside Claude Code with a local story file and with the mock Jira adapter for local development.

### Phase 4 — Auto Dispatch + Review Loop
Story Manager Agent reads `workbench://tasks/pending`, spawns sub-agents using the host's native mechanism, drives the review cycle, and generates the session summary. Lock expiry and retry eligibility are handled by the Ledger Service.

### Phase 5 — Jira / PR Integration
Generate final summary for Jira comment, PR description, or Confluence. Optional: direct Jira API write-back.

---

## Resolved Design Decisions

| Question | Decision |
|----------|----------|
| Jira auth | Jira Cloud; API token or OAuth. Mock Jira adapter is for test/local development only. |
| Spec generation | Progressive field updates via `update_spec`; accepted fields persist, rejected fields return structured issues; OpenQuestions flag product ambiguity and don't block by themselves |
| Sub-agent output | Files on disk + `{ summary, changed_files }` on task + evidence accumulated during execution |
| Review cycle | `implemented` → `review_required` → `verified` or `changes_requested` → back to implementation persona |
| True completion | `signed_off` (human approved), not `verified` (AI reviewed) or `ready_for_signoff` (queued) |
| Human signoff | Explicit human gate via `ready_for_signoff`; user approves/rejects one, many, or all tasks; agent uses MCP tools (`sign_off_task`, `sign_off_tasks`, `request_changes`) on user instruction — never file edits |
| Agent failure | Auto-retry ×2 with backoff; manual `retry_task` after exhaustion |
| Lock expiry | Stale locks return task to `pending` — dead agent recovery |
| Dependency resolution | `TaskDependency { taskId, requiredStatus? }` — defaults to `verified`; override to `implemented` to allow parallelism |
| Personas/Skills | Config-driven, resolved at dispatch, surfaced read-only via MCP |
| Persona resolution | Separate chains for implementation and review; explicit fallback order at each level |
| Task types | Built-in defaults + project overrides via `.workbench.yaml`; `tags` for detail within a type |
| Multi-agent env | Mode-agnostic MCP; `get_task_prompt` works for any agent |
| Missing mappings | Graceful fallback at each level with printed warning; never hard error |
| CLI scope | Infrastructure only (install, verify, MCP entry point, status). No model calls. |
| Pipeline host | All session execution (fetch → spec → plan → dispatch → review) runs inside the agent environment via Workflows and Skills. |
| Sub-agent spawning | Agent host's native mechanism (Claude Code Task tool, Windsurf parallel sessions, etc.). MCP server and CLI do not spawn agents. |
| Build order | CLI + MCP server first (Phase 2), then Skills + Workflows (Phase 3), then orchestration (Phase 4). |

---

## Glossary

| Term | Description |
|------|-------------|
| **Story** | A Jira ticket, mock ticket, or local story file fetched into the workbench. The original source of truth for all downstream artifacts. Immutable once fetched. |
| **Spec** | The fully expanded engineering specification generated from a Story. Adds structure, fills gaps, and validates acceptance criteria before task decomposition begins. |
| **Requirement** | A single functional, non-functional, or constraint item within a Spec. Carries a priority (`must` / `should` / `could`) and type. |
| **AcceptanceCriterion** | A verifiable condition of satisfaction, sourced from Jira or inferred during spec generation. Validated for testability; tasks reference these by ID. |
| **OpenQuestion** | An ambiguity or gap flagged during spec generation that could not be auto-resolved. Recorded on the Spec; does not block decomposition but should be reviewed. |
| **Task** | The atomic unit of work in the workbench. Produced by the Planner Agent from the Spec. Has a type, status, typed dependencies, and a single agent claim at a time. |
| **TaskDependency** | A dependency edge between tasks. Carries an optional `requiredStatus` (default `verified`) so that downstream tasks can begin before upstream review is complete. |
| **TaskType** | A label that categorises what a Task involves (e.g. `backend_api`, `test_coverage`). Drives persona and skill resolution. Built-in defaults are extendable via config. Use `tags` for sub-type detail. |
| **TaskOutput** | The lightweight result record attached to a Task on `submit_task`: a plain-English summary and the list of files the agent wrote or modified. Full file contents live on disk. |
| **Evidence** | Commands run, tests passed, changed files, and notes accumulated by an implementation agent during execution. Attached to the task and included in the reviewer's context pack. |
| **Persona** | A named role (e.g. `Backend Engineer`) with an associated system prompt and skill list. Loaded at dispatch time from config; gives the sub-agent its identity, behavioural context, and scope constraints. |
| **Skill** | An agentic Skill per the Agent Skills open standard — a folder containing a `SKILL.md` file plus optional scripts and reference material. Two tiers: built-in workbench skills (`workbench-spec`, `workbench-planner`) and user persona skills referenced by name in config. |
| **Context Pack** | The fully self-contained prompt returned by `get_task_prompt`. Includes persona identity, task description, dependency status, AC, constraints, evidence (if resuming), allowed/disallowed actions, and Definition of Done. |
| **TaskLock** | A claim record with an `expires_at` timestamp. Prevents two agents from claiming the same task. An expired lock returns the task to `pending` automatically (dead agent recovery). |
| **Ledger Service** | The deterministic domain layer behind MCP tools/resources. Validates mutations, enforces task transitions, computes claimable task views, applies atomic store updates, tracks retry eligibility, and recovers expired locks. Does not spawn agents or make judgment calls — that is the Story Manager Agent's responsibility. |
| **Task Ledger** | The workspace-scoped SQLite store of all Tasks for the current workbench session. Authoritative state for dispatch and coordination. It can be cleaned or archived when the session ends. |
| **MCP Server** | The stdio Model Context Protocol server that exposes the Task Ledger as resources and tools. Intended to be launched from agent MCP configuration, e.g. `npx workbench mcp`. |
| **Story Manager Agent** | A coordination persona running inside the agent host (not the CLI) for one Jira Story. In auto dispatch mode it spawns sub-agents natively, understands persona and skill mappings, routes implemented tasks for review, verifies or rejects reviewed tasks, handles blockers and retries, routes changes back to implementation personas, and generates the final session summary. |
| **Sub-Agent** | A specialised agent that executes a single Task. Receives a fully resolved context pack, writes files, records evidence via `append_evidence`, and submits via `submit_task`. |
| **Dispatch Mode** | Session-level setting (`auto` or `manual`) controlling how tasks are picked up. `auto` uses the Story Manager; `manual` lets agents pull tasks themselves via MCP. |
| **Session** | The full lifecycle from when the agent invokes the workbench Workflow to final summary. Scopes the ledger, spec, and all in-flight agents. Nothing persists after a session ends except the files written to disk. |
| **ready_for_signoff** | The human review gate. AI review is complete (`verified`); the task waits for the user to approve or send back for rework. The user can act on one, many, or all tasks simultaneously. |
| **sign_off** | The terminal state of a task. Distinct from `verified` (AI accepted) and `ready_for_signoff` (human gate) — `signed_off` means the user explicitly approved the output. Triggered via `sign_off_task` or `sign_off_tasks` MCP tools, which an agent calls on user instruction. |

---

## Non-Goals (v1)

- Persistent ledger across sessions after cleanup/archive
- Jira write-back (subtasks, status updates, comments)
- Multi-ticket / epic-level planning
- Runtime persona/skill management (config file only)
- Human review of individual tasks before execution

---

## See Also

- [`CLI.md`](CLI.md) — all commands, options, exit codes, and environment variables
- [`TechStack.md`](TechStack.md) — runtime, dependencies, build, and source layout
- [`WhatAreSkills.md`](WhatAreSkills.md) — Agent Skills open standard reference
