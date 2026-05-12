# AI Agent Workbench — Sequence Diagrams

These diagrams document the end-to-end Workbench session from a user's Jira ticket reference or local story file to all tasks reaching `signed_off`.

They use Mermaid `sequenceDiagram` blocks, which render in GitHub Markdown and common VS Code Markdown preview extensions.

The diagrams intentionally show the pipeline ingestion tools (`fetch_story`, `update_spec`, `update_tasks`) because the Story, Spec, and Task write path must be explicit. Exact field shapes, result schema, revision handling, and circuit breaker semantics remain deferred implementation details.

---

## Actors And Planes

| Name | Plane | Definition |
|------|-------|------------|
| User | Human | Person who provides the Jira ticket reference or local story file, reviews summaries, approves signoff, or requests changes. |
| Agent Host | Agent runtime | Claude Code, Codex, Windsurf, Cursor, or another environment that runs the Workbench Workflow and can call MCP tools/resources. |
| Workbench Workflow | Agent runtime | The user-invoked workflow that coordinates story fetch requests, spec, plan, dispatch, review, and summary. It runs inside the agent host, not inside the CLI. |
| Spec Agent Skill | Agent runtime | `workbench-spec`; expands a Story into a structured Spec and flags product ambiguity as `OpenQuestion[]`. |
| Planner Agent Skill | Agent runtime | `workbench-planner`; converts a valid Spec into typed tasks, dependencies, priorities, and persona assignments. |
| Story Manager Agent | Agent runtime | Auto-mode coordination persona for one Jira Story. Reads pending tasks, understands personas and skills, assigns work, tracks blockers, routes review, recovers tasks, and presents signoff. |
| Implementation Sub-Agent | Agent runtime | Agent assigned to one task. It claims the task, edits project files, records evidence, and submits output. |
| Reviewer Agent | Agent runtime | Agent or review step that checks implemented work against acceptance criteria and either verifies it or requests changes. |
| Story Source | External system | Source of the raw story. First-class user entrypoints are Jira Cloud and local Markdown/YAML/JSON story files. The mock Jira adapter is for test/local development. |
| Workbench MCP Server | Coordination boundary | Stdio MCP server launched by the agent host. Exposes `workbench://` resources and mutation tools. It performs deterministic Jira fetches and never calls a model. |
| Ledger Service | Coordination boundary | Deterministic domain layer behind MCP. Validates payloads and state transitions, computes claimable task views, tracks retries/locks, and applies atomic store updates. |
| Workspace Session Store | Local state | Workspace-scoped backing store under `.workbench/` or equivalent. Holds Story, Spec, tasks, locks, evidence, and revisions with atomic updates. |
| Project Files | Workspace files | The actual repository or working directory files modified by implementation agents. These are not the ledger. |

Plane boundaries:

- Human plane: User decisions and approval.
- Agent runtime plane: Workflows, Skills, sub-agents, and reviewers. This is where model reasoning happens.
- Coordination plane: MCP tools/resources, Ledger Service, and workspace session store. This validates and persists state but does not perform AI judgment.
- External/system plane: Story source and project files.

---

## Shared Bootstrap

This setup is common to both `auto` and `manual` dispatch modes.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Host as Agent Host
  participant MCP as Workbench MCP Server
  participant Ledger as Ledger Service
  participant Store as Workspace Session Store
  participant Source as Story Source

  User->>Host: Invoke Workbench Workflow with Jira key or story file
  Host->>MCP: initialize
  MCP-->>Host: capabilities, instructions
  Host->>MCP: tools/list, resources/list
  MCP-->>Host: Workbench tools and workbench:// resources
  Host->>MCP: tools/call fetch_story { source_ref }
  MCP->>Source: Fetch Jira story or parse local story file
  Source-->>MCP: Story payload
  MCP->>Ledger: Normalize and validate Story entity
  Ledger->>Store: Persist Story
  MCP-->>Host: Story stored, resource available
  Host->>MCP: resources/read workbench://story
  MCP->>Ledger: Read Story
  Ledger->>Store: Load Story
  Store-->>Ledger: Story
  Ledger-->>MCP: Story
  MCP-->>Host: Story JSON
```

Notes:

- The user supplies a Jira reference or a local story file, not a full spec.
- The Workflow runs inside the agent host. The CLI/MCP server does not call a model.
- MCP owns deterministic source loading. For Jira it fetches through the configured adapter. For local stories it parses Markdown, YAML, or JSON into the same Story entity. In test/local development, the Jira adapter can be replaced with a mock.
- Local story files should provide at least `title` and `description`. The filename, such as `JIRA-123.md`, can supply the Story `id` when the file does not include one.
- Jira config and credential precedence are tracked separately in `DesignGaps.md` Gap 9.
- Story persistence should happen through an MCP tool, not by an agent directly editing `.workbench/` files.

---

## Spec And Plan Creation

This path is also common to both dispatch modes and is the core of Gap 4.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Host as Agent Host Workflow
  participant Spec as Spec Agent Skill
  participant Planner as Planner Agent Skill
  participant MCP as Workbench MCP Server
  participant Ledger as Ledger Service
  participant Store as Workspace Session Store

  Host-->>User: Story fetched, offer to draft Spec
  User->>Host: Continue to Spec
  Host->>MCP: resources/read workbench://story
  MCP->>Ledger: Read Story
  Ledger->>Store: Load Story
  Store-->>Ledger: Story
  Ledger-->>MCP: Story
  MCP-->>Host: Story JSON
  Host->>Spec: Invoke workbench-spec with Story
  Spec-->>Host: Draft Spec and open questions
  Host-->>User: Present draft Spec and ask for corrections

  loop Until user approves Spec draft
    alt User requests changes
      User->>Host: Corrections, answers, scope notes
      Host->>Spec: Revise draft with user feedback
      Spec-->>Host: Updated draft Spec
      Host-->>User: Present updated draft
    else User approves
      User->>Host: Approve Spec draft
    end
  end

  loop Until Spec is complete or 10 update_spec attempts are used
    Host->>MCP: tools/call update_spec { base_revision, fields }
    MCP->>Ledger: Validate submitted Spec fields
    Ledger->>Store: Persist accepted fields atomically
    MCP-->>Host: Updated fields, rejected fields, current Spec, completeness
    alt Spec is complete
      Host->>Host: Spec update loop complete
    else Spec is incomplete
      Host->>Spec: Revise missing or rejected fields
      Spec-->>Host: Partial Spec field update
    end
  end

  alt Spec is complete
    Host->>MCP: resources/read workbench://spec
    MCP->>Ledger: Read Spec
    Ledger->>Store: Load Spec
    Store-->>Ledger: Spec
    Ledger-->>MCP: Spec
    MCP-->>Host: Spec JSON
    Host-->>User: Spec saved, offer to create task plan
    User->>Host: Continue to Plan
    Host->>Planner: Invoke workbench-planner with Spec and config
    Planner-->>Host: Draft task plan
    Host-->>User: Present task plan and ask for corrections

    loop Until user approves task plan
      alt User requests changes
        User->>Host: Task split, ordering, dependency, or persona corrections
        Host->>Planner: Revise task plan with user feedback
        Planner-->>Host: Updated task plan
        Host-->>User: Present updated task plan
      else User approves
        User->>Host: Approve task plan
      end
    end

    loop Until task draft is complete or 10 update_tasks attempts are used
      Host->>MCP: tools/call update_tasks { base_revision, tasks }
      MCP->>Ledger: Validate submitted task fields, dependencies, persona mapping
      Ledger->>Store: Persist accepted task fields atomically
      MCP-->>Host: Updated fields, rejected fields, current task draft, completeness
      alt Task draft is complete
        Ledger->>Store: Mark valid tasks claimable
        MCP-->>Host: Tasks complete, pending tasks available
      else Task draft is incomplete
        Host->>Planner: Revise missing or rejected task fields
        Planner-->>Host: Partial task update
      end
    end

    alt Task draft still incomplete after 10 attempts
      Host-->>User: Stop with current task draft and actionable completeness issues
    end
  else Spec still incomplete after 10 attempts
    Host-->>User: Stop with current Spec and actionable completeness issues
  end
```

Notes:

- The user can start the Spec step explicitly after Story fetch, or accept a Workflow continuation offer.
- The Spec draft should loop with the user before planning. User feedback is product clarification, not schema repair.
- `update_spec` is the validation boundary. Agents can submit partial field updates; MCP stores accepted fields, rejects invalid fields, returns the current Spec, and reports completeness.
- Spec update loops are capped at 10 attempts. After that, the Workflow stops and shows the current Spec plus missing/invalid fields.
- Schema failures should produce repairable structured errors. They should not be silently converted into `OpenQuestion[]`.
- `OpenQuestion[]` remains for product or requirements ambiguity discovered during spec generation.
- The current domain model does not have a persisted `Plan` entity. "Plan" means a transient draft task list produced by the Planner Agent.
- The task plan should loop with the user before `update_tasks`, just like the Spec draft loops before `update_spec`.
- `update_tasks` follows the same partial-update pattern as `update_spec`: accepted/rejected fields, current task draft, completeness, and a 10-attempt cap.
- Tasks become claimable only after the task draft is complete and valid.

---

## Auto Dispatch Mode

In auto mode, the Story Manager Agent runs inside an agent host that can spawn sub-agents natively.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Workflow as Workbench Workflow
  participant Manager as Story Manager Agent
  participant MCP as Workbench MCP Server
  participant Ledger as Ledger Service
  participant Store as Workspace Session Store
  participant Impl as Implementation Sub-Agent(s)
  participant Review as Reviewer Agent

  User->>Workflow: Invoke Workbench Workflow with source_ref and dispatch_mode auto
  Workflow->>Workflow: Complete shared bootstrap, Spec, and Plan creation
  Workflow->>MCP: resources/read workbench://tasks/pending
  MCP-->>Workflow: Current pending task view
  Workflow->>Manager: Start managing Story ledger

  loop Until all tasks are ready_for_signoff
    Manager->>MCP: resources/read workbench://tasks/pending
    MCP->>Ledger: Compute claimable tasks
    Ledger->>Store: Read tasks, dependencies, locks
    Store-->>Ledger: Ledger state
    Ledger-->>MCP: Pending tasks
    MCP-->>Manager: Pending tasks

    opt Claimable task exists
      Manager->>Impl: Spawn sub-agent with task assignment
      Impl->>MCP: tools/call claim_task { task_id, agent_id }
      MCP->>Ledger: Atomic dependency, status, and lock check
      Ledger->>Store: Commit claim
      MCP-->>Impl: Task claimed
      Impl->>MCP: tools/call start_task
      MCP->>Ledger: claimed -> in_progress
      Ledger->>Store: Persist status
      MCP-->>Impl: Task in_progress
      Impl->>MCP: tools/call get_task_prompt { task_id }
      MCP->>Ledger: Read task, spec, dependencies, persona config
      MCP-->>Impl: Context pack
      Impl->>Impl: Edit project files
      Impl->>MCP: tools/call append_evidence (optional)
      MCP->>Ledger: Append evidence
      Ledger->>Store: Persist evidence
      Impl->>MCP: tools/call submit_task { output, evidence }
      MCP->>Ledger: in_progress -> implemented
      Ledger->>Store: Persist task output
      MCP-->>Manager: Task implemented
    end

    opt Implemented task exists
      Manager->>MCP: tools/call route_for_review
      MCP->>Ledger: implemented -> review_required
      Ledger->>Store: Persist review route
      Manager->>Review: Spawn or invoke reviewer persona
      Review->>MCP: tools/call get_task_prompt { task_id }
      MCP-->>Review: Review context pack
      Review->>Review: Inspect diff, evidence, AC
      alt Review passes
        Review->>MCP: tools/call verify_task
        MCP->>Ledger: review_required -> verified
        Ledger->>Store: Persist verification
        Manager->>MCP: tools/call queue_for_signoff
        MCP->>Ledger: verified -> ready_for_signoff
        Ledger->>Store: Persist signoff queue
      else Changes requested
        Review->>MCP: tools/call request_changes { notes }
        MCP->>Ledger: review_required -> changes_requested
        Ledger->>Store: Persist review notes
        Manager->>Impl: Resume implementation with review notes
        Impl->>MCP: tools/call resume_task
        MCP->>Ledger: changes_requested -> in_progress
        Ledger->>Store: Persist resumed task
      end
    end
  end

  loop Until all tasks are signed_off
    Manager->>MCP: resources/read workbench://tasks/ready_for_signoff
    MCP-->>Manager: Tasks awaiting human approval
    Manager-->>User: Present signoff summary

    alt User approves all ready tasks
      User->>Manager: Sign off ready tasks
      Manager->>MCP: tools/call sign_off_tasks { all: true }
      MCP->>Ledger: ready_for_signoff -> signed_off
      Ledger->>Store: Persist signed_off tasks
      MCP-->>Manager: Tasks signed_off
    else User rejects one or more tasks
      User->>Manager: Request changes with notes
      Manager->>MCP: tools/call request_changes { task_id, notes }
      MCP->>Ledger: ready_for_signoff -> changes_requested
      Ledger->>Store: Persist user rejection
      Manager->>Impl: Resume rejected task
      Manager->>Manager: Return to task management loop
    end
  end

  Manager->>MCP: resources/read workbench://tasks
  MCP-->>Manager: Final ledger state
  Manager-->>User: Final summary, all tasks signed_off
```

Notes:

- The Workbench Workflow performs bootstrap, Spec, and task creation. The Story Manager takes over once tasks exist.
- The Story Manager spawns agents through the host's native mechanism. MCP does not spawn agents.
- The loop is shown as a polling/management cycle because new tasks can become claimable after dependencies are verified.
- Signoff rejection returns tasks to `changes_requested` and control returns to the task management loop above.
- Every ledger mutation is an MCP tool call with atomic store updates.
- Human approval is represented by `signed_off`, not merely `verified`.

---

## Manual Dispatch Mode

In manual mode, one agent or user-driven sequence pulls tasks from MCP and works them one at a time.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Workflow as Workbench Workflow
  participant Agent as Manual Agent
  participant MCP as Workbench MCP Server
  participant Ledger as Ledger Service
  participant Store as Workspace Session Store
  participant Review as Reviewer Persona

  User->>Workflow: Invoke Workbench Workflow with source_ref and dispatch_mode manual
  Workflow->>Workflow: Complete shared bootstrap, Spec, and Plan creation
  Workflow->>MCP: resources/read workbench://tasks/pending
  MCP-->>Workflow: Current pending task view
  Workflow->>Agent: Continue manual task execution

  loop Until all tasks are ready_for_signoff
    Agent->>MCP: resources/read workbench://tasks/pending
    MCP->>Ledger: Compute claimable tasks
    Ledger->>Store: Read tasks, dependencies, locks
    Store-->>Ledger: Ledger state
    Ledger-->>MCP: Pending tasks
    MCP-->>Agent: Pending tasks
    Agent->>MCP: tools/call claim_task { task_id, agent_id }
    MCP->>Ledger: Atomic dependency, status, and lock check
    Ledger->>Store: Commit claim
    MCP-->>Agent: Task claimed
    Agent->>MCP: tools/call start_task
    MCP->>Ledger: claimed -> in_progress
    Ledger->>Store: Persist status
    Agent->>MCP: tools/call get_task_prompt { task_id }
    MCP-->>Agent: Context pack
    Agent->>Agent: Edit project files
    Agent->>MCP: tools/call append_evidence (optional)
    MCP->>Ledger: Append evidence
    Ledger->>Store: Persist evidence
    Agent->>MCP: tools/call submit_task { output, evidence }
    MCP->>Ledger: in_progress -> implemented
    Ledger->>Store: Persist task output

    Agent->>MCP: tools/call route_for_review
    MCP->>Ledger: implemented -> review_required
    Ledger->>Store: Persist review route
    Agent->>Review: Invoke reviewer persona or review step
    Review->>MCP: tools/call get_task_prompt { task_id }
    MCP-->>Review: Review context pack
    Review->>Review: Inspect diff, evidence, AC

    alt Review passes
      Review->>MCP: tools/call verify_task
      MCP->>Ledger: review_required -> verified
      Ledger->>Store: Persist verification
      Agent->>MCP: tools/call queue_for_signoff
      MCP->>Ledger: verified -> ready_for_signoff
      Ledger->>Store: Persist signoff queue
    else Changes requested
      Review->>MCP: tools/call request_changes { notes }
      MCP->>Ledger: review_required -> changes_requested
      Ledger->>Store: Persist review notes
      Agent->>MCP: tools/call resume_task
      MCP->>Ledger: changes_requested -> in_progress
      Ledger->>Store: Persist resumed task
    end
  end

  loop Until all tasks are signed_off
    Agent->>MCP: resources/read workbench://tasks/ready_for_signoff
    MCP-->>Agent: Tasks awaiting human approval
    Agent-->>User: Present signoff summary

    alt User approves all ready tasks
      User->>Agent: Sign off ready tasks
      Agent->>MCP: tools/call sign_off_tasks { all: true }
      MCP->>Ledger: ready_for_signoff -> signed_off
      Ledger->>Store: Persist signed_off tasks
      MCP-->>Agent: Tasks signed_off
    else User rejects one or more tasks
      User->>Agent: Request changes with notes
      Agent->>MCP: tools/call request_changes { task_id, notes }
      MCP->>Ledger: ready_for_signoff -> changes_requested
      Ledger->>Store: Persist user rejection
      Agent->>MCP: tools/call resume_task
      MCP->>Ledger: changes_requested -> in_progress
      Ledger->>Store: Persist resumed task
      Agent->>Agent: Return to manual task loop
    end
  end

  Agent->>MCP: resources/read workbench://tasks
  MCP-->>Agent: Final ledger state
  Agent-->>User: Final summary, all tasks signed_off
```

Notes:

- Manual mode still uses the same MCP resources and tools as auto mode.
- The Workbench Workflow performs bootstrap, Spec, and task creation. A manual agent then advances one task/review cycle at a time.
- Signoff rejection returns tasks to `changes_requested` and control returns to the manual task loop above.
- The difference is who advances the loop: a single user-directed agent instead of a Story Manager spawning sub-agents.
- `workbench task next` can be a CLI convenience for this mode, but it should use the same ledger and prompt-building logic.

---

## Terminal States

```mermaid
sequenceDiagram
  autonumber
  participant Agent as Implementation Agent
  participant Review as Reviewer or Story Manager
  actor User
  participant MCP as Workbench MCP Server
  participant Ledger as Ledger Service
  participant Store as Workspace Session Store

  Agent->>MCP: submit_task
  MCP->>Ledger: in_progress -> implemented
  Ledger->>Store: Persist implemented
  Review->>MCP: route_for_review
  MCP->>Ledger: implemented -> review_required
  Ledger->>Store: Persist review_required
  Review->>MCP: verify_task
  MCP->>Ledger: review_required -> verified
  Ledger->>Store: Persist verified
  Review->>MCP: queue_for_signoff
  MCP->>Ledger: verified -> ready_for_signoff
  Ledger->>Store: Persist ready_for_signoff
  MCP-->>User: Signoff summary
  User->>MCP: sign_off_task or sign_off_tasks
  MCP->>Ledger: ready_for_signoff -> signed_off
  Ledger->>Store: Persist signed_off
```

`signed_off` is the end of the Workbench task lifecycle in v1. Jira write-back, PR creation, or Confluence publishing may be generated as summary output, but direct write-back remains outside v1 scope unless explicitly added later.
