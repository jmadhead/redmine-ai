import { z } from "zod";
import { RedmineClient } from "../redmine.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerWiki(server: McpServer, client: RedmineClient) {
  server.tool(
    "redmine_list_wiki_pages",
    "List all wiki pages in a Redmine project. Returns page titles, versions, and timestamps. Wiki pages use Redmine's CommonMark Markdown + extensions syntax.",
    {
      project_id: z
        .string()
        .describe("Project identifier or ID"),
    },
    async ({ project_id }) => {
      const result = await client.getWikiPages(project_id);
      const pages = result.map((p) => ({
        title: p.title,
        version: p.version,
        created_on: p.created_on,
        updated_on: p.updated_on,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              project_id,
              wiki_pages: pages,
            }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "redmine_get_wiki_page",
    "Get a single wiki page by title from a Redmine project. Returns the full page content including text, version, author, and comments. The text field uses Redmine's CommonMark Markdown + extensions (wiki links [[Page]], issue links #124, macros {{include()}}, alerts > [!NOTE]).",
    {
      project_id: z
        .string()
        .describe("Project identifier or ID"),
      title: z
        .string()
        .describe("Wiki page title (case-sensitive)"),
    },
    async ({ project_id, title }) => {
      const result = await client.getWikiPage(project_id, title);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                project_id,
                title: result.title,
                text: result.text,
                version: result.version,
                author: result.author,
                comments: result.comments,
                created_on: result.created_on,
                updated_on: result.updated_on,
                parent: result.parent,
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
    "redmine_update_wiki_page",
    "Create or update a wiki page in a Redmine project. If the page exists, it will be updated; otherwise a new page will be created. Requires text field. The text must be in Redmine wiki format (CommonMark Markdown + Redmine extensions).",
    {
      project_id: z
        .string()
        .describe("Project identifier or ID"),
      title: z
        .string()
        .describe("Wiki page title (case-sensitive)"),
      text: z
        .string()
        .describe("Wiki page content in Redmine wiki format. LLMs know CommonMark well (headings #, bold **, italic *, lists, code blocks, blockquotes). Redmine-specific extensions: wiki links [[Page]], wiki links to project [[sandbox:page]], issue links #124 or ##124, user mentions @username, macros {{toc}}, {{include(page)}}, {{child_pages}}, {{issue(123)}}, {{collapse(text)\ncontent\n}}, alerts > [!NOTE]\n> content, inline images ![](url), code highlighting ```ruby ... ```."),
      comments: z
        .string()
        .optional()
        .describe("Edit comment describing the changes made"),
    },
    async ({ project_id, title, text, comments }) => {
      const result = await client.updateWikiPage(project_id, title, {
        text,
        comments,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                project_id,
                title: result.wiki_page?.title ?? result.title ?? title,
                version: result.wiki_page?.version ?? result.version,
                comments: result.wiki_page?.comments ?? comments,
                url: `${client.url}/projects/${encodeURIComponent(project_id)}/wiki/${encodeURIComponent(title)}`,
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
    "redmine_delete_wiki_page",
    "Delete a wiki page from a Redmine project. This cannot be undone.",
    {
      project_id: z
        .string()
        .describe("Project identifier or ID"),
      title: z
        .string()
        .describe("Wiki page title to delete (case-sensitive)"),
    },
    async ({ project_id, title }) => {
      await client.deleteWikiPage(project_id, title);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                project_id,
                title,
                message: `Wiki page '${title}' deleted successfully.`,
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
    "redmine_get_wiki_syntax",
    "Get a complete reference of Redmine wiki format syntax. Use this when creating wiki content to ensure correct formatting. Returns CommonMark Markdown syntax + Redmine extensions.",
    {},
    async () => {
      const syntax = `# Redmine Wiki Format Reference

## CommonMark Markdown (LLMs know this well)

### Headings
# Heading 1
## Heading 2
### Heading 3

### Text styling
**bold**, *italic*, ***bold italic***, ~~strike-through~~

### Lists
* bullet list
1. numbered list
- also bullet

### Code blocks
\`\`\`ruby
code here
\`\`\`

### Blockquotes
> quoted text

### Alerts
> [!NOTE]
> Note text

> [!TIP]
> Tip text

> [!IMPORTANT]
> Important text

> [!CAUTION]
> Caution text

> [!WARNING]
> Warning text

### Tables
| Col1 | Col2 |
|------|------|
| cell | cell |

### Links
[Text](https://url.com)

### Horizontal rule
---

### Inline images
![](image_url)

---

## Redmine Extensions

### Wiki links
[[Page]] — link to page in same project
[[#anchor]] — link to heading anchor on current page
[[sandbox:page]] — link to page in another project
[[sandbox:]] — link to sandbox project wiki main page
[[Page|display text]] — custom link text

### Issue links
#124 — link to issue (strikethrough if closed)
##124 — link to issue with tracker name (#124: subject)
#124-6 — link to issue note
#note-6 — link to note in current issue

### User mentions
@username — mention a user

### Macros
{{toc}} — table of contents
{{>toc}} — right-aligned TOC
{{include(Page)}} — include another wiki page
{{include(project:Page)}} — include from another project
{{child_pages}} — list child pages
{{child_pages(depth=2)}} — limit nesting depth
{{collapse(Click to expand)
Collapsed content here
}}
{{thumbnail(image.png, size=200)}} — clickable image thumbnail
{{issue(123)}} — issue link with flexible formatting
{{issue(123, project=true)}} — include project name
{{recent_pages}} — recently updated pages
{{recent_pages(days=3)}} — custom time range
{{macro_list}} — list all available macros

### Other resource links
document:Doc Title — link to document
version:1.0.0 — link to version
r758 — link to changeset
commit:abc123 — link to commit by hash
source:path/to/file — link to repository file
@username — mention user

### URLs and emails
https://example.com — auto-linked
user@example.com — auto-linked

### Custom link for URLs
[Display text](https://example.com)

### Inline images (attached)
![](attached_image.png) — reference attached image
`
      return {
        content: [
          {
            type: "text",
            text: syntax,
          },
        ],
      };
    }
  );
}
