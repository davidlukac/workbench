---
title: Task Status FSM
type: note
permalink: workbench/task-status-fsm
tags:
- fsm
- task-status
- transitions
- mcp-tools
---

# Task Status FSM

## Status enum
```
pending → claimed → in_progress → implemented → review_required → verified → ready_for_signoff → signed_off
                               ↘ changes_requested → in_progress (return_to_persona)
                               ↘ blocked → pending
                               ↘ failed → (retry ×2 with backoff) → pending | failed[manual]

ready_for_signoff → changes_requested → in_progress  (user rejects during signoff)
```

## Status descriptions
| Status | Meaning |
|--------|---------|
| pending | Ready; all deps satisfied |
| claimed | Agent reserved; lock active |
| in_progress | Agent actively working |
| implemented | Agent believes done; awaiting review routing |
| review_required | Routed to reviewer; awaiting verdict |
| changes_requested | Reviewer rejected; `return_to_persona` set |
| verified | AI reviewer accepted; awaiting human sign-off |
| ready_for_signoff | Human gate; user approves or rejects |
| signed_off | Terminal. User approved. |
| blocked | External blocker |
| failed | Agent errored; retry applies |

## Transitions & MCP tools
| From | To | Tool |
|------|----|------|
| pending | claimed | `claim_task` (sets lock) |
| claimed | in_progress | `start_task` |
| in_progress | implemented | `submit_task` (output + evidence) |
| implemented | review_required | `route_for_review` |
| review_required | verified | `verify_task` |
| review_required | changes_requested | `request_changes` (notes) |
| verified | ready_for_signoff | `queue_for_signoff` (auto after verify) |
| ready_for_signoff | signed_off | `sign_off_task` / `sign_off_tasks` |
| ready_for_signoff | changes_requested | `request_changes` (user rejects) |
| changes_requested | in_progress | `resume_task` |
| in_progress | blocked | `block_task` |
| blocked | pending | `unblock_task` |
| in_progress | failed | `fail_task` |
| failed | pending | Auto-retry / `retry_task` |

## Retry backoff
- Attempt 1 fail → retry after 5s
- Attempt 2 fail → retry after 30s
- Attempt 3+ → stays `failed`; requires manual `retry_task`

## Two checkpoints
- `verified` — AI accepted
- `ready_for_signoff` → `signed_off` — human approved (true terminal)

## Dependency checking (statusRank)
```ts
pending:0, claimed:1, in_progress:2, implemented:3,
review_required:4, changes_requested:4, verified:5, ready_for_signoff:6, signed_off:7
```
Default `requiredStatus` is `verified`; override to `implemented` for parallelism.
