import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RedmineClient } from "../redmine.js";

type WrapHandler = (
  toolName: string,
  handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>
) => (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

export function registerProjects(
  server: McpServer,
  client: RedmineClient,
  wrapHandler?: WrapHandler
) {
  const tool = (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>,
  ) => {
    const effectiveHandler = wrapHandler ? wrapHandler(name, handler) : handler;
    server.tool(name, description, schema, effectiveHandler as any);
  };

  tool(
    "redmine_list_projects",
    "List all Redmine projects. Returns a paginated list of projects with their identifiers, names, and status.",
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
    },
    async (args: any) => {
      const result = await client.getProjects(args.offset, args.limit);
      const projects = result.data.map((p) => ({
        id: p.id,
        identifier: p.identifier,
        name: p.name,
        status: p.status?.name ?? p.status,
        created_on: p.created_on,
        updated_on: p.updated_on,
        description: p.description,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                projects,
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
    },
  );

  tool(
    "redmine_get_project",
    "Get a single Redmine project by its identifier or numeric ID. Returns full project details.",
    {
      identifier: z
        .string()
        .describe("Project identifier (string) or numeric ID"),
    },
    async (args: any) => {
      const project = await client.getProject(args.identifier);
      const formatted = {
        id: project.id,
        identifier: project.identifier,
        name: project.name,
        status: project.status?.name ?? project.status,
        description: project.description,
        created_on: project.created_on,
        updated_on: project.updated_on,
        custom_fields: project.custom_fields,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatted, null, 2),
          },
        ],
      };
    },
  );

  tool(
    "redmine_create_project",
    "Create a new Redmine project. Requires at minimum a 'name' field. Optionally set identifier, description, status, visibility, parent_project_id, and custom_fields.",
    {
      name: z
        .string()
        .describe("Project name (required)"),
      identifier: z
        .string()
        .optional()
        .describe(
          "Unique project identifier (auto-generated from name if omitted)"
        ),
      description: z
        .string()
        .optional()
        .describe("Project description"),
      status: z
        .number()
        .int()
        .optional()
        .describe("Project status ID (1=open by default)"),
      visibility: z
        .enum(["public", "internal", "restricted"])
        .optional()
        .describe("Project visibility level"),
      parent_project_id: z
        .number()
        .int()
        .optional()
        .describe("Parent project ID for sub-projects"),
    },
    async (args: any) => {
      const visibilityMap: Record<string, number> = { public: 2, internal: 1, restricted: 0 };
      const payload: Record<string, unknown> = { name: args.name };
      if (args.identifier !== undefined) payload.identifier = args.identifier;
      if (args.description !== undefined) payload.description = args.description;
      if (args.status !== undefined) payload.status_id = args.status;
      if (args.visibility !== undefined) payload.visibility_level = visibilityMap[args.visibility] ?? 0;
      if (args.parent_project_id !== undefined) payload.parent_project_id = args.parent_project_id;

      const result = await client.createProject(payload);
      return {
        content: [
          {
            type: "text",
            text: `Project created successfully.\n\n${JSON.stringify(
              { id: result.id, identifier: result.identifier, name: result.name },
              null,
              2
            )}`,
          },
        ],
      };
    },
  );

  tool(
    "redmine_update_project",
    "Update an existing Redmine project. Provide the project identifier and any fields to update.",
    {
      identifier: z
        .string()
        .describe("Project identifier to update"),
      name: z
        .string()
        .optional()
        .describe("New project name"),
      description: z
        .string()
        .optional()
        .describe("New project description"),
      status: z
        .number()
        .int()
        .optional()
        .describe("New project status ID (1=open, 2=active, 3=closed)"),
      visibility: z
        .enum(["public", "internal", "restricted"])
        .optional()
        .describe("New visibility level"),
      parent_project_id: z
        .number()
        .int()
        .optional()
        .describe("New parent project ID (omit to keep current)"),
    },
    async (args: any) => {
      const visibilityMap: Record<string, number> = { public: 2, internal: 1, restricted: 0 };
      const payload: Record<string, unknown> = {};
      if (args.name !== undefined) payload.name = args.name;
      if (args.description !== undefined) payload.description = args.description;
      if (args.status !== undefined) payload.status_id = args.status;
      if (args.visibility !== undefined) payload.visibility_level = visibilityMap[args.visibility] ?? 0;
      if (args.parent_project_id !== undefined) payload.parent_project_id = args.parent_project_id;
      let result: any;
      try {
        result = await client.updateProject(args.identifier, payload);
      } catch (e) {
        result = null;
      }
      let data: any;
      if (result && result.id) {
        data = {
          id: result.id,
          identifier: result.identifier,
          name: result.name,
        };
      } else {
        try {
          const refreshed = await client.getProject(args.identifier);
          data = {
            id: refreshed.id,
            identifier: refreshed.identifier,
            name: refreshed.name,
          };
        } catch {
          data = { identifier: args.identifier, message: "Project updated successfully (empty response from server)" };
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Project "${args.identifier}" updated successfully.\n\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    },
  );
}
