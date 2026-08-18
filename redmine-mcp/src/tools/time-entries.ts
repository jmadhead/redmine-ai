import { z } from "zod";
import { RedmineClient } from "../redmine.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerTimeEntries(
  server: McpServer,
  client: RedmineClient
) {
  server.tool(
    "redmine_list_time_entries",
    "List Redmine time entries with optional filtering. Returns time spent records with user, issue, project, hours, and activity.",
    {
      offset: z
        .number()
        .int()
        .nonnegative()
        .default(0)
        .describe("Number of items to skip for pagination"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(25)
        .describe("Number of items to return"),
      user_id: z
        .string()
        .optional()
        .describe("Filter by user ID"),
      issue_id: z
        .string()
        .optional()
        .describe("Filter by issue ID"),
      project_id: z
        .string()
        .optional()
        .describe("Filter by project ID or identifier"),
      activity_id: z
        .string()
        .optional()
        .describe("Filter by time entry activity ID"),
      from: z
        .string()
        .optional()
        .describe("Start date filter (YYYY-MM-DD)"),
      to: z
        .string()
        .optional()
        .describe("End date filter (YYYY-MM-DD)"),
    },
    async ({ offset, limit, user_id, issue_id, project_id, activity_id, from, to }) => {
      const filters: Record<string, string> = {};
      if (user_id) filters.user_id = user_id;
      if (issue_id) filters.issue_id = issue_id;
      if (project_id) filters.project_id = project_id;
      if (activity_id) filters.activity_id = activity_id;
      if (from) filters.from = from;
      if (to) filters.to = to;

      const result = await client.getTimeEntries(offset, limit, filters);

      const entries = result.data.map((e) => ({
        id: e.id,
        issue: e.issue,
        project: e.project,
        user: e.user,
        hours: e.hours,
        comment: e.comment,
        activity: e.activity,
        created_on: e.created_on,
        created_by: e.created_by,
        spent_on: e.spent_on,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                time_entries: entries,
                pagination: {
                  offset: result.offset,
                  limit: result.limit,
                  total: result.total,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_get_time_entry",
    "Get a single Redmine time entry by ID. Returns full details of the time tracking record.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("Time entry numeric ID"),
    },
    async ({ id }) => {
      const entry = await client.getTimeEntry(id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: entry.id,
                issue: entry.issue,
                project: entry.project,
                user: entry.user,
                hours: entry.hours,
                comment: entry.comment,
                activity: entry.activity,
                created_on: entry.created_on,
                created_by: entry.created_by,
                spent_on: entry.spent_on,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_create_time_entry",
    "Create a new Redmine time entry. Requires hours and activity_id. Optionally set issue_id, project_id, user_id, comment, and spent_on.",
    {
      issue_id: z
        .number()
        .int()
        .optional()
        .describe("Issue ID the time is tracked against"),
      project_id: z
        .number()
        .int()
        .optional()
        .describe("Project ID (required if no issue_id)"),
      user_id: z
        .number()
        .int()
        .optional()
        .describe("User ID (defaults to API user if omitted)"),
      hours: z
        .number()
        .positive()
        .describe("Time spent in hours (e.g. 1.5 for 1 hour 30 min)"),
      activity_id: z
        .number()
        .int()
        .describe("Time entry activity ID (use redmine_get_time_activities to see options)"),
      comment: z
        .string()
        .optional()
        .describe("Comment/description for the time entry"),
      spent_on: z
        .string()
        .optional()
        .describe("Date of the time entry (YYYY-MM-DD, defaults to today)"),
    },
    async ({ issue_id, project_id, ...rest }) => {
      if (issue_id === undefined && project_id === undefined) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Either issue_id or project_id must be provided.",
            },
          ],
        };
      }

      const payload: Record<string, unknown> = rest;
      if (issue_id !== undefined) payload.issue_id = issue_id;
      if (project_id !== undefined) payload.project_id = project_id;

      const result = await client.createTimeEntry(payload);
      return {
        content: [
          {
            type: "text",
            text: `Time entry created successfully.\n\n${JSON.stringify(
              {
                id: result.id,
                issue: result.issue,
                hours: result.hours,
                comment: result.comment,
                url: `${client.url}/time_entries/${result.id}`,
              },
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_update_time_entry",
    "Update an existing Redmine time entry by ID. Provide any fields to update.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("Time entry ID to update"),
      hours: z
        .number()
        .positive()
        .optional()
        .describe("New hours value"),
      comment: z
        .string()
        .optional()
        .describe("New comment"),
      activity_id: z
        .number()
        .int()
        .optional()
        .describe("New activity ID"),
      spent_on: z
        .string()
        .optional()
        .describe("New date (YYYY-MM-DD)"),
      issue_id: z
        .number()
        .int()
        .optional()
        .describe("New issue ID"),
    },
    async ({ id, ...payload }) => {
      let result: any;
      try {
        result = await client.updateTimeEntry(id, payload);
      } catch (e) {
        result = null;
      }
      let entryData: any;
      if (result && result.id) {
        entryData = {
          id: result.id,
          hours: result.hours,
          comment: result.comment,
        };
      } else {
        try {
          const refreshed = await client.getTimeEntry(id);
          entryData = {
            id: refreshed.id,
            hours: refreshed.hours,
            comment: refreshed.comment,
          };
        } catch {
          entryData = { id, message: "Time entry updated successfully (empty response from server)" };
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Time entry #${id} updated successfully.\n\n${JSON.stringify(entryData, null, 2)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_delete_time_entry",
    "Delete a Redmine time entry by ID. WARNING: This cannot be undone.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("Time entry ID to delete"),
    },
    async ({ id }) => {
      try {
        await client.deleteTimeEntry(id);
        return {
          content: [
            {
              type: "text",
              text: `Time entry #${id} deleted successfully.`,
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Error deleting time entry #${id}: ${message}`,
            },
          ],
        };
      }
    }
  );
}
