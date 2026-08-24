import { registerWorkflows } from '../src/tools/workflows';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient, fetchImpl } from '../src/redmine';
import { issueFixture, userFixture } from './fixtures';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

type Route = {
  url: RegExp | string;
  method?: string;
  status?: number;
  handler: ((url: string, options?: any) => any) | any;
};

function routeFetch(routes: Route[]) {
  const mockFn = fetchImpl.fn as jest.Mock;
  mockFn.mockImplementation((url: any, options?: any) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    const method = options?.method ?? 'GET';
    const route = routes.find(
      (r) =>
        (typeof r.url === 'string' ? urlStr.includes(r.url) : r.url.test(urlStr)) &&
        (!r.method || r.method === method)
    );
    if (!route) {
      return Promise.resolve({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: () => Promise.reject(new Error('Not Found')),
        text: () => Promise.reject(new Error('Not Found')),
      });
    }
    const status = route.status ?? 200;
    const response = typeof route.handler === 'function' ? route.handler(urlStr, options) : route.handler;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    });
  });
}

const statuses = [
  { id: 1, name: 'New', is_closed: false },
  { id: 2, name: 'In Progress', is_closed: false },
  { id: 5, name: 'Reviewed', is_closed: false },
  { id: 3, name: 'Closed', is_closed: true },
];

describe('registerWorkflows', () => {
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

  it('should register 7 workflow tools', () => {
    registerWorkflows(server, client);
    expect(server.tool).toHaveBeenCalledTimes(7);
    expect(server.tool).toHaveBeenCalledWith('redmine_transition_issue', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_issue_workflow', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_project_overview', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_log_work', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_complete_issue', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_create_issue_tree', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_my_work_dashboard', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_transition_issue should resolve status by name and add a note in one call', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_transition_issue')[3];

    routeFetch([
      { url: '/issues/123.json?include=children', method: 'GET', handler: { issue: issueFixture({ id: 123, status: { id: 1, name: 'New' } }) } },
      { url: '/issue_statuses.json', handler: { issue_statuses: statuses } },
      { url: '/issues', method: 'PUT', handler: { issue: issueFixture({ id: 123, status: { id: 2, name: 'In Progress' } }) } },
    ]);

    const result = await handler({ issue_id: 123, status: 'In Progress', notes: 'Started work', done_ratio: 50 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.previous_status).toBe('New');
    expect(parsed.new_status).toBe('In Progress');
    expect(parsed.notes_added).toBe('Started work');
    expect(parsed.done_ratio).toBe(50);

    const putCall = (fetchImpl.fn as jest.Mock).mock.calls.find((c: any[]) => c[1]?.method === 'PUT');
    expect(putCall[0]).toContain('/issues/123.json');
    expect(JSON.parse(putCall[1].body)).toEqual({ issue: { status_id: 2, notes: 'Started work', done_ratio: 50 } });
  });

  it('redmine_transition_issue should accept a numeric status id directly', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_transition_issue')[3];

    routeFetch([
      { url: '/issues', method: 'GET', handler: { issue: issueFixture({ id: 123 }) } },
      { url: '/issue_statuses.json', handler: { issue_statuses: statuses } },
      { url: '/issues', method: 'PUT', handler: { issue: issueFixture({ id: 123 }) } },
    ]);

    await handler({ issue_id: 123, status: '3' });
    const putCall = (fetchImpl.fn as jest.Mock).mock.calls.find((c: any[]) => c[1]?.method === 'PUT');
    expect(JSON.parse(putCall[1].body).issue.status_id).toBe(3);
  });

  it('redmine_transition_issue should match status names case-insensitively by substring', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_transition_issue')[3];

    const realStatuses = [
      { id: 1, name: 'New', is_closed: false },
      { id: 9, name: '🚧 ai:Need more work', is_closed: false },
      { id: 10, name: '👍 ai:Reviewed', is_closed: false },
    ];

    routeFetch([
      { url: '/issues', method: 'GET', handler: { issue: issueFixture({ id: 123 }) } },
      { url: '/issue_statuses.json', handler: { issue_statuses: realStatuses } },
      { url: '/issues', method: 'PUT', handler: { issue: issueFixture({ id: 123 }) } },
    ]);

    await handler({ issue_id: 123, status: 'ai:review' });
    const putCall = (fetchImpl.fn as jest.Mock).mock.calls.find((c: any[]) => c[1]?.method === 'PUT');
    expect(JSON.parse(putCall[1].body).issue.status_id).toBe(10);
  });

  it('redmine_issue_workflow should assemble full ticket context', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_issue_workflow')[3];

    routeFetch([
      {
        url: '/issues/500.json?include=children',
        handler: {
          issue: issueFixture({
            id: 500,
            project: { id: 42, name: 'Proj' },
            journals: [{ notes: 'First note' }, { notes: 'Second note' }],
            children: [{ id: 501, subject: 'Subtask', status: { name: 'New' }, tracker: { name: 'Task' } }],
          }),
        },
      },
      { url: '/issues/500/relations.json', handler: { relations: [{ id: 9, issue_to: { id: 600, subject: 'Related' }, relation_type: 'relates', is_def: false }] } },
      {
        url: '/time_entries.json',
        handler: {
          time_entries: [{ id: 1, hours: 2, spent_on: '2024-01-01', issue: { id: 500 }, project: {}, user: {}, activity: { name: 'Dev' } }],
          offset: 0,
          limit: 100,
          total_count: 1,
        },
      },
    ]);

    const result = await handler({ issue_id: 500 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(500);
    expect(parsed.notes).toBe('First note\nSecond note');
    expect(parsed.project_id).toBe(42);
    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0].subject).toBe('Subtask');
    expect(parsed.relations[0].issue_to_subject).toBe('Related');
    expect(parsed.time_spent.total_hours).toBe(2);
  });

  it('redmine_project_overview should aggregate open/closed issues by tracker', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_project_overview')[3];

    routeFetch([
      {
        url: '/projects/42.json',
        handler: { project: { id: 42, identifier: 'proj', name: 'Proj', status: { name: 'open' } } },
      },
      {
        url: /status_id=open/,
        handler: {
          issues: [
            issueFixture({ id: 1, tracker: { name: 'Task' }, due_date: '2026-09-01' }),
            issueFixture({ id: 2, tracker: { name: 'Bug' }, due_date: '2020-01-01' }),
          ],
          offset: 0,
          limit: 100,
          total_count: 2,
        },
      },
      { url: /status_id=closed/, handler: { issues: [issueFixture({ id: 3, tracker: { name: 'Task' } })], offset: 0, limit: 100, total_count: 1 } },
      { url: '/issue_categories.json', handler: { issue_categories: [] } },
      { url: '/wiki/index.json', handler: { wiki_pages: [{ title: 'Home', version: 2, updated_on: '2024-01-01' }] } },
    ]);

    const result = await handler({ project_id: '42' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.project.identifier).toBe('proj');
    expect(parsed.issue_counts.open).toBe(2);
    expect(parsed.issue_counts.closed).toBe(1);
    expect(parsed.open_by_tracker.Task.total).toBe(1);
    expect(parsed.overdue_issues).toHaveLength(1);
    expect(parsed.wiki_pages).toHaveLength(1);
  });

  it('redmine_log_work should update the issue and create a time entry', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_log_work')[3];

    routeFetch([
      { url: '/issue_statuses.json', handler: { issue_statuses: statuses } },
      { url: '/issues', method: 'PUT', handler: { issue: issueFixture({ id: 200 }) } },
      { url: '/time_entries', method: 'POST', handler: { time_entry: { id: 77, hours: 3.5, spent_on: '2024-01-01' } } },
    ]);

    const result = await handler({ issue_id: 200, hours: 3.5, status: 'Reviewed', comment: 'Third iteration' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.time_entry.id).toBe(77);
    expect(parsed.time_entry.hours).toBe(3.5);
    expect(parsed.issue_updated.status).toBe('Reviewed');

    const timeCall = (fetchImpl.fn as jest.Mock).mock.calls.find((c: any[]) => c[1]?.method === 'POST');
    const body = JSON.parse(timeCall[1].body).time_entry;
    expect(body.issue_id).toBe(200);
    expect(body.hours).toBe(3.5);
    expect(body.comments).toBe('Third iteration');
  });

  it('redmine_complete_issue should close issue, log time, and close subtasks', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_complete_issue')[3];

    routeFetch([
      { url: '/issues/200.json?include=children', handler: { issue: issueFixture({ id: 200, children: [{ id: 201, subject: 'Sub' }] }) } },
      { url: '/issue_statuses.json', handler: { issue_statuses: statuses } },
      { url: '/issues', method: 'PUT', handler: { issue: issueFixture({ id: 200, status: { id: 3, name: 'Closed' } }) } },
      { url: '/time_entries', method: 'POST', handler: { time_entry: { id: 90, hours: 1 } } },
      { url: '/issues/201', method: 'PUT', handler: { issue: { id: 201 } } },
    ]);

    const result = await handler({ issue_id: 200, remaining_hours: 1, activity_id: 5, final_note: 'Done', close_children: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status_id).toBe(3);
    expect(parsed.done_ratio).toBe(100);
    expect(parsed.remaining_time_entry.id).toBe(90);
    expect(parsed.closed_children).toHaveLength(1);
    expect(parsed.closed_children[0].id).toBe(201);
  });

  it('redmine_complete_issue requires activity_id when remaining_hours is set', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_complete_issue')[3];

    routeFetch([
      { url: '/issues/200.json?include=children', handler: { issue: issueFixture({ id: 200 }) } },
      { url: '/issue_statuses.json', handler: { issue_statuses: statuses } },
    ]);

    const result = await handler({ issue_id: 200, remaining_hours: 1 });
    expect(result.content[0].text).toContain('activity_id is required');

    // No PUT or POST should have been issued
    const mutations = (fetchImpl.fn as jest.Mock).mock.calls.filter((c: any[]) => c[1]?.method === 'PUT' || c[1]?.method === 'POST');
    expect(mutations).toHaveLength(0);
  });

  it('redmine_create_issue_tree should create parent and children', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_create_issue_tree')[3];

    routeFetch([
      {
        url: '/issues',
        method: 'POST',
        handler: (url: string, options: any) => {
          const body = JSON.parse(options.body).issue;
          if (body.parent_issue_id) {
            return { issue: { id: body.subject === 'Child A' ? 101 : 102, subject: body.subject } };
          }
          return { issue: { id: 100, subject: body.subject } };
        },
      },
    ]);

    const result = await handler({
      project_id: 'proj',
      subject: 'Parent',
      custom_fields: [{ id: 5, value: 'Technical Debt' }],
      children: [{ subject: 'Child A', custom_fields: [{ id: 5, value: 'Bug' }] }, { subject: 'Child B' }],
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.parent.id).toBe(100);
    expect(parsed.created_children).toHaveLength(2);
    expect(parsed.created_children.map((c: any) => c.id)).toEqual([101, 102]);
    expect(parsed.total_created).toBe(3);

    const postCalls = (fetchImpl.fn as jest.Mock).mock.calls.filter((c: any[]) => c[1]?.method === 'POST');
    const bodies = postCalls.map((c) => JSON.parse(c[1].body).issue);
    expect(bodies[0].custom_fields).toEqual([{ id: 5, value: 'Technical Debt' }]);
    expect(bodies[1].custom_fields).toEqual([{ id: 5, value: 'Bug' }]);
  });

  it('redmine_my_work_dashboard should resolve current user and aggregate hours', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_my_work_dashboard')[3];

    routeFetch([
      { url: '/users/current.json', handler: { user: userFixture({ id: 5, name: 'Me' }) } },
      {
        url: /assignee_id=5/,
        handler: { issues: [issueFixture({ id: 10, due_date: '2026-09-01' })], offset: 0, limit: 100, total_count: 1 },
      },
      {
        url: '/time_entries.json',
        handler: {
          time_entries: [
            { id: 1, hours: 2, spent_on: '2024-01-01', project: { name: 'P1' }, issue: { id: 10 } },
            { id: 2, hours: 1, spent_on: '2024-01-02', project: { name: 'P2' }, issue: { id: 99 } },
          ],
          offset: 0,
          limit: 100,
          total_count: 2,
        },
      },
    ]);

    const result = await handler({ from: '2024-01-01', to: '2024-01-02' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.assignee_id).toBe(5);
    expect(parsed.open_issues).toHaveLength(1);
    expect(parsed.time_logged.total_hours).toBe(3);
    expect(parsed.hours_by_project.P1.hours).toBe(2);
    expect(parsed.hours_by_date['2024-01-01']).toBe(2);
  });

  it('redmine_my_work_dashboard should accept an explicit assignee_id', async () => {
    registerWorkflows(server, client);
    const handler = server.tool.mock.calls.find((c: any[]) => c[0] === 'redmine_my_work_dashboard')[3];

    routeFetch([
      { url: /assignee_id=7/, handler: { issues: [], offset: 0, limit: 100, total_count: 0 } },
      { url: /time_entries.json/, handler: { time_entries: [], offset: 0, limit: 100, total_count: 0 } },
    ]);

    const result = await handler({ assignee_id: '7' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.assignee_id).toBe(7);
    const currentUserCall = (fetchImpl.fn as jest.Mock).mock.calls.find((c: any[]) => c[0].includes('/users/current.json'));
    expect(currentUserCall).toBeUndefined();
  });
});