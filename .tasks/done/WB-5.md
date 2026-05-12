Title: Install command

Description: 

Implement the install command for the Workbench CLI. The install command installs Skills distributed with Workbench into the local environment.
It takes an argument for which AI products/providers to install Skills for.
Currently supported providers are:
- Claude - installs Skills in to ./.claude/skills/
- Codex - installs Skills in to ./.agents/skills/
- Windsurf - installs Skills in to ./.windsurf/skills/
If any of the skills are already installed, they will be overwritten.

Acceptance Criteria:
- [x] Install command is implemented
- [x] Install command is tested
- [x] Install command is documented

Status: done

Implementation Summary:
- Added `workbench install <provider>` for `claude`, `codex`, and `windsurf`.
- Installs all bundled Skill directories from `resources/skills/`.
- Provider defaults:
  - `claude` -> `.claude/skills/`
  - `codex` -> `.agents/skills/`
  - `windsurf` -> `.windsurf/skills/`
- Supports `--target <dir>` to override the provider default skills directory.
- Existing installed bundled Skill directories are overwritten with the packaged versions.

Changed Files:
- `src/cli.ts`
- `src/install/skills.ts`
- `package.json`
- `test/cli.test.ts`
- `test/install-skills.test.ts`
- `README.md`
- `docs/CLI.md`
- `docs/WorkbenchSkills.md`
- `docs/DesignGaps.md`
- `docs/Feature.md`

Verification:
- `npm run test:coverage` - 100% statements, branches, functions, and lines
- `npm run lint`
- `npm run build`
- Manual install smoke test for `codex`, `claude`, and `windsurf`

Session Summary:
- `.workbench/emulator/WB-5/summary.md`
