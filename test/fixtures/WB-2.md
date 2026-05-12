Title: Minimal MCP server implementation
Description: Implement a basic MCP server that can be run locally during the development and used by Claude, Windsurf and Codex. The MCP should run in development mode with autoreload directly from the repository. The server should expose at least one tool or resource that can be invoked.
Acceptance Criteria:
- [ ] MCP server can be started locally with autoreload
- [ ] MCP server exposes at least one tool or resource - taking a reference to local Jira task file and converting it into a structured format as per specification
- [ ] Tool or resource can be invoked successfully
- [ ] Server logs show successful connection and tool invocation
- [ ] Server can be stopped gracefully
Status: in_progress
