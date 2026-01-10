import { vi, beforeEach } from 'vitest';

// Mock environment variables required by config.ts
process.env.BASE_URL = 'https://test.example.com';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.ALLOWED_EMAIL = 'test@example.com';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.PORT = '8080';

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
