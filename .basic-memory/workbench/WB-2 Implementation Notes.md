---
title: WB-2 Implementation Notes
type: note
permalink: workbench/wb-2-implementation-notes
tags:
- implementation
- mcp
- wb-2
---

# WB-2 Implementation Notes

Implemented minimal stdio MCP server vertical slice.

## Spec Outcome
- `workbench mcp` uses the official `@modelcontextprotocol/sdk` `McpServer` and `StdioServerTransport`.
- `fetch_story` tool accepts a local Markdown/YAML/JSON story file path and normalizes it into the Workbench `Story` shape.
- `workbench://server/info` resource exposes basic debug/capability information.
- Dev/debug logging writes JSONL to `.workbench/logs/workbench-mcp.log` by default and mirrors to stderr when `--dev` is enabled.
- `npm run mcp:dev` runs `node --watch dist/cli.js mcp --dev` after a build.

## Verification
- `npm run lint`
- `npm run test`
- `npm run build`
- Built stdio invocation with SDK `StdioClientTransport` listed `fetch_story`, called it against `.tasks/WB-2.md`, and verified log events.

## Key Files
- `src/server/index.ts`
- `src/server/tools.ts`
- `src/server/resources.ts`
- `src/story-source/local-file.ts`
- `src/logging/logger.ts`
- `test/mcp-server.test.ts`
- `test/story-source.test.ts`

## Follow-up Updates

- Added `scripts/codex-mcp-dev.sh` for Codex MCP development registration with NVM. It sources `$HOME/.nvm/nvm.sh`, runs `nvm use --silent`, builds once, starts `npm run dev` in the background, and execs `node --watch dist/cli.js mcp --dev --log-file .workbench/logs/workbench-mcp.log`.
- Codex registration command: `codex mcp add workbench-dev -- /Users/Madar/dev/workbench/scripts/codex-mcp-dev.sh`.
- Added `@vitest/coverage-v8` and `npm run test:coverage`.
- Added `DEVELOPMENT.md` covering setup, MCP dev usage, log tailing, Codex/NVM registration, and coverage.
- Follow-up verification: `bash -n scripts/codex-mcp-dev.sh`, `npm run lint`, `npm run test:coverage`, `npm run build`.

## Codex MCP Wrapper Fix

A repro of `fetch_story({ source_ref: ".tasks/WB-3.md" })` through `scripts/codex-mcp-dev.sh` showed that `node --watch` is unsafe for a Codex stdio MCP server. Restarts close the stdio transport and can surface as `Transport closed`; in one repro Node also crashed with `EMFILE: too many open files, watch`.

Updated `scripts/codex-mcp-dev.sh` to source NVM, run `npm run build`, and then `exec node dist/cli.js mcp --dev --log-file .workbench/logs/workbench-mcp.log` without `node --watch` or a background build watcher. For source edits, rebuild and restart the Codex MCP connection.
