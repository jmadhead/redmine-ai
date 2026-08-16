import { z } from "zod";
import { RedmineClient } from "../redmine.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerUsers(server: McpServer, client: RedmineClient) {
  server.tool(
    "redmine_get_user",
    "Get a single Redmine user by ID. Returns full user details including groups and roles.",
    {
      id: z
        .number()
        .int()
        .positive()
        .describe("User numeric ID"),
    },
    async ({ id }) => {
      try {
        const user = await client.getUser(id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: user.id,
                  login: user.login,
                  mail: user.mail,
                  firstname: user.firstname,
                  lastname: user.lastname,
                  name: user.name,
                  groups: user.groups,
                  roles: user.roles,
                  status: user.status?.name ?? user.status,
                  last_login_on: user.last_login_on,
                  created_on: user.created_on,
                  custom_fields: user.custom_fields,
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
                  user: null,
                  _warning: "Failed to get user #" + id + ": " + (err as Error).message,
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
