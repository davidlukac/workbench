# How MCP Works — Implementation Reference

This document covers the Model Context Protocol from the perspective of implementing an MCP **server** in TypeScript using `@modelcontextprotocol/sdk` v1.x with Streamable HTTP transport, as used in the workbench project.

---

## Table of Contents

1. [What MCP Is](#1-what-mcp-is)
2. [Protocol Layers](#2-protocol-layers)
3. [Lifecycle — Initialization & Shutdown](#3-lifecycle--initialization--shutdown)
4. [Streamable HTTP Transport](#4-streamable-http-transport)
5. [Resources](#5-resources)
6. [Tools](#6-tools)
7. [Prompts](#7-prompts)
8. [Notifications](#8-notifications)
9. [Error Handling](#9-error-handling)
10. [TypeScript SDK v1.x — Concrete API](#10-typescript-sdk-v1x--concrete-api)
11. [Multi-Client Session Pattern](#11-multi-client-session-pattern)
12. [JSON-RPC Message Reference](#12-json-rpc-message-reference)
13. [Security Requirements](#13-security-requirements)
14. [Workbench Mapping](#14-workbench-mapping)

---

## 1. What MCP Is

The Model Context Protocol (MCP) is a **stateful, JSON-RPC 2.0-based protocol** that connects AI agent hosts to data and action servers. It defines what agents can read (resources), what they can do (tools), and what interaction templates exist (prompts).

### Participants

| Role | Description |
|------|-------------|
| **MCP Host** | The AI application — Claude Code, Windsurf, Cursor |
| **MCP Client** | Component inside the host that maintains one server connection |
| **MCP Server** | Process that exposes resources, tools, and prompts |

One host can maintain connections to multiple servers. One server can serve multiple clients simultaneously (Streamable HTTP only — stdio is 1:1).

In the workbench: the CLI process **is** the MCP server. Each agent (Spec Agent, Planner Agent, Sub-Agents) connects as a separate MCP client.

---

## 2. Protocol Layers

MCP has two layers:

```
┌─────────────────────────────────────────────────────┐
│                 Data Layer                          │
│  JSON-RPC 2.0 messages — requests, responses,       │
│  notifications. Lifecycle, tools, resources,        │
│  prompts, capabilities.                             │
├─────────────────────────────────────────────────────┤
│                 Transport Layer                     │
│  How bytes move: Streamable HTTP (POST + SSE)       │
│  or stdio. Handles connection, framing, auth.       │
└─────────────────────────────────────────────────────┘
```

The same JSON-RPC messages run on any transport. Transport selection is an infrastructure decision — the protocol semantics are identical.

### JSON-RPC 2.0 Basics

All messages are UTF-8 JSON. Three message kinds:

```json
// Request — expects a response
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }

// Response — matches a request by id
{ "jsonrpc": "2.0", "id": 1, "result": { ... } }

// Error response
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32602, "message": "..." } }

// Notification — no id, no response expected
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

---

## 3. Lifecycle — Initialization & Shutdown

Every MCP session follows a strict three-phase lifecycle.

### Phase 1: Initialization

The client sends `initialize` first. No other requests are allowed until this completes.

```json
// Client → Server: initialize request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "sampling": {},
      "elicitation": {}
    },
    "clientInfo": {
      "name": "claude-code",
      "version": "1.0.0"
    }
  }
}
```

The server responds with its own capabilities and version:

```json
// Server → Client: initialize response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-06-18",
    "capabilities": {
      "resources": { "subscribe": false, "listChanged": false },
      "tools": { "listChanged": false }
    },
    "serverInfo": {
      "name": "workbench",
      "version": "0.1.0"
    },
    "instructions": "Task ledger for the current workbench session."
  }
}
```

Then the client sends `initialized` (a notification — no response):

```json
// Client → Server: initialized notification
{ "jsonrpc": "2.0", "method": "notifications/initialized" }
```

The session is now active.

### Capability Negotiation

Capabilities declared in `initialize` govern what the session may use. Attempting an undeclared capability is a protocol error.

**Server capabilities relevant to the workbench:**

| Capability | Sub-options | What it enables |
|-----------|------------|-----------------|
| `resources` | `subscribe`, `listChanged` | `resources/list`, `resources/read` |
| `tools` | `listChanged` | `tools/list`, `tools/call` |
| `prompts` | `listChanged` | `prompts/list`, `prompts/get` |
| `logging` | — | Server-sent log messages |

### Version Negotiation

The client sends the latest version it supports. The server either echoes it back (compatible) or responds with the latest version it supports. If the client does not support the server's version, it should disconnect.

Current stable version: `2025-06-18`.

### Phase 2: Operation

Normal request/response and notification exchange. Both sides must respect the negotiated capabilities and protocol version.

For Streamable HTTP, every subsequent request after initialization must include:
- `Mcp-Session-Id: <sessionId>` header
- `MCP-Protocol-Version: <negotiated-version>` header

### Phase 3: Shutdown

For Streamable HTTP, the client sends `HTTP DELETE` to the MCP endpoint with the `Mcp-Session-Id` header to signal clean termination. The server closes the transport and releases session resources.

---

## 4. Streamable HTTP Transport

Streamable HTTP is the transport for the workbench. It supports multiple concurrent clients over a single server process.

### Why Not stdio

Stdio is 1:1 — one server process per client. The workbench needs N agents connected simultaneously to the same task ledger.

### Endpoint Structure

The server exposes a **single endpoint** (e.g., `http://localhost:3333/mcp`) that handles three HTTP methods:

| Method | Purpose |
|--------|---------|
| `POST` | Client → Server: Send a JSON-RPC message (request, notification, or response) |
| `GET` | Client opens an SSE stream for server-initiated messages |
| `DELETE` | Client terminates its session |

### POST — Sending Messages to the Server

Every client-to-server JSON-RPC message is a fresh HTTP POST.

Required headers:
```
Content-Type: application/json
Accept: application/json, text/event-stream
Mcp-Session-Id: <sessionId>           (all requests except initialize)
MCP-Protocol-Version: 2025-06-18     (all requests except initialize)
```

The body is a single JSON-RPC message.

**Server response options for a POST of a JSON-RPC request:**

1. `Content-Type: application/json` — single JSON response (simple tools/resources)
2. `Content-Type: text/event-stream` — SSE stream for streaming or when the server needs to send multiple messages before responding

**Server response for a POST of a notification or response:**

`HTTP 202 Accepted` with no body.

### GET — Server-Sent Events Stream

The client can open a long-lived SSE stream via GET:

```
GET /mcp HTTP/1.1
Accept: text/event-stream
Mcp-Session-Id: <sessionId>
```

The server responds with `Content-Type: text/event-stream`. Over this stream it may push JSON-RPC requests and notifications to the client. It must NOT send responses on this stream (except when resuming).

### DELETE — Session Termination

```
DELETE /mcp HTTP/1.1
Mcp-Session-Id: <sessionId>
```

Server closes the transport and discards session state. Returns `200 OK` or `405 Method Not Allowed` if session termination is not supported.

### Session Management

On the `initialize` response, the server includes:

```
Mcp-Session-Id: <cryptographically-unique-uuid>
```

The client must include this header on all subsequent requests. The server uses it to route each request to the correct in-memory transport instance.

Sessions are stored in a map on the server:

```
Map<sessionId, StreamableHTTPServerTransport>
```

If the server returns `404` for a known session ID, the client must start a new session with a fresh `initialize`.

### SSE Event Format

SSE events carry JSON-RPC messages:

```
data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}

id: evt-001
data: {"jsonrpc":"2.0","id":5,"result":{"tools":[...]}}
```

The `id` field enables resumability — clients can reconnect with `Last-Event-ID` to replay missed events.

---

## 5. Resources

Resources are **read-only data** exposed to clients. The client (or host application) decides how to surface them to the agent.

### Discovery

```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "resources/list" }

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resources": [
      {
        "uri": "workbench://tasks",
        "name": "tasks",
        "description": "Full task list with statuses",
        "mimeType": "application/json"
      }
    ],
    "nextCursor": null
  }
}
```

### Reading

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "resources/read",
  "params": { "uri": "workbench://tasks/task-PROJ-123-001" }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "workbench://tasks/task-PROJ-123-001",
        "mimeType": "application/json",
        "text": "{ \"id\": \"task-PROJ-123-001\", \"status\": \"pending\", ... }"
      }
    ]
  }
}
```

### Resource Templates (URI Patterns)

For resources with parameterized URIs, servers expose templates:

```json
// Request
{ "jsonrpc": "2.0", "id": 3, "method": "resources/templates/list" }

// Response
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "resourceTemplates": [
      {
        "uriTemplate": "workbench://tasks/{id}",
        "name": "task-by-id",
        "description": "Single task detail by ID",
        "mimeType": "application/json"
      }
    ]
  }
}
```

### Content Types

Resources return either text or binary:

```json
// Text
{ "uri": "...", "mimeType": "application/json", "text": "..." }

// Binary (base64)
{ "uri": "...", "mimeType": "image/png", "blob": "<base64>" }
```

### Capability Declaration

```json
{
  "capabilities": {
    "resources": {
      "subscribe": false,
      "listChanged": false
    }
  }
}
```

`subscribe: true` enables per-resource change subscriptions. `listChanged: true` enables `notifications/resources/list_changed` push notifications. The workbench declares neither — the ledger is polled, not subscribed.

### Error Codes for Resources

| Situation | Code |
|-----------|------|
| URI not found | `-32002` |
| Internal error | `-32603` |

---

## 6. Tools

Tools are **executable actions** the agent can invoke. They are model-controlled — the LLM decides when to call them.

### Discovery

```json
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "claim_task",
        "description": "Claim a pending task; sets lock with expiry",
        "inputSchema": {
          "type": "object",
          "properties": {
            "task_id": { "type": "string", "description": "Task ID to claim" },
            "agent_id": { "type": "string", "description": "Agent identifier" }
          },
          "required": ["task_id", "agent_id"]
        }
      }
    ]
  }
}
```

Tool definition fields:
- `name` — unique identifier, used in `tools/call`
- `description` — guides the LLM on when and how to use the tool
- `inputSchema` — standard JSON Schema; `required` controls which params are mandatory
- `outputSchema` — optional JSON Schema for structured output validation

### Invocation

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "claim_task",
    "arguments": {
      "task_id": "task-PROJ-123-001",
      "agent_id": "agent-abc"
    }
  }
}

// Success response
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "Task task-PROJ-123-001 claimed by agent-abc" }
    ],
    "isError": false
  }
}
```

### Tool Result Content Types

The `content` array can contain mixed types:

```json
// Plain text
{ "type": "text", "text": "Operation succeeded" }

// Image (base64)
{ "type": "image", "data": "<base64>", "mimeType": "image/png" }

// Reference to a resource (not embedded, just a link)
{ "type": "resource_link", "uri": "workbench://tasks/task-001", "name": "task-001", "mimeType": "application/json" }

// Embedded resource (full content included)
{ "type": "resource", "resource": { "uri": "workbench://tasks/task-001", "mimeType": "application/json", "text": "..." } }
```

### Error Handling — Two Channels

**Channel 1 — JSON-RPC protocol errors** (unknown tool, malformed arguments):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32602,
    "message": "Unknown tool: invalid_name"
  }
}
```

**Channel 2 — Tool execution errors** (business logic failures the LLM can recover from):

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "Cannot claim task-001: task is already claimed by agent-xyz" }
    ],
    "isError": true
  }
}
```

Use `isError: true` for failures the agent can understand and retry. Use JSON-RPC errors for protocol-level problems.

### Capability Declaration

```json
{ "capabilities": { "tools": { "listChanged": false } } }
```

---

## 7. Prompts

Prompts are **user-controlled templates** — the user explicitly selects them, unlike tools which the LLM invokes autonomously. In the workbench, prompts are not currently used; this section is reference material.

### Discovery

```json
{ "jsonrpc": "2.0", "id": 1, "method": "prompts/list" }
```

Response includes `name`, `description`, and `arguments` (with `required` flag per arg).

### Get

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompts/get",
  "params": {
    "name": "review-code",
    "arguments": { "language": "typescript", "code": "..." }
  }
}
```

Response contains `messages` — an array of `{ role, content }` objects ready to inject into a conversation.

---

## 8. Notifications

Notifications are one-way messages (no `id`, no response). Either side may send them.

### Server → Client Notifications

| Notification | Trigger |
|-------------|---------|
| `notifications/tools/list_changed` | Tool registry changed |
| `notifications/resources/list_changed` | Resource list changed |
| `notifications/resources/updated` | Specific resource content changed |
| `notifications/prompts/list_changed` | Prompt list changed |
| `notifications/progress` | Progress update for a long-running request |
| `notifications/message` | Log message (when `logging` capability declared) |

### Client → Server Notifications

| Notification | Meaning |
|-------------|---------|
| `notifications/initialized` | Client is ready; sent after `initialize` response |
| `notifications/cancelled` | Cancel a pending request by ID |
| `notifications/roots/list_changed` | Client's root directories changed |

---

## 9. Error Handling

### Standard JSON-RPC Error Codes

| Code | Meaning |
|------|---------|
| `-32700` | Parse error |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32002` | Resource not found (MCP extension) |
| `-32001` | Request timeout (MCP extension) |

### Throwing in SDK Handlers

```typescript
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

// Throw a protocol error from inside a handler
throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);

// Return a tool-level error (agent-recoverable)
return {
  content: [{ type: 'text', text: `Task ${taskId} not in claimable state` }],
  isError: true,
};
```

Unhandled exceptions thrown from SDK handlers are automatically converted to `{ isError: true }` tool results — they do not surface as JSON-RPC errors.

---

## 10. TypeScript SDK v1.x — Concrete API

The project uses `@modelcontextprotocol/sdk@^1.29.0`.

### Import Paths

```typescript
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
```

### McpServer vs Server

| Class | Purpose |
|-------|---------|
| `McpServer` | High-level — handles JSON Schema generation, Zod integration, `list`/`read`/`call` dispatch automatically |
| `Server` | Low-level — manual handler registration for every method; use when you need full control |

Use `McpServer` for the workbench. `Server` is only needed for advanced protocol customization.

### Instantiation

```typescript
const server = new McpServer(
  { name: 'workbench', version: '0.1.0' },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);
```

The second argument (server options) is where you declare capabilities. If you omit `capabilities`, the SDK infers them from registered handlers.

### Registering Tools

```typescript
import { z } from 'zod';

server.registerTool(
  'claim_task',
  {
    description: 'Claim a pending task and set a lock with expiry',
    inputSchema: z.object({
      task_id: z.string().describe('ID of the task to claim'),
      agent_id: z.string().describe('Unique identifier of the claiming agent'),
    }),
  },
  async ({ task_id, agent_id }) => {
    const task = ledger.claim(task_id, agent_id);
    if (!task) {
      return {
        content: [{ type: 'text', text: `Task ${task_id} not claimable` }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: `Claimed task ${task_id}` }],
    };
  }
);
```

`inputSchema` accepts a Zod object schema (`z.object({...})`) or a plain shape object (`{ field: z.string() }`). The SDK converts it to JSON Schema for the `tools/list` response and validates incoming arguments before calling your handler.

The handler receives typed, validated arguments as the first parameter. Return `{ content, isError? }`.

### Registering Resources

**Static resource** (fixed URI):

```typescript
server.registerResource(
  'story',
  'workbench://story',
  {
    description: 'The current Jira story, immutable once fetched',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(ledger.getStory()),
      },
    ],
  })
);
```

**Dynamic resource** (URI template with pattern matching):

```typescript
server.registerResource(
  'task-by-id',
  new ResourceTemplate('workbench://tasks/{id}', {
    list: async () => ({
      resources: ledger.getAllTasks().map((t) => ({
        uri: `workbench://tasks/${t.id}`,
        name: t.id,
        description: t.title,
      })),
    }),
  }),
  {
    description: 'Single task detail including evidence',
    mimeType: 'application/json',
  },
  async (uri, { id }) => {
    const task = ledger.getTask(id);
    if (!task) {
      throw new McpError(ErrorCode.InvalidParams, `Task not found: ${id}`);
    }
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(task),
        },
      ],
    };
  }
);
```

`ResourceTemplate` takes a [RFC 6570 URI template](https://datatracker.ietf.org/doc/html/rfc6570). The extracted template variables are passed as the second argument to the read handler. The `list` option, when provided, responds to `resources/list` by returning all known URIs for this template. Pass `{ list: undefined }` to suppress listing (direct access only).

### Registering Prompts

```typescript
server.registerPrompt(
  'task-context',
  {
    description: 'Build a context prompt for a specific task',
    argsSchema: z.object({
      task_id: z.string().describe('Task ID to build context for'),
    }),
  },
  async ({ task_id }) => {
    const pack = await buildContextPack(task_id);
    return {
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: pack },
        },
      ],
    };
  }
);
```

### Connecting a Transport

`server.connect(transport)` wires the server's handler registry to one transport. This is called **once per session** (one transport per connected client):

```typescript
await server.connect(transport);
```

After connecting, the transport handles the MCP handshake and all subsequent requests automatically.

---

## 11. Multi-Client Session Pattern

The workbench hosts multiple agents simultaneously. Each agent gets its own transport instance; all transports share one `McpServer` (which owns the handler registry and the ledger reference).

### Architecture

```
McpServer (singleton — owns all handlers and ledger reference)
  ├── StreamableHTTPServerTransport (session: agent-001 — Spec Agent)
  ├── StreamableHTTPServerTransport (session: agent-002 — Planner Agent)
  └── StreamableHTTPServerTransport (session: agent-003 — Sub-Agent)
```

### Implementation Pattern

```typescript
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

const server = new McpServer({ name: 'workbench', version: '0.1.0' });

// Register all tools and resources on the shared server instance
registerTools(server, ledger);
registerResources(server, ledger);

// Session store — keyed by the session ID assigned during initialize
const sessions = new Map<string, StreamableHTTPServerTransport>();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (url.pathname !== '/mcp') {
    res.writeHead(404).end();
    return;
  }

  // Validate Origin header (DNS rebinding protection)
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (req.method === 'POST') {
    let body: unknown;
    // ... parse JSON body from req ...

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId && isInitializeRequest(body)) {
      // New session — create a fresh transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, body);

    } else if (sessionId && sessions.has(sessionId)) {
      // Existing session — route to the right transport
      await sessions.get(sessionId)!.handleRequest(req, res, body);

    } else {
      res.writeHead(400).end('Bad Request: missing or unknown session ID');
    }

  } else if (req.method === 'GET') {
    // Client opens an SSE stream for server-initiated messages
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(400).end('Unknown session');
      return;
    }
    await transport.handleRequest(req, res);

  } else if (req.method === 'DELETE') {
    // Client terminates its session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(404).end('Session not found');
      return;
    }
    await transport.close();
    sessions.delete(sessionId!);
    res.writeHead(200).end();

  } else {
    res.writeHead(405).end('Method Not Allowed');
  }
});

httpServer.listen(3333, '127.0.0.1');
```

### Key Points

- **One McpServer, many transports.** The server instance is a singleton that holds all registered handlers. Each connected agent gets its own `StreamableHTTPServerTransport` instance.
- **`onsessioninitialized` for safe map insertion.** The session ID is not known until the transport generates it during the `initialize` handshake. The callback fires after the ID is assigned.
- **`transport.onclose` for cleanup.** Removes the transport from the map when the agent disconnects or times out.
- **Route by `Mcp-Session-Id` header.** Every request after initialization includes this header. Use it to look up the correct transport and call `handleRequest` on it.
- **Localhost-only binding.** Bind to `127.0.0.1`, not `0.0.0.0`, to prevent external access.
- **`isInitializeRequest(body)` guard.** The SDK exports this helper to detect the first message of a new session.

---

## 12. JSON-RPC Message Reference

### Complete Initialize Exchange

```
Client POST /mcp (no session headers yet):

  → { "jsonrpc":"2.0", "id":1, "method":"initialize",
      "params": {
        "protocolVersion":"2025-06-18",
        "capabilities":{ "sampling":{} },
        "clientInfo":{ "name":"claude-code","version":"1.0.0" }
      }}

  ← HTTP 200, Mcp-Session-Id: <uuid>
    { "jsonrpc":"2.0", "id":1,
      "result": {
        "protocolVersion":"2025-06-18",
        "capabilities":{ "resources":{}, "tools":{} },
        "serverInfo":{ "name":"workbench","version":"0.1.0" }
      }}

Client POST /mcp + Mcp-Session-Id + MCP-Protocol-Version:

  → { "jsonrpc":"2.0", "method":"notifications/initialized" }
  ← HTTP 202 Accepted (no body)
```

### Resources

```
resources/list:
  → { "jsonrpc":"2.0","id":2,"method":"resources/list" }
  ← { "jsonrpc":"2.0","id":2,"result":{ "resources":[...] } }

resources/read:
  → { "jsonrpc":"2.0","id":3,"method":"resources/read",
      "params":{ "uri":"workbench://tasks/pending" } }
  ← { "jsonrpc":"2.0","id":3,"result":{ "contents":[{ "uri":"...","mimeType":"application/json","text":"..." }] } }
```

### Tools

```
tools/list:
  → { "jsonrpc":"2.0","id":4,"method":"tools/list" }
  ← { "jsonrpc":"2.0","id":4,"result":{ "tools":[{ "name":"claim_task","description":"...","inputSchema":{...} }] } }

tools/call:
  → { "jsonrpc":"2.0","id":5,"method":"tools/call",
      "params":{ "name":"claim_task","arguments":{ "task_id":"task-001","agent_id":"agent-xyz" } } }
  ← { "jsonrpc":"2.0","id":5,"result":{ "content":[{ "type":"text","text":"Claimed task-001" }],"isError":false } }
```

---

## 13. Security Requirements

These are **MUST** requirements from the MCP specification for Streamable HTTP servers:

1. **Validate `Origin` header** on all incoming connections to prevent DNS rebinding attacks. Reject requests whose Origin does not match the expected host.

2. **Bind to localhost only** (`127.0.0.1`, not `0.0.0.0`) when serving local agents. The workbench MCP server has no external network exposure by design.

3. **Validate resource URIs** before reading — reject path traversal or unexpected schemes.

4. **Validate all tool inputs** before executing — the SDK runs Zod validation automatically when `inputSchema` is provided, but business-logic constraints (task exists, status is correct) must be checked in the handler.

5. **Cryptographically unique session IDs** — use `randomUUID()` from `node:crypto`, not `Math.random()`.

---

## 14. Workbench Mapping

### How Workbench Resources Map to MCP

| Workbench Resource | URI | Method | Content |
|-------------------|-----|--------|---------|
| Story | `workbench://story` | `resources/read` | JSON — Story object |
| Spec | `workbench://spec` | `resources/read` | JSON — Spec object |
| All tasks | `workbench://tasks` | `resources/read` | JSON — Task[] |
| Pending tasks | `workbench://tasks/pending` | `resources/read` | JSON — claimable Task[] |
| Tasks ready for signoff | `workbench://tasks/ready_for_signoff` | `resources/read` | JSON — Task[] |
| Single task | `workbench://tasks/{id}` | `resources/read` | JSON — Task with evidence |
| Personas | `workbench://personas` | `resources/read` | JSON — resolved PersonaMap |
| Skills | `workbench://skills` | `resources/read` | JSON — skills per persona |

`workbench://tasks/{id}` uses a `ResourceTemplate`. The list callback returns all task URIs. The read handler extracts `{id}` and looks up the ledger.

### How Workbench Tools Map to MCP

Each tool in `Feature.md` maps directly to a `registerTool()` call. The `inputSchema` is a Zod object — the SDK validates args before calling the handler:

| Tool | Key Zod Fields |
|------|---------------|
| `claim_task` | `task_id: z.string()`, `agent_id: z.string()` |
| `start_task` | `task_id: z.string()` |
| `submit_task` | `task_id: z.string()`, `output: TaskOutputSchema`, `evidence: EvidenceSchema` |
| `verify_task` | `task_id: z.string()` |
| `request_changes` | `task_id: z.string()`, `notes: z.string()` |
| `sign_off_tasks` | `task_ids: z.array(z.string()).optional()`, `all: z.boolean().optional()` |
| `get_task_prompt` | `task_id: z.string()` |

All state-mutation tools return `{ content: [{ type: 'text', text: '...' }], isError: false }` on success and `{ ..., isError: true }` on business-logic failure (wrong status, missing task, etc.). JSON-RPC errors are reserved for malformed requests.

### Session Lifecycle in a Workbench Run

```
workbench serve (CLI)
  → McpServer created, tools/resources registered, ledger empty
  → HTTP server listening on localhost:3333

Spec Agent connects
  POST /mcp  initialize          → new transport, session-A created
  POST /mcp  notifications/initialized
  POST /mcp  resources/read workbench://story
  POST /mcp  tools/call submit_task (writes spec)

Planner Agent connects (concurrently)
  POST /mcp  initialize          → new transport, session-B created
  POST /mcp  resources/read workbench://spec
  POST /mcp  tools/call claim_task, start_task, submit_task (writes tasks)

Sub-Agent 1 connects
  POST /mcp  initialize          → new transport, session-C created
  POST /mcp  resources/read workbench://tasks/pending
  POST /mcp  tools/call claim_task + start_task + append_evidence + submit_task

Sub-Agent 2 connects (concurrently)
  ...same pattern, different task...

Agents disconnect
  DELETE /mcp  Mcp-Session-Id: session-A   → transport closed, map entry removed
  ...
```

Each agent session is independent. The shared ledger (inside the `McpServer` handler closures) provides the coordination point.
