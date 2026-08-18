import { registerWiki } from '../src/tools/wiki';
import { setupMockResponse } from './helpers/make-fetch-mock';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RedmineClient, fetchImpl } from '../src/redmine';

function createMockServer() {
  return {
    tool: jest.fn(),
  } as unknown as McpServer;
}

describe('registerWiki', () => {
  let server: any;
  let client: RedmineClient;

  beforeEach(() => {
    server = createMockServer();
    client = new RedmineClient({
      url: 'http://test-redmine.example.com',
      apiKey: 'test-api-key',
    });
  });

  it('should register 5 wiki tools', () => {
    registerWiki(server, client);
    expect(server.tool).toHaveBeenCalledTimes(5);
    expect(server.tool).toHaveBeenCalledWith('redmine_list_wiki_pages', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_wiki_page', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_update_wiki_page', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_delete_wiki_page', expect.any(String), expect.any(Object), expect.any(Function));
    expect(server.tool).toHaveBeenCalledWith('redmine_get_wiki_syntax', expect.any(String), expect.any(Object), expect.any(Function));
  });

  it('redmine_get_wiki_syntax should return complete reference', async () => {
    registerWiki(server, client);
    const syntaxCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_wiki_syntax');
    const syntaxHandler = syntaxCall[3];

    const result = await syntaxHandler({});
    expect(result.content[0].type).toBe('text');
    const text = result.content[0].text;
    expect(text).toContain('CommonMark Markdown');
    expect(text).toContain('Wiki links');
    expect(text).toContain('#124');
    expect(text).toContain('{{include(');
    expect(text).toContain('> [!NOTE]');
  });

  it('redmine_list_wiki_pages should return formatted wiki pages', async () => {
    registerWiki(server, client);
    const listCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_list_wiki_pages');
    const listHandler = listCall[3];

    const pages = [
      {
        title: 'Home',
        version: 1,
        created_on: '2024-01-01T00:00:00Z',
        updated_on: '2024-01-02T00:00:00Z',
      },
      {
        title: 'About',
        version: 2,
        created_on: '2024-01-01T00:00:00Z',
        updated_on: '2024-01-03T00:00:00Z',
      },
    ];
    setupMockResponse('/projects/test-project/wiki/index.json', { wiki_pages: pages });

    const result = await listHandler({ project_id: 'test-project' });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.wiki_pages).toHaveLength(2);
    expect(parsed.wiki_pages[0].title).toBe('Home');
    expect(parsed.wiki_pages[1].version).toBe(2);
  });

  it('redmine_get_wiki_page should return single page details', async () => {
    registerWiki(server, client);
    const getPageCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_get_wiki_page');
    const getPageHandler = getPageCall[3];

    const page = {
      title: 'Home',
      text: '# Welcome\n\nThis is the home page.',
      version: 1,
      author: { id: 1, name: 'John Doe' },
      comments: 'Initial version',
      created_on: '2024-01-01T00:00:00Z',
      updated_on: '2024-01-02T00:00:00Z',
      parent: null,
    };
    setupMockResponse('/projects/test-project/wiki/Home.json', { wiki_page: page });

    const result = await getPageHandler({ project_id: 'test-project', title: 'Home' });
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe('Home');
    expect(parsed.text).toContain('Welcome');
    expect(parsed.author.name).toBe('John Doe');
  });

  it('redmine_update_wiki_page should create or update a wiki page (handles 204)', async () => {
    let callCount = 0;
    const mockFn = fetchImpl.fn as jest.Mock;
    mockFn.mockImplementation((_url: any, options: any) => {
      callCount++;
      const method = options?.method ?? 'GET';
      const urlStr = typeof _url === 'string' ? _url : String(_url);
      if (urlStr.includes('/projects/test-project/wiki/Updated')) {
        if (method === 'PUT') {
          return Promise.resolve({
            ok: true,
            status: 204,
            headers: new Headers(),
            json: () => Promise.resolve(null),
            text: () => Promise.resolve(''),
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () => Promise.resolve({
            wiki_page: {
              title: 'Updated Page',
              version: 2,
              comments: 'Updated content',
            },
          }),
          text: () => Promise.resolve(JSON.stringify({
            wiki_page: {
              title: 'Updated Page',
              version: 2,
              comments: 'Updated content',
            },
          })),
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

    registerWiki(server, client);
    const updateCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_update_wiki_page');
    const updateHandler = updateCall[3];

    const response = await updateHandler({
      project_id: 'test-project',
      title: 'Updated Page',
      text: '# Updated\n\nNew content here.',
      comments: 'Updated content',
    });
    expect(response.content[0].type).toBe('text');
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.title).toBe('Updated Page');
    expect(parsed.version).toBe(2);
    expect(parsed.url).toContain('Updated%20Page');
    expect(callCount).toBe(2);
  });

  it('redmine_delete_wiki_page should delete a wiki page', async () => {
    registerWiki(server, client);
    const deleteCall = server.tool.mock.calls.find((call: any[]) => call[0] === 'redmine_delete_wiki_page');
    const deleteHandler = deleteCall[3];

    setupMockResponse('/projects/test-project/wiki/Deletable%20Page.json', {}, 200);

    const response = await deleteHandler({
      project_id: 'test-project',
      title: 'Deletable Page',
    });
    expect(response.content[0].type).toBe('text');
    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.title).toBe('Deletable Page');
    expect(parsed.message).toContain('deleted successfully');
  });
});
