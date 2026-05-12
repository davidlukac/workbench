Title: update_spec MCP tool
Description: Implement the `update_spec` MCP tool. Validates and persists partial Spec field updates. Returns updated[], rejected[], current spec, revision, per-field results, and completeness { complete, missing[], invalid[] }. Args: base_revision?, fields.

Acceptance Criteria:
- `resources/skills/workbench-emulator/SKILL.md` updated to guide the emulator to prefer calling `update_spec` MCP tool over directly writing spec.md, with file-based fallback when unavailable.
- 100% test coverage maintained (`npm run test:coverage` passes).
- `update_spec` tool is documented in the MCP server reference.

Status: Done
