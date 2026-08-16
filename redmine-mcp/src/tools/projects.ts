import { z } from "zod";
import { RedmineClient } from "../redmine.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerProjects(server: McpServer, client: RedmineClient) {
  server.tool(
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
    async ({ offset, limit }) => {
      const result = await client.getProjects(offset, limit);
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
    }
  );

  server.tool(
    "redmine_get_project",
    "Get a single Redmine project by its identifier or numeric ID. Returns full project details.",
    {
      identifier: z
        .string()
        .describe("Project identifier (string) or numeric ID"),
    },
    async ({ identifier }) => {
      const project = await client.getProject(identifier);
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
    }
  );

  server.tool(
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
    async ({ name, identifier, description, status, visibility, parent_project_id }) => {
      const visibilityMap: Record<string, number> = { public: 2, internal: 1, restricted: 0 };
      const payload: Record<string, unknown> = { name };
      if (identifier !== undefined) payload.identifier = identifier;
      if (description !== undefined) payload.description = description;
      if (status !== undefined) payload.status_id = status;
      if (visibility !== undefined) payload.visibility_level = visibilityMap[visibility] ?? 0;
      if (parent_project_id !== undefined) payload.parent_project_id = parent_project_id;

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
    }
  );

  server.tool(
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
    async ({ identifier, name, description, status, visibility, parent_project_id }) => {
      const visibilityMap: Record<string, number> = { public: 2, internal: 1, restricted: 0 };
      const payload: Record<string, unknown> = {};
      if (name !== undefined) payload.name = name;
      if (description !== undefined) payload.description = description;
      if (status !== undefined) payload.status_id = status;
      if (visibility !== undefined) payload.visibility_level = visibilityMap[visibility] ?? 0;
      if (parent_project_id !== undefined) payload.parent_project_id = parent_project_id;
      const result = await client.updateProject(identifier, payload);
      const data = result ? {
        id: result.id,
        identifier: result.identifier,
        name: result.name,
      } : { identifier, message: "Project updated successfully (empty response from server)" };
      return {
        content: [
          {
            type: "text",
            text: `Project "${identifier}" updated successfully.\n\n${JSON.stringify(data, null, 2)}`,
          },
        ],
      };
    }
  );
}
