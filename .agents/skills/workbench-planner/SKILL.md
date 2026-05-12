---
name: workbench-planner
description: Planner Agent — decomposes a validated Spec into a typed, ordered, dependency-aware Task list with persona assignments. Invoked programmatically by the Workbench pipeline; do not trigger manually.
disable-model-invocation: true
context: fork
---

# Workbench Planner Agent

> **Stub — full instructions authored in Phase 3.**
>
> This skill runs as an isolated subagent (`context: fork`). It receives the Spec JSON and `.workbench.yaml` config as its task prompt and writes Tasks to the Ledger via `update_tasks`.

## Instructions (placeholder)

1. Read the Spec and the task type registry from the context pack
2. Decompose the Spec into typed, ordered tasks:
   - Assign `type`, `tags`, `priority`, `dependencies`, `planned_files`
   - Resolve `persona` and `review_persona` from `type_to_persona` in `.workbench.yaml`
   - Set `fresh_context_required` per task based on type and complexity
   - Ensure concurrent tasks have non-overlapping `planned_files`
3. Submit tasks to the Ledger via `update_tasks` (partial updates accepted)
4. Repeat until the task draft is complete or 10 attempts are exhausted

## Invocation Properties

- `context: fork` — runs in an isolated subagent; no access to main conversation history
- `disable-model-invocation: true` — invoked programmatically by `workbench-start` only

## See Also

- `docs/WorkbenchSkills.md` — skill catalogue and pipeline stage mapping
- `docs/Feature.md` — Planner Agent specification and `update_tasks` tool reference
