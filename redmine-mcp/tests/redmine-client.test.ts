import { RedmineClient } from '../src/redmine';
import { projectFixture, issueFixture, userFixture } from './fixtures';
import { setupMockResponse } from './helpers/make-fetch-mock';

describe('RedmineClient', () => {
  let client: RedmineClient;

  beforeEach(() => {
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
  });

  describe('getProjects', () => {
    it('should return paginated projects from API', async () => {
      const projects = [
        projectFixture({ id: 1, name: 'Project 1' }),
        projectFixture({ id: 2, name: 'Project 2' }),
      ];
      setupMockResponse('/projects.json', {
        projects,
        offset: 0,
        limit: 25,
        total_count: 2,
      });

      const result = await client.getProjects(0, 25);
      expect(result.data).toEqual(projects);
      expect(result.total).toBe(2);
    });

    it('should return empty array when no projects', async () => {
      setupMockResponse('/projects.json', {
        projects: [],
        offset: 0,
        limit: 25,
        total_count: 0,
      });

      const result = await client.getProjects();
      expect(result.data).toEqual([]);
    });

    it('should throw on API error', async () => {
      const mockFn = globalThis.fetch as jest.Mock;
      mockFn.mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers(),
          json: () => Promise.resolve({}),
          text: () => Promise.resolve(''),
        }),
      );

      await expect(client.getProjects()).rejects.toThrow('Redmine API error (401): Unauthorized');
    });
  });

  describe('getIssues', () => {
    it('should return paginated issues from API', async () => {
      const issues = [issueFixture({ id: 100, subject: 'Issue 1' })];
      setupMockResponse('/issues.json', {
        issues,
        offset: 0,
        limit: 25,
        total_count: 1,
      });

      const result = await client.getIssues(0, 25);
      expect(result.data).toEqual(issues);
    });

    it('should include filter parameters in URL', async () => {
      const issues = [issueFixture({ id: 101, subject: 'Filtered Issue' })];
      setupMockResponse('/issues.json', {
        issues,
        offset: 0,
        limit: 25,
        total_count: 1,
      });

      await client.getIssues(0, 25, { project_id: '1', status_id: '1', tracker_id: '2' });
      const mockFn = globalThis.fetch as jest.Mock;
      const calls = mockFn.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const requestedUrl = calls[0][0] as string;
      expect(requestedUrl).toContain('project_id=1');
      expect(requestedUrl).toContain('status_id=1');
      expect(requestedUrl).toContain('tracker_id=2');
    });
  });

  describe('getUsers', () => {
    it('should return paginated users from API', async () => {
      const users = [userFixture({ id: 1, login: 'user1' })];
      setupMockResponse('/users.json', {
        users,
        offset: 0,
        limit: 25,
        total_count: 1,
      });

      const result = await client.getUsers(0, 25);
      expect(result.data).toEqual(users);
    });
  });

  describe('getIssue', () => {
    it('should return a single issue', async () => {
      const issue = issueFixture({ id: 100, subject: 'Single Issue' });
      setupMockResponse('/issues/100.json', { issue });

      const result = await client.getIssue(100);
      expect(result).toEqual(issue);
    });
  });

  describe('getUser', () => {
    it('should return a single user', async () => {
      const user = userFixture({ id: 1, login: 'singleuser' });
      setupMockResponse('/users/1.json', { user });

      const result = await client.getUser(1);
      expect(result).toEqual(user);
    });
  });
});
