---
title: Domain Model
type: note
permalink: workbench/domain-model
tags:
- domain-model
- story
- spec
- task
- persona
- skill
---

# Domain Model

## Story

Local story files are a first-class alternative to Jira fetch. Supported source formats are Markdown, YAML, and JSON. Minimum required data is title and description; filename such as `JIRA-123.md` can supply `id` when omitted. MCP owns parsing and normalization through `fetch_story`, so agents do not directly persist story files into `.workbench/`. The mock Jira adapter is for test/local development only.

Raw source request normalized into Workbench. First-class user entrypoints are Jira Cloud and local Markdown/YAML/JSON story files. The mock Jira adapter exists for test/local development. **Immutable once fetched.**
Key fields: `id` (e.g. `PROJ-123`), `source_type` (jira|mock|file), `summary`, `description`, `raw_ac`, `issue_type` (story|bug|task|spike), `priority` (critical|high|medium|low), `labels`, `reporter`, `assignee?`, `fetched_at`.
Local story files should include at least title and description. The filename, such as `JIRA-123.md`, can supply `id` if omitted.

## Spec
Generated from Story. One per session.
Key fields: `id` (`spec-{story_id}`), `story_id`, `background`, `goals[]`, `non_goals[]`, `requirements[]`, `open_questions[]`, `verified_ac[]`, `version` (increments on regen)

Spec persistence goes through `IRepository` (`src/repository/`). The concrete implementation is chosen at `WorkbenchServer` construction time (`FileSystemRepository` in production, `MemoryRepository` in tests). `readSpec()`/`writeSpec()` are path-agnostic — the storage key is baked into the repository constructor, enabling a future SQLite swap without caller changes.

Sub-types:
- `Requirement`: `{ id, description, type: functional|non_functional|constraint, priority: must|should|could }`
- `OpenQuestion`: `{ id, question, resolved: bool, answer: string|null }`
- `AcceptanceCriterion`: `{ id, criterion, testable: bool, notes?, source: jira|generated }`

## Plan
There is no separate persisted `Plan` entity in the current domain model.

"Plan" means the Planner Agent's transient draft `Task[]` produced from a saved Spec. The draft should loop with the user for task split/order/dependency/persona corrections. After user approval, MCP progressively validates and persists accepted task fields through `update_tasks`. Once complete and valid, the draft is persisted as individual claimable Tasks in the ledger.

## Task

Concurrency decision: Gap 5 is resolved with Option A. The Planner assigns `planned_files[]` as the intended file scope for each task. Tasks that can run in parallel should have non-overlapping planned file scopes. If file scope overlaps, the planner should merge the work or add an explicit dependency instead of relying on runtime file locks. `TaskOutput.changed_files[]` remains evidence of actual changes for review.

Atomic unit. Lives in the ledger.
Key fields: `id` (`task-PROJ-123-001`), `spec_id`, `story_id`, `title`, `type`, `tags[]`, `description`, `ac_refs[]`, `persona?`, `review_persona?`, `planned_files[]`, `dependencies: TaskDependency[]`, `status`, `priority` (1..n), `fresh_context_required`, `claimed_by?`, `lock: TaskLock|null`, `attempt_count`, `max_attempts` (default 2), `output: TaskOutput|null`, `evidence: Evidence`, `error?`, `return_to_persona?`

Sub-types:
- `TaskDependency`: `{ taskId, requiredStatus?: TaskStatus }` — default `verified`; override to `implemented` for parallelism
- `TaskLock`: `{ owner, expires_at }` — expired lock returns task to `pending`
- `TaskOutput`: `{ summary, changed_files[] }` — lightweight, no file contents
- `Evidence`: `{ commands_run[], tests_passed[], changed_files[], notes[] }`

## Task Types (built-in, extensible via config)
`backend_api | frontend_ui | schema_migration | test_coverage | spec_writing | security_review | code_review | infra_change | research`

Use `tags` for sub-type detail (e.g. `type: backend_api, tags: [nestjs, redis]`) rather than creating new types.

## Persona
Not a ledger entity — config-driven, resolved at dispatch time.
```yaml
personas:
  backend_engineer:
    name: Backend Engineer
    system_prompt: "..."
    skills: [be-dev]
```

## Skill
Agent Skills open standard (folder with `SKILL.md`). Two tiers:
- **Built-in pipeline skills**: ship with the Workbench tool; installed via `workbench install skills`. All use `disable-model-invocation: true`. See `docs/WorkbenchSkills.md` for the authoritative catalogue.
  - `workbench` — pipeline entry Workflow; user-invoked (`/workbench <source-ref>`)
  - `workbench-spec` — Spec Agent; `context: fork`, programmatic only
  - `workbench-planner` — Planner Agent; `context: fork`, programmatic only
  - `workbench-manager` — Story Manager; auto-mode dispatch/review coordination
  - `workbench-reviewer` — Reviewer Agent; verifies or requests changes
  - `workbench-emulator` — development emulator; full pipeline without MCP
- **User persona skills**: referenced by name in `.workbench.yaml` under `personas[*].skills`; installed independently from agentskills.io or user source; invocation format resolved at runtime per platform

## Persona resolution order
**Implementation**: `task.persona_override` → `type_to_persona[type]` → `defaults.default_persona` → fallback (warn)
**Review**: `task.review_persona_override` → `type_to_persona[type].review_persona` → `defaults.review_persona` → `quality_reviewer` (warn)

Missing mappings emit warnings, never hard errors.
