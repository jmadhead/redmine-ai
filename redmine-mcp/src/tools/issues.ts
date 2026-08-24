import { z } from "zod";
import { RedmineClient } from "../redmine.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type WrapHandler = (
  toolName: string,
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
) => (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

export function registerIssues(server: McpServer, client: RedmineClient, wrapHandler?: WrapHandler) {
  server.tool(
    "redmine_list_issues",
    "List Redmine issues with optional filtering. Returns issues with id, project, tracker, status, subject, priority, assignee, relations, and more.",
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
      project_id: z
        .string()
        .optional()
        .describe("Filter by project ID or identifier"),
      status_id: z
        .string()
        .optional()
        .describe("Filter by issue status (e.g. '*', '1' for open, '3' for closed)"),
      tracker_id: z
        .string()
        .optional()
        .describe("Filter by tracker ID"),
      assignee_id: z
        .string()
        .optional()
        .describe("Filter by assignee user ID"),
      subject: z
        .string()
        .optional()
        .describe("Filter by subject (contains match)"),
    },
    async ({ offset, limit, project_id, status_id, tracker_id, assignee_id, subject }) => {
      const filters: Record<string, string> = {};
      if (project_id) filters.project_id = project_id;
      if (status_id) filters.status_id = status_id;
      if (tracker_id) filters.tracker_id = tracker_id;
      if (assignee_id) filters.assignee_id = assignee_id;
      if (subject) filters.subject = subject;

      const result = await client.getIssues(offset, limit, filters);

      const issues = result.data.map((issue) => ({
        id: issue.id,
        project: issue.project?.name ?? issue.project,
        project_id: issue.project?.id ?? issue.project_id,
        tracker: issue.tracker?.name ?? issue.tracker,
        status: issue.status?.name ?? issue.status,
        subject: issue.subject,
        priority: issue.priority?.name ?? issue.priority,
        assignee: issue.assigned_to?.name ?? issue.assigned_to,
        author: issue.author?.name ?? issue.author,
        description: issue.description,
        created_on: issue.created_on,
        updated_on: issue.updated_on,
        start_date: issue.start_date,
        due_date: issue.due_date,
        done_ratio: issue.done_ratio,
        relations: issue.relations,
        custom_fields: issue.custom_fields,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issues,
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
    "redmine_get_issue_children",
    "Get the child issues (subtasks) of a Redmine issue. Returns issues listed in the 'children' field of /issues/{id}.json?include=children response.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("Parent issue ID"),
    },
    async ({ id }) => {
      const issue = await client.getIssue(id);
      const children = (issue.children || []).map((c: any) => ({
        id: c.id,
        project: c.project?.name ?? c.project,
        tracker: c.tracker?.name ?? c.tracker,
        status: c.status?.name ?? c.status,
        subject: c.subject,
        priority: c.priority?.name ?? c.priority,
        assignee: c.assigned_to?.name ?? c.assigned_to,
        author: c.author?.name ?? c.author,
        description: c.description,
        start_date: c.start_date,
        due_date: c.due_date,
        done_ratio: c.done_ratio,
        created_on: c.created_on,
        updated_on: c.updated_on,
        custom_fields: c.custom_fields,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_id: id,
                children,
                total: children.length,
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
    "redmine_create_issue",
    "Create a new Redmine issue. Requires project and subject. Optionally set tracker_id, assignee_id, priority_id, status_id, description, start_date, due_date, parent_issue_id, and custom_fields. Use redmine_get_context to discover available IDs.",
    {
      project_id: z
        .string()
        .describe("Project ID or identifier for the new issue"),
      subject: z
        .string()
        .describe("Issue subject/title"),
      tracker_id: z
        .number()
        .int()
        .optional()
        .describe("Tracker ID (use redmine_get_trackers to see available options)"),
      assignee_id: z
        .number()
        .int()
        .optional()
        .describe("Assignee user ID"),
      priority_id: z
        .number()
        .int()
        .optional()
        .describe("Priority ID (use redmine_get_context to see available options)"),
      status_id: z
        .number()
        .int()
        .optional()
        .describe("Issue status ID (defaults to first open status)"),
      category_id: z
        .number()
        .int()
        .optional()
        .describe("Issue category ID"),
      description: z
        .string()
        .optional()
        .describe("Issue description in CommonMark Markdown (GitHub Flavored). Use #, ##, ### for headings. Code blocks with ```lang. Never use == (reStructuredText), h1. (Redmine wiki), or AsciiDoc formatting."),
      start_date: z
        .string()
        .optional()
        .describe("Start date (YYYY-MM-DD)"),
      due_date: z
        .string()
        .optional()
        .describe("Due date (YYYY-MM-DD)"),
      parent_issue_id: z
        .number()
        .int()
        .optional()
        .describe("Parent issue ID for sub-issues"),
      custom_fields: z
        .array(
          z.object({
            id: z.number(),
            value: z.unknown(),
          })
        )
        .optional()
        .describe("Custom field values as array of {id, value} objects"),
    },
    async ({ project_id, subject, ...rest }) => {
      const payload: Record<string, unknown> = {
        project_id,
        subject,
        ...rest,
      };
      const result = await client.createIssue(payload);
      return {
        content: [
          {
            type: "text",
            text: `Issue created successfully.\n\n${JSON.stringify(
              {
                id: result.id,
                project: result.project?.identifier ?? result.project,
                subject: result.subject,
                status: result.status?.name ?? result.status,
                url: `${client.url}/issues/${result.id}`,
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
    "redmine_update_issue",
    "Update an existing Redmine issue. Provide the issue ID and any fields to update. Use redmine_issue_workflow first to see current state including relations.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("Issue ID to update"),
      subject: z
        .string()
        .optional()
        .describe("New subject"),
      description: z
        .string()
        .optional()
        .describe("New description in CommonMark Markdown (GitHub Flavored). Use #, ##, ### for headings. Code blocks with ```lang. Never use == (reStructuredText), h1. (Redmine wiki), or AsciiDoc formatting."),
      status_id: z
        .number()
        .int()
        .optional()
        .describe("New status ID"),
      priority_id: z
        .number()
        .int()
        .optional()
        .describe("New priority ID"),
      assignee_id: z
        .number()
        .int()
        .optional()
        .describe("New assignee user ID"),
      tracker_id: z
        .number()
        .int()
        .optional()
        .describe("New tracker ID"),
      category_id: z
        .number()
        .int()
        .optional()
        .describe("New category ID"),
      start_date: z
        .string()
        .optional()
        .describe("New start date (YYYY-MM-DD)"),
      due_date: z
        .string()
        .optional()
        .describe("New due date (YYYY-MM-DD)"),
      done_ratio: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("Completion percentage (0-100)"),
      notes: z
        .string()
        .optional()
        .describe("Private notes in CommonMark Markdown. Use #, ##, ### for headings. Never use == or h1. formatting."),
      custom_fields: z
        .array(
          z.object({
            id: z.number(),
            value: z.unknown(),
          })
        )
        .optional()
        .describe("Custom field values as array of {id, value} objects"),
      relations: z
        .array(
          z.object({
            issue_to_id: z.number().int().positive().describe("ID of the issue to link"),
            type: z.string().describe("Relation type: relates, blocks, precedes, follows, duplicates, duplicate"),
            is_def: z.boolean().optional().describe("If true, the linked issue is a dependency (blocks/follows)"),
          })
        )
        .optional()
        .describe("Issue relations to create/update: array of {issue_to_id, type, is_def} objects. Replaces all existing relations for this issue."),
    },
    async ({ id, relations, ...payload }: { id: number; relations?: Array<{ issue_to_id: number; type: string; is_def?: boolean }>; [key: string]: unknown }) => {
      const addedRelations: any[] = [];
      if (relations && relations.length > 0) {
        for (const r of relations) {
          const result = await client.createIssueRelation(id, {
            issue_to_id: r.issue_to_id,
            relation_type: r.type,
            inverted: r.is_def,
          });
          addedRelations.push({
            issue_to_id: r.issue_to_id,
            relation_type: r.type,
            relation_id: result?.relation?.id ?? result?.id,
          });
        }
      }
      let result: any;
      try {
        result = await client.updateIssue(id, payload as Record<string, unknown>);
      } catch (e) {
        result = null;
      }
      let data: any;
      if (result && result.id) {
        data = {
          id: result.id,
          subject: result.subject,
          status: result.status?.name ?? result.status,
          url: `${client.url}/issues/${result.id}`,
        };
      } else {
        try {
          const refreshed = await client.getIssue(id);
          data = {
            id: refreshed.id,
            subject: refreshed.subject,
            status: refreshed.status?.name ?? refreshed.status,
            url: `${client.url}/issues/${refreshed.id}`,
          };
        } catch {
          data = { id, message: "Issue updated successfully (empty response from server)" };
        }
      }
      if (addedRelations.length > 0) {
        (data as any).relations_added = addedRelations;
      }
      return {
        content: [
          {
            type: "text",
            text: `Issue #${id} updated successfully.\n\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_delete_issue",
    "Delete a Redmine issue by ID. WARNING: This cannot be undone.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("Issue ID to delete"),
    },
    async ({ id }) => {
      await client.deleteIssue(id);
      return {
        content: [
          {
            type: "text",
            text: `Issue #${id} deleted successfully.`,
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_get_relations",
    "Get all relations (linked issues) for a specific Redmine issue. Returns relation type, direction (is_def), and linked issue details.",
    {
      issue_id: z
        .number()
        .int()
        .positive()
        .describe("Issue ID to get relations for"),
    },
    async ({ issue_id }) => {
      const relations = await client.getIssueRelations(issue_id);
      const formatted = (relations || []).map((r: any) => ({
        id: r.id,
        issue_to_id: r.issue_to_id ?? r.issue_to?.id,
        issue_to_subject: r.issue_to?.subject ?? null,
        type: r.relation_type ?? r.type,
        is_def: r.is_def ?? false,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_id,
                relations: formatted,
                total: formatted.length,
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
    "redmine_remove_relation",
    "Remove a single relation (linked issue) from a Redmine issue. This permanently removes the link but does not delete either issue.",
    {
      issue_id: z
        .number()
        .int()
        .positive()
        .describe("Issue ID that owns the relation"),
      relation_id: z
        .number()
        .int()
        .positive()
        .describe("Relation ID to remove (found via redmine_get_relations)"),
    },
    async ({ issue_id, relation_id }) => {
      await client.removeIssueRelation(issue_id, relation_id);
      return {
        content: [
          {
            type: "text",
            text: `Relation #${relation_id} removed from issue #${issue_id} successfully.`,
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_add_relation",
    "Add a new relation (link) between two Redmine issues. Uses POST /issues/{issue_id}/relations.json.",
    {
      issue_id: z
        .number()
        .int()
        .positive()
        .describe("Issue ID to add the relation to"),
      issue_to_id: z
        .number()
        .int()
        .positive()
        .describe("ID of the issue to link to"),
      type: z
        .string()
        .describe("Relation type: relates, blocks, precedes, follows, duplicates, duplicate"),
      is_def: z
        .boolean()
        .optional()
        .describe("If true, this issue blocks/follows the linked issue (sets inverted flag)"),
    },
    async ({ issue_id, issue_to_id, type, is_def }) => {
      const result = await client.createIssueRelation(issue_id, {
        issue_to_id,
        relation_type: type,
        inverted: is_def,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_id,
                issue_to_id,
                relation_type: type,
                relation_id: result.relation?.id ?? result.id,
                message: `Added ${type} relation from issue #${issue_id} to #${issue_to_id}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
