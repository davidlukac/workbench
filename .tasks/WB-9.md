Title: start_task MCP tool
Description: Implement the `start_task` MCP tool. Transitions a task from `claimed` → `in_progress`. Args: task_id.

Acceptance Criteria:
- `resources/skills/workbench-emulator/SKILL.md` updated to guide the emulator to prefer calling `start_task` MCP tool over directly updating task file YAML, with file-based fallback when unavailable.
- 100% test coverage maintained (`npm run test:coverage` passes).
- `start_task` tool is documented in the MCP server reference.
