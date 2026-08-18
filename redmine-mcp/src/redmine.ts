import { z } from "zod";

export interface RedmineConfig {
  url: string;
  apiKey: string;
}

interface RedmineResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  offset: number;
  limit: number;
  total: number;
}

export type RedmineIssue = Record<string, any>;
export type RedmineProject = Record<string, any>;
export type RedmineUser = Record<string, any>;
export type RedmineTimeEntry = Record<string, any>;
export type RedmineIssueStatus = Record<string, any>;
export type RedmineTracker = Record<string, any>;
export type RedmineIssueCategory = Record<string, any>;

export const fetchImpl: { fn: typeof fetch } = { fn: globalThis.fetch.bind(globalThis) };

function buildUrl(config: RedmineConfig, path: string): string {
  const base = config.url.replace(/\/+$/, "");
  return `${base}${path}`;
}

async function redmineRequest<T>(
  config: RedmineConfig,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<T> {
  const url = buildUrl(config, path);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Redmine-API-Key": config.apiKey,
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body && (method === "POST" || method === "PUT")) {
    const parts = path.split("/");
    const resourceName = parts[1]?.replace(/\.json$/, "");
    const wikiMatch = path.match(/\/wiki\/[^/]+\.json$/);
    const bodyKey = wikiMatch
      ? "wiki_page"
      : ({
          issues: "issue",
          projects: "project",
          time_entries: "time_entry",
          users: "user",
        }[resourceName] ?? resourceName);
    options.body = JSON.stringify({ [bodyKey]: body });
  }

  console.log('[REDMINE] redmineRequest:', method, path);
  const response = await fetchImpl.fn(url, options);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const statusText = response.status === 404 ? "Not Found" : response.statusText;
    const message = errorText ? `Redmine API error (${response.status}): ${statusText} - ${errorText.slice(0, 500)}` : `Redmine API error (${response.status}): ${statusText}`;
    throw new Error(message);
  }

  const text = await response.text();
  if (!text) return null as T;
  try {
    const json: T = JSON.parse(text);
    return json;
  } catch {
    return null as T;
  }
}

function paginate<T>(
  data: T[],
  offset: number,
  limit: number
): PaginatedResponse<T> {
  const total = data.length;
  const slice = data.slice(offset, offset + limit);
  return { data: slice, offset, limit, total };
}

export class RedmineClient {
  private config: RedmineConfig;

  constructor(config: RedmineConfig) {
    this.config = config;
  }

  get url(): string {
    return this.config.url;
  }

  async getIssues(
    offset = 0,
    limit = 25,
    filters: Record<string, string> = {}
  ): Promise<PaginatedResponse<RedmineIssue>> {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });

    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }

    const path = `/issues.json?${params.toString()}`;
    const response = await redmineRequest<{
      issues: RedmineIssue[];
      offset: number;
      limit: number;
      total_count: number;
    }>(this.config, path);
    const {
      offset: respOffset,
      limit: respLimit,
      issues,
      total_count,
    } = response;
    return {
      data: issues,
      offset: respOffset ?? offset,
      limit: respLimit ?? limit,
      total: total_count ?? issues.length,
    };
  }

  async getIssue(id: number): Promise<RedmineIssue> {
    const response = await redmineRequest<{ issue: RedmineIssue }>(
      this.config,
      `/issues/${id}.json?include=children`
    );
    return response.issue;
  }

  async createIssue(payload: Record<string, unknown>): Promise<RedmineIssue> {
    return redmineRequest(
      this.config,
      "/issues.json",
      "POST",
      payload
    );
  }

  async updateIssue(
    id: number,
    payload: Record<string, unknown>
  ): Promise<RedmineIssue> {
    return redmineRequest(
      this.config,
      `/issues/${id}.json`,
      "PUT",
      payload
    );
  }

  async deleteIssue(id: number): Promise<void> {
    await redmineRequest(this.config, `/issues/${id}.json`, "DELETE");
  }

  async getIssueRelations(issueId: number): Promise<any[]> {
    const response = await redmineRequest<{ relations: any[] }>(
      this.config,
      `/issues/${issueId}/relations.json`
    );
    return response.relations || [];
  }

  async removeIssueRelation(issueId: number, relationId: number): Promise<void> {
    await redmineRequest(
      this.config,
      `/relations/${relationId}.json`,
      "DELETE"
    );
  }

  async createIssueRelation(
    issueId: number,
    relation: { issue_to_id: number; relation_type: string; inverted?: boolean }
  ): Promise<any> {
    const { config } = this;
    const url = `${config.url}/issues/${issueId}/relations.json`;
    const headers = {
      "Content-Type": "application/json",
      "X-Redmine-API-Key": config.apiKey,
    };
    const body = { relation };
    const response = await fetchImpl.fn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const statusText = response.status === 404 ? "Not Found" : response.statusText;
      const message = errorText ? `Redmine API error (${response.status}): ${statusText} - ${errorText.slice(0, 500)}` : `Redmine API error (${response.status}): ${statusText}`;
      throw new Error(message);
    }

    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async getProjects(
    offset = 0,
    limit = 25
  ): Promise<PaginatedResponse<RedmineProject>> {
    const path = `/projects.json?offset=${offset}&limit=${limit}`;
    const response = await redmineRequest<{
      projects: RedmineProject[];
      limit: number;
      offset: number;
      total_count: number;
    }>(this.config, path);
    return {
      data: response.projects,
      offset: response.offset,
      limit: response.limit,
      total: response.total_count,
    };
  }

  async getProject(identifier: string): Promise<RedmineProject> {
    const response = await redmineRequest<{ project: RedmineProject }>(
      this.config,
      `/projects/${encodeURIComponent(identifier)}.json`
    );
    return response.project;
  }

  async createProject(payload: Record<string, unknown>): Promise<RedmineProject> {
    const response = await redmineRequest<{ project: RedmineProject }>(
      this.config,
      "/projects.json",
      "POST",
      payload
    );
    return response.project;
  }

  async updateProject(
    identifier: string,
    payload: Record<string, unknown>
  ): Promise<RedmineProject> {
    const response = await redmineRequest<{ project: RedmineProject }>(
      this.config,
      `/projects/${encodeURIComponent(identifier)}.json`,
      "PUT",
      payload
    );
    return response.project;
  }

  async getUsers(
    offset = 0,
    limit = 25
  ): Promise<PaginatedResponse<RedmineUser>> {
    const path = `/users.json?offset=${offset}&limit=${limit}`;
    const response = await redmineRequest<{
      users: RedmineUser[];
      limit: number;
      offset: number;
      total_count: number;
    }>(this.config, path);
    return {
      data: response.users,
      offset: response.offset,
      limit: response.limit,
      total: response.total_count,
    };
  }

  async getUser(id: number): Promise<RedmineUser> {
    const response = await redmineRequest<{ user: RedmineUser }>(
      this.config,
      `/users/${id}.json`
    );
    return response.user;
  }

  async getTimeEntries(
    offset = 0,
    limit = 25,
    filters: Record<string, string> = {}
  ): Promise<PaginatedResponse<RedmineTimeEntry>> {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(limit),
    });

    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        params.set(key, value);
      }
    }

    const path = `/time_entries.json?${params.toString()}`;
    const response = await redmineRequest<{
      time_entries: RedmineTimeEntry[];
      limit: number;
      offset: number;
      total_count: number;
    }>(this.config, path);
    return {
      data: response.time_entries,
      offset: response.offset,
      limit: response.limit,
      total: response.total_count,
    };
  }

  async getTimeEntry(id: number): Promise<RedmineTimeEntry> {
    return redmineRequest(this.config, `/time_entries/${id}.json`);
  }

  async createTimeEntry(
    payload: Record<string, unknown>
  ): Promise<RedmineTimeEntry> {
    return redmineRequest(this.config, "/time_entries.json", "POST", payload);
  }

  async updateTimeEntry(
    id: number,
    payload: Record<string, unknown>
  ): Promise<RedmineTimeEntry> {
    return redmineRequest(
      this.config,
      `/time_entries/${id}.json`,
      "PUT",
      payload
    );
  }

  async deleteTimeEntry(id: number): Promise<void> {
    await redmineRequest(
      this.config,
      `/time_entries/${id}.json`,
      "DELETE"
    );
  }

  async getWikiPages(projectId: string): Promise<{
    title: string;
    version: number;
    created_on?: string;
    updated_on?: string;
  }[]> {
    const response = await redmineRequest<{
      wiki_pages: {
        title: string;
        version: number;
        created_on?: string;
        updated_on?: string;
      }[];
    }>(this.config, `/projects/${encodeURIComponent(projectId)}/wiki/index.json`);
    return response.wiki_pages;
  }

  async getWikiPage(
    projectId: string,
    title: string
  ): Promise<{
    title: string;
    text: string;
    version: number;
    author?: { id: number; name: string };
    comments?: string;
    created_on?: string;
    updated_on?: string;
    parent?: { title: string };
  }> {
    const response = await redmineRequest<{
      wiki_page: {
        title: string;
        text: string;
        version: number;
        author?: { id: number; name: string };
        comments?: string;
        created_on?: string;
        updated_on?: string;
        parent?: { title: string };
      };
    }>(this.config, `/projects/${encodeURIComponent(projectId)}/wiki/${encodeURIComponent(title)}.json`);
    return response.wiki_page;
  }

  async updateWikiPage(
    projectId: string,
    title: string,
    body: { text: string; comments?: string }
  ): Promise<any> {
    return redmineRequest(
      this.config,
      `/projects/${encodeURIComponent(projectId)}/wiki/${encodeURIComponent(title)}.json`,
      "PUT",
      body
    );
  }

  async deleteWikiPage(
    projectId: string,
    title: string
  ): Promise<void> {
    await redmineRequest(
      this.config,
      `/projects/${encodeURIComponent(projectId)}/wiki/${encodeURIComponent(title)}.json`,
      "DELETE"
    );
  }

  async getIssueStatuses(): Promise<RedmineIssueStatus[]> {
    const response = await redmineRequest<{
      issue_statuses: RedmineIssueStatus[];
    }>(this.config, "/issue_statuses.json");
    return response.issue_statuses;
  }

  async getTrackers(): Promise<RedmineTracker[]> {
    const response = await redmineRequest<{ trackers: RedmineTracker[] }>(
      this.config,
      "/trackers.json"
    );
    return response.trackers;
  }

  async getIssueCategories(
    projectId: string
  ): Promise<RedmineIssueCategory[]> {
    const response = await redmineRequest<{
      issue_categories: RedmineIssueCategory[];
    }>(
      this.config,
      `/projects/${encodeURIComponent(projectId)}/issue_categories.json`
    );
    return response.issue_categories;
  }

  async getIssueStatusesSafe(): Promise<RedmineIssueStatus[]> {
    try {
      return await this.getIssueStatuses();
    } catch {
      return [];
    }
  }

  async getTrackersSafe(): Promise<RedmineTracker[]> {
    try {
      return await this.getTrackers();
    } catch {
      return [];
    }
  }

  async getUserSafe(id: number): Promise<RedmineUser | null> {
    try {
      return await this.getUser(id);
    } catch {
      return null;
    }
  }

  async getIssueCategoriesForProject(
    projectId: string
  ): Promise<RedmineIssueCategory[]> {
    try {
      return await this.getIssueCategories(projectId);
    } catch {
      return [];
    }
  }

  async getContext(projectId?: string): Promise<{
    projects: RedmineProject[];
    issue_statuses: RedmineIssueStatus[];
    trackers: RedmineTracker[];
    issue_categories: Record<string, RedmineIssueCategory[]>;
  }> {
    let projects: RedmineProject[] = [];
    try {
      const projectsResult = await this.getProjects(0, 100);
      projects = projectsResult.data;
    } catch (err) {
      console.error("Failed to fetch projects for context:", err);
    }

    const [issue_statuses, trackers] = await Promise.all([
      this.getIssueStatusesSafe(),
      this.getTrackersSafe(),
    ]);

    const issue_categories: Record<string, RedmineIssueCategory[]> = {};
    const targetProjects = projectId
      ? projects.filter(
          (p) =>
            p.id === parseInt(projectId) ||
            p.identifier === projectId ||
            p.name === projectId
        )
      : projects;

    await Promise.all(
      targetProjects.map(async (p) => {
        const cats = await this.getIssueCategoriesForProject(String(p.id));
        if (cats.length > 0) {
          issue_categories[String(p.id)] = cats;
        }
      })
    );

    return {
      projects,
      issue_statuses,
      trackers,
      issue_categories,
    };
  }
}
