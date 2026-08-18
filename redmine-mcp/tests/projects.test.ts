import { registerProjects } from '../src/tools/projects';
import { projectFixture } from './fixtures';
import { setupMockResponse } from './helpers/make-fetch-mock';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient, fetchImpl } from '../src/redmine';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

describe('registerProjects', () => {
  let server: any;
  let client: RedmineClient;

  beforeEach(() => {
    server = createMockServer();
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
  });

  it('should register 4 project tools', () => {
    registerProjects(server, client);
    expect(server.tool).toHaveBeenCalledTimes(4);
    expect(server.tool).toHaveBeenCalledWith('redmine_list_projects', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_project', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_create_project', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_update_project', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_list_projects should return formatted projects', async () => {
    registerProjects(server, client);
    const listProjectsCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_list_projects');
    const listProjectsHandler = listProjectsCall[3];

    const projects = [
      projectFixture({ id: 1, name: 'Project 1', identifier: 'proj-1' }),
      projectFixture({ id: 2, name: 'Project 2', identifier: 'proj-2' }),
    ];
    setupMockResponse('/projects.json', {
      projects,
      offset: 0,
      limit: 25,
      total_count: 2,
    });

    const result = await listProjectsHandler({ offset: 0, limit: 25 });
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.projects).toHaveLength(2);
    expect(parsed.pagination.total).toBe(2);
  });

  it('redmine_get_project should return single project', async () => {
    registerProjects(server, client);
    const getProjectCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_project');
    const getProjectHandler = getProjectCall[3];

    const project = projectFixture({ id: 1, name: 'Test Project', identifier: 'test-project' });
    setupMockResponse('/projects/test-project.json', { project });

    const result = await getProjectHandler({ identifier: 'test-project' });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe('Test Project');
  });

  it('redmine_create_project should create project and return result', async () => {
    registerProjects(server, client);
    const createProjectCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_create_project');
    const createProjectHandler = createProjectCall[3];

    const created = projectFixture({ id: 42, name: 'New Project', identifier: 'new-project' });
    setupMockResponse('/projects.json', { project: created });

    const result = await createProjectHandler({
      name: 'New Project',
      identifier: 'new-project',
      description: 'A new project',
      status: 1,
      visibility: 'public',
      parent_project_id: 1,
    });

    expect(result.content[0].type).toBe('text');
    // Handler wraps output with a prefix, extract the JSON portion
    const jsonPart = result.content[0].text.split('\n\n')[1];
    const parsed = JSON.parse(jsonPart);
    expect(parsed.name).toBe('New Project');
    expect(parsed.id).toBe(42);
    expect(parsed.identifier).toBe('new-project');
  });

  it('redmine_update_project should update project and return result (handles 204)', async () => {
    let callCount = 0;
    const mockFn = fetchImpl.fn as jest.Mock;
    mockFn.mockImplementation((_url: any, options: any) => {
      callCount++;
      const method = options?.method ?? 'GET';
      const urlStr = typeof _url === 'string' ? _url : String(_url);
      if (urlStr.includes('/projects/updated.json')) {
        if (method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 204,
            headers: new Headers(),
            json: () => Promise.resolve(null),
            text: () => Promise.resolve(''),
          } as unknown as Response);
        }
        const updated = projectFixture({ id: 1, name: 'Updated', identifier: 'updated' });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => Promise.resolve({ project: updated }),
          text: () => Promise.resolve(JSON.stringify({ project: updated })),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: () => Promise.reject(new Error('Not Found')),
        text: () => Promise.reject(new Error('Not Found')),
      } as unknown as Response);
    });

    registerProjects(server, client);
    const updateProjectCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_update_project');
    const updateProjectHandler = updateProjectCall[3];

    const result = await updateProjectHandler({
      identifier: 'updated',
      name: 'Updated',
      description: 'Updated desc',
      status: 2,
      visibility: 'internal',
      parent_project_id: 5,
    });

    expect(result.content[0].type).toBe('text');
    const jsonPart = result.content[0].text.split('\n\n')[1];
    const parsed = JSON.parse(jsonPart);
    expect(parsed.name).toBe('Updated');
    expect(parsed.id).toBe(1);
    expect(parsed.identifier).toBe('updated');
    expect(callCount).toBe(2);
  });
});
