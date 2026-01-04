import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { Firestore } from '@google-cloud/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { OAuth2Client } from 'googleapis-common';
import { google } from 'googleapis';

// ============ CONFIGURATION ============

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const BASE_URL = process.env.BASE_URL!; // e.g., https://mcp-drive-xyz.run.app

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',  // Create and manage files created by this app
  'https://www.googleapis.com/auth/drive',        // Full Drive access for listing/searching all files
  'https://www.googleapis.com/auth/spreadsheets', // Read and write Google Sheets
  'https://www.googleapis.com/auth/documents',    // Read and write Google Docs
  'https://www.googleapis.com/auth/userinfo.email',
];

const firestore = new Firestore();
const secrets = new SecretManagerServiceClient();

// ============ HELPERS ============

async function getGoogleOAuthCredentials(): Promise<{ clientId: string; clientSecret: string }> {
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

async function getGoogleOAuthClient(): Promise<OAuth2Client> {
  const { clientId, clientSecret } = await getGoogleOAuthCredentials();
  return new OAuth2Client(clientId, clientSecret, `${BASE_URL}/google/callback`);
}

function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashCodeVerifier(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ============ OAUTH2 DISCOVERY ============
// Claude Web looks for this to discover your OAuth endpoints

app.get('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
  res.json({
    resource: BASE_URL,
    authorization_servers: [BASE_URL],
  });
});

app.get('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
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

// ============ DYNAMIC CLIENT REGISTRATION ============
// Claude Web registers itself as an OAuth client

app.post('/register', async (req: Request, res: Response) => {
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

// ============ AUTHORIZATION ENDPOINT ============
// Claude Web redirects user here to start OAuth flow

app.get('/authorize', async (req: Request, res: Response) => {
  try {
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      response_type,
    } = req.query as Record<string, string>;

    // Validate required params
    if (!client_id || !redirect_uri || !code_challenge || response_type !== 'code') {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    // Verify client exists
    const clientDoc = await firestore.doc(`oauth-clients/${client_id}`).get();
    if (!clientDoc.exists) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }

    // Verify redirect URI is registered
    const clientData = clientDoc.data()!;
    if (!clientData.redirect_uris?.includes(redirect_uri)) {
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    // Store OAuth session
    const sessionId = generateSecureToken();
    await firestore.doc(`oauth-sessions/${sessionId}`).set({
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method: code_challenge_method || 'S256',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 min
    });

    // Redirect to Google OAuth for Drive permissions
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

// ============ GOOGLE OAUTH CALLBACK ============
// Google redirects here after user grants Drive access

app.get('/google/callback', async (req: Request, res: Response) => {
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

    // Retrieve OAuth session
    const sessionDoc = await firestore.doc(`oauth-sessions/${sessionId}`).get();
    if (!sessionDoc.exists) {
      res.status(400).send('Invalid or expired session');
      return;
    }
    const session = sessionDoc.data()!;

    // Check session expiry
    if (new Date() > session.expires_at.toDate()) {
      res.status(400).send('Session expired');
      return;
    }

    // Exchange Google code for tokens
    const googleOAuth = await getGoogleOAuthClient();
    const { tokens } = await googleOAuth.getToken(code);

    if (!tokens.refresh_token) {
      res.status(400).send(
        'No refresh token received. Please revoke access at https://myaccount.google.com/permissions and try again.'
      );
      return;
    }

    // Get user email for identification
    googleOAuth.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: googleOAuth });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email;

    // Generate authorization code for Claude Web
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
      expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 min
    });

    // Clean up session
    await firestore.doc(`oauth-sessions/${sessionId}`).delete();

    // Redirect back to Claude Web with our auth code
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

// ============ TOKEN ENDPOINT ============
// Claude Web exchanges auth code for access token

app.post('/token', async (req: Request, res: Response) => {
  try {
    const { grant_type, code, code_verifier, refresh_token, client_id, client_secret } = req.body;

    // Verify client credentials
    const clientDoc = await firestore.doc(`oauth-clients/${client_id}`).get();
    if (!clientDoc.exists || clientDoc.data()?.client_secret !== client_secret) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    if (grant_type === 'authorization_code') {
      // Look up authorization code
      const codeDoc = await firestore.doc(`auth-codes/${code}`).get();
      if (!codeDoc.exists) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid authorization code' });
        return;
      }
      const codeData = codeDoc.data()!;

      // Check expiry
      if (new Date() > codeData.expires_at.toDate()) {
        await firestore.doc(`auth-codes/${code}`).delete();
        res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
        return;
      }

      // Verify PKCE code_verifier
      if (!code_verifier) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing code_verifier' });
        return;
      }

      const expectedChallenge = hashCodeVerifier(code_verifier);
      if (expectedChallenge !== codeData.code_challenge) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid code_verifier' });
        return;
      }

      // Generate tokens for Claude Web
      const accessToken = generateSecureToken();
      const mcpRefreshToken = generateSecureToken();

      // Store access token
      await firestore.doc(`access-tokens/${accessToken}`).set({
        google_refresh_token: codeData.google_refresh_token,
        user_email: codeData.user_email,
        client_id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      });

      // Store refresh token
      await firestore.doc(`refresh-tokens/${mcpRefreshToken}`).set({
        google_refresh_token: codeData.google_refresh_token,
        user_email: codeData.user_email,
        client_id,
        created_at: new Date(),
      });

      // Delete used authorization code
      await firestore.doc(`auth-codes/${code}`).delete();

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: mcpRefreshToken,
      });
    } else if (grant_type === 'refresh_token') {
      // Look up refresh token
      const rtDoc = await firestore.doc(`refresh-tokens/${refresh_token}`).get();
      if (!rtDoc.exists) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
        return;
      }
      const rtData = rtDoc.data()!;

      // Generate new access token
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

// ============ MCP ENDPOINT ============

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

async function getDriveClient(googleRefreshToken: string) {
  const googleOAuth = await getGoogleOAuthClient();
  googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
  return google.drive({ version: 'v3', auth: googleOAuth });
}

// MCP JSON-RPC handler - handle both root path and /mcp
async function mcpHandler(req: Request, res: Response) {
  console.log('MCP Request:', JSON.stringify(req.body));

  const { method, params, id } = req.body;

  // Handle notifications (no id) - these don't require auth and don't return responses
  if (id === undefined || id === null) {
    console.log('Notification received:', method);
    // For notifications, just acknowledge with 200 OK and empty response
    res.status(200).end();
    return;
  }

  const tokenValidation = await validateAccessToken(req.headers.authorization);

  if (!tokenValidation.valid) {
    console.log('Token validation failed:', tokenValidation.error);
    res.status(401).json({
      jsonrpc: '2.0',
      id: req.body?.id,
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

// Register MCP handler on both root and /mcp paths
app.post('/', mcpHandler);
app.post('/mcp', mcpHandler);

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
          serverInfo: {
            name: 'google-drive-mcp',
            version: '1.0.0',
          },
          capabilities: {
            tools: {},
          },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'list_drive_files',
              description: `List files in your Google Drive (${userEmail}). Returns file names, types, and modification dates.`,
              inputSchema: {
                type: 'object',
                properties: {
                  folderId: {
                    type: 'string',
                    description: 'Folder ID to list contents of. Omit to list recent files.',
                  },
                  query: {
                    type: 'string',
                    description: 'Search query to filter files (e.g., "name contains \'report\'")',
                  },
                  pageSize: {
                    type: 'number',
                    description: 'Number of files to return (1-100, default 20)',
                    default: 20,
                  },
                  mimeType: {
                    type: 'string',
                    description: 'Filter by MIME type (e.g., "application/pdf", "application/vnd.google-apps.spreadsheet")',
                  },
                },
              },
            },
            {
              name: 'get_file_info',
              description: 'Get detailed information about a specific file in Google Drive.',
              inputSchema: {
                type: 'object',
                properties: {
                  fileId: {
                    type: 'string',
                    description: 'The ID of the file to get information about',
                  },
                },
                required: ['fileId'],
              },
            },
            {
              name: 'search_drive',
              description: 'Search for files in Google Drive by name or content.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string',
                    description: 'Search term to find in file names or content',
                  },
                  pageSize: {
                    type: 'number',
                    description: 'Number of results to return (1-100, default 20)',
                    default: 20,
                  },
                },
                required: ['query'],
              },
            },
            {
              name: 'create_folder',
              description: 'Create a new folder in Google Drive.',
              inputSchema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Name of the folder to create',
                  },
                  parentFolderId: {
                    type: 'string',
                    description: 'ID of the parent folder. Omit to create in root.',
                  },
                },
                required: ['name'],
              },
            },
            {
              name: 'create_file',
              description: 'Create a new file in Google Drive with text content.',
              inputSchema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Name of the file to create (include extension, e.g., "notes.txt", "data.json")',
                  },
                  content: {
                    type: 'string',
                    description: 'Text content of the file',
                  },
                  parentFolderId: {
                    type: 'string',
                    description: 'ID of the parent folder. Omit to create in root.',
                  },
                  mimeType: {
                    type: 'string',
                    description: 'MIME type of the file (default: text/plain). Use "application/vnd.google-apps.document" for Google Docs.',
                  },
                },
                required: ['name', 'content'],
              },
            },
            {
              name: 'read_file',
              description: 'Read the content of a file from Google Drive. Works with text files, Google Docs, Sheets (as CSV), and other exportable formats.',
              inputSchema: {
                type: 'object',
                properties: {
                  fileId: {
                    type: 'string',
                    description: 'The ID of the file to read',
                  },
                },
                required: ['fileId'],
              },
            },
            {
              name: 'move_file',
              description: 'Move a file or folder to a different location in Google Drive.',
              inputSchema: {
                type: 'object',
                properties: {
                  fileId: {
                    type: 'string',
                    description: 'The ID of the file or folder to move',
                  },
                  destinationFolderId: {
                    type: 'string',
                    description: 'The ID of the destination folder. Use "root" for the root of My Drive.',
                  },
                },
                required: ['fileId', 'destinationFolderId'],
              },
            },
            {
              name: 'rename_file',
              description: 'Rename a file or folder in Google Drive.',
              inputSchema: {
                type: 'object',
                properties: {
                  fileId: {
                    type: 'string',
                    description: 'The ID of the file or folder to rename',
                  },
                  newName: {
                    type: 'string',
                    description: 'The new name for the file or folder',
                  },
                },
                required: ['fileId', 'newName'],
              },
            },
            {
              name: 'create_sheet',
              description: 'Create a new Google Sheet with optional initial data.',
              inputSchema: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Name of the spreadsheet to create',
                  },
                  data: {
                    type: 'array',
                    description: 'Optional 2D array of data to populate the sheet. Each inner array is a row.',
                    items: {
                      type: 'array',
                      items: {
                        type: ['string', 'number', 'boolean'],
                      },
                    },
                  },
                  parentFolderId: {
                    type: 'string',
                    description: 'ID of the parent folder. Omit to create in root.',
                  },
                },
                required: ['name'],
              },
            },
            {
              name: 'append_to_doc',
              description: 'Append text to the end of an existing Google Doc.',
              inputSchema: {
                type: 'object',
                properties: {
                  documentId: {
                    type: 'string',
                    description: 'The ID of the Google Doc to append to',
                  },
                  text: {
                    type: 'string',
                    description: 'The text to append to the document',
                  },
                },
                required: ['documentId', 'text'],
              },
            },
            {
              name: 'find_replace_in_doc',
              description: 'Find and replace text in a Google Doc.',
              inputSchema: {
                type: 'object',
                properties: {
                  documentId: {
                    type: 'string',
                    description: 'The ID of the Google Doc',
                  },
                  findText: {
                    type: 'string',
                    description: 'The text to find',
                  },
                  replaceText: {
                    type: 'string',
                    description: 'The text to replace it with',
                  },
                  matchCase: {
                    type: 'boolean',
                    description: 'Whether to match case (default: false)',
                  },
                },
                required: ['documentId', 'findText', 'replaceText'],
              },
            },
            {
              name: 'insert_text',
              description: 'Insert text at a specific position in a Google Doc with optional formatting.',
              inputSchema: {
                type: 'object',
                properties: {
                  documentId: {
                    type: 'string',
                    description: 'The ID of the Google Doc',
                  },
                  text: {
                    type: 'string',
                    description: 'The text to insert',
                  },
                  position: {
                    type: 'string',
                    enum: ['start', 'end'],
                    description: 'Where to insert: "start" or "end" of the document (default: end)',
                  },
                  formatting: {
                    type: 'object',
                    description: 'Optional formatting to apply',
                    properties: {
                      bold: { type: 'boolean', description: 'Make text bold' },
                      italic: { type: 'boolean', description: 'Make text italic' },
                      underline: { type: 'boolean', description: 'Underline the text' },
                      fontSize: { type: 'number', description: 'Font size in points (e.g., 12, 14, 18)' },
                      foregroundColor: {
                        type: 'object',
                        description: 'Text color as RGB (0-1 values)',
                        properties: {
                          red: { type: 'number' },
                          green: { type: 'number' },
                          blue: { type: 'number' },
                        },
                      },
                    },
                  },
                },
                required: ['documentId', 'text'],
              },
            },
            {
              name: 'set_heading',
              description: 'Convert a paragraph containing specific text to a heading style.',
              inputSchema: {
                type: 'object',
                properties: {
                  documentId: {
                    type: 'string',
                    description: 'The ID of the Google Doc',
                  },
                  text: {
                    type: 'string',
                    description: 'The text of the paragraph to convert to a heading',
                  },
                  level: {
                    type: 'number',
                    enum: [1, 2, 3, 4, 5, 6],
                    description: 'Heading level (1-6, where 1 is the largest)',
                  },
                },
                required: ['documentId', 'text', 'level'],
              },
            },
            {
              name: 'insert_image',
              description: 'Insert an image into a Google Doc from a URL.',
              inputSchema: {
                type: 'object',
                properties: {
                  documentId: {
                    type: 'string',
                    description: 'The ID of the Google Doc',
                  },
                  imageUrl: {
                    type: 'string',
                    description: 'The URL of the image to insert (must be publicly accessible)',
                  },
                  position: {
                    type: 'string',
                    enum: ['start', 'end'],
                    description: 'Where to insert: "start" or "end" of the document (default: end)',
                  },
                  width: {
                    type: 'number',
                    description: 'Optional width in points (72 points = 1 inch)',
                  },
                  height: {
                    type: 'number',
                    description: 'Optional height in points (72 points = 1 inch)',
                  },
                },
                required: ['documentId', 'imageUrl'],
              },
            },
            {
              name: 'insert_link',
              description: 'Insert a hyperlink into a Google Doc.',
              inputSchema: {
                type: 'object',
                properties: {
                  documentId: {
                    type: 'string',
                    description: 'The ID of the Google Doc',
                  },
                  text: {
                    type: 'string',
                    description: 'The display text for the link',
                  },
                  url: {
                    type: 'string',
                    description: 'The URL the link points to',
                  },
                  position: {
                    type: 'string',
                    enum: ['start', 'end'],
                    description: 'Where to insert: "start" or "end" of the document (default: end)',
                  },
                },
                required: ['documentId', 'text', 'url'],
              },
            },
            {
              name: 'insert_list',
              description: 'Insert a bulleted or numbered list into a Google Doc.',
              inputSchema: {
                type: 'object',
                properties: {
                  documentId: {
                    type: 'string',
                    description: 'The ID of the Google Doc',
                  },
                  items: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array of list items',
                  },
                  listType: {
                    type: 'string',
                    enum: ['bullet', 'numbered'],
                    description: 'Type of list: "bullet" or "numbered" (default: bullet)',
                  },
                  position: {
                    type: 'string',
                    enum: ['start', 'end'],
                    description: 'Where to insert: "start" or "end" of the document (default: end)',
                  },
                },
                required: ['documentId', 'items'],
              },
            },
          ],
        },
      };

    case 'tools/call': {
      const toolResult = await handleToolCall(params, googleRefreshToken);
      return {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

async function handleToolCall(params: any, googleRefreshToken: string) {
  const { name, arguments: args } = params;
  console.log(`Tool call: ${name}`, JSON.stringify(args));

  const drive = await getDriveClient(googleRefreshToken);

  try {
    switch (name) {
      case 'list_drive_files': {
        const pageSize = Math.min(Math.max(args?.pageSize || 20, 1), 100);
        let query = 'trashed = false';

        if (args?.folderId) {
          query += ` and '${args.folderId}' in parents`;
        }
        if (args?.query) {
          query += ` and ${args.query}`;
        }
        if (args?.mimeType) {
          query += ` and mimeType = '${args.mimeType}'`;
        }

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
          content: [
            {
              type: 'text',
              text: `Found ${files.length} files:\n\n${JSON.stringify(formattedFiles, null, 2)}`,
            },
          ],
        };
      }

      case 'get_file_info': {
        if (!args?.fileId) {
          return {
            content: [{ type: 'text', text: 'Error: fileId is required' }],
            isError: true,
          };
        }

        const response = await drive.files.get({
          fileId: args.fileId,
          fields: 'id, name, mimeType, modifiedTime, createdTime, size, webViewLink, owners, shared, permissions',
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      }

      case 'search_drive': {
        if (!args?.query) {
          return {
            content: [{ type: 'text', text: 'Error: query is required' }],
            isError: true,
          };
        }

        const pageSize = Math.min(Math.max(args?.pageSize || 20, 1), 100);
        const searchQuery = `fullText contains '${args.query.replace(/'/g, "\\'")}' and trashed = false`;

        const response = await drive.files.list({
          pageSize,
          q: searchQuery,
          fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
          orderBy: 'modifiedTime desc',
        });

        const files = response.data.files || [];

        return {
          content: [
            {
              type: 'text',
              text: `Search results for "${args.query}":\n\n${JSON.stringify(files, null, 2)}`,
            },
          ],
        };
      }

      case 'create_folder': {
        if (!args?.name) {
          return {
            content: [{ type: 'text', text: 'Error: name is required' }],
            isError: true,
          };
        }

        const folderMetadata: any = {
          name: args.name,
          mimeType: 'application/vnd.google-apps.folder',
        };

        if (args.parentFolderId) {
          folderMetadata.parents = [args.parentFolderId];
        }

        const response = await drive.files.create({
          requestBody: folderMetadata,
          fields: 'id, name, webViewLink',
        });

        return {
          content: [
            {
              type: 'text',
              text: `Folder created successfully!\n\n${JSON.stringify({
                id: response.data.id,
                name: response.data.name,
                link: response.data.webViewLink,
              }, null, 2)}`,
            },
          ],
        };
      }

      case 'create_file': {
        if (!args?.name) {
          return {
            content: [{ type: 'text', text: 'Error: name is required' }],
            isError: true,
          };
        }
        if (args?.content === undefined) {
          return {
            content: [{ type: 'text', text: 'Error: content is required' }],
            isError: true,
          };
        }

        const mimeType = args.mimeType || 'text/plain';

        const fileMetadata: any = {
          name: args.name,
        };

        if (args.parentFolderId) {
          fileMetadata.parents = [args.parentFolderId];
        }

        // For Google Docs, we need to convert from text
        if (mimeType === 'application/vnd.google-apps.document') {
          fileMetadata.mimeType = mimeType;
          const response = await drive.files.create({
            requestBody: fileMetadata,
            media: {
              mimeType: 'text/plain',
              body: args.content,
            },
            fields: 'id, name, webViewLink, mimeType',
          });

          return {
            content: [
              {
                type: 'text',
                text: `Google Doc created successfully!\n\n${JSON.stringify({
                  id: response.data.id,
                  name: response.data.name,
                  type: response.data.mimeType,
                  link: response.data.webViewLink,
                }, null, 2)}`,
              },
            ],
          };
        }

        // For regular files, create with the specified content
        const { Readable } = await import('stream');
        const contentStream = Readable.from([args.content]);

        const response = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: mimeType,
            body: contentStream,
          },
          fields: 'id, name, webViewLink, mimeType, size',
        });

        return {
          content: [
            {
              type: 'text',
              text: `File created successfully!\n\n${JSON.stringify({
                id: response.data.id,
                name: response.data.name,
                type: response.data.mimeType,
                size: response.data.size,
                link: response.data.webViewLink,
              }, null, 2)}`,
            },
          ],
        };
      }

      case 'read_file': {
        if (!args?.fileId) {
          return {
            content: [{ type: 'text', text: 'Error: fileId is required' }],
            isError: true,
          };
        }

        // First, get file metadata to determine type
        const fileMetadata = await drive.files.get({
          fileId: args.fileId,
          fields: 'id, name, mimeType, size',
        });

        const mimeType = fileMetadata.data.mimeType || '';
        const fileName = fileMetadata.data.name || 'unknown';

        // Google Workspace files need to be exported
        const googleDocsTypes: Record<string, { exportMime: string; label: string }> = {
          'application/vnd.google-apps.document': { exportMime: 'text/plain', label: 'Google Doc' },
          'application/vnd.google-apps.spreadsheet': { exportMime: 'text/csv', label: 'Google Sheet' },
          'application/vnd.google-apps.presentation': { exportMime: 'text/plain', label: 'Google Slides' },
          'application/vnd.google-apps.drawing': { exportMime: 'image/svg+xml', label: 'Google Drawing' },
        };

        let content: string;

        if (googleDocsTypes[mimeType]) {
          // Export Google Workspace files
          const exportType = googleDocsTypes[mimeType];
          const response = await drive.files.export({
            fileId: args.fileId,
            mimeType: exportType.exportMime,
          }, {
            responseType: 'text',
          });

          content = response.data as string;

          return {
            content: [
              {
                type: 'text',
                text: `**${fileName}** (${exportType.label})\n\n${content}`,
              },
            ],
          };
        }

        // For regular files, download content
        const response = await drive.files.get({
          fileId: args.fileId,
          alt: 'media',
        }, {
          responseType: 'text',
        });

        content = response.data as string;

        // Truncate very large files
        const maxLength = 100000; // ~100KB of text
        if (content.length > maxLength) {
          content = content.substring(0, maxLength) + '\n\n... [Content truncated - file too large]';
        }

        return {
          content: [
            {
              type: 'text',
              text: `**${fileName}** (${mimeType})\n\n${content}`,
            },
          ],
        };
      }

      case 'move_file': {
        if (!args?.fileId) {
          return {
            content: [{ type: 'text', text: 'Error: fileId is required' }],
            isError: true,
          };
        }
        if (!args?.destinationFolderId) {
          return {
            content: [{ type: 'text', text: 'Error: destinationFolderId is required' }],
            isError: true,
          };
        }

        // Get current parents to remove them
        const file = await drive.files.get({
          fileId: args.fileId,
          fields: 'id, name, parents',
        });

        const previousParents = file.data.parents?.join(',') || '';

        // Move file by updating parents
        const response = await drive.files.update({
          fileId: args.fileId,
          addParents: args.destinationFolderId,
          removeParents: previousParents,
          fields: 'id, name, parents, webViewLink',
        });

        return {
          content: [
            {
              type: 'text',
              text: `File moved successfully!\n\n${JSON.stringify({
                id: response.data.id,
                name: response.data.name,
                newParent: response.data.parents?.[0],
                link: response.data.webViewLink,
              }, null, 2)}`,
            },
          ],
        };
      }

      case 'rename_file': {
        if (!args?.fileId) {
          return {
            content: [{ type: 'text', text: 'Error: fileId is required' }],
            isError: true,
          };
        }
        if (!args?.newName) {
          return {
            content: [{ type: 'text', text: 'Error: newName is required' }],
            isError: true,
          };
        }

        // Get current file info for the response
        const currentFile = await drive.files.get({
          fileId: args.fileId,
          fields: 'id, name',
        });

        const oldName = currentFile.data.name;

        // Rename the file
        const response = await drive.files.update({
          fileId: args.fileId,
          requestBody: {
            name: args.newName,
          },
          fields: 'id, name, webViewLink, mimeType',
        });

        return {
          content: [
            {
              type: 'text',
              text: `File renamed successfully!\n\n${JSON.stringify({
                id: response.data.id,
                oldName: oldName,
                newName: response.data.name,
                type: response.data.mimeType,
                link: response.data.webViewLink,
              }, null, 2)}`,
            },
          ],
        };
      }

      case 'create_sheet': {
        if (!args?.name) {
          return {
            content: [{ type: 'text', text: 'Error: name is required' }],
            isError: true,
          };
        }

        // Create the spreadsheet using Drive API
        const fileMetadata: any = {
          name: args.name,
          mimeType: 'application/vnd.google-apps.spreadsheet',
        };

        if (args.parentFolderId) {
          fileMetadata.parents = [args.parentFolderId];
        }

        const createResponse = await drive.files.create({
          requestBody: fileMetadata,
          fields: 'id, name, webViewLink',
        });

        const spreadsheetId = createResponse.data.id!;

        // If data is provided, populate the sheet using Sheets API
        if (args.data && Array.isArray(args.data) && args.data.length > 0) {
          const googleOAuth = await getGoogleOAuthClient();
          googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
          const sheets = google.sheets({ version: 'v4', auth: googleOAuth });

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Sheet1!A1',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: args.data,
            },
          });
        }

        return {
          content: [
            {
              type: 'text',
              text: `Google Sheet created successfully!\n\n${JSON.stringify({
                id: spreadsheetId,
                name: createResponse.data.name,
                link: createResponse.data.webViewLink,
                rowsAdded: args.data?.length || 0,
              }, null, 2)}`,
            },
          ],
        };
      }

      case 'append_to_doc': {
        if (!args?.documentId) {
          return {
            content: [{ type: 'text', text: 'Error: documentId is required' }],
            isError: true,
          };
        }
        if (!args?.text) {
          return {
            content: [{ type: 'text', text: 'Error: text is required' }],
            isError: true,
          };
        }

        const googleOAuth = await getGoogleOAuthClient();
        googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
        const docs = google.docs({ version: 'v1', auth: googleOAuth });

        // Get document to find the end index
        const doc = await docs.documents.get({ documentId: args.documentId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Insert text at the end (before the final newline)
        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: endIndex - 1 },
                  text: args.text,
                },
              },
            ],
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Text appended successfully to document "${doc.data.title}".\n\nAppended ${args.text.length} characters.`,
            },
          ],
        };
      }

      case 'find_replace_in_doc': {
        if (!args?.documentId) {
          return {
            content: [{ type: 'text', text: 'Error: documentId is required' }],
            isError: true,
          };
        }
        if (!args?.findText) {
          return {
            content: [{ type: 'text', text: 'Error: findText is required' }],
            isError: true,
          };
        }
        if (args?.replaceText === undefined) {
          return {
            content: [{ type: 'text', text: 'Error: replaceText is required' }],
            isError: true,
          };
        }

        const googleOAuth = await getGoogleOAuthClient();
        googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
        const docs = google.docs({ version: 'v1', auth: googleOAuth });

        const response = await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                replaceAllText: {
                  containsText: {
                    text: args.findText,
                    matchCase: args.matchCase || false,
                  },
                  replaceText: args.replaceText,
                },
              },
            ],
          },
        });

        const occurrences = response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;

        return {
          content: [
            {
              type: 'text',
              text: `Find and replace completed.\n\nReplaced ${occurrences} occurrence(s) of "${args.findText}" with "${args.replaceText}".`,
            },
          ],
        };
      }

      case 'insert_text': {
        if (!args?.documentId) {
          return {
            content: [{ type: 'text', text: 'Error: documentId is required' }],
            isError: true,
          };
        }
        if (!args?.text) {
          return {
            content: [{ type: 'text', text: 'Error: text is required' }],
            isError: true,
          };
        }

        const googleOAuth = await getGoogleOAuthClient();
        googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
        const docs = google.docs({ version: 'v1', auth: googleOAuth });

        // Get document to find positions
        const doc = await docs.documents.get({ documentId: args.documentId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Determine insert position
        const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

        const requests: any[] = [
          {
            insertText: {
              location: { index: insertIndex },
              text: args.text,
            },
          },
        ];

        // Apply formatting if specified
        if (args.formatting) {
          const textStyle: any = {};
          const fields: string[] = [];

          if (args.formatting.bold !== undefined) {
            textStyle.bold = args.formatting.bold;
            fields.push('bold');
          }
          if (args.formatting.italic !== undefined) {
            textStyle.italic = args.formatting.italic;
            fields.push('italic');
          }
          if (args.formatting.underline !== undefined) {
            textStyle.underline = args.formatting.underline;
            fields.push('underline');
          }
          if (args.formatting.fontSize) {
            textStyle.fontSize = { magnitude: args.formatting.fontSize, unit: 'PT' };
            fields.push('fontSize');
          }
          if (args.formatting.foregroundColor) {
            textStyle.foregroundColor = { color: { rgbColor: args.formatting.foregroundColor } };
            fields.push('foregroundColor');
          }

          if (fields.length > 0) {
            requests.push({
              updateTextStyle: {
                range: {
                  startIndex: insertIndex,
                  endIndex: insertIndex + args.text.length,
                },
                textStyle,
                fields: fields.join(','),
              },
            });
          }
        }

        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: { requests },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Text inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".\n\nInserted ${args.text.length} characters.`,
            },
          ],
        };
      }

      case 'set_heading': {
        if (!args?.documentId) {
          return {
            content: [{ type: 'text', text: 'Error: documentId is required' }],
            isError: true,
          };
        }
        if (!args?.text) {
          return {
            content: [{ type: 'text', text: 'Error: text is required' }],
            isError: true,
          };
        }
        if (!args?.level || args.level < 1 || args.level > 6) {
          return {
            content: [{ type: 'text', text: 'Error: level must be between 1 and 6' }],
            isError: true,
          };
        }

        const googleOAuth = await getGoogleOAuthClient();
        googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
        const docs = google.docs({ version: 'v1', auth: googleOAuth });

        // Get document to find the text
        const doc = await docs.documents.get({ documentId: args.documentId });

        // Find the paragraph containing the text
        let startIndex = -1;
        let endIndex = -1;

        const content = doc.data.body?.content || [];
        for (const element of content) {
          if (element.paragraph) {
            const paragraphText = element.paragraph.elements
              ?.map((e: any) => e.textRun?.content || '')
              .join('') || '';

            if (paragraphText.includes(args.text)) {
              startIndex = element.startIndex || 0;
              endIndex = element.endIndex || 0;
              break;
            }
          }
        }

        if (startIndex === -1) {
          return {
            content: [{ type: 'text', text: `Error: Could not find paragraph containing "${args.text}"` }],
            isError: true,
          };
        }

        const headingType = `HEADING_${args.level}`;

        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                updateParagraphStyle: {
                  range: { startIndex, endIndex },
                  paragraphStyle: { namedStyleType: headingType },
                  fields: 'namedStyleType',
                },
              },
            ],
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Heading applied successfully. Set "${args.text}" as Heading ${args.level}.`,
            },
          ],
        };
      }

      case 'insert_image': {
        if (!args?.documentId) {
          return {
            content: [{ type: 'text', text: 'Error: documentId is required' }],
            isError: true,
          };
        }
        if (!args?.imageUrl) {
          return {
            content: [{ type: 'text', text: 'Error: imageUrl is required' }],
            isError: true,
          };
        }

        const googleOAuth = await getGoogleOAuthClient();
        googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
        const docs = google.docs({ version: 'v1', auth: googleOAuth });

        // Get document to find positions
        const doc = await docs.documents.get({ documentId: args.documentId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Determine insert position
        const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

        const imageRequest: any = {
          insertInlineImage: {
            location: { index: insertIndex },
            uri: args.imageUrl,
          },
        };

        // Add size if specified
        if (args.width || args.height) {
          imageRequest.insertInlineImage.objectSize = {};
          if (args.width) {
            imageRequest.insertInlineImage.objectSize.width = { magnitude: args.width, unit: 'PT' };
          }
          if (args.height) {
            imageRequest.insertInlineImage.objectSize.height = { magnitude: args.height, unit: 'PT' };
          }
        }

        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [imageRequest],
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Image inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".`,
            },
          ],
        };
      }

      case 'insert_link': {
        if (!args?.documentId) {
          return {
            content: [{ type: 'text', text: 'Error: documentId is required' }],
            isError: true,
          };
        }
        if (!args?.text) {
          return {
            content: [{ type: 'text', text: 'Error: text is required' }],
            isError: true,
          };
        }
        if (!args?.url) {
          return {
            content: [{ type: 'text', text: 'Error: url is required' }],
            isError: true,
          };
        }

        const googleOAuth = await getGoogleOAuthClient();
        googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
        const docs = google.docs({ version: 'v1', auth: googleOAuth });

        // Get document to find positions
        const doc = await docs.documents.get({ documentId: args.documentId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Determine insert position
        const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: {
            requests: [
              {
                insertText: {
                  location: { index: insertIndex },
                  text: args.text,
                },
              },
              {
                updateTextStyle: {
                  range: {
                    startIndex: insertIndex,
                    endIndex: insertIndex + args.text.length,
                  },
                  textStyle: {
                    link: { url: args.url },
                  },
                  fields: 'link',
                },
              },
            ],
          },
        });

        return {
          content: [
            {
              type: 'text',
              text: `Link inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".\n\nLink text: "${args.text}"\nURL: ${args.url}`,
            },
          ],
        };
      }

      case 'insert_list': {
        if (!args?.documentId) {
          return {
            content: [{ type: 'text', text: 'Error: documentId is required' }],
            isError: true,
          };
        }
        if (!args?.items || !Array.isArray(args.items) || args.items.length === 0) {
          return {
            content: [{ type: 'text', text: 'Error: items array is required and must not be empty' }],
            isError: true,
          };
        }

        const googleOAuth = await getGoogleOAuthClient();
        googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
        const docs = google.docs({ version: 'v1', auth: googleOAuth });

        // Get document to find positions
        const doc = await docs.documents.get({ documentId: args.documentId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Determine insert position
        const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

        // Create the list text with newlines
        const listText = args.items.map((item: string) => item).join('\n') + '\n';

        const requests: any[] = [
          {
            insertText: {
              location: { index: insertIndex },
              text: listText,
            },
          },
        ];

        // Apply bullet/numbered list formatting
        const bulletPreset = args.listType === 'numbered'
          ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
          : 'BULLET_DISC_CIRCLE_SQUARE';

        requests.push({
          createParagraphBullets: {
            range: {
              startIndex: insertIndex,
              endIndex: insertIndex + listText.length,
            },
            bulletPreset,
          },
        });

        await docs.documents.batchUpdate({
          documentId: args.documentId,
          requestBody: { requests },
        });

        return {
          content: [
            {
              type: 'text',
              text: `${args.listType === 'numbered' ? 'Numbered' : 'Bulleted'} list inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".\n\nInserted ${args.items.length} items.`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error: any) {
    console.error(`Tool ${name} error:`, error);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

// ============ HEALTH CHECK ============

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============ START SERVER ============

app.listen(PORT, () => {
  console.log(`MCP Drive Server running on port ${PORT}`);
  console.log(`OAuth metadata: ${BASE_URL}/.well-known/oauth-authorization-server`);
});
