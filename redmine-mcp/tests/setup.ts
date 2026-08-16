// Reset fetch mock between tests
beforeEach(() => {
  (globalThis as any).fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});
