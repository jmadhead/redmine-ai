// Fixtures for Redmine API test data

export const projectFixture = (overrides?: Partial<any>) => ({
  id: 1,
  identifier: 'test-project',
  name: 'Test Project',
  description: 'A test project',
  status: 1,
  created_on: '2024-01-01T00:00:00Z',
  ...overrides,
});

export const issueFixture = (overrides?: Partial<any>) => ({
  id: 100,
  project: { id: 1, name: 'Test Project' },
  tracker: { id: 1, name: 'Task' },
  status: { id: 1, name: 'New' },
  priority: { id: 3, name: 'Normal' },
  author: { id: 1, name: 'John Doe' },
  subject: 'Test Issue',
  description: 'Issue description',
  created_on: '2024-01-01T00:00:00Z',
  updated_on: '2024-01-02T00:00:00Z',
  ...overrides,
});

export const userFixture = (overrides?: Partial<any>) => ({
  id: 1,
  login: 'johndoe',
  real_name: 'John Doe',
  mail: 'john@example.com',
  created_on: '2024-01-01T00:00:00Z',
  ...overrides,
});

export const timeEntryFixture = (overrides?: Partial<any>) => ({
  id: 1001,
  issue: { id: 100, subject: 'Test Issue' },
  project: { id: 1, name: 'Test Project' },
  user: { id: 1, name: 'John Doe' },
  activity: { id: 1, name: 'Development' },
  hours: 3.5,
  comments: 'Worked on feature',
  spent_on: '2024-01-01',
  created_on: '2024-01-01T00:00:00Z',
  updated_on: '2024-01-01T12:00:00Z',
  ...overrides,
});

export const trackerFixture = (overrides?: Partial<any>) => ({
  id: 1,
  name: 'Task',
  ...overrides,
});

export const statusFixture = (overrides?: Partial<any>) => ({
  id: 1,
  name: 'New',
  is_closed: false,
  ...overrides,
});

export const priorityFixture = (overrides?: Partial<any>) => ({
  id: 1,
  name: 'Urgent',
  ...overrides,
});

export const categoryFixture = (overrides?: Partial<any>) => ({
  id: 1,
  name: 'Category 1',
  project: { id: 1, name: 'Test Project' },
  ...overrides,
});

export const timeActivityFixture = (overrides?: Partial<any>) => ({
  id: 1,
  name: 'Development',
  ...overrides,
});

export const relationFixture = (overrides?: Partial<any>) => ({
  id: 1,
  issue_to: { id: 200, subject: 'Related Issue' },
  type: 'relates',
  is_def: false,
  ...overrides,
});
