# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build      # Compile TypeScript to dist/
npm run dev        # Watch mode for development
npm run start      # Run the compiled server
./deploy.sh        # Deploy to Google Cloud Run (requires GCP_PROJECT env var)
```

## Architecture Overview

This is an MCP (Model Context Protocol) server that provides Google Drive, Docs, and Sheets access to Claude Web via OAuth2 authentication. It runs on Google Cloud Run.

### Single-File Server (`src/index.ts`)

The entire server is implemented in one file with these sections:

1. **OAuth2 Discovery Endpoints** - `/.well-known/oauth-*` endpoints for Claude Web to discover auth configuration
2. **Dynamic Client Registration** - `/register` for Claude Web to register as an OAuth client
3. **Authorization Flow** - `/authorize` starts OAuth, redirects to Google, stores session in Firestore
4. **Google Callback** - `/google/callback` receives Google's OAuth response, exchanges for tokens
5. **Token Endpoint** - `/token` handles authorization_code and refresh_token grants with PKCE validation
6. **MCP Handler** - `/` and `/mcp` handle JSON-RPC MCP protocol requests

### Data Storage (Firestore Collections)

- `oauth-clients/` - Registered OAuth clients (Claude Web instances)
- `oauth-sessions/` - Temporary OAuth session state (10 min TTL)
- `auth-codes/` - Authorization codes pending exchange (5 min TTL)
- `access-tokens/` - Active access tokens (1 hour TTL)
- `refresh-tokens/` - Long-lived refresh tokens

### MCP Tools

The server exposes these tools via MCP:
- Drive operations: `list_drive_files`, `get_file_info`, `search_drive`, `create_folder`, `create_file`, `read_file`, `move_file`, `rename_file`
- Sheets: `create_sheet` (with optional initial data)
- Docs editing: `append_to_doc`, `find_replace_in_doc`, `insert_text`, `set_heading`, `insert_image`, `insert_link`, `insert_list`

### Secrets Management

OAuth credentials are stored in Google Secret Manager:
- `oauth-client-id` - Google OAuth client ID
- `oauth-client-secret` - Google OAuth client secret

## Deployment

Set `GCP_PROJECT` environment variable before running `./deploy.sh`. The script:
1. Enables required GCP APIs
2. Creates Firestore if needed
3. Builds TypeScript
4. Deploys to Cloud Run
5. Sets BASE_URL automatically from the deployed service URL
