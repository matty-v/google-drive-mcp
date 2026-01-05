import { Router, Request, Response } from 'express';
import { BASE_URL } from '../config.js';

export const discoveryRoutes = Router();

discoveryRoutes.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
  res.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
  });
});

discoveryRoutes.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    scopes_supported: ['drive:read'],
  });
});
