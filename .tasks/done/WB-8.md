Status: done
Title: claim_task MCP tool
Description: Implement the `claim_task` MCP tool. Transitions a task from `pending` → `claimed`. Args: task_id, agent_id.

Acceptance Criteria:
- `resources/skills/workbench-emulator/SKILL.md` updated to guide the emulator to prefer calling `claim_task` MCP tool over directly updating task file YAML, with file-based fallback when unavailable.
- 100% test coverage maintained (`npm run test:coverage` passes).
- `claim_task` tool is documented in the MCP server reference.
