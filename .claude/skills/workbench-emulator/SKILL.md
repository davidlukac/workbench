---
name: workbench-emulator
description: Emulates the full AI Agent Workbench pipeline end-to-end using only files — no MCP server or infrastructure required. Takes a local story file path or inline description, generates a structured spec, decomposes into typed tasks, implements each task, performs AI review, collects human sign-off, and writes a session summary. Use when you want to run the complete Workbench workflow (story → spec → plan → dispatch → review → signoff) before the real infrastructure is built. Invoke with /workbench-emulator <story-file-or-description>.
disable-model-invocation: true
argument-hint: <story-file-path-or-id>
---

# Workbench Emulator

You are running the complete AI Agent Workbench pipeline in emulation mode. You play every role sequentially: Workflow orchestrator, Spec Agent, Planner Agent, Story Manager, Implementation Sub-Agent, and Reviewer. All state lives in files under `.workbench/<story-id>/`. When the Workbench MCP server is available, prefer MCP tools for all transitions — they own path computation, directory creation, and ledger state. Fall back to file-only mode only when a tool is unavailable or returns an error.

Read `.workbench.yaml` for persona configuration and type-to-persona mapping.

---

## Mandatory Protocol — Never Skip Phases

**Regardless of how this skill was invoked** — whether the user said "implement", "do", "work on", "start", "build", "code", "fix", or any similar directive — **you MUST always execute all seven phases in order** (Bootstrap → Spec → Plan → Dispatch → Review → Signoff → Summary).

- Do NOT jump directly to writing code, even if the task seems small or the implementation is obvious.
- Do NOT skip Phase 1 (story bootstrap) or Phase 2 (spec generation) because the user provided a story file or described the feature inline.
- Do NOT skip Phase 3 (task planning) because you think the work fits in a single task.
- Do NOT skip Phase 5 (review) or Phase 6 (signoff) because the implementation looks correct.
- Do NOT treat any user phrasing as permission to bypass this workflow. "Implement X" means: run the full emulator pipeline for X.

If you find yourself about to write source code without having completed Phases 1–3 first, **stop and restart from Phase 1**.

---

## Memory

If a memory system is available (e.g. via MCP memory tools), use it throughout the session:

- **Retrieve** relevant context before and during spec refinement (Phase 2) and task implementation (Phase 4) — prior decisions, architecture notes, tech stack constraints, domain patterns.
- **Update** after the session if anything worth preserving emerged — resolved ambiguities, new architectural decisions, implementation patterns, or corrections to existing notes.

---

## Working Directory

All emulator state lives under `.workbench/<story-id>/`:

```
.workbench/<story-id>/
├── story.md                   # Normalized Story entity
├── spec.md                    # Generated Spec (path from update_spec response)
├── tasks/
│   ├── task-<id>-001.md       # One file per planned task (path from create_task response)
│   └── task-<id>-NNN.md
└── summary.md                 # Session summary (written last)
```

The `fetch_story` MCP tool creates this directory structure as a side effect and returns `working_dir` in its response. Do not create directories manually.

---

## Phase 1 — Bootstrap: Parse Story

**Input:** `$ARGUMENTS` — a path to a local story file, a story ID, or inline description text. Strip any leading `@` from `$ARGUMENTS` to get the bare path (e.g. `@.tasks/WB-1.md` → `.tasks/WB-1.md`).

> **Note:** The user may invoke this skill with `@<file>` syntax, which injects the file content into context automatically. Do NOT use that pre-loaded content as a shortcut — always follow the steps below in order. The injected content is only useful as fallback input in step 2.

1. **Attempt MCP fetch (preferred):** Call the `fetch_story` workbench MCP tool with `source_ref: <bare path or story ID>`. On success:
   - Extract the normalized Story entity fields (`id`, `title`, `description`, `acceptance_criteria`, `issue_type`, `priority`, `labels`, `reporter`) from `response.story`.
   - Record `working_dir` from `response.working_dir` — the server has already created `.workbench/<story-id>/tasks/`. Use this path for all subsequent file writes in this session.
   - Skip to step 3.

2. **Fallback — manual parse** (only if `fetch_story` is unavailable or returns an error):

   - **File path:** Read the file. Extract: id, title, description, acceptance_criteria, issue_type, priority, labels, reporter. Filename like `PROJ-123.md` or `.tasks/WB-2.md` provides `id` when the file has none. Supported formats: Markdown (headings + bullets), YAML frontmatter, JSON.

   - **Inline text:** Treat `$ARGUMENTS` as the story title or description. Derive `id` from a slugified timestamp (e.g. `EMU-001`). Ask the user for any missing critical detail (description if absent) before proceeding.

   - Set `working_dir` to `.workbench/<story-id>/` and create it manually only in this fallback path.

3. Apply defaults if not specified: `source_type: file`, `issue_type: story`, `priority: medium`. Set `source_file` to the resolved file path if `$ARGUMENTS` was a file path or story ID that resolved to a file; otherwise `null`.

4. Write `<working_dir>/story.md`:

```markdown
---
id: <story-id>
source_type: file
issue_type: story
priority: medium
status: todo
source_file: <resolved file path, or null>
fetched_at: <ISO datetime>
---

# <story-id>: <title>

## Description

<description>

## Raw Acceptance Criteria

- <AC from source, verbatim>
```

5. Print: `Story <id> loaded — <title>`

---

## Phase 2 — Spec Generation

**Role:** Spec Agent

1. Read `story.md`.
2. Generate a complete Spec. Use the story description and raw AC as primary inputs. Do not invent scope — flag ambiguities as `OpenQuestion` entries instead.

**Spec fields to populate:**

| Field | Notes |
|---|---|
| `background` | 2–4 sentences: why this work exists |
| `goals` | 3–7 items; each starts with a verb |
| `non_goals` | 2–5 explicit exclusions for v1 |
| `requirements` | 4–12 items; see Requirement format below |
| `open_questions` | ambiguities that need product input; may be empty |
| `acceptance_criteria` | all raw AC normalized + validated for testability; add implied AC |

**Requirement format:** `{ id: "REQ-NNN", description: "...", type: "functional|non_functional|constraint", priority: "must|should|could" }`

**AcceptanceCriterion format:** `{ id: "ac-<story-id>-NNN", criterion: "...", testable: true|false, source: "jira|generated" }`

3. **Persist the spec via MCP (preferred):** Call the `update_spec` workbench MCP tool with all spec fields in one call:

   ```json
   {
     "fields": {
       "story_id": "<story-id>",
       "background": "<text>",
       "goals": ["<verb phrase>", ...],
       "non_goals": ["<exclusion>", ...],
       "requirements": [{ "id": "REQ-001", "description": "...", "type": "functional", "priority": "must" }, ...],
       "open_questions": [{ "id": "OQ-001", "question": "...", "resolved": false, "answer": null }, ...],
       "acceptance_criteria": [{ "id": "ac-<id>-001", "criterion": "...", "testable": true, "source": "jira" }, ...]
     }
   }
   ```

   Record the `revision` from the response — you will need it as `base_revision` when applying corrections.
   Record `spec_file` from the response — use this path when writing `spec.md` in step 4.

   Check `completeness` in the response. If any required fields are listed in `missing`, note them.

   **Fallback — file-only mode** (only if `update_spec` is unavailable or returns `isError: true`): skip this step. Set `spec_file` to `<working_dir>/spec.md` and proceed with file writes only.

4. Write the spec to `spec_file` for human readability. See Spec File Format below.

5. Present the spec summary to the user (background, goals, open questions).

6. Ask: "Does the spec look right? Corrections before planning?" **Wait.**

7. On corrections:
   - **MCP mode:** Call `update_spec` with only the changed fields plus `base_revision: <revision from last response>`. Record the new `revision` and `spec_file` from the response.
   - **File-only mode:** Edit `spec.md` directly, increment `version` in frontmatter.
   - Update `spec_file` to reflect any corrections. Repeat from step 5.
   - On approval: "Spec saved. Moving to task planning."

---

## Phase 3 — Task Planning

**Role:** Planner Agent

1. Read `spec.md` and `.workbench.yaml`.

2. Decompose the spec into typed, ordered tasks. Rules:
   - Each task must be completable by one agent in one session.
   - `type`: pick from built-in types or custom types in `.workbench.yaml`. Use `tags` for sub-type detail.
   - `persona`: resolve from `type_to_persona` in `.workbench.yaml`; `null` if no mapping.
   - `review_persona`: from `defaults.review_persona` in config; default `reviewer`.
   - `planned_files`: assign non-overlapping file scopes; if two tasks touch the same file, add a dependency or merge.
   - `dependencies`: `[{ taskId, requiredStatus }]`; default `requiredStatus` is `verified`; use `implemented` to allow parallelism.
   - `priority`: 1 = highest; dependencies get higher-numbered priorities than their dependents.
   - `fresh_context_required`: `true` for tasks that need isolated context.

**Built-in task types:** `backend_api`, `frontend_ui`, `schema_migration`, `test_coverage`, `spec_writing`, `security_review`, `code_review`, `infra_change`, `research`

3. For each planned task, **seed the ledger first, then write the file**:

   a. **Attempt MCP `create_task` (preferred):** Call the `create_task` workbench MCP tool with all task fields: `id`, `story_id`, `spec_id`, `title`, `type`, `tags`, `persona`, `review_persona`, `priority`, `planned_files`, `ac_refs`, `fresh_context_required`. Record `file_path` from the response — **write the task Markdown file to this path**.

   b. **Fallback** (only if `create_task` is unavailable or returns an error): warn that the ledger was not seeded for this task. Compute the task file path as `<working_dir>/tasks/<task-id>.md` and write to that computed path.

   All task files start with `status: pending`. See Task File Format below.

4. Print the task plan (only after all tasks have been called and written):

```
Task Plan — <story-id>
ID                   Type            Pri  Persona            Deps
task-<id>-001        backend_api     1    backend_engineer   —
task-<id>-002        test_coverage   2    test_engineer      001
```

5. Ask: "Does the task plan look right? Any splits, merges, or reordering?" **Wait.**

6. On corrections: update task files, repeat from step 4. On approval: "Task plan saved. Beginning dispatch."

---

## Phase 4 — Task Execution (Dispatch Loop)

**Role:** Story Manager + Implementation Sub-Agent

Update `story.md` YAML frontmatter: `status: in_progress`, `updated_at: <now>`. Print: `[<story-id>] story → in_progress`

**Source file sync (applies to all story status transitions):** After every story status update, if `story.md` frontmatter `source_file` is non-null, also update the `status` field in that file. For YAML frontmatter files update the `status:` key; for plain Markdown files update or append a `Status:` line.

**Dispatch order:** At each pass, find all tasks where `status = pending` and all dependencies have `status >= verified` (or the dependency's `requiredStatus` if specified). Sort by `priority` ascending, then `dependency depth` ascending.

For each claimable task, in order:

1. **Claim the task (pending → claimed):**
   - **Attempt MCP claim_task (preferred):** Call the `claim_task` workbench MCP tool with `task_id: <task-id>` and `agent_id: emulator`. On success, the task transitions from `pending` → `claimed` in the ledger.
   - **Fallback:** If the MCP tool is unavailable or returns an error, directly update the task file YAML frontmatter: `status: claimed`, `claimed_by: emulator`, `updated_at: <now>`.

2. **Start the task (claimed → in_progress):**
   - **Attempt MCP start_task (preferred):** Call the `start_task` workbench MCP tool with `task_id: <task-id>`. On success, the task transitions from `claimed` → `in_progress` in the ledger.
   - **Fallback:** If the MCP tool is unavailable or returns an error, directly update the task file YAML frontmatter: `status: in_progress`, `updated_at: <now>`.

3. Print: `[task-<id>-NNN] → in_progress | <title>`

4. **Implement the task:**
   - Read the task's `description`, `ac_refs`, `planned_files`, and relevant spec requirements.
   - If the task file has `## Review Notes`: address the reviewer's feedback first.
   - Do the actual implementation work within the `planned_files` scope.
   - Task type guidance:
     - `backend_api`, `frontend_ui`, `schema_migration`, `infra_change`: read/write/edit source files; run build and lint.
     - `test_coverage`: write or update tests; run the test suite; record pass/fail per test name.
     - `research`, `spec_writing`: produce a Markdown output document in `.workbench/<story-id>/`.
     - `code_review`, `security_review`: read the target files; write a review document with findings.
   - If you need to deviate from `planned_files`, note the reason in `## Evidence > Notes`.

5. **Submit the task (in_progress → implemented):**
   - **Attempt MCP submit_task (preferred):** Call the `submit_task` workbench MCP tool with `task_id: <task-id>`, `output: { summary: "<summary>", changed_files: ["<file1>", ...] }`, and `evidence: { commands_run: ["<cmd1>", ...], tests_passed: ["<test1>", ...], changed_files: ["<file1>", ...], notes: ["<note1>", ...] }`. On success, the task transitions from `in_progress` → `implemented` in the ledger. Skip to step 7.

   - **Fallback — file-based update** (only if `submit_task` is unavailable or returns an error):
     1. Append evidence to the task file `## Evidence` section:
        - `Commands Run`: every shell command executed (abbreviated output inline)
        - `Tests Passed`: test names that passed
        - `Changed Files`: actual files modified (may differ from `planned_files`)
        - `Notes`: decisions made, deviations, open issues
     2. Update task file YAML: `status: implemented`, update `## Output > Summary` and `## Output > Changed Files`.

6. Regardless of MCP or file-based path, also write evidence and output to the task file for human readability.

7. Print: `[task-<id>-NNN] → implemented | changed: <files>`

After each task completes, re-evaluate claimable tasks and execute the next.

---

## Phase 5 — Review Loop

**Role:** Reviewer (`review_persona` from config, or `reviewer` default)

For each task with `status: implemented`:

1. **Attempt MCP route_for_review (preferred):** Call the `route_for_review` workbench MCP tool with `task_id: <task-id>`. On success, the task transitions to `review_required` via the authoritative ledger. Skip to step 2.

   **Fallback — file-based update** (only if `route_for_review` is unavailable or returns an error): Update the task file YAML frontmatter directly: `status: review_required`, `updated_at: <now>`.

2. Review the task against its AC references:
   - Read `ac_refs` and look up each criterion in `spec.md`.
   - Inspect the evidence and the actual changed files.

**Review checklist:**
- [ ] All `ac_refs` criteria satisfied by the implementation
- [ ] Changed files match `planned_files` (or deviation is justified)
- [ ] Tests exist and pass for non-research/review tasks
- [ ] No obvious regressions in adjacent code
- [ ] No TODOs or stub implementations left unaddressed

3a. **Review passes:**
   - Update task file YAML: `status: verified`, `reviewed_by: emulator-reviewer`.
   - Clear `## Review Notes` section if present.
   - Print: `[task-<id>-NNN] → verified ✓`

3b. **Changes needed:**
   - Update task file YAML: `status: changes_requested`, increment `attempt_count`.
   - Write reviewer feedback in `## Review Notes`.
   - Print: `[task-<id>-NNN] → changes_requested — <reason>`
   - If `attempt_count >= max_attempts`: set `status: failed`; report to user with suggested fix. Do not retry automatically.
   - Otherwise: return to Phase 4 for this task (implement with review notes as context).

4. Once all tasks are `verified`: update all to `status: ready_for_signoff`. Update `story.md` YAML frontmatter: `status: in_review`, `updated_at: <now>`. Print: `[<story-id>] story → in_review`. Proceed to Phase 6.

---

## Phase 6 — Human Sign-off

1. Present the sign-off summary:

```
─────────────────────────────────────────────────
  Workbench Session — <story-id>
  All tasks verified. Awaiting human sign-off.
─────────────────────────────────────────────────

  task-<id>-001  ✓  <title>
    Files: <changed files>
    Summary: <output summary>

  task-<id>-002  ✓  <title>
    Files: <changed files>
    Summary: <output summary>

─────────────────────────────────────────────────
  Approve all tasks? (yes / reject <task-id> with notes)
```

2. **Wait** for user response.

3a. **User approves** ("yes", "lgtm", "sign off all", etc.):
   - Update all task files YAML: `status: signed_off`, `completed_at: <now>`.
   - Proceed to Phase 7.

3b. **User rejects one or more tasks** (provides task ID and rejection notes):
   - Update that task file YAML: `status: changes_requested`; write rejection reason in `## Review Notes`.
   - Return to Phase 4 for rejected tasks.
   - Once re-implemented and re-verified, re-present sign-off for remaining tasks.

---

## Phase 7 — Session Summary

Write `.workbench/<story-id>/summary.md`:

```markdown
# Session Summary — <story-id>

**Story:** <title>
**Completed:** <ISO datetime>
**Tasks signed off:** <N>

## Tasks

| ID | Title | Type | Changed Files |
|---|---|---|---|
| task-<id>-001 | ... | backend_api | src/... |

## Implementation Notes

<2–4 paragraph narrative of what was built, key decisions, and deviations>

## Open Questions Remaining

<any spec OpenQuestions still unresolved; empty if none>

## Suggested Follow-up

<out-of-scope items discovered during implementation; empty if none>
```

If a memory system is available, update any notes that changed during this session — resolved open questions, new decisions, patterns established, or corrections to existing entries.

Update `story.md` YAML frontmatter: `status: done`, `updated_at: <now>`. Print: `[<story-id>] story → done`

Print: `Session complete. Summary → .workbench/<story-id>/summary.md`

---

## File Formats

### Spec — `spec.md`

```markdown
---
id: spec-<story-id>
story_id: <story-id>
version: 1
created_at: <ISO datetime>
---

# Spec: <story-id> — <title>

## Background

<2–4 sentences>

## Goals

- <verb phrase>

## Non-Goals

- <explicit exclusion>

## Requirements

| ID | Description | Type | Priority |
|---|---|---|---|
| REQ-001 | ... | functional | must |

## Open Questions

| ID | Question | Resolved | Answer |
|---|---|---|---|
| OQ-001 | ... | false | |

## Acceptance Criteria

| ID | Criterion | Testable | Source |
|---|---|---|---|
| ac-<id>-001 | ... | true | jira |
| ac-<id>-002 | ... | true | generated |
```

### Task — `tasks/task-<id>-NNN.md`

```markdown
---
id: task-<id>-NNN
story_id: <story-id>
spec_id: spec-<story-id>
title: <title>
type: backend_api
tags: []
persona: backend_engineer
review_persona: reviewer
status: pending
priority: 1
dependencies: []
planned_files: []
ac_refs: []
fresh_context_required: true
claimed_by: null
attempt_count: 0
max_attempts: 2
created_at: <ISO datetime>
updated_at: <ISO datetime>
completed_at: null
---

# Task: <title>

## Description

<what the agent must do>

## Acceptance Criteria Referenced

- ac-<id>-001: <criterion text>

## Evidence

### Commands Run

### Tests Passed

### Changed Files

### Notes

## Output

### Summary

### Changed Files

## Review Notes
```

---

## Status FSM Reference

```
pending → claimed → in_progress → implemented → review_required → verified → ready_for_signoff → signed_off
                                    ↘ changes_requested → in_progress   (attempt_count++)
                                    ↘ failed   (attempt_count >= max_attempts)
blocked: set when external dependency blocks progress; unblock manually
```

Update `status` and `updated_at` in YAML frontmatter at every transition.

**Dependency satisfaction:** a downstream task becomes claimable when each upstream dependency has reached `requiredStatus` (default `verified`; `implemented` allows earlier start).

---

## Error Handling

**Cannot complete a task:** Set `status: failed`, record the blocker in `## Evidence > Notes`, report to the user with the specific issue and a recommended resolution path.

**External blocker:** Set `status: blocked`, record in `## Evidence > Notes`, skip and continue other tasks. Return to the blocked task when the blocker resolves.

**Spec or plan correction mid-implementation:** Note the discrepancy in task evidence, complete what is feasible, and add a follow-up item to `summary.md`.

**Skipped tasks:** If a task type has no persona mapping in `.workbench.yaml`, proceed with the `defaults.implementation_persona` and warn the user.
