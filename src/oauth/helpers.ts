import crypto from 'crypto';
import { OAuth2Client } from 'googleapis-common';
import { secrets, PROJECT_ID, BASE_URL } from '../config.js';

export async function getGoogleOAuthCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  const [clientIdVersion] = await secrets.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/oauth-client-id/versions/latest`,
  });
  const [clientSecretVersion] = await secrets.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/oauth-client-secret/versions/latest`,
  });

  return {
    clientId: clientIdVersion.payload?.data?.toString() || '',
    clientSecret: clientSecretVersion.payload?.data?.toString() || '',
  };
}

export async function getGoogleOAuthClient(): Promise<OAuth2Client> {
  const { clientId, clientSecret } = await getGoogleOAuthCredentials();
  return new OAuth2Client(clientId, clientSecret, `${BASE_URL}/google/callback`);
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashCodeVerifier(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
