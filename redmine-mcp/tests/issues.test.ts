import { registerIssues } from '../src/tools/issues';
import { issueFixture, relationFixture } from './fixtures';
import { setupMockResponse } from './helpers/make-fetch-mock';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient, fetchImpl } from '../src/redmine';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

describe('registerIssues', () => {
  let server: any;
  let client: RedmineClient;

  beforeEach(() => {
    server = createMockServer();
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
    (fetchImpl.fn as jest.Mock).mockClear();
  });

  it('should register 8 issue tools', () => {
    registerIssues(server, client);
    expect(server.tool).toHaveBeenCalledTimes(8);
    expect(server.tool).toHaveBeenCalledWith('redmine_list_issues', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_issue_children', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_create_issue', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_update_issue', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_delete_issue', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_relations', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_remove_relation', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_add_relation', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_list_issues should return formatted issues with pagination', async () => {
    registerIssues(server, client);
    const listIssuesCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_list_issues');
    const listIssuesHandler = listIssuesCall[3];

    const issues = [issueFixture({ id: 100, subject: 'Issue 1' })];
    setupMockResponse('/issues.json', {
      issues,
      offset: 0,
      limit: 25,
      total_count: 1,
    });

    const result = await listIssuesHandler({ offset: 0, limit: 25 });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].id).toBe(100);
  });

  it('redmine_list_issues should filter by project_id', async () => {
    registerIssues(server, client);
    const listIssuesCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_list_issues');
    const listIssuesHandler = listIssuesCall[3];

    const issues = [issueFixture({ id: 101, subject: 'Filtered' })];
    setupMockResponse('/issues.json', {
      issues,
      offset: 0,
      limit: 25,
      total_count: 1,
    });

    await listIssuesHandler({ offset: 0, limit: 25, project_id: '1', subject: 'login' });
    const mockFn = globalThis.fetch as jest.Mock;
    const calls = mockFn.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toContain('project_id=1');
    expect(decodeURIComponent(calls[0][0])).toContain('subject~=login');
  });

  it('redmine_update_issue should accept relations parameter (adds via POST)', async () => {
    registerIssues(server, client);
    const updateIssueCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_update_issue');
    const updateIssueHandler = updateIssueCall[3];

    let callCount = 0;
    const mockFn = fetchImpl.fn as jest.Mock;
    mockFn.mockImplementation((_url: any, options: any) => {
      callCount++;
      const method = options?.method ?? 'GET';
      if (callCount === 1 && method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => Promise.resolve({ relation: { id: 10, issue_id: 100, issue_to_id: 400, relation_type: 'duplicates' } }),
          text: () => Promise.resolve(JSON.stringify({ relation: { id: 10, issue_id: 100, issue_to_id: 400, relation_type: 'duplicates' } })),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: () => Promise.resolve({ issue: { id: 100, subject: 'Updated', status: { name: 'In Progress' } } }),
        text: () => Promise.resolve(JSON.stringify({ issue: { id: 100, subject: 'Updated', status: { name: 'In Progress' } } })),
      } as unknown as Response);
    });

    await updateIssueHandler({
      id: 100,
      status_id: 2,
      relations: [{ issue_to_id: 400, type: 'duplicates' }],
    });

    const calls = mockFn.mock.calls;
    // First call is POST to create relation
    const relationCall = calls[0];
    expect(relationCall[0]).toContain('/issues/100/relations.json');
    expect((relationCall[1] as any).method).toBe('POST');
    const body = JSON.parse((relationCall[1] as any).body);
    expect(body.relation.issue_to_id).toBe(400);
    expect(body.relation.relation_type).toBe('duplicates');
    // Second call is the PUT to update the issue
    const updateCall = calls[1];
    expect(updateCall[0]).toContain('/issues/100.json');
    expect((updateCall[1] as any).method).toBe('PUT');
  });

  it('redmine_add_relation should create a new relation', async () => {
    registerIssues(server, client);
    const addRelationCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_add_relation');
    const addRelationHandler = addRelationCall[3];

    const mockFn = fetchImpl.fn as jest.Mock;
    mockFn.mockImplementation((_url: any, options: any) => {
      const method = options?.method ?? 'GET';
      if (method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => Promise.resolve({ relation: { id: 5, issue_id: 100, issue_to_id: 200, relation_type: 'blocks' } }),
          text: () => Promise.resolve(JSON.stringify({ relation: { id: 5, issue_id: 100, issue_to_id: 200, relation_type: 'blocks' } })),
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

    const result = await addRelationHandler({
      issue_id: 100,
      issue_to_id: 200,
      type: 'blocks',
      is_def: true,
    });

    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.issue_id).toBe(100);
    expect(parsed.issue_to_id).toBe(200);
    expect(parsed.relation_type).toBe('blocks');
    expect(parsed.relation_id).toBe(5);

    const calls = mockFn.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toContain('/issues/100/relations.json');
    expect((lastCall[1] as any).method).toBe('POST');
    const body = JSON.parse((lastCall[1] as any).body);
    expect(body.relation.issue_to_id).toBe(200);
    expect(body.relation.relation_type).toBe('blocks');
    expect(body.relation.inverted).toBe(true);
  });

  it('redmine_get_relations should return formatted relations', async () => {
    registerIssues(server, client);
    const getRelationsCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_relations');
    const getRelationsHandler = getRelationsCall[3];

    const relations = [
      relationFixture({ id: 1, issue_to_id: 200, issue_to_subject: 'Related Issue', relation_type: 'relates', is_def: false }),
      relationFixture({ id: 2, issue_to_id: 300, issue_to_subject: 'Blocked Issue', relation_type: 'blocks', is_def: true }),
    ];
    setupMockResponse('/issues/100/relations.json', { relations });

    const result = await getRelationsHandler({ issue_id: 100 });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.issue_id).toBe(100);
    expect(parsed.relations).toHaveLength(2);
    expect(parsed.relations[0].id).toBe(1);
    expect(parsed.relations[0].issue_to_id).toBe(200);
    expect(parsed.relations[0].type).toBe('relates');
    expect(parsed.relations[1].is_def).toBe(true);
    expect(parsed.total).toBe(2);
  });

  it('redmine_remove_relation should delete a relation', async () => {
    registerIssues(server, client);
    const removeRelationCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_remove_relation');
    const removeRelationHandler = removeRelationCall[3];

    setupMockResponse('/relations/5.json', {});

    const result = await removeRelationHandler({ issue_id: 100, relation_id: 5 });
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Relation #5 removed from issue #100');

    const mockFn = fetchImpl.fn as jest.Mock;
    const calls = mockFn.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toContain('/relations/5.json');
    expect((lastCall[1] as any).method).toBe('DELETE');
  });
});
