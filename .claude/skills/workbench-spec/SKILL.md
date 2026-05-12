---
name: workbench-spec
description: Spec Agent — expands a fetched Story into a structured Spec with validated acceptance criteria. Invoked programmatically by the Workbench pipeline; do not trigger manually.
disable-model-invocation: true
context: fork
---

# Workbench Spec Agent

> **Stub — full instructions authored in Phase 3.**
>
> This skill runs as an isolated subagent (`context: fork`). It receives the Story JSON as its task prompt and writes the Spec to the Ledger via `update_spec`.

## Instructions (placeholder)

1. Read the Story from the context pack
2. Generate: background, goals, non-goals, requirements (functional / non-functional / constraint), open questions, and verified acceptance criteria
3. Flag ambiguities as `OpenQuestion[]` — do not block decomposition
4. Submit fields to the Ledger via `update_spec` (partial updates accepted)
5. Repeat until the Spec is complete or 10 attempts are exhausted

## Invocation Properties

- `context: fork` — runs in an isolated subagent; no access to main conversation history
- `disable-model-invocation: true` — invoked programmatically by `workbench-start` only

## See Also

- `docs/WorkbenchSkills.md` — skill catalogue and pipeline stage mapping
- `docs/Feature.md` — Spec Agent specification and `update_spec` tool reference
