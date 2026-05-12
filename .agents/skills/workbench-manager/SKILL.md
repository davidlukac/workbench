---
name: workbench-manager
description: Story Manager — coordinates auto-mode Workbench dispatch. Reads the pending task queue, spawns sub-agents, monitors progress, routes implemented tasks for review, handles blockers and retries, and presents the signoff summary. Load alongside the Story Manager persona in auto dispatch mode.
disable-model-invocation: true
---

# Workbench Story Manager

> **Stub — full instructions authored in Phase 4.**
>
> This skill provides the coordination procedure for the Story Manager Agent in auto dispatch mode. It is loaded alongside the Story Manager persona and runs in the main conversation context so it can interact with the user across the session.

## Instructions (placeholder)

### Dispatch loop (repeat until all tasks are `ready_for_signoff`)

1. Read `workbench://tasks/pending`
2. For each claimable task: spawn a sub-agent with the task context pack from `get_task_prompt`
3. Monitor `implemented` tasks; call `route_for_review` then invoke the reviewer persona (`workbench-reviewer`)
4. On `verified`: call `queue_for_signoff`
5. On `changes_requested`: call `resume_task` to route back to the implementation persona with reviewer notes
6. Handle expired locks and blocked tasks: investigate and unblock or escalate to user

### Signoff loop

7. Present signoff summary from `workbench://tasks/ready_for_signoff`
8. On user approval: call `sign_off_tasks { all: true }` or `sign_off_task` per task
9. On user rejection: call `request_changes` with notes; return to dispatch loop for rejected tasks

## See Also

- `docs/WorkbenchSkills.md` — skill catalogue and pipeline stage mapping
- `docs/Feature.md` — Story Manager Agent specification and MCP tool reference
- `docs/SequenceDiagrams.md` — auto dispatch mode sequence diagram
