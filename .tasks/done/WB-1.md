Title: Initial project setup
Description: Set up the initial project structure, dependencies, and configuration files for the AI Agent Workbench project. Use TechStack description.
Acceptance Criteria:
- [x] Project structure is set up with src, dist, and test directories
- [x] Dependencies are installed and configured
- [x] Configuration files are created and validated
- [x] Strict, modern, type-safe TypeScript is configured with tsconfig.json
- [x] Build scripts are configured in package.json
- [x] Linting and formatting tools are configured
- [x] Tests can be run successfully
- [x] Help command is set up and working.
- [x] Readme is updated with project overview and setup instructions.

Implementation Evidence:
- Added npm package setup, strict TypeScript config, tsup build, Vitest tests, Biome lint/format config, and default `.workbench.yaml`.
- Added initial `src/` implementation for Commander CLI, config loading/validation, verification checks, and public exports.
- Added focused tests for CLI help and config validation.
- Verified with `npm install`, `npm run lint`, `npm run test`, `npm run build`, `node dist/cli.js --help`, and `node dist/cli.js verify`.
Status: Done
