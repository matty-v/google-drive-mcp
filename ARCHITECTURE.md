# MCP Server Architecture for Claude Web

This document describes the architecture for building MCP servers that work with Claude Web, using OAuth2 authentication and Google Cloud Run.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CLAUDE WEB                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         YOUR MCP SERVER (Cloud Run)                         │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │  OAuth2 Layer   │  │   MCP Layer     │  │    Your Service Layer       │ │
│  │                 │  │                 │  │                             │ │
│  │ /.well-known/   │  │ POST /          │  │  Google Drive API           │ │
│  │ /register       │  │ - initialize    │  │  Slack API                  │ │
│  │ /authorize      │  │ - tools/list    │  │  GitHub API                 │ │
│  │ /token          │  │ - tools/call    │  │  Any other API...           │ │
│  │ /callback       │  │ - notifications │  │                             │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
             ┌───────────┐  ┌─────────────┐  ┌───────────────┐
             │ Firestore │  │   Secret    │  │  External API │
             │ (tokens)  │  │   Manager   │  │  (Drive, etc) │
             └───────────┘  └─────────────┘  └───────────────┘
```

## Key Components

### 1. OAuth2 Layer (Required for Claude Web)

Claude Web uses OAuth2 to authenticate with your MCP server. Your server must implement:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/.well-known/oauth-authorization-server` | GET | OAuth2 server metadata discovery |
| `/register` | POST | Dynamic client registration |
| `/authorize` | GET | Start authorization flow |
| `/token` | POST | Exchange code for tokens |
| `/{provider}/callback` | GET | OAuth callback from external provider |

### 2. MCP Layer (JSON-RPC over HTTP)

Claude Web communicates with your MCP server using JSON-RPC 2.0 over HTTP POST to the root path `/`.

| Method | Purpose |
|--------|---------|
| `initialize` | Handshake, returns server info and capabilities |
| `tools/list` | Returns available tools |
| `tools/call` | Executes a tool |
| `notifications/*` | Notifications (no response required) |

### 3. Service Layer (Your Business Logic)

This is where you implement your actual functionality - calling external APIs, processing data, etc.

---

## OAuth2 Flow (Detailed)

```
┌──────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────────────┐
│  Claude  │     │  Your Server  │     │   External   │     │  Firestore   │
│   Web    │     │  (Cloud Run)  │     │   Provider   │     │              │
└────┬─────┘     └───────┬───────┘     └──────┬───────┘     └──────┬───────┘
     │                   │                    │                    │
     │  1. GET /.well-known/oauth-authorization-server             │
     │──────────────────>│                    │                    │
     │  {endpoints...}   │                    │                    │
     │<──────────────────│                    │                    │
     │                   │                    │                    │
     │  2. POST /register                     │                    │
     │──────────────────>│                    │                    │
     │                   │  Store client      │                    │
     │                   │────────────────────────────────────────>│
     │  {client_id,      │                    │                    │
     │   client_secret}  │                    │                    │
     │<──────────────────│                    │                    │
     │                   │                    │                    │
     │  3. GET /authorize?client_id=...&redirect_uri=...          │
     │──────────────────>│                    │                    │
     │                   │  Store session     │                    │
     │                   │────────────────────────────────────────>│
     │                   │                    │                    │
     │  302 Redirect to external provider    │                    │
     │<──────────────────│                    │                    │
     │                   │                    │                    │
     │  4. User authenticates with provider  │                    │
     │──────────────────────────────────────>│                    │
     │                   │                    │                    │
     │  5. Provider redirects to /callback   │                    │
     │                   │<───────────────────│                    │
     │                   │                    │                    │
     │                   │  Exchange code     │                    │
     │                   │───────────────────>│                    │
     │                   │  {access_token,    │                    │
     │                   │   refresh_token}   │                    │
     │                   │<───────────────────│                    │
     │                   │                    │                    │
     │                   │  Store tokens      │                    │
     │                   │────────────────────────────────────────>│
     │                   │                    │                    │
     │  302 Redirect to Claude with auth code│                    │
     │<──────────────────│                    │                    │
     │                   │                    │                    │
     │  6. POST /token (exchange code)       │                    │
     │──────────────────>│                    │                    │
     │                   │  Verify & create   │                    │
     │                   │  access token      │                    │
     │                   │────────────────────────────────────────>│
     │  {access_token,   │                    │                    │
     │   refresh_token}  │                    │                    │
     │<──────────────────│                    │                    │
     │                   │                    │                    │
     │  7. MCP calls with Bearer token       │                    │
     │──────────────────>│                    │                    │
     │                   │  Validate token    │                    │
     │                   │────────────────────────────────────────>│
     │                   │                    │                    │
     │                   │  Call external API │                    │
     │                   │───────────────────>│                    │
     │                   │<───────────────────│                    │
     │  {result}         │                    │                    │
     │<──────────────────│                    │                    │
```

---

## MCP Protocol Implementation

### Request/Response Format

All MCP communication uses JSON-RPC 2.0:

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "my_tool",
    "arguments": {"arg1": "value1"}
  },
  "id": 1
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {"type": "text", "text": "Tool output here"}
    ]
  }
}
```

### Critical Implementation Details

#### 1. Handle Notifications (No ID)

Notifications have no `id` field and should NOT return a response:

```typescript
if (id === undefined || id === null) {
  // This is a notification - just acknowledge
  res.status(200).end();
  return;
}
```

#### 2. Always Include ID in Responses

Every response to a request (has `id`) MUST include the same `id`:

```typescript
return {
  jsonrpc: '2.0',
  id,  // CRITICAL: Must match request id
  result: { ... }
};
```

#### 3. Tool Results Format

Tool results must have this structure:

```typescript
{
  content: [
    { type: 'text', text: 'Your output here' }
  ],
  isError?: boolean  // Optional: true if this is an error
}
```

### Required MCP Methods

```typescript
switch (method) {
  case 'initialize':
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'your-server-name',
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
            name: 'tool_name',
            description: 'What this tool does',
            inputSchema: {
              type: 'object',
              properties: {
                param1: { type: 'string', description: '...' },
              },
              required: ['param1'],
            },
          },
        ],
      },
    };

  case 'tools/call':
    const result = await executeYourTool(params);
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: result }],
      },
    };
}
```

---

## Firestore Collections Schema

```
firestore/
├── oauth-clients/
│   └── {client_id}/
│       ├── client_name: string
│       ├── client_secret: string
│       ├── redirect_uris: string[]
│       └── created_at: timestamp
│
├── oauth-sessions/
│   └── {session_id}/
│       ├── client_id: string
│       ├── redirect_uri: string
│       ├── state: string
│       ├── code_challenge: string
│       ├── code_challenge_method: string
│       ├── created_at: timestamp
│       └── expires_at: timestamp
│
├── auth-codes/
│   └── {code}/
│       ├── provider_refresh_token: string
│       ├── user_email: string
│       ├── client_id: string
│       ├── code_challenge: string
│       ├── created_at: timestamp
│       └── expires_at: timestamp
│
├── access-tokens/
│   └── {token}/
│       ├── provider_refresh_token: string
│       ├── user_email: string
│       ├── client_id: string
│       ├── created_at: timestamp
│       └── expires_at: timestamp
│
└── refresh-tokens/
    └── {token}/
        ├── provider_refresh_token: string
        ├── user_email: string
        ├── client_id: string
        └── created_at: timestamp
```

---

## Adapting for Other Services

### Step 1: Replace the External Provider

Instead of Google OAuth, use your service's OAuth:

```typescript
// Example: Slack OAuth
const SLACK_SCOPES = ['channels:read', 'chat:write'];

app.get('/authorize', async (req, res) => {
  // ... store session ...

  const slackAuthUrl = `https://slack.com/oauth/v2/authorize?` +
    `client_id=${SLACK_CLIENT_ID}` +
    `&scope=${SLACK_SCOPES.join(',')}` +
    `&redirect_uri=${BASE_URL}/slack/callback` +
    `&state=${sessionId}`;

  res.redirect(slackAuthUrl);
});

app.get('/slack/callback', async (req, res) => {
  // Exchange code for Slack tokens
  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code: req.query.code,
    }),
  });
  // ... store tokens and redirect back to Claude ...
});
```

### Step 2: Define Your Tools

```typescript
case 'tools/list':
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tools: [
        {
          name: 'send_slack_message',
          description: 'Send a message to a Slack channel',
          inputSchema: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel ID or name' },
              message: { type: 'string', description: 'Message text' },
            },
            required: ['channel', 'message'],
          },
        },
        {
          name: 'list_channels',
          description: 'List available Slack channels',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    },
  };
```

### Step 3: Implement Tool Handlers

```typescript
async function handleToolCall(params, providerRefreshToken) {
  const { name, arguments: args } = params;

  // Get fresh access token using refresh token
  const accessToken = await refreshProviderToken(providerRefreshToken);

  switch (name) {
    case 'send_slack_message':
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: args.channel,
          text: args.message,
        }),
      });
      const result = await response.json();
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };

    // ... other tools ...
  }
}
```

---

## Project Template

```
my-mcp-server/
├── src/
│   └── index.ts          # All-in-one server file
├── package.json
├── tsconfig.json
├── Dockerfile
└── .gcloudignore
```

### package.json

```json
{
  "name": "my-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@google-cloud/firestore": "^7.3.0",
    "@google-cloud/secret-manager": "^5.5.0",
    "express": "^4.18.2"
    // Add your service's SDK here
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.0"
  }
}
```

### Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

---

## Deployment Checklist

### Google Cloud Setup

```bash
# 1. Set project
export PROJECT_ID="your-project"
export REGION="us-central1"
gcloud config set project $PROJECT_ID

# 2. Enable APIs
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com

# 3. Create Firestore database
gcloud firestore databases create --location=$REGION

# 4. Create OAuth credentials for your external provider
#    (Google Cloud Console, Slack App Dashboard, etc.)

# 5. Store secrets
echo -n "your-client-id" | gcloud secrets create oauth-client-id --data-file=-
echo -n "your-client-secret" | gcloud secrets create oauth-client-secret --data-file=-

# 6. Build and deploy
npm run build
gcloud run deploy my-mcp-server \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT=$PROJECT_ID,BASE_URL=https://my-mcp-server-xxx.run.app"

# 7. Get service URL and update BASE_URL
SERVICE_URL=$(gcloud run services describe my-mcp-server --region $REGION --format="value(status.url)")
gcloud run services update my-mcp-server --region $REGION --set-env-vars "BASE_URL=$SERVICE_URL,GCP_PROJECT=$PROJECT_ID"

# 8. Grant IAM permissions
SA_EMAIL="${PROJECT_ID}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/datastore.user"
gcloud secrets add-iam-policy-binding oauth-client-id \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding oauth-client-secret \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

### External Provider Setup

1. Create OAuth application in provider's dashboard
2. Set redirect URI to: `https://your-server.run.app/{provider}/callback`
3. Note the client ID and secret
4. Store in Secret Manager

### Connect to Claude Web

1. Go to claude.ai
2. Settings → Integrations
3. Add MCP server with your Cloud Run URL
4. Click Connect and authenticate

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Error connecting to MCP server" | OAuth endpoints not working | Check `/.well-known/oauth-authorization-server` returns valid JSON |
| "Error occurred during tool execution" | Missing `id` in response | Ensure all responses include the request `id` |
| Auth works but tools fail | Notifications returning errors | Handle notifications (no `id`) with empty 200 response |
| "Permission denied" to Firestore | Missing IAM role | Add `roles/datastore.user` to Cloud Run service account |
| "Invalid client" | Client not registered | Check Firestore `oauth-clients` collection |
| Token refresh fails | Refresh token not stored | Ensure provider returns refresh token (may need `prompt=consent`) |

---

## Security Considerations

1. **Always use HTTPS** (Cloud Run provides this automatically)
2. **Validate redirect URIs** against registered URIs
3. **Use PKCE** (code_challenge/code_verifier) for OAuth
4. **Short-lived access tokens** (1 hour recommended)
5. **Store secrets in Secret Manager**, not environment variables
6. **Minimal scopes** - only request what you need
7. **Validate all inputs** in tool handlers
