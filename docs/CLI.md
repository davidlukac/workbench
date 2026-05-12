# AI Agent Workbench — CLI Reference

The CLI is **infrastructure tooling only**. It installs Skills and Workflows, validates configuration, provides the stdio MCP server entry point, and provides session observability. It does not call any AI model and does not drive the pipeline.

Session execution (story source request → Spec → Plan → Dispatch → Review) always starts inside your agent environment through the workbench Workflow and Skills. The CLI and MCP server cannot invoke agents. Deterministic story loading is handled by the Workbench MCP server: it can fetch Jira or parse a local Markdown/YAML/JSON story file. For test/local development, it can use the mock Jira adapter instead of real Jira. See [`Feature.md`](Feature.md) for the full architecture and [`SequenceDiagrams.md`](SequenceDiagrams.md) for the renderable end-to-end flows.

Implementation note: the CLI is built with Commander. Commander owns command parsing and routing only. The `mcp` / `serve` command delegates to the official MCP TypeScript SDK server implementation.

## Installation

```sh
# Zero-install (recommended for one-off runs)
npx @workbench/cli <command>

# Global install
npm install -g @workbench/cli
workbench <command>
```

**Requires:** Node.js `>=22.0.0`

For the feature spec and domain model see [`Feature.md`](Feature.md). For runtime, dependencies, and build details see [`TechStack.md`](TechStack.md).

---

## Global Options

These options are accepted by every command.

| Option | Default | Description |
|--------|---------|-------------|
| `--help`, `-h` | — | Print help for the command and exit |
| `--version`, `-V` | — | Print the CLI version and exit |

---

## Commands

### `workbench mcp` / `workbench serve`

Run the MCP server over stdio. This command is primarily launched by an agent host from MCP configuration, not manually as a long-running singleton.

```sh
codex mcp add workbench -- npx workbench mcp
workbench mcp
workbench mcp --config ./path/to/.workbench.yaml
```

`workbench serve` is an alias for `workbench mcp`.

Implementation boundary:

- Commander parses `mcp` / `serve` and `--config`.
- The command action calls `runMcpServer({ configPath })`.
- `runMcpServer` creates the MCP SDK `McpServer`, registers Workbench resources/tools, and connects `StdioServerTransport`.
- Ledger mutation and locking live below the MCP handlers in the shared ledger store.

**Options**

| Option | Default | Description |
|--------|---------|-------------|
| `--config <path>` | `.workbench.yaml` in the current directory | Path to an alternative config file. |

**Notes**

- The host launches the server process and communicates through stdin/stdout.
- The server must not write non-MCP data to stdout; logs go to stderr.
- Workbench coordination state is workspace-scoped, so multiple launched MCP subprocesses can coordinate through the same SQLite ledger store.
- The pipeline Workflow writes Story, Spec, and Tasks via MCP tools.

---

### `workbench task next`

Print the fully resolved task prompt for the next claimable task. Useful for copy-pasting into agent environments or manual workflows.

```sh
workbench task next
workbench task next --format json
```

**Options**

| Option | Default | Description |
|--------|---------|-------------|
| `--format <format>` | `text` | Output format. Accepted values: `text`, `json`. |

**Output**

Prints the same prompt that `get_task_prompt` would return for the highest-priority pending task: task description, persona system prompt, skill invocations, and relevant spec context. Ready to paste into Claude Code, Windsurf, Cursor, or any other agent.

Returns exit code `1` if no claimable tasks exist.

---

### `workbench status`

Print the live ledger state — all tasks, their current statuses, and assigned agents — from the workspace-scoped session store.

```sh
workbench status
workbench status --watch
```

**Options**

| Option | Default | Description |
|--------|---------|-------------|
| `--watch` | — | Poll and re-render every 2 seconds until interrupted. |

**Output**

Tabular summary of every task in the ledger:

```
ID                  TYPE          STATUS       CLAIMED BY    ATTEMPTS
task-PROJ-123-001   backend_api   in_progress  agent-abc     1/2
task-PROJ-123-002   test_coverage pending      —             0/2
task-PROJ-123-003   frontend_ui   done         agent-def     1/2
```

Returns exit code `1` if no active workspace session exists.

---

### `workbench install <provider>`

Install Workbench for a supported AI provider.

For the current release this installs the bundled Workbench Skills into the provider's local skills directory. The command shape is intentionally provider-oriented so future setup work can add config initialization, MCP registration guidance or automation, and path setup without adding another install layer.

```sh
workbench install claude
workbench install codex
workbench install windsurf
workbench install codex --target .custom/skills
```

**Options**

| Option | Default | Description |
|--------|---------|-------------|
| `--target <dir>` | Provider-specific | Override the provider default skills directory. |

**Provider defaults**

| Provider | Default skills directory |
|----------|--------------------------|
| `claude` | `.claude/skills/` |
| `codex` | `.agents/skills/` |
| `windsurf` | `.windsurf/skills/` |

Existing bundled Skill folders in the target directory are overwritten with the packaged versions.

**Installs**

| Skill folder | Description |
|--------------|-------------|
| `workbench` | Pipeline Workflow skill — entry point for a session; orchestrates story fetch, spec generation, task planning, dispatch, and signoff. |
| `workbench-spec` | Spec Agent skill — expands a Story into a structured Spec and validates AC. |
| `workbench-planner` | Planner Agent skill — decomposes a Spec into typed, ordered Tasks. |
| `workbench-manager` | Story Manager skill — coordinates auto-mode dispatch, review routing, and signoff presentation. |
| `workbench-reviewer` | Reviewer Agent skill — inspects implemented work against AC; verifies or requests changes. |
| `workbench-emulator` | Development emulator — runs the full pipeline without MCP infrastructure using file-based state. |

`workbench-spec` and `workbench-planner` use `context: fork` and `disable-model-invocation: true` — they are invoked programmatically by the pipeline, never auto-triggered. `workbench`, `workbench-manager`, and `workbench-emulator` use `disable-model-invocation: true` — they must be invoked explicitly by the user. See [`docs/WorkbenchSkills.md`](WorkbenchSkills.md) for the full catalogue with per-skill detail.

---

### `workbench tool`

List or call MCP tools and resources directly from the terminal. Useful for debugging, scripting, and local testing without an active agent session. Tools are dispatched in-process using the same handler functions as the MCP server — no duplication of business logic.

```sh
# List all registered tools and resources
workbench tool

# Describe a tool (has required fields, no args → show schema)
workbench tool fetch_story

# Call a tool — first positional = primary required field
workbench tool fetch_story .tasks/WB-30.md

# Call with additional named args
workbench tool claim_task task-WB-30-001 --agent_id=dev

# Complex object fields accept a JSON string
workbench tool submit_task task-001 --output='{"summary":"done","changed_files":[]}' --evidence='{"commands_run":[],"tests_passed":[],"changed_files":[],"notes":[]}'

# Read a resource
workbench tool --resource workbench://server/info
```

**Options**

| Option | Default | Description |
|--------|---------|-------------|
| `--resource <uri>` | — | Read a registered MCP resource by URI and print its content. |
| `--format <format>` | `json` | Output format: `json` (structured content) or `text` (raw content text). |

**Argument passing**

The first positional after the tool name maps to the tool's first required field (bare value — no key prefix). Additional arguments use `--key=value` syntax. Complex object fields take a JSON string value.

**Describe mode**

`workbench tool <name>` with no arguments prints the tool's description and argument schema when it has required fields. Tools with zero required fields execute immediately. `--help` always shows Commander's help text.

**Dynamic dispatch**

Tool availability is derived from the server's registered tool registry at runtime — no hardcoded CLI subcommands per tool. New tools added to `WorkbenchServer.registerBuiltinTools()` appear in `workbench tool` automatically.

---

### `workbench verify`

Validate the `.workbench.yaml` config file and check that referenced skills are resolvable in the current agentic environment.

```sh
workbench verify
workbench verify --config ./path/to/.workbench.yaml
```

**Options**

| Option | Default | Description |
|--------|---------|-------------|
| `--config <path>` | `.workbench.yaml` in the current directory | Path to the config file to validate. |

**Checks performed**

- Config file exists and parses as valid YAML.
- All required fields are present and pass schema validation.
- `dispatch_mode` is a known value.
- Every persona referenced in `type_to_persona` has a definition in `personas`.
- Every skill referenced in `personas[*].skills` is findable in the expected skills directory.
- Jira credentials are present in the environment when `jira.auth: token` is set and real Jira is used.
- Local story files parse successfully and include at least title and description when used as the source.

Prints `OK` and exits `0` on success. Prints a structured list of errors/warnings and exits `1` on failure.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_EMAIL` | When using real Jira API | Email address of the Jira Cloud account. |
| `JIRA_API_TOKEN` | When using real Jira API | Jira Cloud API token (generated at id.atlassian.com). |

---

## Configuration File

All commands look for `.workbench.yaml` in the current working directory by default. Pass `--config <path>` to any command to use a different location.

See the **Configuration** section of [`Feature.md`](Feature.md) for the full `.workbench.yaml` schema and annotated example.

---

## MCP Server

The MCP server runs over **stdio** and is intended to be launched by an agent host from MCP configuration:

```sh
codex mcp add workbench -- npx workbench mcp
```

`workbench mcp` and `workbench serve` are equivalent entry points. Session state lives in a workspace-scoped SQLite ledger store so separate stdio server subprocesses can coordinate safely.

See the **MCP Server** section of [`Feature.md`](Feature.md) for the full resource and tool reference.
