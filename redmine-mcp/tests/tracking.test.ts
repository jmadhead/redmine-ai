import { registerTracking } from '../src/tools/tracking';
import { setupMockResponse } from './helpers/make-fetch-mock';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient } from '../src/redmine';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

describe('registerTracking', () => {
  let server: any;
  let client: RedmineClient;

  beforeEach(() => {
    server = createMockServer();
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
  });

  it('should register 3 tracking tools', () => {
    registerTracking(server, client);
    expect(server.tool).toHaveBeenCalledTimes(3);
    expect(server.tool).toHaveBeenCalledWith('redmine_get_issue_statuses', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_trackers', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_issue_categories', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_get_issue_statuses should return statuses', async () => {
    registerTracking(server, client);
    const getStatusesCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_issue_statuses');
    const getStatusesHandler = getStatusesCall[3];

    const statuses = [{ id: 1, name: 'New', is_closed: false }];
    setupMockResponse('/issue_statuses.json', { issue_statuses: statuses });

    const result = await getStatusesHandler({});
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.issue_statuses).toHaveLength(1);
  });

  it('redmine_get_trackers should return trackers', async () => {
    registerTracking(server, client);
    const getTrackersCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_trackers');
    const getTrackersHandler = getTrackersCall[3];

    const trackers = [{ id: 1, name: 'Task' }];
    setupMockResponse('/trackers.json', { trackers });

    const result = await getTrackersHandler({});
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.trackers).toHaveLength(1);
  });

  it('redmine_get_issue_categories should return categories for project', async () => {
    registerTracking(server, client);
    const getCategoriesCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_issue_categories');
    const getCategoriesHandler = getCategoriesCall[3];

    const categories = [{ id: 1, name: 'Category 1', assigned_to: null }];
    setupMockResponse('/projects/1/issue_categories.json', { issue_categories: categories });

    const result = await getCategoriesHandler({ project_id: '1' });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.project_id).toBe('1');
    expect(parsed.categories).toHaveLength(1);
  });

});
