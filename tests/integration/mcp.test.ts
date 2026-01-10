import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as jwt from 'jsonwebtoken';

// Use the same JWT secret as setup.ts
const TEST_JWT_SECRET = 'test-jwt-secret';

// Mock the auth/state module to control googleCredentials
vi.mock('../../src/auth/state.js', () => ({
  googleCredentials: null,
  setGoogleCredentials: vi.fn(),
  pendingAuth: new Map(),
  authCodes: new Map(),
  registeredClients: new Map(),
}));

// Mock the tools module
vi.mock('../../src/mcp/tools/index.js', () => ({
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
  ]),
}));

import { mcpRouter } from '../../src/mcp/handler.js';
import * as authState from '../../src/auth/state.js';

// Helper to generate valid JWT tokens for testing
function generateTestToken(email: string = 'user@example.com'): string {
  return jwt.sign({ type: 'access', email }, TEST_JWT_SECRET, { expiresIn: '1h' });
}

describe('MCP Integration Tests', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(mcpRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset googleCredentials to a valid state by default
    (authState as any).googleCredentials = {
      refreshToken: 'test-refresh-token',
      email: 'user@example.com',
    };
  });

  describe('POST / (MCP endpoint)', () => {
    describe('initialize', () => {
      it('returns server capabilities', async () => {
        const token = generateTestToken();

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            jsonrpc: '2.0',
            method: 'initialize',
            id: 1,
          });

        expect(response.status).toBe(200);
        expect(response.body.jsonrpc).toBe('2.0');
        expect(response.body.id).toBe(1);
        expect(response.body.result.protocolVersion).toBe('2024-11-05');
        expect(response.body.result.serverInfo.name).toBe('google-drive-mcp');
        expect(response.body.result.capabilities).toHaveProperty('tools');
      });
    });

    describe('tools/list', () => {
      it('returns all available tools', async () => {
        const token = generateTestToken();

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            jsonrpc: '2.0',
            method: 'tools/list',
            id: 2,
          });

        expect(response.status).toBe(200);
        expect(response.body.result.tools).toHaveLength(2);
        expect(response.body.result.tools[0].name).toBe('list_drive_files');
      });

      it('includes user email in list_drive_files description', async () => {
        const token = generateTestToken('user@example.com');

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            jsonrpc: '2.0',
            method: 'tools/list',
            id: 2,
          });

        const listFilesTool = response.body.result.tools.find(
          (t: any) => t.name === 'list_drive_files'
        );
        expect(listFilesTool.description).toContain('user@example.com');
      });
    });

    describe('tools/call', () => {
      it('executes list_drive_files tool', async () => {
        const token = generateTestToken();

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'list_drive_files', arguments: {} },
            id: 3,
          });

        expect(response.status).toBe(200);
        expect(response.body.result.content[0].text).toBe('files listed');
      });

      it('returns error for unknown tool', async () => {
        const token = generateTestToken();

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: { name: 'unknown_tool', arguments: {} },
            id: 4,
          });

        expect(response.status).toBe(200);
        expect(response.body.result.content[0].text).toContain('Unknown tool');
        expect(response.body.result.isError).toBe(true);
      });
    });

    describe('authentication', () => {
      it('returns 401 without Authorization header', async () => {
        const response = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            method: 'initialize',
            id: 1,
          });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('unauthorized');
      });

      it('returns 401 for invalid token', async () => {
        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer invalid-token')
          .send({
            jsonrpc: '2.0',
            method: 'initialize',
            id: 1,
          });

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('invalid_token');
      });
    });

    describe('notifications', () => {
      it('accepts notifications with valid auth (no id)', async () => {
        const token = generateTestToken();
        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          });

        expect(response.status).toBe(200);
      });
    });

    describe('unknown method', () => {
      it('returns method not found error', async () => {
        const token = generateTestToken();

        const response = await request(app)
          .post('/')
          .set('Authorization', `Bearer ${token}`)
          .send({
            jsonrpc: '2.0',
            method: 'unknown/method',
            id: 5,
          });

        expect(response.status).toBe(200);
        expect(response.body.error.code).toBe(-32601);
        expect(response.body.error.message).toContain('Method not found');
      });
    });
  });

  describe('POST /mcp (alternate endpoint)', () => {
    it('works the same as POST /', async () => {
      const token = generateTestToken();

      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({
          jsonrpc: '2.0',
          method: 'initialize',
          id: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.result.serverInfo.name).toBe('google-drive-mcp');
    });
  });
});
