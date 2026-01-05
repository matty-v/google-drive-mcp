import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// Mock the config module before importing handler
vi.mock('../../../src/config.js', () => ({
  firestore: {
    doc: vi.fn(),
  },
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

import { mcpHandler } from '../../../src/mcp/handler.js';
import { firestore } from '../../../src/config.js';
import { toolsByName } from '../../../src/mcp/tools/index.js';

function createMockRequest(body: object, authHeader?: string): Partial<Request> {
  return {
    body,
    headers: authHeader ? { authorization: authHeader } : {},
  };
}

function createMockResponse(): Partial<Response> & { jsonData: any; statusCode: number } {
  const res: any = {
    jsonData: null,
    statusCode: 200,
    json: vi.fn((data) => {
      res.jsonData = data;
      return res;
    }),
    status: vi.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    end: vi.fn(),
  };
  return res;
}

describe('mcp/handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('notifications (no id)', () => {
    it('responds with 200 OK and empty body for notifications', async () => {
      const req = createMockRequest({ method: 'notifications/initialized' });
      const res = createMockResponse();

      await mcpHandler(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('validateAccessToken', () => {
    it('returns 401 for missing Authorization header', async () => {
      const req = createMockRequest({ method: 'initialize', id: 1 });
      const res = createMockResponse();

      await mcpHandler(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.jsonData.error.message).toBe('Missing or invalid Authorization header');
    });

    it('returns 401 for non-Bearer token', async () => {
      const req = createMockRequest({ method: 'initialize', id: 1 }, 'Basic abc123');
      const res = createMockResponse();

      await mcpHandler(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.jsonData.error.message).toBe('Missing or invalid Authorization header');
    });

    it('returns 401 for invalid token', async () => {
      vi.mocked(firestore.doc).mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      } as any);

      const req = createMockRequest({ method: 'initialize', id: 1 }, 'Bearer invalid-token');
      const res = createMockResponse();

      await mcpHandler(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.jsonData.error.message).toBe('Invalid access token');
    });

    it('returns 401 for expired token', async () => {
      const expiredDate = new Date(Date.now() - 3600000); // 1 hour ago
      vi.mocked(firestore.doc).mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            expires_at: { toDate: () => expiredDate },
            google_refresh_token: 'refresh-token',
            user_email: 'test@example.com',
          }),
        }),
      } as any);

      const req = createMockRequest({ method: 'initialize', id: 1 }, 'Bearer expired-token');
      const res = createMockResponse();

      await mcpHandler(req as Request, res as Response);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.jsonData.error.message).toBe('Access token expired');
    });
  });

  describe('handleMcpMethod', () => {
    const validTokenSetup = () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      vi.mocked(firestore.doc).mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            expires_at: { toDate: () => futureDate },
            google_refresh_token: 'test-refresh-token',
            user_email: 'user@example.com',
          }),
        }),
      } as any);
    };

    describe('initialize', () => {
      it('returns server info and capabilities', async () => {
        validTokenSetup();
        const req = createMockRequest({ method: 'initialize', id: 1 }, 'Bearer valid-token');
        const res = createMockResponse();

        await mcpHandler(req as Request, res as Response);

        expect(res.jsonData).toEqual({
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
        validTokenSetup();
        const req = createMockRequest({ method: 'tools/list', id: 2 }, 'Bearer valid-token');
        const res = createMockResponse();

        await mcpHandler(req as Request, res as Response);

        expect(res.jsonData.result.tools).toHaveLength(2);
        const listFilesTool = res.jsonData.result.tools.find(
          (t: any) => t.name === 'list_drive_files'
        );
        expect(listFilesTool.description).toContain('user@example.com');
      });
    });

    describe('tools/call', () => {
      it('executes a valid tool and returns result', async () => {
        validTokenSetup();
        const req = createMockRequest(
          {
            method: 'tools/call',
            params: { name: 'list_drive_files', arguments: {} },
            id: 3,
          },
          'Bearer valid-token'
        );
        const res = createMockResponse();

        await mcpHandler(req as Request, res as Response);

        const tool = toolsByName.get('list_drive_files');
        expect(tool?.handler).toHaveBeenCalledWith({}, 'test-refresh-token');
        expect(res.jsonData.result.content[0].text).toBe('files listed');
      });

      it('returns error for unknown tool', async () => {
        validTokenSetup();
        const req = createMockRequest(
          {
            method: 'tools/call',
            params: { name: 'unknown_tool', arguments: {} },
            id: 4,
          },
          'Bearer valid-token'
        );
        const res = createMockResponse();

        await mcpHandler(req as Request, res as Response);

        expect(res.jsonData.result.content[0].text).toBe('Unknown tool: unknown_tool');
        expect(res.jsonData.result.isError).toBe(true);
      });

      it('handles tool execution errors', async () => {
        validTokenSetup();
        const tool = toolsByName.get('search_drive');
        vi.mocked(tool!.handler).mockRejectedValueOnce(new Error('API error'));

        const req = createMockRequest(
          {
            method: 'tools/call',
            params: { name: 'search_drive', arguments: { query: 'test' } },
            id: 5,
          },
          'Bearer valid-token'
        );
        const res = createMockResponse();

        await mcpHandler(req as Request, res as Response);

        expect(res.jsonData.result.content[0].text).toContain('Error executing search_drive');
        expect(res.jsonData.result.isError).toBe(true);
      });
    });

    describe('unknown method', () => {
      it('returns method not found error', async () => {
        validTokenSetup();
        const req = createMockRequest(
          { method: 'unknown/method', id: 6 },
          'Bearer valid-token'
        );
        const res = createMockResponse();

        await mcpHandler(req as Request, res as Response);

        expect(res.jsonData.error.code).toBe(-32601);
        expect(res.jsonData.error.message).toBe('Method not found: unknown/method');
      });
    });
  });
});
