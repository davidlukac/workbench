Title: Test coverage
Description: Add test coverage for the project
Acceptance Criteria:
- [x] 100% test coverage for the project
- [x] All tests pass
- [x] Coverage report generated
- [x] documentation in docs/Testing.md
- [x] evaluate most comprehensive test coverage tool

Emulated Workbench Spec:
- Story ID: WB-3
- Goal: Enforce and document complete test coverage for the current TypeScript project.
- Requirements:
  - REQ-1: Configure coverage collection for relevant `src/**/*.ts` files.
  - REQ-2: Enforce 100% branches, functions, lines, and statements.
  - REQ-3: Add unit tests until the current source satisfies coverage thresholds.
  - REQ-4: Ensure `npm run test` and `npm run test:coverage` pass.
  - REQ-5: Document testing commands, coverage expectations, report output, and tech debt in `docs/Testing.md`.
  - REQ-6: Evaluate V8 versus Babel/Istanbul coverage instrumentation for this stack.
- Non-goals:
  - Replacing Vitest as the test runner.
  - Adding full CLI binary or stdio MCP integration tests in this story.
  - Requiring real Jira credentials or network access during tests.

Emulated Planner Task Breakdown:
- [x] task-WB-3-001: Evaluate coverage instrumentation provider.
- [x] task-WB-3-002: Configure enforced coverage thresholds.
- [x] task-WB-3-003: Expand unit tests to satisfy coverage.
- [x] task-WB-3-004: Document testing and coverage workflow.

Implementation Evidence:
- Changed files: `vitest.config.ts`, `src/cli.ts`, `src/config/loader.ts`, `src/server/index.ts`, `test/cli.test.ts`, `test/config.test.ts`, `test/index.test.ts`, `test/logger.test.ts`, `test/mcp-server.test.ts`, `test/story-source.test.ts`, `test/verify.test.ts`, `docs/Testing.md`.
- Added coverage configuration with Vitest V8 provider, `src/**/*.ts` inclusion, text/html/json reports, and 100% thresholds for branches, functions, lines, and statements.
- Added isolated unit coverage for CLI command behavior, MCP server startup hooks, configuration loading and reference validation, local story parsing, logger output, environment verification, and public exports.
- Added small testability seams so CLI and MCP startup behavior can be tested with injected dependencies instead of launching the real CLI process or stdio server.
- Documented full CLI binary and real stdio MCP process tests as deferred integration-test debt in `docs/Testing.md`.
- Coverage provider decision: keep Vitest V8. Current Vitest documentation describes V8 as the default recommended provider, and modern V8 coverage uses AST-based remapping for Istanbul-equivalent accuracy on this Node.js TypeScript stack.
- Commands run:
  - `npm run format`
  - `npm run lint`
  - `npm run build`
  - `npm run test`
  - `npm run test:coverage`
- Final verification:
  - `npm run lint` passed
  - `npm run build` passed
  - `npm run test` passed with 7 test files / 29 tests
  - `npm run test:coverage` passed with 100% statements, branches, functions, and lines

Status: Done
