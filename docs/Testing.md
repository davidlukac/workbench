# Testing

Workbench uses Vitest for the TypeScript unit test suite. Tests run in Node and should avoid network access, real Jira credentials, and machine-specific persistent state.

## Commands

Run the full unit test suite:

```sh
npm run test
```

Run tests in watch mode:

```sh
npm run test:watch
```

Run one test file:

```sh
npx vitest run test/config.test.ts
```

Run tests with coverage:

```sh
npm run test:coverage
```

Run lint and build after behavior or test changes:

```sh
npm run lint
npm run build
```

## Coverage

Coverage is configured in `vitest.config.ts` with the V8 provider. Coverage collection includes `src/**/*.ts` and excludes declaration files, generated output, tests, and dependency code.

The project enforces 100% coverage across all four dimensions:

- branches
- functions
- lines
- statements

`npm run test:coverage` writes reports to `coverage/`. The configured reporters are:

- `text`, printed in the terminal
- `html`, written under `coverage/`
- `json`, written under `coverage/coverage-final.json`

## Provider Decision

Use Vitest's V8 coverage provider for this project.

The project runs under Node.js, which is a V8 runtime, and already depends on `@vitest/coverage-v8`. Current Vitest documentation describes V8 as the default recommended provider. Modern Vitest uses AST-based remapping for V8 coverage, giving report accuracy equivalent to Istanbul for this stack while avoiding Babel/Istanbul pre-instrumentation overhead.

Babel/Istanbul-style instrumentation remains useful for non-V8 runtimes or cases where instrumentation must be limited to selected files before execution. Those constraints do not currently apply to Workbench.

The full evaluation for WB-3 is recorded in `.workbench/emulator/WB-3/coverage-tool-evaluation.md`.

## Test Scope

Prefer isolated unit tests around exported functions and injected dependencies. For process-adjacent code, expose small seams that let tests provide fake dependencies instead of launching real processes.

Current examples:

- CLI command behavior is tested through `createProgram` and `runCli` with injected config loading, MCP startup, verification, and output handlers.
- MCP server startup is tested with an injected transport and process signal hooks.
- Logger tests use temporary log files where practical.
- Verification tests stub environment variables and avoid real Jira calls.

## Tech Debt

The current suite intentionally does not launch the real CLI binary or run a real stdio MCP server integration session. Those paths are documented as integration-test debt because they need process management and stream lifecycle handling beyond the unit scope of WB-3.

Deferred integration coverage:

- Execute `dist/cli.js` as a child process and verify command exit behavior.
- Start the stdio MCP server as a child process and exercise it with an MCP client over real stdio.
- Verify signal handling against a real process rather than injected signal hooks.
