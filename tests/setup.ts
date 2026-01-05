import { vi, beforeEach } from 'vitest';

// Mock environment variables
process.env.GCP_PROJECT = 'test-project';
process.env.BASE_URL = 'https://test.example.com';
process.env.PORT = '8080';

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
