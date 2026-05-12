Title: Minimal MCP server implementation
Description: Implement a basic MCP server that can be run locally during the development and used by Claude, Windsurf and Codex. The MCP should run in development mode with autoreload directly from the repository. The server should expose at least one tool or resource that can be invoked.
Acceptance Criteria:
- [x] MCP server can be started locally with autoreload
- [x] MCP server exposes at least one tool or resource - taking a reference to local Jira task file and converting it into a structured format as per specification
- [x] Tool or resource can be invoked successfully
- [x] Server logs show successful connection and tool invocation
- [x] Server can be stopped gracefully
- [x] Implementation is documented in README
- [x] Code follows TypeScript best practices
- [x] Code is properly formatted and linted
- [x] Tests cover the MCP server functionality
- [x] No critical errors or warnings in the implementation
- [x] Implementation is ready for integration with the main application
- [x] MCP server produces a log file with detailed information about the server operations (dev/debug mode) we can tail
- [x] Simple stdio implementation is sufficient.

Emulated Workbench Spec:
- Story ID: WB-2
- Goal: Provide a minimal stdio MCP server that can run locally, expose an invokable capability, normalize local Jira/task files into the Story shape, and write dev/debug logs.
- Requirements:
  - REQ-1: `workbench mcp` starts a stdio MCP server using the official TypeScript SDK.
  - REQ-2: dev mode supports local autoreload through an npm script.
  - REQ-3: the server exposes `fetch_story` for Markdown/YAML/JSON local story files.
  - REQ-4: the server exposes at least one read resource for host discovery/debugging.
  - REQ-5: server operations write JSONL logs to a tail-able log file without corrupting stdout.
  - REQ-6: tests prove story normalization and MCP tool/resource invocation.
- Non-goals:
  - Full task ledger implementation.
  - HTTP/SSE transport.
  - Real Jira Cloud API integration.

Emulated Planner Task Breakdown:
- [x] task-WB-2-001: Implement local story file normalization.
- [x] task-WB-2-002: Register MCP server, `fetch_story` tool, and debug resource.
- [x] task-WB-2-003: Add dev/autoreload script and debug logging.
- [x] task-WB-2-004: Cover parser and MCP behavior with tests.
- [x] task-WB-2-005: Document local MCP usage in README.
- [x] task-WB-2-006: Verify build, lint, tests, stdio invocation, and log output.
- [x] task-WB-2-007: Document Codex MCP registration with NVM, dev mode, and watch mode.
- [x] task-WB-2-008: Add explicit test coverage command and coverage provider.
- [x] task-WB-2-009: Add `DEVELOPMENT.md` for Workbench MCP development usage.

Implementation Evidence:
- Changed files: `package.json`, `README.md`, `src/cli.ts`, `src/index.ts`, `src/server/index.ts`, `src/server/tools.ts`, `src/server/resources.ts`, `src/story-source/local-file.ts`, `src/logging/logger.ts`, `src/types.ts`, `test/mcp-server.test.ts`, `test/story-source.test.ts`.
- Added `npm run mcp:dev` for `node dist/cli.js mcp --dev`. It intentionally does not use `node --watch` after follow-up debugging showed watch restarts close stdio MCP transports.
- Added `fetch_story` MCP tool that converts `.tasks/WB-2.md` into a structured Story object.
- Added `workbench://server/info` MCP resource.
- Added JSONL debug logging to `.workbench/logs/workbench-mcp.log` by default, with stderr mirroring in dev mode.
- Verified graceful stop through SDK client close in the stdio invocation check.
- Commands run:
  - `npm run format`
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - `node --input-type=module -e '<stdio MCP client invocation>'`
  - `tail -n 5 /private/tmp/workbench-mcp-e2e.log`
- Stdio invocation result: listed `fetch_story`, called it with `.tasks/WB-2.md`, returned Story `WB-2`, and wrote `server_connected`, `tool_invocation_started`, and `tool_invocation_succeeded` log events.

Follow-up Answers:
- Codex + NVM setup: added executable `scripts/codex-mcp-dev.sh`. Register with `codex mcp add workbench-dev -- /Users/Madar/dev/workbench/scripts/codex-mcp-dev.sh`. The script changes to the repo root, sources `$HOME/.nvm/nvm.sh`, runs `nvm use --silent`, builds once, and execs `node dist/cli.js mcp --dev --log-file .workbench/logs/workbench-mcp.log`. Follow-up debugging showed `node --watch` is unsafe for Codex stdio MCP because a restart closes the transport and can surface as `Transport closed`; rebuild and restart the Codex MCP connection after source edits instead.
- Test/code coverage: WB-2 already had tests for local story normalization and MCP tool/resource invocation. Added `@vitest/coverage-v8` and `npm run test:coverage`; latest coverage run passed with 4 test files / 5 tests and an overall line coverage report of 65.74%.
- Development docs: added `DEVELOPMENT.md` with setup, Codex MCP registration, NVM/watch-mode details, log tailing, current MCP capabilities, and coverage instructions. README now links to `DEVELOPMENT.md`.
- Follow-up verification commands:
  - `npm install`
  - `chmod +x scripts/codex-mcp-dev.sh`
  - `bash -n scripts/codex-mcp-dev.sh`
  - `npm run lint`
  - `npm run test:coverage`
  - `npm run build`

Status: Done
