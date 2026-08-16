import { registerContext } from '../src/tools/context';
import { setupMockResponse } from './helpers/make-fetch-mock';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient } from '../src/redmine';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

describe('registerContext', () => {
  let server: any;
  let client: RedmineClient;

  beforeEach(() => {
    server = createMockServer();
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
  });

  it('should register 1 context tool', () => {
    registerContext(server, client);
    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.tool).toHaveBeenCalledWith('redmine_get_context', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_get_context should return formatted context data', async () => {
    registerContext(server, client);
    const getContextCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_context');
    const getContextHandler = getContextCall[3];

    const mockContext = {
      projects: [{ id: 1, name: 'Test Project', identifier: 'test' }],
      issue_statuses: [{ id: 1, name: 'New', is_closed: false }],
      trackers: [{ id: 1, name: 'Task' }],
      issue_categories: {},
    };

    const mockFn = globalThis.fetch as unknown as jest.Mock;
    mockFn
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          projects: mockContext.projects,
          offset: 0,
          limit: 100,
          total_count: 1,
        }),
        text: () => Promise.resolve(JSON.stringify({
          projects: mockContext.projects,
          offset: 0,
          limit: 100,
          total_count: 1,
        })),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ issue_statuses: mockContext.issue_statuses }),
        text: () => Promise.resolve(JSON.stringify({ issue_statuses: mockContext.issue_statuses })),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ trackers: mockContext.trackers }),
        text: () => Promise.resolve(JSON.stringify({ trackers: mockContext.trackers })),
      }))
      .mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ issue_categories: [] }),
        text: () => Promise.resolve(JSON.stringify({ issue_categories: [] })),
      }));

    const result = await getContextHandler({ project_id: '1' });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.issue_statuses).toHaveLength(1);
    expect(parsed.trackers).toHaveLength(1);
  });
});
