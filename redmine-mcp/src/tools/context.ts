import { z } from "zod";
import { RedmineClient } from "../redmine.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerContext(server: McpServer, client: RedmineClient) {
  server.tool(
    "redmine_get_context",
    "Get all reference data needed to create or update issues in a single call. Returns projects, issue statuses, trackers, and issue categories. Use this before creating or updating issues to avoid multiple separate tool calls.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Optional project ID, identifier, or name to scope the reference data. If omitted, returns data for all projects."
        ),
    },
    async ({ project_id }) => {
      const context = await client.getContext(project_id);

      const formatted = {
        projects: context.projects.map((p) => ({
          id: p.id,
          identifier: p.identifier,
          name: p.name,
          status: p.status?.name ?? p.status,
        })),
        issue_statuses: context.issue_statuses.map((s) => ({
          id: s.id,
          name: s.name,
          is_closed: s.is_closed,
        })),
        trackers: context.trackers.map((t) => ({
          id: t.id,
          name: t.name,
        })),
        issue_categories: Object.fromEntries(
          Object.entries(context.issue_categories).map(([key, cats]) => [
            key,
            cats.map((c) => ({
              id: c.id,
              name: c.name,
              assigned_to: c.assigned_to,
            })),
          ])
        ),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatted, null, 2),
          },
        ],
      };
    }
  );
}
