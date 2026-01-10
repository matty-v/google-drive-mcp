# Auth Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Firestore-based auth with in-memory state + JWT tokens, matching the github-mcp auth pattern.

**Architecture:** OAuth 2.1 with PKCE using Google for user authentication, JWT tokens for MCP access, single-user email allowlist, in-memory state with auto-cleanup.

**Tech Stack:** Express, google-auth-library, jsonwebtoken, uuid

---

## Task 1: Update Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Update package.json**

Replace dependencies section:

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "google-auth-library": "^9.0.0",
    "googleapis": "^140.0.0",
    "jsonwebtoken": "^9.0.0",
    "uuid": "^9.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/node": "^20.10.0",
    "@types/supertest": "^6.0.3",
    "@types/uuid": "^9.0.0",
    "@vitest/coverage-v8": "^4.0.16",
    "supertest": "^7.1.4",
    "typescript": "^5.3.0",
    "vitest": "^4.0.16"
  }
}
```

**Step 2: Install dependencies**

Run: `npm install`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: update dependencies for JWT auth"
```

---

## Task 2: Create Config Module

**Files:**
- Replace: `src/config.ts`

**Step 1: Write new config.ts**

```typescript
// Validate required config at startup
const required = [
  "BASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ALLOWED_EMAIL",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || "8080"),
  baseUrl: process.env.BASE_URL!,

  // Google OAuth (for authenticating the user)
  googleClientId: process.env.GOOGLE_CLIENT_ID!,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  allowedEmail: process.env.ALLOWED_EMAIL!,

  // JWT signing for tokens issued to Claude
  jwtSecret: process.env.JWT_SECRET || require("uuid").v4(),

  // Google API scopes
  googleScopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
};
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config.ts
git commit -m "refactor: replace Firestore/Secret Manager config with env vars"
```

---

## Task 3: Create Auth State Module

**Files:**
- Create: `src/auth/state.ts`

**Step 1: Write state.ts**

```typescript
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
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No errors (may have unused warnings, that's fine)

**Step 3: Commit**

```bash
git add src/auth/state.ts
git commit -m "feat: add in-memory auth state module"
```

---

## Task 4: Create Auth Middleware

**Files:**
- Create: `src/auth/middleware.ts`

**Step 1: Write middleware.ts**

```typescript
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as any;
    if (decoded.type !== "access") {
      return res.status(401).json({ error: "invalid_token" });
    }
    // Attach email to request for use in handlers
    (req as any).userEmail = decoded.email;
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/auth/middleware.ts
git commit -m "feat: add JWT auth middleware"
```

---

## Task 5: Create OAuth Routes Module

**Files:**
- Create: `src/auth/oauth.ts`

**Step 1: Write oauth.ts**

```typescript
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import {
  pendingAuth,
  authCodes,
  registeredClients,
  setGoogleCredentials,
} from "./state.js";

const router = Router();

const googleOAuth = new OAuth2Client(
  config.googleClientId,
  config.googleClientSecret,
  `${config.baseUrl}/oauth/callback`
);

// OAuth 2.0 Protected Resource Metadata (RFC 9449)
router.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: config.baseUrl,
    authorization_servers: [config.baseUrl],
  });
});

// OAuth 2.1 Authorization Server Metadata
router.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
    token_endpoint: `${config.baseUrl}/oauth/token`,
    registration_endpoint: `${config.baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

// OAuth 2.0 Dynamic Client Registration (RFC 7591)
router.post("/oauth/register", (req, res) => {
  const { client_name, redirect_uris } = req.body;

  const clientId = uuidv4();
  const clientSecret = uuidv4();

  registeredClients.set(clientId, {
    clientSecret,
    clientName: client_name || "Claude",
    redirectUris: redirect_uris || [],
    createdAt: Date.now(),
  });

  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: client_name || "Claude",
    redirect_uris: redirect_uris || [],
  });
});

// OAuth 2.1 Authorization Endpoint
router.get("/oauth/authorize", (req, res) => {
  const {
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    response_type,
  } = req.query;

  // Validate request
  if (response_type !== "code") {
    return res.status(400).json({ error: "unsupported_response_type" });
  }
  if (code_challenge_method !== "S256") {
    return res
      .status(400)
      .json({ error: "invalid_request", error_description: "S256 required" });
  }
  if (!state || !code_challenge || !redirect_uri) {
    return res.status(400).json({ error: "invalid_request" });
  }

  // Store pending auth
  pendingAuth.set(state as string, {
    codeChallenge: code_challenge as string,
    redirectUri: redirect_uri as string,
    createdAt: Date.now(),
  });

  // Redirect to Google OAuth
  const googleAuthUrl = googleOAuth.generateAuthUrl({
    access_type: "offline",
    scope: config.googleScopes,
    state: state as string,
    prompt: "consent",
  });

  res.redirect(googleAuthUrl);
});

// Google OAuth Callback
router.get("/oauth/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`OAuth error: ${error}`);
  }

  if (!state || !code) {
    return res.status(400).send("Missing state or code");
  }

  // Retrieve pending auth
  const pending = pendingAuth.get(state as string);
  if (!pending) {
    return res.status(400).send("Invalid or expired state");
  }

  try {
    // Exchange code for Google tokens
    const { tokens } = await googleOAuth.getToken(code as string);

    // Get user info
    const ticket = await googleOAuth.verifyIdToken({
      idToken: tokens.id_token!,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();
    const email = payload?.email;

    // Check if this is the allowed user
    if (email !== config.allowedEmail) {
      console.log(`Rejected login attempt from: ${email}`);
      return res
        .status(403)
        .send(`Access denied. Only ${config.allowedEmail} can use this server.`);
    }

    console.log(`Successful login: ${email}`);

    // Store Google credentials for API calls
    if (tokens.refresh_token) {
      setGoogleCredentials({
        refreshToken: tokens.refresh_token,
        email: email!,
      });
    }

    // Generate auth code for Claude
    const authCode = uuidv4();
    authCodes.set(authCode, { createdAt: Date.now() });

    // Clean up pending auth
    pendingAuth.delete(state as string);

    // Redirect back to Claude with auth code
    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set("code", authCode);
    redirectUrl.searchParams.set("state", state as string);

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send("Authentication failed");
  }
});

// OAuth 2.1 Token Endpoint
router.post("/oauth/token", (req, res) => {
  const { grant_type, code, refresh_token } = req.body;

  if (grant_type === "authorization_code") {
    // Validate auth code
    if (!code || !authCodes.has(code)) {
      return res.status(400).json({ error: "invalid_grant" });
    }

    // Consume the code
    authCodes.delete(code);

    // Issue tokens
    const accessToken = jwt.sign(
      { type: "access", email: config.allowedEmail },
      config.jwtSecret,
      { expiresIn: "1h" }
    );
    const refreshToken = jwt.sign(
      { type: "refresh", email: config.allowedEmail },
      config.jwtSecret,
      { expiresIn: "30d" }
    );

    return res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
    });
  }

  if (grant_type === "refresh_token") {
    // Validate refresh token
    try {
      const decoded = jwt.verify(refresh_token, config.jwtSecret) as any;
      if (decoded.type !== "refresh") {
        return res.status(400).json({ error: "invalid_grant" });
      }

      // Issue new access token
      const accessToken = jwt.sign(
        { type: "access", email: config.allowedEmail },
        config.jwtSecret,
        { expiresIn: "1h" }
      );

      return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
      });
    } catch {
      return res.status(400).json({ error: "invalid_grant" });
    }
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

export const oauthRouter = router;
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/auth/oauth.ts
git commit -m "feat: add OAuth 2.1 routes with JWT tokens"
```

---

## Task 6: Create Auth Index

**Files:**
- Create: `src/auth/index.ts`

**Step 1: Write index.ts**

```typescript
export { oauthRouter } from "./oauth.js";
export { requireAuth } from "./middleware.js";
export { googleCredentials } from "./state.js";
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/auth/index.ts
git commit -m "feat: add auth module index"
```

---

## Task 7: Update MCP Handler

**Files:**
- Modify: `src/mcp/handler.ts`

**Step 1: Rewrite handler.ts**

Replace entire file with:

```typescript
import { Router, Request, Response } from "express";
import { requireAuth, googleCredentials } from "../auth/index.js";
import { config } from "../config.js";
import { toolDefinitions, toolsByName } from "./tools/index.js";

const router = Router();

async function handleMcp(req: Request, res: Response) {
  console.log("MCP Request:", JSON.stringify(req.body));

  const { method, params, id } = req.body;

  // Handle notifications (no id) - these don't require auth
  if (id === undefined || id === null) {
    console.log("Notification received:", method);
    res.status(200).end();
    return;
  }

  const userEmail = (req as any).userEmail || config.allowedEmail;

  try {
    const response = await handleMcpMethod(method, params, id, userEmail);
    console.log("MCP Response:", JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error("MCP error:", error);
    res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: "Internal error" },
    });
  }
}

async function handleMcpMethod(
  method: string,
  params: any,
  id: string | number,
  userEmail: string
) {
  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "google-drive-mcp", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      };

    case "tools/list": {
      const toolsWithEmail = toolDefinitions.map((t) => {
        if (t.name === "list_drive_files") {
          return {
            ...t,
            description: `List files in your Google Drive (${userEmail}). Returns file names, types, and modification dates.`,
          };
        }
        return t;
      });
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: toolsWithEmail },
      };
    }

    case "tools/call": {
      const { name, arguments: args } = params;
      console.log(`Tool call: ${name}`, JSON.stringify(args));

      // Check if we have Google credentials
      if (!googleCredentials) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: "Error: Not authenticated with Google. Please re-authenticate." }],
            isError: true,
          },
        };
      }

      const tool = toolsByName.get(name);
      if (!tool) {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          },
        };
      }

      try {
        const result = await tool.handler(args, googleCredentials.refreshToken);
        return { jsonrpc: "2.0", id, result };
      } catch (error: any) {
        console.error(`Tool ${name} error:`, error);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: `Error executing ${name}: ${error.message}` }],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// Mount handler on both / and /mcp with auth middleware
router.post("/", requireAuth, handleMcp);
router.post("/mcp", requireAuth, handleMcp);

export const mcpRouter = router;
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/mcp/handler.ts
git commit -m "refactor: update MCP handler for JWT auth and in-memory credentials"
```

---

## Task 8: Update MCP Tools to Use google-auth-library

**Files:**
- Modify: `src/mcp/tools/drive.ts`
- Modify: `src/mcp/tools/docs.ts`
- Modify: `src/mcp/tools/sheets.ts`

**Step 1: Update drive.ts imports and getDriveClient**

Replace the first ~10 lines:

```typescript
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Tool, ToolResult } from "../types.js";
import { config } from "../../config.js";

async function getDriveClient(googleRefreshToken: string) {
  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );
  oauth2Client.setCredentials({ refresh_token: googleRefreshToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}
```

**Step 2: Update docs.ts similarly**

Replace imports and getDocsClient:

```typescript
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Tool, ToolResult } from "../types.js";
import { config } from "../../config.js";

async function getDocsClient(googleRefreshToken: string) {
  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );
  oauth2Client.setCredentials({ refresh_token: googleRefreshToken });
  return google.docs({ version: "v1", auth: oauth2Client });
}
```

**Step 3: Update sheets.ts similarly**

Replace imports and getSheetsClient:

```typescript
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Tool, ToolResult } from "../types.js";
import { config } from "../../config.js";

async function getSheetsClient(googleRefreshToken: string) {
  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );
  oauth2Client.setCredentials({ refresh_token: googleRefreshToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

async function getDriveClient(googleRefreshToken: string) {
  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );
  oauth2Client.setCredentials({ refresh_token: googleRefreshToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}
```

**Step 4: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add src/mcp/tools/drive.ts src/mcp/tools/docs.ts src/mcp/tools/sheets.ts
git commit -m "refactor: update tools to use google-auth-library directly"
```

---

## Task 9: Update Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Rewrite index.ts**

```typescript
import express from "express";
import { config } from "./config.js";
import { oauthRouter } from "./auth/oauth.js";
import { mcpRouter } from "./mcp/handler.js";
import { generateLandingPage } from "./landing.js";

// Import state to start cleanup interval
import "./auth/state.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth routes
app.use(oauthRouter);

// MCP protocol handler
app.use(mcpRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Landing page
app.get("/", (req, res) => {
  res.type("html").send(generateLandingPage());
});

// Export for Cloud Functions
export const googleDriveMcp = app;

// Start server only when running locally (not in Cloud Functions)
const isCloudFunction = process.env.K_SERVICE || process.env.FUNCTION_TARGET;
if (!isCloudFunction) {
  app.listen(config.port, () => {
    console.log(`Google Drive MCP Server running on port ${config.port}`);
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Allowed user: ${config.allowedEmail}`);
  });
}
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: update entry point for Cloud Functions"
```

---

## Task 10: Delete Old OAuth Files

**Files:**
- Delete: `src/oauth/` directory

**Step 1: Remove old oauth directory**

```bash
rm -rf src/oauth/
```

**Step 2: Update mcp/index.ts if needed**

Check if it exports anything from oauth:

```typescript
// src/mcp/index.ts - should just export MCP stuff
export { mcpRouter } from "./handler.js";
export * from "./types.js";
```

**Step 3: Verify it compiles**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove old Firestore-based OAuth modules"
```

---

## Task 11: Update Deploy Script

**Files:**
- Modify: `deploy.sh`

**Step 1: Rewrite deploy.sh for Cloud Functions**

```bash
#!/bin/bash
set -e

# ============================================================
# Google Drive MCP Deployment Script (Cloud Functions)
# ============================================================

PROJECT_ID="${GCP_PROJECT:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
FUNCTION_NAME="google-drive-mcp"

echo "============================================"
echo "Google Drive MCP Deployment (Cloud Functions)"
echo "============================================"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check required env vars
if [ -z "$ALLOWED_EMAIL" ]; then
    echo "Error: ALLOWED_EMAIL environment variable required"
    exit 1
fi

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 > /dev/null 2>&1; then
    echo "Error: Not authenticated with gcloud. Run: gcloud auth login"
    exit 1
fi

# Set project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "Enabling required APIs..."
gcloud services enable \
    cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com \
    drive.googleapis.com \
    docs.googleapis.com \
    sheets.googleapis.com \
    secretmanager.googleapis.com \
    --quiet

# Build TypeScript
echo "Building TypeScript..."
npm run build

# Deploy to Cloud Functions Gen 2
echo "Deploying to Cloud Functions..."
gcloud functions deploy "$FUNCTION_NAME" \
    --gen2 \
    --runtime=nodejs20 \
    --region="$REGION" \
    --source=. \
    --entry-point=googleDriveMcp \
    --trigger-http \
    --allow-unauthenticated \
    --set-env-vars="ALLOWED_EMAIL=$ALLOWED_EMAIL" \
    --set-secrets="GOOGLE_CLIENT_ID=oauth-client-id:latest,GOOGLE_CLIENT_SECRET=oauth-client-secret:latest,JWT_SECRET=jwt-secret:latest" \
    --memory=512Mi \
    --timeout=60s

# Get the function URL
FUNCTION_URL=$(gcloud functions describe "$FUNCTION_NAME" --region "$REGION" --gen2 --format="value(serviceConfig.uri)")

# Update function with BASE_URL
echo "Setting BASE_URL environment variable..."
gcloud functions deploy "$FUNCTION_NAME" \
    --gen2 \
    --region="$REGION" \
    --update-env-vars="BASE_URL=$FUNCTION_URL"

echo ""
echo "============================================"
echo "Deployment Complete!"
echo "============================================"
echo ""
echo "Function URL: $FUNCTION_URL"
echo ""
echo "SETUP CHECKLIST:"
echo "============================================"
echo ""
echo "1. Create OAuth credentials at:"
echo "   https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo ""
echo "   Authorized redirect URI: ${FUNCTION_URL}/oauth/callback"
echo ""
echo "2. Store secrets (if not already done):"
echo ""
echo "   echo -n 'YOUR_CLIENT_ID' | gcloud secrets create oauth-client-id --data-file=-"
echo "   echo -n 'YOUR_CLIENT_SECRET' | gcloud secrets create oauth-client-secret --data-file=-"
echo "   echo -n '\$(uuidgen)' | gcloud secrets create jwt-secret --data-file=-"
echo ""
echo "3. Add to Claude Web:"
echo "   Settings > Integrations > Add MCP server"
echo "   URL: $FUNCTION_URL"
echo ""
```

**Step 2: Commit**

```bash
git add deploy.sh
git commit -m "refactor: update deploy script for Cloud Functions"
```

---

## Task 12: Update Tests

**Files:**
- Modify: `tests/unit/mcp/handler.test.ts`
- Modify: `tests/integration/mcp.test.ts`
- Modify: `tests/integration/oauth.test.ts`
- Delete: `tests/unit/oauth/helpers.test.ts`

**Step 1: Update handler tests to mock JWT**

The tests need to be updated to:
1. Mock JWT tokens instead of Firestore lookups
2. Mock googleCredentials state

**Step 2: Update integration tests similarly**

**Step 3: Remove obsolete oauth/helpers tests**

```bash
rm tests/unit/oauth/helpers.test.ts
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass (some may need adjustment)

**Step 5: Commit**

```bash
git add -A
git commit -m "test: update tests for JWT auth"
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update documentation**

Update the Architecture Overview and Data Storage sections to reflect new auth approach:

- Remove Firestore collections section
- Add Environment Variables section
- Update deployment instructions

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for new auth architecture"
```

---

## Task 14: Final Verification

**Step 1: Clean build**

```bash
rm -rf dist/ node_modules/
npm install
npm run build
```

**Step 2: Run all tests**

```bash
npm test
```

**Step 3: Test locally**

```bash
BASE_URL=http://localhost:8080 \
GOOGLE_CLIENT_ID=test \
GOOGLE_CLIENT_SECRET=test \
ALLOWED_EMAIL=test@example.com \
npm start
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup for auth refactor"
```
