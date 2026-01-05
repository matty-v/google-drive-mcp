# Modular Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor 1,800-line single-file server into modular structure for better navigation, extensibility, and testability.

**Architecture:** Extract config → helpers → OAuth routes → MCP types/registry → tools by domain → handler → thin orchestrator. Build verification at each step.

**Tech Stack:** TypeScript, Express Router, Google APIs (Drive, Docs, Sheets)

---

## Task 1: Extract Configuration

**Files:**
- Create: `src/config.ts`
- Modify: `src/index.ts`

**Step 1: Create config.ts**

Create `src/config.ts` with all configuration constants and singleton instances:

```typescript
import { Firestore } from '@google-cloud/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

export const PORT = process.env.PORT || 8080;
export const PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
export const BASE_URL = process.env.BASE_URL!;

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/userinfo.email',
];

export const firestore = new Firestore();
export const secrets = new SecretManagerServiceClient();
```

**Step 2: Update index.ts imports**

Replace configuration block in `src/index.ts` with import:

```typescript
import { PORT, PROJECT_ID, BASE_URL, GOOGLE_SCOPES, firestore, secrets } from './config';
```

Remove lines 14-27 (the constants and instance creation).

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/config.ts src/index.ts
git commit -m "refactor: extract configuration to config.ts"
```

---

## Task 2: Extract OAuth Helpers

**Files:**
- Create: `src/oauth/helpers.ts`
- Modify: `src/index.ts`

**Step 1: Create oauth/helpers.ts**

Create `src/oauth/helpers.ts`:

```typescript
import crypto from 'crypto';
import { OAuth2Client } from 'googleapis-common';
import { secrets, PROJECT_ID, BASE_URL } from '../config';

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
```

**Step 2: Update index.ts imports**

Add import to `src/index.ts`:

```typescript
import { getGoogleOAuthClient, generateSecureToken, hashCodeVerifier } from './oauth/helpers';
```

Remove lines 31-56 (the helper functions).

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/oauth/helpers.ts src/index.ts
git commit -m "refactor: extract OAuth helpers to oauth/helpers.ts"
```

---

## Task 3: Extract OAuth Discovery Routes

**Files:**
- Create: `src/oauth/discovery.ts`
- Modify: `src/index.ts`

**Step 1: Create oauth/discovery.ts**

Create `src/oauth/discovery.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { BASE_URL } from '../config';

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
```

**Step 2: Update index.ts**

Add import and use router:

```typescript
import { discoveryRoutes } from './oauth/discovery';
// After app setup:
app.use(discoveryRoutes);
```

Remove the two `app.get('/.well-known/...')` handlers (lines 61-80).

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/oauth/discovery.ts src/index.ts
git commit -m "refactor: extract OAuth discovery routes"
```

---

## Task 4: Extract OAuth Registration Route

**Files:**
- Create: `src/oauth/registration.ts`
- Modify: `src/index.ts`

**Step 1: Create oauth/registration.ts**

Create `src/oauth/registration.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { firestore } from '../config';
import { generateSecureToken } from './helpers';

export const registrationRoutes = Router();

registrationRoutes.post('/register', async (req: Request, res: Response) => {
  try {
    const { client_name, redirect_uris } = req.body;

    const clientId = generateSecureToken(16);
    const clientSecret = generateSecureToken(32);

    await firestore.doc(`oauth-clients/${clientId}`).set({
      client_name,
      client_secret: clientSecret,
      redirect_uris,
      created_at: new Date(),
    });

    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name,
      redirect_uris,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});
```

**Step 2: Update index.ts**

Add import and use router:

```typescript
import { registrationRoutes } from './oauth/registration';
app.use(registrationRoutes);
```

Remove the `app.post('/register', ...)` handler.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/oauth/registration.ts src/index.ts
git commit -m "refactor: extract OAuth registration route"
```

---

## Task 5: Extract OAuth Authorize Route

**Files:**
- Create: `src/oauth/authorize.ts`
- Modify: `src/index.ts`

**Step 1: Create oauth/authorize.ts**

Create `src/oauth/authorize.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { firestore, GOOGLE_SCOPES } from '../config';
import { getGoogleOAuthClient, generateSecureToken } from './helpers';

export const authorizeRoutes = Router();

authorizeRoutes.get('/authorize', async (req: Request, res: Response) => {
  try {
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      response_type,
    } = req.query as Record<string, string>;

    if (!client_id || !redirect_uri || !code_challenge || response_type !== 'code') {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    const clientDoc = await firestore.doc(`oauth-clients/${client_id}`).get();
    if (!clientDoc.exists) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }

    const clientData = clientDoc.data()!;
    if (!clientData.redirect_uris?.includes(redirect_uri)) {
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    const sessionId = generateSecureToken();
    await firestore.doc(`oauth-sessions/${sessionId}`).set({
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method: code_challenge_method || 'S256',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    });

    const googleOAuth = await getGoogleOAuthClient();
    const googleAuthUrl = googleOAuth.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent',
      state: sessionId,
    });

    res.redirect(googleAuthUrl);
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});
```

**Step 2: Update index.ts**

Add import and use router:

```typescript
import { authorizeRoutes } from './oauth/authorize';
app.use(authorizeRoutes);
```

Remove the `app.get('/authorize', ...)` handler.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/oauth/authorize.ts src/index.ts
git commit -m "refactor: extract OAuth authorize route"
```

---

## Task 6: Extract OAuth Callback Route

**Files:**
- Create: `src/oauth/callback.ts`
- Modify: `src/index.ts`

**Step 1: Create oauth/callback.ts**

Create `src/oauth/callback.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { firestore } from '../config';
import { getGoogleOAuthClient, generateSecureToken } from './helpers';

export const callbackRoutes = Router();

callbackRoutes.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: sessionId, error } = req.query as Record<string, string>;

    if (error) {
      res.status(400).send(`Google OAuth error: ${error}`);
      return;
    }

    if (!code || !sessionId) {
      res.status(400).send('Missing code or session');
      return;
    }

    const sessionDoc = await firestore.doc(`oauth-sessions/${sessionId}`).get();
    if (!sessionDoc.exists) {
      res.status(400).send('Invalid or expired session');
      return;
    }
    const session = sessionDoc.data()!;

    if (new Date() > session.expires_at.toDate()) {
      res.status(400).send('Session expired');
      return;
    }

    const googleOAuth = await getGoogleOAuthClient();
    const { tokens } = await googleOAuth.getToken(code);

    if (!tokens.refresh_token) {
      res.status(400).send(
        'No refresh token received. Please revoke access at https://myaccount.google.com/permissions and try again.'
      );
      return;
    }

    googleOAuth.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: googleOAuth });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email;

    const authCode = generateSecureToken();

    await firestore.doc(`auth-codes/${authCode}`).set({
      google_refresh_token: tokens.refresh_token,
      google_access_token: tokens.access_token,
      user_email: userEmail,
      client_id: session.client_id,
      code_challenge: session.code_challenge,
      code_challenge_method: session.code_challenge_method,
      redirect_uri: session.redirect_uri,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
    });

    await firestore.doc(`oauth-sessions/${sessionId}`).delete();

    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (session.state) {
      redirectUrl.searchParams.set('state', session.state);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Google callback error:', error);
    res.status(500).send('Authentication failed');
  }
});
```

**Step 2: Update index.ts**

Add import and use router:

```typescript
import { callbackRoutes } from './oauth/callback';
app.use(callbackRoutes);
```

Remove the `app.get('/google/callback', ...)` handler.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/oauth/callback.ts src/index.ts
git commit -m "refactor: extract OAuth callback route"
```

---

## Task 7: Extract OAuth Token Route

**Files:**
- Create: `src/oauth/token.ts`
- Modify: `src/index.ts`

**Step 1: Create oauth/token.ts**

Create `src/oauth/token.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { firestore } from '../config';
import { generateSecureToken, hashCodeVerifier } from './helpers';

export const tokenRoutes = Router();

tokenRoutes.post('/token', async (req: Request, res: Response) => {
  try {
    const { grant_type, code, code_verifier, refresh_token, client_id, client_secret } = req.body;

    const clientDoc = await firestore.doc(`oauth-clients/${client_id}`).get();
    if (!clientDoc.exists || clientDoc.data()?.client_secret !== client_secret) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    if (grant_type === 'authorization_code') {
      const codeDoc = await firestore.doc(`auth-codes/${code}`).get();
      if (!codeDoc.exists) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid authorization code' });
        return;
      }
      const codeData = codeDoc.data()!;

      if (new Date() > codeData.expires_at.toDate()) {
        await firestore.doc(`auth-codes/${code}`).delete();
        res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
        return;
      }

      if (!code_verifier) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing code_verifier' });
        return;
      }

      const expectedChallenge = hashCodeVerifier(code_verifier);
      if (expectedChallenge !== codeData.code_challenge) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid code_verifier' });
        return;
      }

      const accessToken = generateSecureToken();
      const mcpRefreshToken = generateSecureToken();

      await firestore.doc(`access-tokens/${accessToken}`).set({
        google_refresh_token: codeData.google_refresh_token,
        user_email: codeData.user_email,
        client_id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      });

      await firestore.doc(`refresh-tokens/${mcpRefreshToken}`).set({
        google_refresh_token: codeData.google_refresh_token,
        user_email: codeData.user_email,
        client_id,
        created_at: new Date(),
      });

      await firestore.doc(`auth-codes/${code}`).delete();

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: mcpRefreshToken,
      });
    } else if (grant_type === 'refresh_token') {
      const rtDoc = await firestore.doc(`refresh-tokens/${refresh_token}`).get();
      if (!rtDoc.exists) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
        return;
      }
      const rtData = rtDoc.data()!;

      const newAccessToken = generateSecureToken();

      await firestore.doc(`access-tokens/${newAccessToken}`).set({
        google_refresh_token: rtData.google_refresh_token,
        user_email: rtData.user_email,
        client_id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      });

      res.json({
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
    }
  } catch (error) {
    console.error('Token error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});
```

**Step 2: Update index.ts**

Add import and use router:

```typescript
import { tokenRoutes } from './oauth/token';
app.use(tokenRoutes);
```

Remove the `app.post('/token', ...)` handler.

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/oauth/token.ts src/index.ts
git commit -m "refactor: extract OAuth token route"
```

---

## Task 8: Create OAuth Index Export

**Files:**
- Create: `src/oauth/index.ts`
- Modify: `src/index.ts`

**Step 1: Create oauth/index.ts**

Create `src/oauth/index.ts`:

```typescript
export { discoveryRoutes } from './discovery';
export { registrationRoutes } from './registration';
export { authorizeRoutes } from './authorize';
export { callbackRoutes } from './callback';
export { tokenRoutes } from './token';
export { getGoogleOAuthClient, generateSecureToken, hashCodeVerifier } from './helpers';
```

**Step 2: Update index.ts imports**

Consolidate imports in `src/index.ts`:

```typescript
import {
  discoveryRoutes,
  registrationRoutes,
  authorizeRoutes,
  callbackRoutes,
  tokenRoutes,
} from './oauth';
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/oauth/index.ts src/index.ts
git commit -m "refactor: add OAuth index export"
```

---

## Task 9: Create MCP Types

**Files:**
- Create: `src/mcp/types.ts`

**Step 1: Create mcp/types.ts**

Create `src/mcp/types.ts`:

```typescript
import { OAuth2Client } from 'googleapis-common';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

export interface Tool extends ToolDefinition {
  handler: (args: any, googleRefreshToken: string) => Promise<ToolResult>;
}

export interface McpRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: string | number;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/mcp/types.ts
git commit -m "refactor: add MCP type definitions"
```

---

## Task 10: Extract Drive Tools

**Files:**
- Create: `src/mcp/tools/drive.ts`

**Step 1: Create mcp/tools/drive.ts**

Create `src/mcp/tools/drive.ts` with all Drive-related tools. This is a large file (~400 lines) containing:
- `list_drive_files`
- `get_file_info`
- `search_drive`
- `create_folder`
- `create_file`
- `read_file`
- `move_file`
- `rename_file`

```typescript
import { google } from 'googleapis';
import { Tool, ToolResult } from '../types';
import { getGoogleOAuthClient } from '../../oauth/helpers';

async function getDriveClient(googleRefreshToken: string) {
  const googleOAuth = await getGoogleOAuthClient();
  googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
  return google.drive({ version: 'v3', auth: googleOAuth });
}

export const driveTools: Tool[] = [
  {
    name: 'list_drive_files',
    description: 'List files in your Google Drive. Returns file names, types, and modification dates.',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID to list contents of. Omit to list recent files.' },
        query: { type: 'string', description: 'Search query to filter files' },
        pageSize: { type: 'number', description: 'Number of files to return (1-100, default 20)', default: 20 },
        mimeType: { type: 'string', description: 'Filter by MIME type' },
      },
    },
    handler: async (args, googleRefreshToken): Promise<ToolResult> => {
      const drive = await getDriveClient(googleRefreshToken);
      const pageSize = Math.min(Math.max(args?.pageSize || 20, 1), 100);
      let query = 'trashed = false';

      if (args?.folderId) query += ` and '${args.folderId}' in parents`;
      if (args?.query) query += ` and ${args.query}`;
      if (args?.mimeType) query += ` and mimeType = '${args.mimeType}'`;

      const response = await drive.files.list({
        pageSize,
        q: query,
        fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink, parents)',
        orderBy: 'modifiedTime desc',
      });

      const files = response.data.files || [];
      const formattedFiles = files.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.mimeType,
        modified: f.modifiedTime,
        size: f.size ? `${Math.round(parseInt(f.size) / 1024)} KB` : 'N/A',
        link: f.webViewLink,
      }));

      return {
        content: [{ type: 'text', text: `Found ${files.length} files:\n\n${JSON.stringify(formattedFiles, null, 2)}` }],
      };
    },
  },
  // ... (get_file_info, search_drive, create_folder, create_file, read_file, move_file, rename_file)
  // Copy the full implementations from index.ts lines 925-1259
];
```

Note: The full implementation should copy all 8 Drive tools from the original file. Due to length, showing pattern above.

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/mcp/tools/drive.ts
git commit -m "refactor: extract Drive tools to mcp/tools/drive.ts"
```

---

## Task 11: Extract Docs Tools

**Files:**
- Create: `src/mcp/tools/docs.ts`

**Step 1: Create mcp/tools/docs.ts**

Create `src/mcp/tools/docs.ts` with all Docs-related tools:
- `append_to_doc`
- `find_replace_in_doc`
- `insert_text`
- `set_heading`
- `insert_image`
- `insert_link`
- `insert_list`

Follow the same pattern as drive.ts, copying implementations from index.ts lines 1317-1778.

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/mcp/tools/docs.ts
git commit -m "refactor: extract Docs tools to mcp/tools/docs.ts"
```

---

## Task 12: Extract Sheets Tools

**Files:**
- Create: `src/mcp/tools/sheets.ts`

**Step 1: Create mcp/tools/sheets.ts**

Create `src/mcp/tools/sheets.ts` with:
- `create_sheet`

Copy implementation from index.ts lines 1261-1315.

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/mcp/tools/sheets.ts
git commit -m "refactor: extract Sheets tools to mcp/tools/sheets.ts"
```

---

## Task 13: Create Tool Registry

**Files:**
- Create: `src/mcp/tools/index.ts`

**Step 1: Create mcp/tools/index.ts**

Create `src/mcp/tools/index.ts`:

```typescript
import { Tool, ToolDefinition } from '../types';
import { driveTools } from './drive';
import { docsTools } from './docs';
import { sheetsTools } from './sheets';

export const tools: Tool[] = [
  ...driveTools,
  ...docsTools,
  ...sheetsTools,
];

export const toolDefinitions: ToolDefinition[] = tools.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

export const toolsByName = new Map(tools.map(t => [t.name, t]));
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/mcp/tools/index.ts
git commit -m "refactor: add tool registry"
```

---

## Task 14: Extract MCP Handler

**Files:**
- Create: `src/mcp/handler.ts`
- Modify: `src/index.ts`

**Step 1: Create mcp/handler.ts**

Create `src/mcp/handler.ts`:

```typescript
import { Request, Response } from 'express';
import { firestore } from '../config';
import { tools, toolDefinitions, toolsByName } from './tools';

async function validateAccessToken(authHeader: string | undefined): Promise<{
  valid: boolean;
  googleRefreshToken?: string;
  userEmail?: string;
  error?: string;
}> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid Authorization header' };
  }

  const accessToken = authHeader.slice(7);
  const tokenDoc = await firestore.doc(`access-tokens/${accessToken}`).get();

  if (!tokenDoc.exists) {
    return { valid: false, error: 'Invalid access token' };
  }

  const tokenData = tokenDoc.data()!;

  if (new Date() > tokenData.expires_at.toDate()) {
    return { valid: false, error: 'Access token expired' };
  }

  return {
    valid: true,
    googleRefreshToken: tokenData.google_refresh_token,
    userEmail: tokenData.user_email,
  };
}

export async function mcpHandler(req: Request, res: Response) {
  console.log('MCP Request:', JSON.stringify(req.body));

  const { method, params, id } = req.body;

  // Handle notifications (no id)
  if (id === undefined || id === null) {
    console.log('Notification received:', method);
    res.status(200).end();
    return;
  }

  const tokenValidation = await validateAccessToken(req.headers.authorization);

  if (!tokenValidation.valid) {
    console.log('Token validation failed:', tokenValidation.error);
    res.status(401).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32001, message: tokenValidation.error },
    });
    return;
  }

  try {
    const response = await handleMcpMethod(
      method,
      params,
      id,
      tokenValidation.googleRefreshToken!,
      tokenValidation.userEmail!
    );
    console.log('MCP Response:', JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error('MCP error:', error);
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: 'Internal error' },
    });
  }
}

async function handleMcpMethod(
  method: string,
  params: any,
  id: string | number,
  googleRefreshToken: string,
  userEmail: string
) {
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'google-drive-mcp', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      };

    case 'tools/list':
      // Inject userEmail into list_drive_files description dynamically
      const toolsWithEmail = toolDefinitions.map(t => {
        if (t.name === 'list_drive_files') {
          return { ...t, description: `List files in your Google Drive (${userEmail}). Returns file names, types, and modification dates.` };
        }
        return t;
      });
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: toolsWithEmail },
      };

    case 'tools/call': {
      const { name, arguments: args } = params;
      console.log(`Tool call: ${name}`, JSON.stringify(args));

      const tool = toolsByName.get(name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true },
        };
      }

      try {
        const result = await tool.handler(args, googleRefreshToken);
        return { jsonrpc: '2.0', id, result };
      } catch (error: any) {
        console.error(`Tool ${name} error:`, error);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Error executing ${name}: ${error.message}` }], isError: true },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
```

**Step 2: Update index.ts**

Add import and wire up:

```typescript
import { mcpHandler } from './mcp/handler';

// Replace existing mcpHandler references
app.post('/', mcpHandler);
app.post('/mcp', mcpHandler);
```

Remove all MCP-related code from index.ts (validateAccessToken, getDriveClient, mcpHandler, handleMcpMethod, handleToolCall, and all tool implementations).

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/mcp/handler.ts src/index.ts
git commit -m "refactor: extract MCP handler"
```

---

## Task 15: Create MCP Index Export

**Files:**
- Create: `src/mcp/index.ts`
- Modify: `src/index.ts`

**Step 1: Create mcp/index.ts**

Create `src/mcp/index.ts`:

```typescript
export { mcpHandler } from './handler';
export { tools, toolDefinitions, toolsByName } from './tools';
export * from './types';
```

**Step 2: Update index.ts import**

```typescript
import { mcpHandler } from './mcp';
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add src/mcp/index.ts src/index.ts
git commit -m "refactor: add MCP index export"
```

---

## Task 16: Finalize Thin Orchestrator

**Files:**
- Modify: `src/index.ts`

**Step 1: Clean up index.ts**

Final `src/index.ts` should be ~40 lines:

```typescript
import express, { Request, Response } from 'express';
import { PORT } from './config';
import {
  discoveryRoutes,
  registrationRoutes,
  authorizeRoutes,
  callbackRoutes,
  tokenRoutes,
} from './oauth';
import { mcpHandler } from './mcp';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth routes
app.use(discoveryRoutes);
app.use(registrationRoutes);
app.use(authorizeRoutes);
app.use(callbackRoutes);
app.use(tokenRoutes);

// MCP routes
app.post('/', mcpHandler);
app.post('/mcp', mcpHandler);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`MCP Drive Server running on port ${PORT}`);
});
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: finalize thin orchestrator index.ts"
```

---

## Task 17: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture section**

Update `CLAUDE.md` to reflect new modular structure:

```markdown
### Modular Architecture

```
src/
  index.ts          # Express app setup, route wiring (~40 lines)
  config.ts         # Constants, Firestore, Secrets (~30 lines)
  oauth/
    index.ts        # Re-exports
    helpers.ts      # OAuth utilities
    discovery.ts    # /.well-known endpoints
    registration.ts # POST /register
    authorize.ts    # GET /authorize
    callback.ts     # GET /google/callback
    token.ts        # POST /token
  mcp/
    index.ts        # Re-exports
    types.ts        # TypeScript interfaces
    handler.ts      # JSON-RPC dispatcher
    tools/
      index.ts      # Tool registry
      drive.ts      # Drive operations
      docs.ts       # Docs operations
      sheets.ts     # Sheets operations
```
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with modular architecture"
```

---

## Task 18: Final Verification

**Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 2: Line count comparison**

Run: `wc -l src/**/*.ts src/**/**/*.ts`
Expected: Total ~1900 lines split across ~15 files, largest file <400 lines

**Step 3: Commit summary**

```bash
git log --oneline -20
```

Review all commits are present and incremental.

---

## Summary

| Task | Files Created/Modified | Purpose |
|------|----------------------|---------|
| 1 | config.ts | Extract configuration |
| 2 | oauth/helpers.ts | Extract OAuth utilities |
| 3 | oauth/discovery.ts | Extract discovery routes |
| 4 | oauth/registration.ts | Extract registration route |
| 5 | oauth/authorize.ts | Extract authorize route |
| 6 | oauth/callback.ts | Extract callback route |
| 7 | oauth/token.ts | Extract token route |
| 8 | oauth/index.ts | OAuth barrel export |
| 9 | mcp/types.ts | MCP type definitions |
| 10 | mcp/tools/drive.ts | Drive tools |
| 11 | mcp/tools/docs.ts | Docs tools |
| 12 | mcp/tools/sheets.ts | Sheets tools |
| 13 | mcp/tools/index.ts | Tool registry |
| 14 | mcp/handler.ts | MCP dispatcher |
| 15 | mcp/index.ts | MCP barrel export |
| 16 | index.ts | Thin orchestrator |
| 17 | CLAUDE.md | Documentation update |
| 18 | - | Final verification |
