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

import { discoveryRoutes, registrationRoutes } from '../../src/oauth/index.js';
import { firestore } from '../../src/config.js';

describe('OAuth Integration Tests', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(discoveryRoutes);
    app.use(registrationRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /.well-known/oauth-authorization-server', () => {
    it('returns correct OAuth metadata', async () => {
      const response = await request(app).get('/.well-known/oauth-authorization-server');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        issuer: 'https://test.example.com',
        authorization_endpoint: 'https://test.example.com/authorize',
        token_endpoint: 'https://test.example.com/token',
        registration_endpoint: 'https://test.example.com/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        scopes_supported: ['drive:read'],
      });
    });
  });

  describe('GET /.well-known/oauth-protected-resource', () => {
    it('returns resource and authorization servers', async () => {
      const response = await request(app).get('/.well-known/oauth-protected-resource');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        resource: 'https://test.example.com',
        authorization_servers: ['https://test.example.com'],
      });
    });
  });

  describe('POST /register', () => {
    it('creates a new OAuth client', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firestore.collection).mockReturnValue({
        doc: vi.fn().mockReturnValue({
          set: mockSet,
          get: vi.fn(),
          delete: vi.fn(),
        }),
      } as any);

      const response = await request(app)
        .post('/register')
        .send({
          client_name: 'Test Client',
          redirect_uris: ['https://callback.example.com'],
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('client_id');
      expect(response.body).toHaveProperty('client_secret');
      expect(response.body.client_name).toBe('Test Client');
      expect(response.body.redirect_uris).toEqual(['https://callback.example.com']);
    });

    it('creates client even without redirect_uris (no validation)', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firestore.collection).mockReturnValue({
        doc: vi.fn().mockReturnValue({
          set: mockSet,
          get: vi.fn(),
          delete: vi.fn(),
        }),
      } as any);

      const response = await request(app)
        .post('/register')
        .send({ client_name: 'Test Client' });

      // Note: The current implementation doesn't validate redirect_uris
      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('client_id');
    });

    it('creates client with empty redirect_uris array', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      vi.mocked(firestore.collection).mockReturnValue({
        doc: vi.fn().mockReturnValue({
          set: mockSet,
          get: vi.fn(),
          delete: vi.fn(),
        }),
      } as any);

      const response = await request(app)
        .post('/register')
        .send({ client_name: 'Test Client', redirect_uris: [] });

      expect(response.status).toBe(201);
      expect(response.body.redirect_uris).toEqual([]);
    });
  });
});
