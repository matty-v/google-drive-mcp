import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as jwt from 'jsonwebtoken';

// Use the same JWT secret as setup.ts
const TEST_JWT_SECRET = 'test-jwt-secret';

// Mock credentials state
let mockGoogleCredentials: { refreshToken: string; email: string } | null = null;

// Mock the auth/state module to control googleCredentials
vi.mock('../../../src/auth/state.js', () => ({
  getGoogleCredentials: vi.fn(async () => mockGoogleCredentials),
  setGoogleCredentials: vi.fn(),
  getPendingAuth: vi.fn(),
  setPendingAuth: vi.fn(),
  deletePendingAuth: vi.fn(),
  getAuthCode: vi.fn(),
  setAuthCode: vi.fn(),
  deleteAuthCode: vi.fn(),
  getRegisteredClient: vi.fn(),
  setRegisteredClient: vi.fn(),
}));

// Mock the tools module
vi.mock('../../../src/mcp/tools/index.js', () => ({
  toolDefinitions: [
    { name: 'list_drive_files', description: 'List files', inputSchema: {} },
    { name: 'search_drive', description: 'Search files', inputSchema: {} },
  ],
  toolsByName: new Map([
    ['list_drive_files', {
      name: 'list_drive_files',
      handler: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'files listed' }]
      })
    }],
    ['search_drive', {
      name: 'search_drive',
      handler: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'search results' }]
      })
    }],
  ]),
}));

import { mcpRouter } from '../../../src/mcp/handler.js';
import { toolsByName } from '../../../src/mcp/tools/index.js';

// Helper to generate valid JWT tokens for testing
function generateTestToken(email: string = 'test@example.com'): string {
  return jwt.sign({ type: 'access', email }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

// Helper to generate invalid/expired tokens
function generateExpiredToken(email: string = 'test@example.com'): string {
  return jwt.sign({ type: 'access', email }, TEST_JWT_SECRET, { expiresIn: '-1h' });
}

function generateWrongTypeToken(email: string = 'test@example.com'): string {
  return jwt.sign({ type: 'refresh', email }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

describe('mcp/handler', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(mcpRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset googleCredentials to a valid state by default
    mockGoogleCredentials = {
      refreshToken: 'test-refresh-token',
      email: 'test@example.com',
    };
  });

  describe('notifications (no id)', () => {
    it('responds with 200 OK and empty body for notifications with valid auth', async () => {
      const token = generateTestToken();
      const response = await request(app)
        .post('/')
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'notifications/initialized' });

      expect(response.status).toBe(200);
      expect(response.text).toBe('');
    });
  });

  describe('authentication', () => {
    it('returns 401 for missing Authorization header', async () => {
      const response = await request(app)
        .post('/')
        .send({ method: 'initialize', id: 1 });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('returns 401 for non-Bearer token', async () => {
      const response = await request(app)
        .post('/')
        .set('Authorization', 'Basic abc123')
        .send({ method: 'initialize', id: 1 });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('unauthorized');
    });

    it('returns 401 for invalid JWT token', async () => {
      const response = await request(app)
        .post('/')
        .set('Authorization', 'Bearer invalid-token')
        .send({ method: 'initialize', id: 1 });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_token');
    });

    it('returns 401 for expired token', async () => {
      const expiredToken = generateExpiredToken();
      const response = await request(app)
        .post('/')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({ method: 'initialize', id: 1 });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_token');
    });

    it('returns 401 for wrong token type', async () => {
      const wrongTypeToken = generateWrongTypeToken();
      const response = await request(app)
        .post('/')
        .set('Authorization', `Bearer ${wrongTypeToken}`)
        .send({ method: 'initialize', id: 1 });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('invalid_token');
    });
  });

  describe('handleMcpMethod', () => {
    describe('initialize', () => {
      it('returns server info and capabilities', async () => {
        const token = generateTestToken();
        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({ method: 'initialize', id: 1 });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'google-drive-mcp', version: '1.0.0' },
            capabilities: { tools: {} },
          },
        });
      });
    });

    describe('tools/list', () => {
      it('returns tool definitions with user email in list_drive_files', async () => {
        const token = generateTestToken('user@example.com');
        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({ method: 'tools/list', id: 2 });

        expect(response.status).toBe(200);
        expect(response.body.result.tools).toHaveLength(2);
        const listFilesTool = response.body.result.tools.find(
          (t: any) => t.name === 'list_drive_files'
        );
        expect(listFilesTool.description).toContain('user@example.com');
      });
    });

    describe('tools/call', () => {
      it('executes a valid tool and returns result', async () => {
        const token = generateTestToken();
        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            method: 'tools/call',
            params: { name: 'list_drive_files', arguments: {} },
            id: 3,
          });

        const tool = toolsByName.get('list_drive_files');
        expect(tool?.handler).toHaveBeenCalledWith({}, 'test-refresh-token');
        expect(response.body.result.content[0].text).toBe('files listed');
      });

      it('returns error for unknown tool', async () => {
        const token = generateTestToken();
        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            method: 'tools/call',
            params: { name: 'unknown_tool', arguments: {} },
            id: 4,
          });

        expect(response.body.result.content[0].text).toBe('Unknown tool: unknown_tool');
        expect(response.body.result.isError).toBe(true);
      });

      it('handles tool execution errors', async () => {
        const token = generateTestToken();
        const tool = toolsByName.get('search_drive');
        vi.mocked(tool!.handler).mockRejectedValueOnce(new Error('API error'));

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            method: 'tools/call',
            params: { name: 'search_drive', arguments: { query: 'test' } },
            id: 5,
          });

        expect(response.body.result.content[0].text).toContain('Error executing search_drive');
        expect(response.body.result.isError).toBe(true);
      });

      it('returns error when googleCredentials is null', async () => {
        mockGoogleCredentials = null;
        const token = generateTestToken();

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            method: 'tools/call',
            params: { name: 'list_drive_files', arguments: {} },
            id: 6,
          });

        expect(response.body.result.content[0].text).toContain('Not authenticated with Google');
        expect(response.body.result.isError).toBe(true);
      });
    });

    describe('unknown method', () => {
      it('returns method not found error', async () => {
        const token = generateTestToken();
        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({ method: 'unknown/method', id: 6 });

        expect(response.body.error.code).toBe(-32601);
        expect(response.body.error.message).toBe('Method not found: unknown/method');
      });
    });
  });

  describe('POST /mcp (alternate endpoint)', () => {
    it('works the same as POST /', async () => {
      const token = generateTestToken();
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'initialize', id: 1 });

      expect(response.status).toBe(200);
      expect(response.body.result.serverInfo.name).toBe('google-drive-mcp');
    });
  });
});
