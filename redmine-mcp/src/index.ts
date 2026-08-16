import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RedmineClient } from "./redmine.js";
import { registerProjects } from "./tools/projects.js";
import { registerIssues } from "./tools/issues.js";
import { registerUsers } from "./tools/users.js";
import { registerTimeEntries } from "./tools/time-entries.js";
import { registerTracking } from "./tools/tracking.js";
import { registerContext } from "./tools/context.js";
import { registerWiki } from "./tools/wiki.js";

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

async function main() {
  const config = getRedmineConfig();

  const server = new McpServer({
    name: "redmine-mcp",
    version: "0.1.0",
  });

  const client = new RedmineClient(config);

  registerProjects(server, client);
  registerIssues(server, client);
  registerUsers(server, client);
  registerTimeEntries(server, client);
  registerTracking(server, client);
  registerContext(server, client);
  registerWiki(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Redmine MCP server running on stdio");
}

main().catch((err) => {
  console.error("Failed to start Redmine MCP server:", err.message);
  process.exit(1);
});
