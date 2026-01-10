# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode for development
npm run start      # Run the compiled server
./deploy.sh        # Deploy to Google Cloud Functions (requires GCP_PROJECT env var)
```

## Architecture Overview

This is an MCP (Model Context Protocol) server that provides Google Drive, Docs, and Sheets access to Claude Web via OAuth2 authentication. It runs on Google Cloud Functions.

### Modular Architecture

```
src/
  index.ts          # Express app setup, Cloud Functions export
  config.ts         # Environment variable validation
  landing.ts        # Landing page HTML
  auth/
    index.ts        # Re-exports
    state.ts        # Firestore-based auth state (persistent)
    middleware.ts   # JWT auth middleware
    oauth.ts        # OAuth 2.1 routes
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

### Firestore Collections

Auth state is persisted in Firestore (survives Cloud Function restarts):

| Collection | Purpose | TTL |
|------------|---------|-----|
| `pendingAuth` | OAuth authorization flow state | 10 minutes |
| `authCodes` | Short-lived authorization codes | 10 minutes |
| `registeredClients` | OAuth client registrations | Permanent |
| `googleCredentials` | Google API refresh tokens | Permanent |

### Token Lifetimes

| Token Type | Duration |
|------------|----------|
| Access token | 7 days |
| Refresh token | 30 days |

### Environment Variables

| Variable | Description |
|----------|-------------|
| BASE_URL | Deployed function URL |
| GOOGLE_CLIENT_ID | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret |
| ALLOWED_EMAIL | Single authorized user email |
| JWT_SECRET | Secret for signing JWT tokens |
| PORT | Server port (default 8080, local only) |

### MCP Tools

The server exposes these tools via MCP:
- Drive operations: `list_drive_files`, `get_file_info`, `search_drive`, `create_folder`, `create_file`, `read_file`, `move_file`, `rename_file`
- Sheets: `create_sheet` (with optional initial data)
- Docs editing: `append_to_doc`, `find_replace_in_doc`, `insert_text`, `set_heading`, `insert_image`, `insert_link`, `insert_list`

## Deployment

Set `GCP_PROJECT` environment variable before running `./deploy.sh`. The script:
1. Enables required GCP APIs (including Firestore)
2. Creates Firestore database if it doesn't exist
3. Builds TypeScript
4. Deploys to Cloud Functions
5. Sets BASE_URL automatically from the deployed function URL
