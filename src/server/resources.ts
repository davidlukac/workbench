import type { Logger } from "../logging/logger.js";

/**
 * Builds a resource handler for `workbench://server/info`.
 * The tool list is derived at read time via `getToolNames()` so it always reflects
 * the current set of registered tools without manual maintenance.
 */
export function serverInfoResource(logger: Logger, getToolNames: () => readonly string[]) {
  return async (uri: URL) => {
    const info = {
      name: "@workbench/cli",
      transport: "stdio",
      status: "ready",
      tools: getToolNames(),
      resources: ["workbench://server/info"]
    };
    await logger.info("resource_read", {
      uri: uri.toString()
    });
    return {
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(info, null, 2)
        }
      ]
    };
  };
}
