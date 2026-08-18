import { registerTimeEntries } from '../src/tools/time-entries';
import { timeEntryFixture } from './fixtures';
import { setupMockResponse } from './helpers/make-fetch-mock';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient, fetchImpl } from '../src/redmine';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

describe('registerTimeEntries', () => {
  let server: any;
  let client: RedmineClient;

  beforeEach(() => {
    server = createMockServer();
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
  });

  it('should register 5 time entry tools', () => {
    registerTimeEntries(server, client);
    expect(server.tool).toHaveBeenCalledTimes(5);
    expect(server.tool).toHaveBeenCalledWith('redmine_list_time_entries', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_time_entry', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_create_time_entry', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_update_time_entry', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_delete_time_entry', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_list_time_entries should return formatted entries', async () => {
    registerTimeEntries(server, client);
    const listEntriesCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_list_time_entries');
    const listEntriesHandler = listEntriesCall[3];

    const entries = [timeEntryFixture({ id: 1001, hours: 3.5 })];
    setupMockResponse('/time_entries.json', {
      time_entries: entries,
      offset: 0,
      limit: 25,
      total_count: 1,
    });

    const result = await listEntriesHandler({ offset: 0, limit: 25 });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.time_entries).toHaveLength(1);
    expect(parsed.time_entries[0].hours).toBe(3.5);
  });

  it('redmine_list_time_entries should filter by user_id', async () => {
    registerTimeEntries(server, client);
    const listEntriesCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_list_time_entries');
    const listEntriesHandler = listEntriesCall[3];

    const entries: any[] = [];
    setupMockResponse('/time_entries.json', {
      time_entries: entries,
      offset: 0,
      limit: 25,
      total_count: 0,
    });

    await listEntriesHandler({ offset: 0, limit: 25, user_id: '1' });
    const mockFn = fetchImpl.fn as jest.Mock;
    const calls = mockFn.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toContain('user_id=1');
  });

  it('redmine_list_time_entries should filter by date range', async () => {
    registerTimeEntries(server, client);
    const listEntriesCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_list_time_entries');
    const listEntriesHandler = listEntriesCall[3];

    const entries: any[] = [];
    setupMockResponse('/time_entries.json', {
      time_entries: entries,
      offset: 0,
      limit: 25,
      total_count: 0,
    });

    await listEntriesHandler({ offset: 0, limit: 25, from: '2024-01-01', to: '2024-01-31' });
    const mockFn = fetchImpl.fn as jest.Mock;
    const calls = mockFn.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const url = calls[0][0] as string;
    expect(url).toContain('from=2024-01-01');
    expect(url).toContain('to=2024-01-31');
  });

  it('redmine_get_time_entry should return single entry', async () => {
    registerTimeEntries(server, client);
    const getTimeEntryCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_time_entry');
    const getTimeEntryHandler = getTimeEntryCall[3];

    const entry = timeEntryFixture({ id: 1001, hours: 3.5 });
    setupMockResponse('/time_entries/1001.json', entry);

    const result = await getTimeEntryHandler({ id: 1001 });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(1001);
  });

  it('redmine_create_time_entry handler passes activity_id to API when provided', async () => {
    registerTimeEntries(server, client);
    const createTimeEntryCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_create_time_entry');
    const createTimeEntryHandler = createTimeEntryCall[3];

    const entry = timeEntryFixture({ id: 2001, hours: 2.0, activity: { id: 5, name: 'Development' } });
    setupMockResponse('/time_entries.json', entry);

    const result = await createTimeEntryHandler({
      hours: 2.0,
      activity_id: 5,
      issue_id: 10,
      comment: 'Test work',
    });
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Time entry created successfully');
    expect(result.content[0].text).toContain('2001');
    expect(result.content[0].text).toContain('2');

    // Verify the request body included activity_id
    const mockFn = fetchImpl.fn as jest.Mock;
    const calls = mockFn.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const requestBody = JSON.parse((calls[0][1] as any).body);
    expect(requestBody.time_entry.activity_id).toBe(5);
  });

  it('redmine_delete_time_entry should return clear error on 404', async () => {
    registerTimeEntries(server, client);
    const deleteCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_delete_time_entry');
    const deleteHandler = deleteCall[3];

    // Mock a 404 response for the delete request
    const mockFn = fetchImpl.fn as jest.Mock;
    mockFn.mockImplementation((_url: any, _options: any) =>
      Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        json: () => Promise.reject(new Error('Not Found')),
        text: () => Promise.resolve(''),
      } as unknown as Response)
    );

    const result = await deleteHandler({ id: 9999 });
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Error deleting time entry #9999');
    expect(result.content[0].text).toContain('404');
  });

  it('redmine_update_time_entry should update time entry and return result (handles 204)', async () => {
    let callCount = 0;
    const mockFn = fetchImpl.fn as jest.Mock;
    mockFn.mockImplementation((_url: any, options: any) => {
      callCount++;
      const method = options?.method ?? 'GET';
      const urlStr = typeof _url === 'string' ? _url : String(_url);
      if (urlStr.includes('/time_entries/1001.json')) {
        if (method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 204,
            headers: new Headers(),
            json: () => Promise.resolve(null),
            text: () => Promise.resolve(''),
          } as unknown as Response);
        }
        const entry = timeEntryFixture({ id: 1001, hours: 4.0, comment: 'Updated comment' });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => Promise.resolve(entry),
          text: () => Promise.resolve(JSON.stringify(entry)),
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

    registerTimeEntries(server, client);
    const updateTimeEntryCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_update_time_entry');
    const updateTimeEntryHandler = updateTimeEntryCall[3];

    const result = await updateTimeEntryHandler({
      id: 1001,
      hours: 4.0,
      comment: 'Updated comment',
    });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Time entry #1001 updated successfully');
    expect(result.content[0].text).toContain('4');
    expect(result.content[0].text).toContain('Updated comment');
    expect(callCount).toBe(2);
  });

  it('redmine_create_time_entry should require issue_id or project_id', async () => {
    registerTimeEntries(server, client);
    const createTimeEntryCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_create_time_entry');
    const createTimeEntryHandler = createTimeEntryCall[3];

    const result = await createTimeEntryHandler({ hours: 2.0 });
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Either issue_id or project_id must be provided');
  });
});
