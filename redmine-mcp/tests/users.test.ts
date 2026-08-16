import { registerUsers } from '../src/tools/users';
import { userFixture } from './fixtures';
import { setupMockResponse } from './helpers/make-fetch-mock';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient } from '../src/redmine';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

describe('registerUsers', () => {
  let server: any;
  let client: RedmineClient;

  beforeEach(() => {
    server = createMockServer();
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
  });

  it('should register 1 user tool', () => {
    registerUsers(server, client);
    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.tool).toHaveBeenCalledWith('redmine_get_user', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_get_user should return single user details', async () => {
    registerUsers(server, client);
    const getUserCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_user');
    const getUserHandler = getUserCall[3];

    const user = userFixture({ id: 1, login: 'johndoe', mail: 'john@example.com' });
    setupMockResponse('/users/1.json', { user });

    const result = await getUserHandler({ id: 1 });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(1);
    expect(parsed.login).toBe('johndoe');
  });
});
