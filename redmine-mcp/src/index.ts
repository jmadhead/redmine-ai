import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RedmineClient } from "./redmine.js";
import { logger } from "./logger.js";
import { registerProjects } from "./tools/projects.js";
import { registerIssues } from "./tools/issues.js";
import { registerUsers } from "./tools/users.js";
import { registerTimeEntries } from "./tools/time-entries.js";
import { registerTracking } from "./tools/tracking.js";
import { registerContext } from "./tools/context.js";
import { registerWiki } from "./tools/wiki.js";
import { registerWorkflows } from "./tools/workflows.js";

function getRedmineConfig(): { url: string; apiKey: string } {
  const url =
    process.env.REDMINE_URL?.replace(/\/+$/, "") || "http://localhost:3000";
  const apiKey = process.env.REDMINE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "REDMINE_API_KEY environment variable is required. " +
        "Generate one in Redmine at My Account > API access key."
    );
  }

  return { url, apiKey };
}

function loggedHandler(
  toolName: string,
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
): typeof handler {
  return async (args: Record<string, unknown>) => {
    logger.toolCall(toolName, args);
    const start = Date.now();
    try {
      const result = await handler(args);
      const duration = Date.now() - start;
      const output = result.content?.[0]?.text ?? JSON.stringify(result.content);
      logger.toolResult(toolName, duration, output);
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.toolError(toolName, duration, errorMessage);
      throw err;
    }
  };
}

type RegisterFn = (
  server: McpServer,
  client: RedmineClient,
  wrapHandler: typeof loggedHandler
) => void;

async function main() {
  const config = getRedmineConfig();

  const server = new McpServer({
    name: "redmine-mcp",
    version: "0.1.0",
  });

  const client = new RedmineClient(config);

  registerProjects(server, client, loggedHandler);
  registerIssues(server, client, loggedHandler);
  registerUsers(server, client, loggedHandler);
  registerTimeEntries(server, client, loggedHandler);
  registerTracking(server, client, loggedHandler);
  registerContext(server, client, loggedHandler);
  registerWiki(server, client, loggedHandler);
  registerWorkflows(server, client, loggedHandler);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Redmine MCP server running on stdio");
}

main().catch((err) => {
  logger.error("Failed to start Redmine MCP server: " + err.message);
  process.exit(1);
});
