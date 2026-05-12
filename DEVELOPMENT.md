# Workbench Development

## Local Setup

Requires Node.js `>=22.0.0`; this repository pins Node 24 in `.nvmrc`.

```sh
nvm use
npm install
npm run build
npm run lint
npm run test
npm run test:coverage
```

## Run the MCP Server Locally

For a direct terminal run after building:

```sh
npm run build
npm run mcp:dev
```

`npm run mcp:dev` runs:

```sh
node dist/cli.js mcp --dev
```

For source changes, rebuild and restart the MCP connection. Stdio MCP transports are long-lived pipes; restarting the server process under a connected host closes that pipe.

## Add the Dev MCP Server to Codex

Codex launches MCP servers outside your interactive shell, so it may not inherit the active NVM Node version. Use the wrapper script, which changes to the repo root, sources NVM, runs `nvm use`, builds once, and then launches the stdio MCP server in dev mode.

```sh
codex mcp add workbench -- /Users/Madar/dev/workbench/scripts/codex-mcp-dev.sh
```

The wrapper performs:

```sh
source "$HOME/.nvm/nvm.sh"
nvm use --silent
npm run build
exec node dist/cli.js mcp --dev --log-file .workbench/logs/workbench-mcp.log
```

Do not run a Codex MCP entrypoint under `node --watch`. A stdio MCP server restart closes the transport that Codex is using, which surfaces as `Transport closed` during tool calls. For source edits, run `npm run build` and restart the Codex MCP connection.

Debug logs are JSONL and can be tailed:

```sh
tail -f .workbench/logs/workbench-mcp.log
```

MCP protocol traffic must stay on stdout. The dev server writes diagnostics to stderr and the log file.

## Current MCP Capabilities

Tool:

- `fetch_story`: accepts `source_ref` for a local Markdown, YAML, or JSON story/task file and returns a structured Workbench Story.

Resource:

- `workbench://server/info`: returns basic server status and capability information.

## Test Coverage

The WB-2 implementation is covered by:

- `test/story-source.test.ts`: local Markdown task parsing and Story normalization.
- `test/mcp-server.test.ts`: real SDK client/server connection over in-memory MCP transport, resource listing/read, `fetch_story` invocation, and log-event assertions.

Run coverage with:

```sh
npm run test:coverage
```
