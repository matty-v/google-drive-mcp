// In-memory stores (fine for single instance)

export interface PendingAuth {
  codeChallenge: string;
  redirectUri: string;
  createdAt: number;
}

export interface RegisteredClient {
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

export interface GoogleCredentials {
  refreshToken: string;
  email: string;
}

// Pending OAuth states: state -> { codeChallenge, redirectUri, createdAt }
export const pendingAuth = new Map<string, PendingAuth>();

// Issued auth codes: code -> { createdAt }
export const authCodes = new Map<string, { createdAt: number }>();

// Registered OAuth clients: clientId -> { clientSecret, clientName, redirectUris }
export const registeredClients = new Map<string, RegisteredClient>();

// Cached Google credentials for the allowed user (populated after first OAuth)
export let googleCredentials: GoogleCredentials | null = null;

export function setGoogleCredentials(creds: GoogleCredentials) {
  googleCredentials = creds;
}

// Clean up old entries periodically (10 minute expiry)
const EXPIRY_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingAuth) {
    if (now - value.createdAt > EXPIRY_MS) pendingAuth.delete(key);
  }
  for (const [key, value] of authCodes) {
    if (now - value.createdAt > EXPIRY_MS) authCodes.delete(key);
  }
}, CLEANUP_INTERVAL_MS);
