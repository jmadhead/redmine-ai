import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RedmineClient } from "../redmine.js";

type WrapHandler = (
  toolName: string,
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
) => (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function unwrapEntity(response: any): Record<string, any> {
  return response?.issue ?? response?.time_entry ?? response ?? {};
}

async function resolveStatusId(client: RedmineClient, status: string): Promise<number> {
  const statuses = await client.getIssueStatuses();
  const numeric = parseInt(status, 10);
  const lower = status.toLowerCase();
  const exact = statuses.find(
    (s) => s.id === numeric || String(s.name).toLowerCase() === lower
  );
  const match = exact ?? statuses.find((s) => String(s.name).toLowerCase().includes(lower));
  if (!match) {
    throw new Error(
      `Status '${status}' not found. Available: ${statuses.map((s) => s.name).join(", ")}`
    );
  }
  return match.id;
}

async function resolveClosedStatusId(client: RedmineClient): Promise<number> {
  const statuses = await client.getIssueStatuses();
  const closed = statuses.find((s) => s.is_closed === true) ?? statuses.find((s) => s.id === 3);
  if (!closed) throw new Error("No closed issue status found in Redmine.");
  return closed.id;
}

export function registerWorkflows(server: McpServer, client: RedmineClient, wrapHandler?: WrapHandler) {
  const tool = (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    handler: (args: any) => Promise<{ content: Array<{ type: string; text: string }> }>
  ) => {
    const effectiveHandler = wrapHandler ? wrapHandler(name, handler) : handler;
    server.tool(name, description, schema, effectiveHandler as any);
  };

  tool(
    "redmine_transition_issue",
    "Move an issue to a new status (by ID or name) while adding a private note and optionally setting progress or changing the assignee, all in a single call. Status names are resolved automatically.",
    {
      issue_id: z.number().int().positive().describe("Issue ID to transition"),
      status: z.string().describe("Target status: numeric ID or name. Names match case-insensitively on substring (e.g. 'In Progress', 'ai:Review')."),
      notes: z.string().optional().describe("Journal note to add on transition"),
      done_ratio: z.number().int().min(0).max(100).optional().describe("Completion percentage (0-100)"),
      assignee_id: z.number().int().optional().describe("New assignee user ID"),
    },
    async ({ issue_id, status, notes, done_ratio, assignee_id }) => {
      const prior = await client.getIssue(issue_id);
      const statusId = await resolveStatusId(client, status as string);

      const payload: Record<string, unknown> = { status_id: statusId };
      if (notes !== undefined) payload.notes = notes;
      if (done_ratio !== undefined) payload.done_ratio = done_ratio;
      if (assignee_id !== undefined) payload.assignee_id = assignee_id;
      await client.updateIssue(issue_id, payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_id,
                previous_status: prior.status?.name ?? prior.status_id,
                new_status: status,
                notes_added: notes ?? null,
                done_ratio: done_ratio ?? prior.done_ratio ?? null,
                assignee_id: assignee_id ?? null,
                url: `${client.url}/issues/${issue_id}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  tool(
    "redmine_issue_workflow",
    "Get the full working context of an issue in one call: description, latest notes, child tasks, related issues, and total hours logged. Ideal before implementing or reviewing a ticket.",
    {
      issue_id: z.number().int().positive().describe("Issue ID to analyze"),
    },
    async ({ issue_id }) => {
      const [issue, relations] = await Promise.all([
        client.getIssue(issue_id),
        client.getIssueRelations(issue_id).catch(() => []),
      ]);
      const entries = await client
        .getTimeEntries(0, 100, { issue_id: String(issue_id) })
        .catch(() => ({ data: [], offset: 0, limit: 100, total: 0 }));

      const children = (issue.children || []).map((c: any) => ({
        id: c.id,
        subject: c.subject,
        status: c.status?.name ?? c.status,
        tracker: c.tracker?.name ?? c.tracker,
      }));

      const hours = entries.data.reduce((acc, e) => acc + (e.hours || 0), 0);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: issue.id,
                project: issue.project?.name ?? issue.project,
                project_id: issue.project?.id ?? issue.project_id ?? null,
                tracker: issue.tracker?.name ?? issue.tracker,
                tracker_id: issue.tracker?.id ?? issue.tracker_id ?? null,
                status: issue.status?.name ?? issue.status,
                status_id: issue.status?.id ?? issue.status_id ?? null,
                priority: issue.priority?.name ?? issue.priority,
                priority_id: issue.priority?.id ?? issue.priority_id ?? null,
                subject: issue.subject,
                description: issue.description,
                assignee: issue.assigned_to?.name ?? issue.assigned_to,
                assignee_id: issue.assigned_to?.id ?? issue.assigned_to_id ?? null,
                author: issue.author?.name ?? issue.author,
                start_date: issue.start_date,
                due_date: issue.due_date,
                done_ratio: issue.done_ratio,
                created_on: issue.created_on,
                updated_on: issue.updated_on,
                notes: (issue.journals || []).map((j: any) => j.notes).filter(Boolean).join("\n"),
                relations: (relations || []).map((r: any) => ({
                  id: r.id,
                  issue_to_id: r.issue_to_id ?? r.issue_to?.id,
                  issue_to_subject: r.issue_to?.subject ?? null,
                  type: r.relation_type ?? r.type,
                  is_def: r.is_def ?? false,
                })),
                children,
                time_spent: {
                  total_hours: hours,
                  entries: entries.data.map((e) => ({
                    id: e.id,
                    date: e.spent_on,
                    hours: e.hours,
                    activity: e.activity?.name ?? e.activity,
                    user: e.user?.name ?? e.user,
                    comment: e.comment ?? e.comments ?? null,
                  })),
                },
                custom_fields: issue.custom_fields,
                url: `${client.url}/issues/${issue.id}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  tool(
    "redmine_project_overview",
    "Get a health snapshot of a project in one call: metadata, open vs closed issue counts grouped by tracker, overdue and due-soon items, issue categories, and the wiki index.",
    {
      project_id: z.string().describe("Project ID, identifier, or name"),
    },
    async ({ project_id }) => {
      const project = await client.getProject(project_id as string);
      const projectId = String(project.id);

      const [openResult, closedResult, categories, wiki] = await Promise.all([
        client.getIssues(0, 100, { project_id: projectId, status_id: "open" }).catch(() => ({ data: [] as any[], offset: 0, limit: 0, total: 0 })),
        client.getIssues(0, 100, { project_id: projectId, status_id: "closed" }).catch(() => ({ data: [] as any[], offset: 0, limit: 0, total: 0 })),
        client.getIssueCategories(projectId).catch(() => []),
        client.getWikiPages(projectId).catch(() => []),
      ]);

      const byTracker = (issues: any[]) => {
        const counts: Record<string, { total: number; ids: number[] }> = {};
        for (const i of issues) {
          const name = i.tracker?.name ?? String(i.tracker);
          counts[name] = counts[name] ?? { total: 0, ids: [] };
          counts[name].total += 1;
          counts[name].ids.push(i.id);
        }
        return counts;
      };

      const openIssues = openResult.data;
      const today = new Date().toISOString().slice(0, 10);
      const overdue = openIssues.filter((i) => i.due_date && String(i.due_date) < today);
      const dueSoon = openIssues.filter((i) => {
        if (!i.due_date) return false;
        const diff = (new Date(String(i.due_date)).getTime() - Date.now()) / 86400000;
        return diff >= 0 && diff <= 7;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                project: {
                  id: project.id,
                  identifier: project.identifier,
                  name: project.name,
                  description: project.description,
                  status: project.status?.name ?? project.status,
                  url: `${client.url}/projects/${project.identifier}`,
                },
                issue_counts: {
                  open: openResult.total,
                  closed: closedResult.total,
                },
                open_by_tracker: byTracker(openIssues),
                closed_by_tracker: byTracker(closedResult.data),
                overdue_issues: overdue.map((i) => ({ id: i.id, subject: i.subject, due_date: i.due_date })),
                due_soon_issues: dueSoon.map((i) => ({ id: i.id, subject: i.subject, due_date: i.due_date })),
                categories: categories.map((c) => ({ id: c.id, name: c.name, assigned_to: c.assigned_to })),
                wiki_pages: wiki.map((p) => ({ title: p.title, version: p.version, updated_on: p.updated_on })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  tool(
    "redmine_log_work",
    "Log time against an issue and optionally move it to a new status with a note and progress, all in a single call. Status can be given by ID or name.",
    {
      issue_id: z.number().int().positive().describe("Issue ID the time is tracked against"),
      hours: z.number().positive().describe("Time spent in hours (e.g. 1.5 for 1 hour 30 min)"),
      activity_id: z.number().int().optional().describe("Time entry activity ID"),
      comment: z.string().optional().describe("Comment for the time entry"),
      spent_on: z.string().optional().describe("Date of the time entry (YYYY-MM-DD, defaults to today)"),
      status: z.string().optional().describe("Optional new status ID or name to set alongside the time entry. Names match case-insensitively on substring."),
      notes: z.string().optional().describe("Optional journal note to add to the issue"),
      done_ratio: z.number().int().min(0).max(100).optional().describe("Completion percentage (0-100)"),
    },
    async ({ issue_id, hours, activity_id, comment, spent_on, status, notes, done_ratio }) => {
      const results: Record<string, unknown> = {};

      const updatePayload: Record<string, unknown> = {};
      if (status !== undefined) updatePayload.status_id = await resolveStatusId(client, status as string);
      if (done_ratio !== undefined) updatePayload.done_ratio = done_ratio;
      if (notes !== undefined) updatePayload.notes = notes;
      if (Object.keys(updatePayload).length > 0) {
        await client.updateIssue(issue_id, updatePayload);
        results.issue_updated = {
          status: status ?? null,
          done_ratio: done_ratio ?? null,
          notes_added: notes ?? null,
        };
      }

      const entryPayload: Record<string, unknown> = { issue_id, hours, comments: comment };
      if (activity_id !== undefined) entryPayload.activity_id = activity_id;
      if (spent_on !== undefined) entryPayload.spent_on = spent_on;
      const entry = unwrapEntity(await client.createTimeEntry(entryPayload));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_id,
                time_entry: {
                  id: entry.id,
                  hours: entry.hours ?? hours,
                  comment: comment ?? null,
                  spent_on: entry.spent_on ?? spent_on ?? null,
                  url: `${client.url}/time_entries/${entry.id}`,
                },
                ...results,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  tool(
    "redmine_complete_issue",
    "Close out an issue in one call: sets the first closed status and 100% progress, logs any remaining time, adds a final note, and optionally closes open subtasks.",
    {
      issue_id: z.number().int().positive().describe("Issue ID to complete"),
      remaining_hours: z.number().positive().optional().describe("Remaining time to log against the issue on completion"),
      activity_id: z.number().int().optional().describe("Time entry activity ID (required if remaining_hours is set)"),
      final_note: z.string().optional().describe("Final journal note (defaults to 'Completed.')"),
      close_children: z.boolean().optional().describe("Also close all open subtasks (default false)"),
    },
    async ({ issue_id, remaining_hours, activity_id, final_note, close_children }) => {
      const issue = await client.getIssue(issue_id);
      const closedStatusId = await resolveClosedStatusId(client);
      const note = (final_note as string | undefined) ?? "Completed.";

      if (remaining_hours !== undefined && activity_id === undefined) {
        return {
          content: [
            {
              type: "text",
              text: "Error: activity_id is required when remaining_hours is set, to log the remaining time.",
            },
          ],
        };
      }

      await client.updateIssue(issue_id, {
        status_id: closedStatusId,
        done_ratio: 100,
        notes: note,
      });

      const results: Record<string, unknown> = {};

      if (remaining_hours !== undefined) {
        const entry = unwrapEntity(await client.createTimeEntry({ issue_id, hours: remaining_hours, comments: note, activity_id }));
        results.remaining_time_entry = { id: entry.id, hours: remaining_hours };
      }

      const children = issue.children || [];
      if (close_children && children.length > 0) {
        const closed: unknown[] = [];
        for (const c of children) {
          try {
            await client.updateIssue(c.id, { status_id: closedStatusId });
            closed.push({ id: c.id, subject: c.subject });
          } catch {
            closed.push({ id: c.id, subject: c.subject, error: "failed to close" });
          }
        }
        results.closed_children = closed;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                issue_id,
                subject: issue.subject,
                status_id: closedStatusId,
                done_ratio: 100,
                final_note: note,
                ...results,
                url: `${client.url}/issues/${issue_id}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  tool(
    "redmine_create_issue_tree",
    "Create a parent issue plus a list of subtasks in a single call. Returns IDs and URLs for the whole tree.",
    {
      project_id: z.string().describe("Project ID or identifier"),
      subject: z.string().describe("Subject of the parent issue"),
      description: z.string().optional().describe("Description for the parent issue"),
      assignee_id: z.number().int().optional().describe("Assignee for the parent issue"),
      priority_id: z.number().int().optional().describe("Priority for the parent issue"),
      tracker_id: z.number().int().optional().describe("Tracker for the parent issue"),
      category_id: z.number().int().optional().describe("Category for the parent issue"),
      status_id: z.number().int().optional().describe("Status for the parent issue"),
      custom_fields: z
        .array(
          z.object({
            id: z.number(),
            value: z.unknown(),
          })
        )
        .optional()
        .describe("Custom field values for the parent issue, e.g. Task Type"),
      children: z
        .array(
          z.object({
            subject: z.string().describe("Subtask subject"),
            description: z.string().optional(),
            assignee_id: z.number().int().optional(),
            priority_id: z.number().int().optional(),
            tracker_id: z.number().int().optional(),
            category_id: z.number().int().optional(),
            status_id: z.number().int().optional(),
            start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
            due_date: z.string().optional().describe("Due date (YYYY-MM-DD)"),
            custom_fields: z
              .array(
                z.object({
                  id: z.number(),
                  value: z.unknown(),
                })
              )
              .optional()
              .describe("Custom field values for the subtask, e.g. Task Type"),
          })
        )
        .describe("Subtask definitions linked to the parent issue"),
    },
    async ({ project_id, subject, description, assignee_id, priority_id, tracker_id, category_id, status_id, custom_fields, children }) => {
      const parentPayload: Record<string, unknown> = { project_id, subject };
      if (description !== undefined) parentPayload.description = description;
      if (assignee_id !== undefined) parentPayload.assignee_id = assignee_id;
      if (priority_id !== undefined) parentPayload.priority_id = priority_id;
      if (tracker_id !== undefined) parentPayload.tracker_id = tracker_id;
      if (category_id !== undefined) parentPayload.category_id = category_id;
      if (status_id !== undefined) parentPayload.status_id = status_id;
      if (custom_fields !== undefined) parentPayload.custom_fields = custom_fields;
      const parent = unwrapEntity(await client.createIssue(parentPayload));

      const createdChildren: unknown[] = [];
      for (const child of (children as any[]) || []) {
        const payload: Record<string, unknown> = {
          project_id,
          parent_issue_id: parent.id,
          subject: child.subject,
        };
        for (const key of ["description", "assignee_id", "priority_id", "tracker_id", "category_id", "status_id", "start_date", "due_date", "custom_fields"]) {
          if (child[key] !== undefined) payload[key] = child[key];
        }
        const created = unwrapEntity(await client.createIssue(payload));
        createdChildren.push({
          id: created.id,
          subject: created.subject,
          url: `${client.url}/issues/${created.id}`,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                parent: {
                  id: parent.id,
                  subject: parent.subject,
                  url: `${client.url}/issues/${parent.id}`,
                },
                created_children: createdChildren,
                total_created: createdChildren.length + 1,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  tool(
    "redmine_my_work_dashboard",
    "Daily stand-up summary: open issues assigned to a user (defaults to the current API user) with due dates, plus hours logged in a date range aggregated by issue and date.",
    {
      assignee_id: z.string().optional().describe("Assignee user ID; omit or pass 'me' for the current API user"),
      from: z.string().optional().describe("Start date for time entries (YYYY-MM-DD)"),
      to: z.string().optional().describe("End date for time entries (YYYY-MM-DD)"),
    },
    async ({ assignee_id, from, to }) => {
      let userId: number;
      if (assignee_id === undefined || assignee_id === "me") {
        const current = await client.getCurrentUser();
        userId = current.id;
      } else {
        userId = parseInt(assignee_id as string, 10);
      }

      const filters: Record<string, string> = { user_id: String(userId) };
      if (from !== undefined) filters.from = from as string;
      if (to !== undefined) filters.to = to as string;

      const [issues, entries] = await Promise.all([
        client.getIssues(0, 100, { assignee_id: String(userId), status_id: "open" }).catch(() => ({ data: [] as any[], offset: 0, limit: 0, total: 0 })),
        client.getTimeEntries(0, 100, filters).catch(() => ({ data: [], offset: 0, limit: 0, total: 0 })),
      ]);

      const byProject: Record<string, { hours: number; issue_ids: number[] }> = {};
      const byDate: Record<string, number> = {};
      for (const e of entries.data) {
        const projName = String(e.project?.name ?? e.project);
        byProject[projName] = byProject[projName] ?? { hours: 0, issue_ids: [] };
        byProject[projName].hours += e.hours || 0;
        if (e.issue?.id) byProject[projName].issue_ids.push(e.issue.id);
        const date = e.spent_on ?? e.created_on;
        if (date) byDate[String(date)] = (byDate[String(date)] ?? 0) + (e.hours || 0);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                assignee_id: userId,
                open_issues: issues.data
                  .map((i) => ({
                    id: i.id,
                    subject: i.subject,
                    status: i.status?.name ?? i.status,
                    priority: i.priority?.name ?? i.priority,
                    due_date: i.due_date ?? null,
                    done_ratio: i.done_ratio,
                    project: i.project?.name ?? i.project,
                    url: `${client.url}/issues/${i.id}`,
                  }))
                  .sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999"))),
                time_logged: {
                  total_entries: entries.total,
                  total_hours: entries.data.reduce((acc, e) => acc + (e.hours || 0), 0),
                },
                hours_by_project: byProject,
                hours_by_date: byDate,
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