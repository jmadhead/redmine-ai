import { z } from "zod";
import { RedmineClient } from "../redmine.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type WrapHandler = (
  toolName: string,
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
) => (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

export function registerTracking(server: McpServer, client: RedmineClient, wrapHandler?: WrapHandler) {
  server.tool(
    "redmine_get_issue_statuses",
    "Get all available Redmine issue statuses (open, closed, etc.). Returns status IDs, names, and whether they are active.",
    {},
    async () => {
      try {
        const statuses = await client.getIssueStatuses();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  issue_statuses: statuses.map((s) => ({
                    id: s.id,
                    name: s.name,
                    is_closed: s.is_closed,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  issue_statuses: [],
                  _warning: "Failed to fetch issue statuses: " + (err as Error).message,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "redmine_get_trackers",
    "Get all available Redmine trackers (bug, feature, support, etc.). Returns tracker IDs and names.",
    {},
    async () => {
      try {
        const trackers = await client.getTrackers();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  trackers: trackers.map((t) => ({
                    id: t.id,
                    name: t.name,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  trackers: [],
                  _warning: "Failed to fetch trackers: " + (err as Error).message,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.tool(
    "redmine_get_issue_categories",
    "Get issue categories for a specific project. Categories help organize issues within a project.",
    {
      project_id: z
        .string()
        .describe("Project identifier or ID"),
    },
    async ({ project_id }) => {
      try {
        const categories = await client.getIssueCategories(project_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  project_id,
                  categories: categories.map((c) => ({
                    id: c.id,
                    name: c.name,
                    assigned_to: c.assigned_to,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  project_id,
                  categories: [],
                  _warning: "Failed to fetch issue categories: " + (err as Error).message,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

}
