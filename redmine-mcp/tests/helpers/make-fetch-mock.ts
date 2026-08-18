import { Mock } from 'jest-mock';

/**
 * Helper to create a fetch mock that routes based on URL pattern.
 * Returns the mock function for further configuration.
 */
export function makeFetchMock() {
  const mockFn = globalThis.fetch as unknown as Mock;
  return mockFn;
}

/**
 * Utility to set up a mock response for a specific URL pattern.
 * @param urlPattern - URL to match (string or RegExp)
 * @param response - The response body to return
 * @param status - HTTP status code (default 200)
 * @param headers - Additional headers
 */
export function setupMockResponse(
  urlPattern: string | RegExp,
  response: any,
  status = 200,
  headers: Record<string, string> = { 'Content-Type': 'application/json' },
) {
  const mockFn = globalThis.fetch as unknown as Mock;
  mockFn.mockImplementation((url: unknown, _options: unknown) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    const matches = typeof urlPattern === 'string'
      ? urlStr.includes(urlPattern)
      : urlPattern.test(urlStr);

    if (matches) {
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(headers),
        json: () => Promise.resolve(response),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as unknown as Response);
    }

    // Return 404 for unmatched URLs
    return Promise.resolve({
      ok: false,
      status: 404,
      headers: new Headers(),
      json: () => Promise.reject(new Error('Not Found')),
      text: () => Promise.reject(new Error('Not Found')),
    } as unknown as Response);
  });
}
