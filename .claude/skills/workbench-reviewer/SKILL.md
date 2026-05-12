---
name: workbench-reviewer
description: Reviewer Agent — inspects implemented Workbench task output against its acceptance criteria and either verifies the task or requests specific changes. Load alongside the reviewer persona. Used in both auto and manual dispatch modes.
---

# Workbench Reviewer Agent

> **Stub — full instructions authored in Phase 4.**
>
> This skill provides the review procedure for the Reviewer Agent. It is loaded alongside the reviewer persona. In auto mode it runs as a sub-agent spawned by the Story Manager; in manual mode it is invoked by the user or the active agent.

## Instructions (placeholder)

1. Read the task context pack via `get_task_prompt { task_id }`
2. Inspect the changed files and accumulated evidence (`commands_run`, `tests_passed`, `changed_files`, `notes`)
3. Check each `ac_refs` criterion against the implementation

### Review checklist

- [ ] All `ac_refs` criteria satisfied by the implementation
- [ ] Changed files match `planned_files` (or deviation is justified in evidence)
- [ ] Tests exist and pass for non-research/review tasks
- [ ] No obvious regressions in adjacent code
- [ ] No unaddressed TODOs or stub implementations

### Verdict

- **Pass:** Call `verify_task { task_id }` — task moves to `verified`
- **Fail:** Call `request_changes { task_id, notes }` with specific, actionable notes — task moves to `changes_requested`

## See Also

- `docs/WorkbenchSkills.md` — skill catalogue and pipeline stage mapping
- `docs/Feature.md` — review loop specification and MCP tool reference
