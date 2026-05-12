# AI Agent Workbench

An ephemeral orchestration workbench that starts inside an agent session and bridges Jira tickets or local story files to AI sub-agent execution. A ticket or story enters as a raw description and exits as completed, verified work — with spec expansion, AC validation, task decomposition, and persona-matched agent dispatch in between.

```text
Agent session: /workbench-start PROJ-123
Agent session: /workbench-start ./JIRA-123.md
```

---

## How it works

```
Jira Ticket or Local Story File
    │
    ▼
Fetch Story → Generate Spec → Decompose into Tasks → Dispatch to Agents → Summary
```

1. **Fetch** — pulls the Jira story or parses a local story file; test/local development can use the mock Jira adapter
2. **Spec** — a Spec Agent expands the story into structured requirements and validates acceptance criteria
3. **Plan** — a Planner Agent decomposes the spec into typed, ordered tasks
4. **Dispatch** — tasks flow through an in-session ledger exposed via MCP; agents claim and work them in `auto` mode (Story Manager spawns sub-agents) or `manual` mode (agents pull tasks independently)
5. **Done** — all tasks complete, written files persist; the ledger is discarded

---

## Quick start

**Requires Node.js `>=22.0.0`**

Developer setup:

```sh
npm install
npm run build
npm run mcp:dev
npm run lint
npm run test
npm run test:coverage
node dist/cli.js --help
```

For Codex MCP development with NVM, see [`DEVELOPMENT.md`](DEVELOPMENT.md).

Terminal setup:

```sh
# Add the Workbench MCP server to Codex
codex mcp add workbench -- npx workbench mcp

# Install bundled Workbench skills into your Codex environment
npx @workbench/cli install codex
```

Agent session:

```text
/workbench-start PROJ-123
/workbench-start ./JIRA-123.md

# For local development, configure the mock Jira adapter and use a mock key
/workbench-start MOCK-123
```

Terminal observability:

```sh
# Check the status of a running session
npx @workbench/cli status --watch

# Get the next task prompt for manual agent copy-paste
npx @workbench/cli task next
```

### Install Workbench

The workbench ships bundled Agent Skills used by the pipeline. Install them into your agentic environment before running the pipeline:

```sh
npx @workbench/cli install claude
npx @workbench/cli install codex
npx @workbench/cli install windsurf
```

By default, the provider controls the skills directory: `.claude/skills/`, `.agents/skills/`, or `.windsurf/skills/`. Pass `--target <dir>` to override the skills directory for a provider.

### Configure

Create a `.workbench.yaml` in your project root:

```yaml
dispatch_mode: auto   # auto | manual

jira:
  base_url: https://yourorg.atlassian.net
  auth: token         # credentials via JIRA_EMAIL + JIRA_API_TOKEN env vars

type_to_persona:
  backend_api: backend_engineer
  frontend_ui: frontend_engineer

personas:
  backend_engineer:
    name: Backend Engineer
    system_prompt: You are a senior backend engineer...
    skills:
      - be-dev
```

Validate your config at any time:

```sh
npx @workbench/cli verify
```

### Run the local MCP server

Workbench currently exposes a minimal stdio MCP server for local development. It includes:

- `fetch_story` tool: accepts `source_ref` for a local Markdown, YAML, or JSON story/task file and returns a structured Workbench Story
- `workbench://server/info` resource: returns basic server capability/debug information

Build once, then run the dev server with autoreload:

```sh
npm run build
npm run mcp:dev
```

The dev server writes JSONL debug logs to `.workbench/logs/workbench-mcp.log` and mirrors those log lines to stderr. MCP protocol messages are written only to stdout by the SDK transport.

You can point an MCP-capable host at the local command:

```sh
node dist/cli.js mcp --dev
node dist/cli.js mcp --dev --log-file .workbench/logs/workbench-mcp.log
```

Tail the debug log while invoking the server from a host:

```sh
tail -f .workbench/logs/workbench-mcp.log
```

---

## Documentation

| Doc | Description |
|-----|-------------|
| [`docs/Feature.md`](docs/Feature.md) | Full feature spec: domain model, task workflow, dispatch modes, MCP server, agent roles |
| [`docs/SequenceDiagrams.md`](docs/SequenceDiagrams.md) | Renderable Mermaid sequence diagrams for auto and manual sessions from Jira ticket to sign-off |
| [`docs/CLI.md`](docs/CLI.md) | All commands, options, exit codes, and environment variables |
| [`docs/TechStack.md`](docs/TechStack.md) | Runtime, dependencies, build pipeline, TypeScript config, and source layout |
| [`docs/WhatAreSkills.md`](docs/WhatAreSkills.md) | Agent Skills open standard reference — what skills are, how to write them, platform details |

---

## Dispatch modes

| Mode | When to use |
|------|-------------|
| `auto` | Claude Code — Story Manager spawns and monitors sub-agents concurrently |
| `manual` | Windsurf, Cursor, or any single-agent environment — agents pull tasks via MCP one at a time |

In both modes the MCP server is intended to run from agent MCP configuration over stdio, for example `codex mcp add workbench -- npx workbench mcp`. See [`docs/Feature.md`](docs/Feature.md) for the full MCP resource and tool reference.

---

## Requirements

- Node.js `>=22.0.0`
- An agentic environment (Claude Code recommended for `auto` mode)
- Jira Cloud credentials when using real Jira fetches
