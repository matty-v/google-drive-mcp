# Auth Refactor Design

Align authentication approach with github-mcp: in-memory state, JWT tokens, Cloud Functions deployment.

## Goals

1. Remove Firestore dependency - use in-memory state with auto-cleanup
2. Remove Secret Manager dependency - use environment variables
3. Use JWT tokens instead of opaque tokens stored in database
4. Add PKCE requirement (S256 mandatory)
5. Add single-user email allowlist (ALLOWED_EMAIL)
6. Switch from Cloud Run to Cloud Functions (Gen 2)

## Architecture

### Current State

- Cloud Run deployment
- Firestore for all auth state (5 collections)
- Secret Manager for OAuth credentials
- Opaque tokens stored in database
- Multi-user capable

### Target State

- Cloud Functions (Gen 2) deployment
- In-memory state with auto-cleanup
- Environment variables for all config
- JWT tokens (self-contained, signed)
- Single-user via `ALLOWED_EMAIL`

### New File Structure

```
src/
  index.ts              # Cloud Function entry point
  config.ts             # Environment validation (no Firestore/Secrets)
  auth/
    oauth.ts            # OAuth 2.1 endpoints (register, authorize, callback, token)
    state.ts            # In-memory stores with cleanup
    middleware.ts       # JWT validation middleware
    index.ts            # Re-exports
  mcp/
    handler.ts          # MCP JSON-RPC dispatcher (unchanged logic)
    tools/              # Keep existing tools as-is
      drive.ts
      docs.ts
      sheets.ts
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `BASE_URL` | Deployed function URL |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAIL` | Single authorized user email |
| `JWT_SECRET` | Secret for signing tokens |

## Authentication Flow

### Stage 1 - Dynamic Client Registration

`POST /oauth/register`

- Claude instances self-register with name and redirect URIs
- Server generates `client_id` and `client_secret` (UUIDs)
- Stored in-memory (not persisted across restarts)

### Stage 2 - Authorization

`GET /oauth/authorize`

- Requires PKCE with S256 (mandatory)
- Validates `client_id`, `redirect_uri`, `code_challenge`
- Stores pending auth state in-memory (10 min expiry)
- Redirects to Google OAuth consent screen

### Stage 3 - Google Callback

`GET /oauth/callback`

- Receives Google auth code, exchanges for tokens
- Verifies ID token and extracts email
- Checks email against `ALLOWED_EMAIL` - rejects others with 403
- Generates authorization code, redirects back to client

### Stage 4 - Token Exchange

`POST /oauth/token`

- Client exchanges auth code (with PKCE verifier) for tokens
- Issues two JWTs:
  - Access token (1 hour): `{ type: "access", email }`
  - Refresh token (30 days): `{ type: "refresh", email }`
- Auth code consumed (single-use)

### Stage 5 - MCP Access

- All MCP requests require valid JWT Bearer token
- Middleware validates signature and checks `type: "access"`

## MCP Tools Changes

### What stays the same

- All 16 MCP tools (drive, docs, sheets) - logic unchanged
- Tool registry pattern
- JSON-RPC dispatcher structure

### What changes

**Google API Authentication:**
- Currently: Tokens fetched from Firestore, used to create OAuth2Client per request
- New: Single OAuth2Client cached after first successful auth
- User's Google refresh token stored in-memory

**Handler integration:**
- Add `requireAuth` middleware before MCP handler
- Pass authenticated Google client to tool handlers

**Token refresh:**
- OAuth2Client handles automatic Google token refresh
- If server restarts, user re-authenticates (acceptable for single-user)

## Deployment

### Cloud Functions (Gen 2)

```bash
gcloud functions deploy google-drive-mcp \
  --gen2 \
  --runtime=nodejs20 \
  --trigger-http \
  --allow-unauthenticated \
  --set-env-vars="BASE_URL=...,ALLOWED_EMAIL=..." \
  --set-secrets="GOOGLE_CLIENT_ID=...,GOOGLE_CLIENT_SECRET=...,JWT_SECRET=..."
```

## File Changes

### Files to create

| File | Purpose |
|------|---------|
| `src/auth/state.ts` | In-memory stores with 60s cleanup interval |
| `src/auth/oauth.ts` | OAuth 2.1 endpoints |
| `src/auth/middleware.ts` | JWT validation middleware |
| `src/auth/index.ts` | Re-exports |

### Files to modify

| File | Changes |
|------|---------|
| `src/index.ts` | Cloud Function entry, new route wiring |
| `src/mcp/handler.ts` | Accept pre-authenticated Google client |
| `package.json` | Update dependencies |
| `deploy.sh` | Cloud Functions deployment |

### Files to delete

| File | Reason |
|------|--------|
| `src/config.ts` | Firestore/Secret Manager no longer needed |
| `src/oauth/*` | Replaced by `src/auth/*` |

### Dependencies to add

- `jsonwebtoken` - JWT signing/verification
- `uuid` - Client ID generation

### Dependencies to remove

- `@google-cloud/firestore`
- `@google-cloud/secret-manager`
