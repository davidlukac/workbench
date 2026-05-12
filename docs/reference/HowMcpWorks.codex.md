# How MCP Works for Workbench

This document explains MCP from the perspective of implementing the Workbench MCP server. It is intentionally project-facing: it separates MCP protocol requirements from Workbench-specific design decisions.

Research sources:

- MCP latest specification, 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25/basic
- MCP Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP server primitives: https://modelcontextprotocol.io/specification/2025-11-25/server
- MCP tools: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP resources: https://modelcontextprotocol.io/specification/2025-11-25/server/resources
- MCP prompts: https://modelcontextprotocol.io/specification/2025-11-25/server/prompts
- MCP client roots, sampling, elicitation: https://modelcontextprotocol.io/specification/2025-11-25/client/roots, https://modelcontextprotocol.io/specification/2025-11-25/client/sampling, https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
- TypeScript SDK server guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md

## Executive Summary

MCP is a JSON-RPC 2.0 protocol that lets an agent host connect to external context providers. An MCP server does not talk directly to the model. It exposes capabilities to the host, and the host decides how those capabilities are made available to the model and user.

MCP server features are split into three primitives:

| Primitive | Control | Purpose | Workbench use |
| --- | --- | --- | --- |
| Resources | Application-controlled | Read-only context fetched by the host | Story, spec, tasks, personas, skills |
| Tools | Model-controlled | Callable functions/actions | Fetch story source, update spec/tasks, claim, start, submit, review, sign off, append evidence |
| Prompts | User-controlled | Reusable prompt templates | Optional; possible future replacement/companion for `get_task_prompt` |

For Workbench, the MCP server is the coordination boundary around the ephemeral task ledger. Agents must never mutate the ledger by editing files directly. They read ledger state through resources and mutate it through tools.

## Protocol Basics

All MCP messages are JSON-RPC 2.0 messages. Requests include an `id`, a `method`, and optional `params`. Responses echo the same `id` and contain either `result` or `error`. Notifications have a `method` and optional `params`, but no `id` and no response.

Example request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "claim_task",
    "arguments": {
      "task_id": "task-PROJ-123-001",
      "agent_id": "agent-backend-1"
    }
  }
}
```

Example success response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"task_id\":\"task-PROJ-123-001\",\"status\":\"claimed\"}"
      }
    ],
    "structuredContent": {
      "task_id": "task-PROJ-123-001",
      "status": "claimed"
    }
  }
}
```

The protocol has a lifecycle:

1. Client sends `initialize` with supported protocol version, client capabilities, and client info.
2. Server responds with negotiated protocol version, server capabilities, server info, and optional instructions.
3. Client sends `notifications/initialized`.
4. Normal operation begins: resource reads, tool calls, prompt requests, pings, logs, and optional server-to-client requests.
5. Shutdown is transport-specific. For HTTP, closing the relevant HTTP connections ends communication.

Workbench should rely on the SDK for lifecycle handling, but tests should still prove that a real MCP client can initialize, list tools/resources, and call core tools over stdio.

## Transport Choice

Workbench should use stdio as the primary v1 transport.

The actual distinction is where the connection boundary and process boundary live.

| Transport | Current status | Process model | Connection model | Multi-agent meaning |
| --- | --- | --- | --- | --- |
| stdio | Current standard | Client/host launches the MCP server as a child process | JSON-RPC over that process's stdin/stdout | Many logical agents can share it if they are all routed through the same host/client process; independent agent hosts usually spawn independent server processes |
| Streamable HTTP | Current standard | Server runs as an independent process | JSON-RPC over HTTP `POST`; optional server-to-client SSE over `GET` | Multiple independent clients/hosts can connect to the same server process and shared in-memory state |
| HTTP+SSE | Legacy/deprecated | Server runs as an independent process | Two endpoints: SSE receive stream plus HTTP `POST` send endpoint | Multiple clients possible, but the transport is retained mainly for backwards compatibility |

Stdio is the right default for the intended product shape: users add Workbench to their agent host MCP config, and the host launches it as needed:

```sh
codex mcp add workbench -- npx workbench mcp
```

`workbench mcp` and `workbench serve` are equivalent entry points. They should not be designed around "manually start one singleton server and point every agent at `localhost`." The host owns process launch.

This changes the state model. A stdio MCP server process may be shared by multiple logical agents if the host multiplexes them through one MCP client connection. But separate host sessions can also launch separate Workbench subprocesses. Therefore Workbench v1 must not keep authoritative ledger state only in process memory. The authoritative session/ledger state should live in a workspace-scoped SQLite store under `.workbench/`, with transactions around mutations.

This is the same broad pattern as local MCP servers like Basic Memory: stdio is the transport, while shared state lives in a backing store that can tolerate separate MCP server invocations.

Streamable HTTP remains useful for a future mode when we explicitly want a network-addressable daemon:

```text
workbench mcp --transport http --port 3333
```

It is not the default architecture.

Stdio requirements relevant to Workbench:

- The server reads JSON-RPC messages from stdin and writes JSON-RPC messages to stdout.
- Messages are newline-delimited and must not contain embedded newlines.
- Logs, diagnostics, and progress text must go to stderr, never stdout.
- The client/host owns process lifecycle.
- There is no HTTP session header, URL, Origin validation, or port binding.
- Concurrent logical agents may arrive through one host connection, while separate host sessions may launch separate subprocesses.

Streamable HTTP requirements if added later:

- The server provides one MCP endpoint that supports `POST` and may support `GET`.
- Every client-to-server JSON-RPC message is sent as a new HTTP `POST`.
- Client `POST` requests include `Accept: application/json, text/event-stream`.
- A request response can be either one JSON object (`application/json`) or an SSE stream (`text/event-stream`).
- `GET` is used for server-to-client SSE streams. If unsupported, the server returns `405 Method Not Allowed`.
- Stateful sessions may use the `MCP-Session-Id` response header after initialization; clients then send that header on subsequent requests.
- HTTP clients should send `MCP-Protocol-Version` on subsequent requests after initialization.

HTTP+SSE note: the older 2024-11-05 transport used two endpoints. The client opened an SSE endpoint to receive server messages, then the server sent an `endpoint` event telling the client where to `POST` client messages. New implementations should not start there; support it only if backwards compatibility with older clients becomes a requirement.

HTTP security requirements and recommendations, if HTTP is added:

- Validate `Origin` on incoming HTTP requests. Reject invalid origins with `403`.
- Bind local servers to `127.0.0.1`, not `0.0.0.0`, unless the user explicitly opts into network exposure.
- Do not expose the Workbench server to external networks by default.
- If remote mode is ever added, add real authentication and authorization before exposing task state or file paths.

## Server Capabilities

During initialization, the server advertises which primitives it supports. Workbench v1 should advertise:

```json
{
  "resources": {
    "listChanged": true
  },
  "tools": {
    "listChanged": true
  }
}
```

Do not advertise capabilities that are not implemented. In particular:

- Do not advertise resource subscription support until `resources/subscribe` and update notifications are implemented.
- Do not advertise prompts unless Workbench registers MCP prompts.
- Do not advertise logging unless the server supports MCP logging messages.

The server can provide `instructions` in the initialize response. Workbench should use this for stable cross-tool guidance, not for duplicating every tool description. Example:

```text
This server exposes an ephemeral Workbench task ledger. Read state through workbench:// resources. Mutate state only through task lifecycle tools. Implementation agents must not call review or sign-off tools.
```

## Resources

Resources expose read-only context. They are application-controlled: the host decides when to fetch them and whether to place their contents in model context.

Workbench resources should use the custom `workbench://` URI scheme:

| URI | Description | MIME type |
| --- | --- | --- |
| `workbench://story` | Current immutable story from Jira or local file; mock source is for test/local development | `application/json` |
| `workbench://spec` | Generated session spec | `application/json` |
| `workbench://tasks` | Full task list | `application/json` |
| `workbench://tasks/pending` | Claimable tasks only | `application/json` |
| `workbench://tasks/ready_for_signoff` | Tasks awaiting human sign-off | `application/json` |
| `workbench://tasks/{id}` | Single task with evidence and output | `application/json` |
| `workbench://personas` | Resolved persona definitions | `application/json` |
| `workbench://skills` | Skill references mapped to personas | `application/json` |

The MCP methods involved are:

- `resources/list`: discover fixed resources.
- `resources/templates/list`: discover parameterized resources such as `workbench://tasks/{id}`.
- `resources/read`: retrieve contents for a specific URI.
- `notifications/resources/list_changed`: optional notification when the set of available resources changes.

Resource content can be text or binary. Workbench should return JSON resources as text content with `mimeType: "application/json"`:

```json
{
  "contents": [
    {
      "uri": "workbench://tasks/pending",
      "mimeType": "application/json",
      "text": "{\"tasks\":[...]}"
    }
  ]
}
```

Do not put write behavior behind resources. Reading `workbench://tasks/pending` must not claim a task. Claiming is a tool call.

## Tools

Tools are executable functions exposed by the server. They are model-controlled in the MCP mental model: the host may make them available for the LLM to call.

Workbench tools are the ledger mutation API plus a small number of helper reads:

| Tool | Kind | Effect |
| --- | --- | --- |
| `claim_task` | mutation | `pending -> claimed`; sets lock |
| `start_task` | mutation | `claimed -> in_progress` |
| `submit_task` | mutation | `in_progress -> implemented`; records output/evidence |
| `route_for_review` | mutation | `implemented -> review_required`; records reviewer |
| `verify_task` | mutation | `review_required -> verified` |
| `queue_for_signoff` | mutation | `verified -> ready_for_signoff` |
| `request_changes` | mutation | review/signoff rejection -> `changes_requested` |
| `resume_task` | mutation | `changes_requested -> in_progress` |
| `sign_off_task` | mutation | `ready_for_signoff -> signed_off` |
| `sign_off_tasks` | mutation | batch sign-off |
| `fail_task` | mutation | `in_progress -> failed`; retry policy applies |
| `block_task` | mutation | `in_progress -> blocked` |
| `unblock_task` | mutation | `blocked -> pending` |
| `retry_task` | mutation | exhausted failed task -> `pending` |
| `append_evidence` | mutation | append command/test/note evidence |
| `get_task_prompt` | helper read | return resolved context pack |

Each tool must have:

- A concise description that tells the agent when to use it.
- An `inputSchema` for arguments.
- Preferably an `outputSchema` for structured results.
- Runtime validation using the same Zod schema as TypeScript inference where practical.

Tool results can include:

- `content`: user/model-displayable content blocks.
- `structuredContent`: machine-readable JSON object.
- `isError`: optional boolean for tool-level failures represented as successful JSON-RPC responses.

For Workbench, successful tools should return both `structuredContent` and a short text JSON serialization for compatibility. Protocol or validation failures should be JSON-RPC errors. Domain failures can be either:

- JSON-RPC error, when the call is invalid and should not be retried blindly, such as unknown task ID or malformed arguments.
- Tool result with `isError: true`, when the tool ran and wants the agent to reason about the failure, such as a lock conflict or unsatisfied dependency.

Recommended error distinction:

| Case | Response style |
| --- | --- |
| Invalid JSON-RPC / malformed request | JSON-RPC error |
| Input schema validation failure | JSON-RPC error |
| Unknown tool name | JSON-RPC error |
| Unknown `task_id` | JSON-RPC error |
| Invalid state transition | tool result with `isError: true` and current status |
| Lock conflict | tool result with `isError: true`, owner, expiry |
| Dependency not satisfied | tool result with `isError: true`, blocking dependencies |
| Internal server bug | JSON-RPC error |

Example `claim_task` schema:

```ts
const ClaimTaskInput = z.object({
  task_id: z.string().min(1),
  agent_id: z.string().min(1)
});

const ClaimTaskOutput = z.object({
  task_id: z.string(),
  status: z.literal("claimed"),
  claimed_by: z.string(),
  lock: z.object({
    owner: z.string(),
    expires_at: z.string().datetime()
  })
});
```

Example `submit_task` schema:

```ts
const SubmitTaskInput = z.object({
  task_id: z.string().min(1),
  output: z.object({
    summary: z.string().min(1),
    changed_files: z.array(z.string())
  }),
  evidence: z.object({
    commands_run: z.array(z.string()),
    tests_passed: z.array(z.string()),
    changed_files: z.array(z.string()),
    notes: z.array(z.string())
  })
});
```

Tool handlers must be deterministic. They should not call models. The Workbench CLI and MCP server remain infrastructure; all AI judgment belongs to the agent host, skills, and workflows.

## Prompts

Prompts are reusable templates exposed by a server and typically invoked by user choice, slash command, or host UI. They are not the same thing as tools.

Workbench currently models `get_task_prompt` as a tool because both auto and manual agents need a callable way to obtain the exact context pack for a task. That is acceptable for v1.

A future MCP-native prompt could expose similar behavior as:

- `workbench_task`: arguments `{ task_id }`
- `workbench_review`: arguments `{ task_id }`
- `workbench_session_summary`: arguments `{ format }`

If implemented, prompts should be additive. Keep `get_task_prompt` because it is useful in headless/manual flows and CLI `workbench task next`.

## Client Features Workbench Should Know About

MCP also defines client features. These are capabilities the host can expose to the server.

### Roots

Roots let clients tell servers which filesystem roots are available. Workbench can use this later to verify project boundaries. For v1, do not depend on roots; accept an explicit working directory from the CLI session.

Potential later use:

- Validate that evidence changed files are under an allowed root.
- Resolve relative file paths in task evidence.
- Refuse prompts that ask agents to operate outside the workspace.

### Sampling

Sampling lets a server request a model completion through the client. Workbench should not use sampling in the CLI/MCP server because the project explicitly says the CLI never calls a model. Even though sampling is mediated by the client, it would put AI judgment into the infrastructure layer and blur the project boundary.

### Elicitation

Elicitation lets a server ask the client to collect user input. Workbench can ignore it for v1. If added later, use it only for non-sensitive workflow questions such as resolving open questions. Do not use form-mode elicitation for secrets, tokens, passwords, API keys, or payment data.

## Context In and Out

MCP itself does not define "the model context" as one blob. Context moves through specific operations:

- Server instructions may be surfaced by the host as general guidance.
- Resource definitions are discovered through `resources/list`; resource contents are pulled through `resources/read`.
- Tool definitions and schemas are discovered through `tools/list`; tool calls send arguments through `tools/call`; tool results return content and structured data.
- Prompt definitions are discovered through `prompts/list`; prompt content is fetched through `prompts/get`.

For Workbench, the context contract should be:

1. Agent reads high-level state through resources.
2. Agent claims a task through `claim_task`.
3. Agent calls `get_task_prompt` for the full execution context.
4. Agent performs local file work using host tools, not MCP.
5. Agent appends evidence if useful during work.
6. Agent calls `submit_task` with output and final evidence.
7. Reviewer or Story Manager reads task state and calls review tools.

`get_task_prompt` should include only the context needed for the task:

- Persona instructions.
- Task fields.
- Dependency statuses.
- Referenced acceptance criteria.
- Relevant constraints.
- Existing evidence for resumed tasks.
- Review notes for resumed tasks.
- Allowed/disallowed actions.
- Definition of Done.
- Skill invocation hints.

It should not include full repository files, raw secrets, unrelated tasks, or unbounded logs.

## Recommended Workbench Interaction Flows

### Initialization

```text
Agent host -> Workbench: initialize
Workbench -> Agent host: protocol version, resources/tools capabilities, instructions
Agent host -> Workbench: notifications/initialized
```

### Manual Implementation Agent

```text
Agent -> resources/read workbench://tasks/pending
Agent -> tools/call claim_task
Agent -> tools/call start_task
Agent -> tools/call get_task_prompt
Agent -> edits files with host filesystem tools
Agent -> tools/call append_evidence, optional during work
Agent -> tools/call submit_task
```

### Auto Mode Story Manager

```text
Story Manager -> resources/read workbench://tasks/pending
Story Manager -> tools/call claim_task for each dispatchable task, or delegates claim to sub-agent
Story Manager -> tools/call get_task_prompt
Story Manager -> host-native sub-agent spawn with prompt
Sub-agent -> tools/call start_task
Sub-agent -> edits files
Sub-agent -> tools/call submit_task
Story Manager -> tools/call route_for_review
Reviewer -> tools/call verify_task or request_changes
Story Manager -> tools/call queue_for_signoff after verify
User approves -> tools/call sign_off_task/sign_off_tasks
```

### Review Rework Loop

```text
Reviewer -> tools/call request_changes with notes
Implementation agent -> tools/call resume_task
Implementation agent -> tools/call get_task_prompt
Implementation agent sees Review Notes and Evidence So Far
Implementation agent edits files
Implementation agent -> tools/call submit_task
```

## Transport and Process Structure

Workbench should not invent REST endpoints for every operation. In v1, MCP operations flow over stdio through the host-launched `workbench mcp` process.

Recommended installation shape:

```sh
codex mcp add workbench -- npx workbench mcp
```

Recommended command shape:

| Command | Purpose |
| --- | --- |
| `workbench mcp` | stdio MCP server for host configuration |
| `workbench serve` | alias for `workbench mcp` |
| `workbench status` | non-MCP CLI read of workspace session state |
| `workbench task next` | non-MCP CLI helper that reads/claims from workspace session state and prints a context pack |

If Streamable HTTP is added later, expose one MCP endpoint such as `/mcp`. Avoid adding REST paths like `/tasks`, `/claim`, or `/resources`; they would duplicate MCP and create two APIs to secure and test.

The CLI convenience commands do not need to act as MCP clients in stdio mode. They can use the same ledger library directly, because the shared coordination boundary is the workspace session store, not a long-running network process.

## State and Sessions

There are three different notions of state:

1. MCP transport process state: the host-launched stdio subprocess and its protocol lifecycle.
2. Workbench session state: workspace-scoped Story, Spec, Tasks, locks, evidence, and outputs.
3. Agent host state: whatever conversation/sub-agent context the host maintains.

The authoritative Workbench ledger must be shared across possible MCP server subprocesses. Do not keep it only in memory. Store it in a workspace-scoped SQLite database under `.workbench/` or an equivalent local session directory.

Recommended model:

- One `LedgerStore` library used by both MCP tools and CLI commands.
- Workspace-scoped session directory, for example `.workbench/sessions/<story-id>/`.
- SQLite WAL and transactions for task mutation.
- Conditional updates and optimistic revisions for concurrent claims/submissions.
- Cleanup/archive command after sign-off if the session should remain ephemeral.

## Concurrency

Multiple logical agents and/or multiple stdio MCP subprocesses can call tools against the same workspace. Workbench must treat every mutation tool as a critical section around the ledger store.

Required safeguards:

- `claim_task` must atomically check dependencies, status, and lock state before setting a lock.
- Expired locks are treated as claimable, but lock expiry and re-claim must be consistent.
- `start_task`, `submit_task`, and review tools must validate the current status before transitioning.
- Every mutation should return the resulting task/version so clients can refresh their view.
- Add a monotonically increasing `revision` field to tasks or the whole ledger to detect stale updates.
- Use SQLite transactions and conditional updates rather than ad hoc "read JSON, write JSON" updates.

File write conflicts are outside MCP itself. They are a Workbench planning/coordination concern. The MCP server can help by surfacing declared changed files in evidence, but it does not automatically prevent filesystem conflicts unless the ledger grows file-level claims.

## Schema Strategy

Use Zod as the source of truth for:

- Domain models: Story, Spec, Task, Evidence, TaskOutput.
- Tool input schemas.
- Tool structured output schemas.
- Config parsing.

The MCP protocol uses JSON Schema for tool and prompt arguments. The TypeScript SDK can derive protocol schemas from Zod-compatible schemas depending on SDK version. Because this repo currently targets `@modelcontextprotocol/sdk`, verify exact imports and helper APIs during Phase 2 implementation.

Schema recommendations:

- Prefer explicit object schemas with required fields.
- Use enums for task statuses and built-in task types.
- Reject unknown fields in mutation inputs unless a specific extension point is intended.
- Include `description` text on tool fields where it helps the model provide correct arguments.
- Keep output schemas stable; agents may learn to depend on them.

## Suggested Source Layout

The existing planned layout is sound:

```text
src/
  cli.ts                  # Commander CLI; mcp/serve delegates to runMcpServer()
  index.ts                # Public API exports

  server/
    index.ts              # official MCP SDK server, bind StdioServerTransport
    resources.ts          # workbench:// resource registrations
    tools.ts              # tool registrations and handlers
    prompt-builder.ts     # get_task_prompt assembly
  ledger/
    index.ts              # workspace-scoped ledger store
    transitions.ts        # FSM and validation
    locks.ts              # file/revision locking primitives
  types.ts                # Zod schemas and inferred types
```

Implementation boundaries:

- `cli.ts` should use Commander only for command parsing/routing and should stay thin.
- `server/index.ts` should use the official MCP TypeScript SDK (`McpServer`, `StdioServerTransport`) for protocol/server behavior.
- `server/tools.ts` should validate MCP inputs and call ledger methods.
- `ledger/transitions.ts` should own legal state transitions.
- `prompt-builder.ts` should be pure and testable.
- `server/index.ts` should avoid business logic beyond wiring stdio transport, server info, capabilities, and instructions.

## Testing Plan

Unit tests:

- Every legal and illegal task transition.
- Dependency satisfaction logic.
- Lock expiry and re-claim behavior.
- Prompt builder output for implementation, review, and resumed tasks.
- Tool input/output schema validation.

Integration tests:

- Start the MCP server with stdio transport.
- Connect with a real MCP client over stdio.
- Complete initialization.
- List resources and tools.
- Read `workbench://tasks/pending`.
- Call `claim_task`, `start_task`, `get_task_prompt`, `submit_task`.
- Verify concurrent claim attempts allow only one winner.
- Verify two independent MCP subprocesses pointed at the same workspace cannot claim the same task.
- Verify CLI commands and MCP tools observe the same workspace session state.

Do not mock the MCP SDK in transport tests. The goal is to catch real protocol and transport mistakes before agent hosts do.

## Implementation Checklist for Phase 2

- Implement `workbench mcp` as a stdio MCP server.
- Keep `workbench serve` as an alias for `workbench mcp`.
- Register resources and resource templates for `workbench://` URIs.
- Register all ledger mutation tools with Zod schemas.
- Return structured tool output plus short text content.
- Validate all state transitions in the ledger, not only in tool handlers.
- Implement workspace-scoped SQLite ledger storage with transactional mutation.
- Add real stdio transport integration tests.
- Keep model invocation out of the MCP server.
- Treat the ledger as workspace-scoped shared state, not process-local MCP state.

## Open Questions for This Project

1. Should Workbench expose MCP prompts in v1, or keep only `get_task_prompt` as a tool?
2. What SQLite package and migration runner should v1 use?
3. Should `claim_task` return an `isError: true` tool result on dependency/lock conflicts, or should those be JSON-RPC errors?
4. Should `workbench://tasks/pending` include enough information for dispatch decisions, or only IDs plus summaries?
5. Should `resources/list_changed` notifications be implemented when tasks are created, or deferred until clients need reactive updates?
