import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import * as jwt from 'jsonwebtoken';

// Use the same JWT secret as setup.ts
const TEST_JWT_SECRET = 'test-jwt-secret';

// Mock google-auth-library to avoid real OAuth calls
vi.mock('google-auth-library', () => {
  class MockOAuth2Client {
    generateAuthUrl = vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=true');
    getToken = vi.fn().mockResolvedValue({
      tokens: {
        access_token: 'google-access-token',
        refresh_token: 'google-refresh-token',
        id_token: 'mock-id-token',
      },
    });
    verifyIdToken = vi.fn().mockResolvedValue({
      getPayload: () => ({ email: 'test@example.com' }),
    });
  }
  return { OAuth2Client: MockOAuth2Client };
});

import { oauthRouter } from '../../src/auth/oauth.js';
import { authCodes, pendingAuth, registeredClients } from '../../src/auth/state.js';

describe('OAuth Integration Tests', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(oauthRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear all state
    authCodes.clear();
    pendingAuth.clear();
    registeredClients.clear();
  });

  describe('GET /.well-known/oauth-authorization-server', () => {
    it('returns correct OAuth metadata', async () => {
      const response = await request(app).get('/.well-known/oauth-authorization-server');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        issuer: 'https://test.example.com',
        authorization_endpoint: 'https://test.example.com/oauth/authorize',
        token_endpoint: 'https://test.example.com/oauth/token',
        registration_endpoint: 'https://test.example.com/oauth/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
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

  describe('POST /oauth/register', () => {
    it('creates a new OAuth client', async () => {
      const response = await request(app)
        .post('/oauth/register')
        .send({
          client_name: 'Test Client',
          redirect_uris: ['https://callback.example.com'],
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('client_id');
      expect(response.body).toHaveProperty('client_secret');
      expect(response.body.client_name).toBe('Test Client');
      expect(response.body.redirect_uris).toEqual(['https://callback.example.com']);

      // Verify client was stored
      expect(registeredClients.has(response.body.client_id)).toBe(true);
    });

    it('creates client with default name when not provided', async () => {
      const response = await request(app)
        .post('/oauth/register')
        .send({});

      expect(response.status).toBe(201);
      expect(response.body.client_name).toBe('Claude');
    });

    it('creates client with empty redirect_uris array', async () => {
      const response = await request(app)
        .post('/oauth/register')
        .send({ client_name: 'Test Client', redirect_uris: [] });

      expect(response.status).toBe(201);
      expect(response.body.redirect_uris).toEqual([]);
    });
  });

  describe('GET /oauth/authorize', () => {
    it('redirects to Google OAuth with valid parameters', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: 'test-client',
          redirect_uri: 'https://callback.example.com',
          state: 'test-state',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
          response_type: 'code',
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toContain('accounts.google.com');

      // Verify pending auth was stored
      expect(pendingAuth.has('test-state')).toBe(true);
    });

    it('returns error for invalid response_type', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: 'test-client',
          redirect_uri: 'https://callback.example.com',
          state: 'test-state',
          code_challenge: 'test-challenge',
          code_challenge_method: 'S256',
          response_type: 'token', // Invalid - should be 'code'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('unsupported_response_type');
    });

    it('returns error for missing code_challenge_method S256', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          client_id: 'test-client',
          redirect_uri: 'https://callback.example.com',
          state: 'test-state',
          code_challenge: 'test-challenge',
          code_challenge_method: 'plain', // Invalid - should be 'S256'
          response_type: 'code',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });

    it('returns error for missing required parameters', async () => {
      const response = await request(app)
        .get('/oauth/authorize')
        .query({
          response_type: 'code',
          code_challenge_method: 'S256',
          // Missing state, code_challenge, redirect_uri
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });
  });

  describe('POST /oauth/token', () => {
    describe('authorization_code grant', () => {
      it('exchanges valid auth code for tokens', async () => {
        // Setup: add a valid auth code
        const authCode = 'test-auth-code';
        authCodes.set(authCode, { createdAt: Date.now() });

        const response = await request(app)
          .post('/oauth/token')
          .send({
            grant_type: 'authorization_code',
            code: authCode,
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('access_token');
        expect(response.body).toHaveProperty('refresh_token');
        expect(response.body.token_type).toBe('Bearer');
        expect(response.body.expires_in).toBe(3600);

        // Verify access token is valid JWT
        const decoded = jwt.verify(response.body.access_token, TEST_JWT_SECRET) as any;
        expect(decoded.type).toBe('access');
        expect(decoded.email).toBe('test@example.com');

        // Verify auth code was consumed
        expect(authCodes.has(authCode)).toBe(false);
      });

      it('returns error for invalid auth code', async () => {
        const response = await request(app)
          .post('/oauth/token')
          .send({
            grant_type: 'authorization_code',
            code: 'invalid-code',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('invalid_grant');
      });
    });

    describe('refresh_token grant', () => {
      it('exchanges valid refresh token for new access token', async () => {
        // Generate a valid refresh token
        const refreshToken = jwt.sign(
          { type: 'refresh', email: 'test@example.com' },
          TEST_JWT_SECRET,
          { expiresIn: '30d' }
        );

        const response = await request(app)
          .post('/oauth/token')
          .send({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('access_token');
        expect(response.body.token_type).toBe('Bearer');
        expect(response.body.expires_in).toBe(3600);

        // Verify new access token is valid
        const decoded = jwt.verify(response.body.access_token, TEST_JWT_SECRET) as any;
        expect(decoded.type).toBe('access');
      });

      it('returns error for invalid refresh token', async () => {
        const response = await request(app)
          .post('/oauth/token')
          .send({
            grant_type: 'refresh_token',
            refresh_token: 'invalid-token',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('invalid_grant');
      });

      it('returns error for access token used as refresh token', async () => {
        const accessToken = jwt.sign(
          { type: 'access', email: 'test@example.com' },
          TEST_JWT_SECRET,
          { expiresIn: '1h' }
        );

        const response = await request(app)
          .post('/oauth/token')
          .send({
            grant_type: 'refresh_token',
            refresh_token: accessToken, // Wrong type
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('invalid_grant');
      });
    });

    it('returns error for unsupported grant type', async () => {
      const response = await request(app)
        .post('/oauth/token')
        .send({
          grant_type: 'password',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('unsupported_grant_type');
    });
  });
});
