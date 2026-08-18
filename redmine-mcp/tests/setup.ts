import { fetchImpl } from '../src/redmine';

// Reset fetch mock between tests
// Use the same mock instance for both globalThis.fetch and fetchImpl.fn
beforeEach(() => {
  const mockFn = jest.fn();
  (globalThis as any).fetch = mockFn;
  (fetchImpl.fn as any) = mockFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});
