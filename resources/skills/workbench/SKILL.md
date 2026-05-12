---
name: workbench
description: Main Workbench pipeline Workflow — orchestrates story fetch, spec generation, task planning, dispatch, and signoff for a Jira ticket or local story file. Use when starting a new Workbench session with /workbench <source-ref>.
disable-model-invocation: true
argument-hint: <jira-key-or-story-file>
---

# Workbench

Starts a full AI Agent Workbench session for `$ARGUMENTS`.

## Instructions

> **Stub — full instructions authored in Phase 3.**
>
> This skill drives the complete pipeline: story fetch → spec generation (with user review) → task planning (with user review) → dispatch → review loop → signoff summary.

### Steps (placeholder)

1. Call MCP `fetch_story` with the provided source reference
2. Invoke `/workbench-spec` to generate and review the Spec
3. Invoke `/workbench-planner` to generate and review the task plan
4. Begin dispatch per `dispatch_mode` in `.workbench.yaml`:
   - `auto`: hand off to the Story Manager (`workbench-manager`)
   - `manual`: loop through tasks using `workbench task next`
5. Present signoff summary; wait for user approval
6. Call `sign_off_tasks` on user instruction

## See Also

- `docs/WorkbenchSkills.md` — full skill catalogue
- `docs/Feature.md` — pipeline architecture and session lifecycle
- `docs/SequenceDiagrams.md` — end-to-end sequence diagrams
