import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock environment variables before any imports
process.env.GCP_PROJECT = 'test-project';
process.env.BASE_URL = 'https://test.example.com';

// Mock the config module
vi.mock('../../src/config.js', () => ({
  BASE_URL: 'https://test.example.com',
  PROJECT_ID: 'test-project',
  PORT: 8080,
  GOOGLE_SCOPES: ['https://www.googleapis.com/auth/drive.file'],
  firestore: {
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
      }),
    }),
    doc: vi.fn().mockReturnValue({
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    }),
  },
  secrets: {
    accessSecretVersion: vi.fn(),
  },
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

import { mcpHandler } from '../../src/mcp/index.js';
import { firestore } from '../../src/config.js';

describe('MCP Integration Tests', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.post('/', mcpHandler);
    app.post('/mcp', mcpHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validTokenSetup = () => {
    const futureDate = new Date(Date.now() + 3600000);
    vi.mocked(firestore.doc).mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          expires_at: { toDate: () => futureDate },
          google_refresh_token: 'test-refresh-token',
          user_email: 'user@example.com',
        }),
      }),
      set: vi.fn(),
      delete: vi.fn(),
    } as any);
  };

  describe('POST / (MCP endpoint)', () => {
    describe('initialize', () => {
      it('returns server capabilities', async () => {
        validTokenSetup();

        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer valid-token')
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
        validTokenSetup();

        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer valid-token')
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
        validTokenSetup();

        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer valid-token')
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
        validTokenSetup();

        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer valid-token')
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
        validTokenSetup();

        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer valid-token')
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
        expect(response.body.error.message).toBe('Missing or invalid Authorization header');
      });

      it('returns 401 for invalid token', async () => {
        vi.mocked(firestore.doc).mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: false }),
          set: vi.fn(),
          delete: vi.fn(),
        } as any);

        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer invalid-token')
          .send({
            jsonrpc: '2.0',
            method: 'initialize',
            id: 1,
          });

        expect(response.status).toBe(401);
        expect(response.body.error.message).toBe('Invalid access token');
      });
    });

    describe('notifications', () => {
      it('accepts notifications without auth (no id)', async () => {
        const response = await request(app)
          .post('/')
          .send({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          });

        expect(response.status).toBe(200);
      });
    });

    describe('unknown method', () => {
      it('returns method not found error', async () => {
        validTokenSetup();

        const response = await request(app)
          .post('/')
          .set('Authorization', 'Bearer valid-token')
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
      validTokenSetup();

      const response = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer valid-token')
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
