# Google Drive MCP Server Setup Guide

This MCP server allows Claude Web to access your Google Drive using OAuth2 authentication.

## Architecture

```
Claude Web                        Cloud Functions                    Google
    │                                     │                              │
    │  1. Connect integration             │                              │
    │────────────────────────────────────>│                              │
    │                                     │                              │
    │  2. Dynamic client registration     │                              │
    │<────────────────────────────────────│                              │
    │                                     │                              │
    │  3. Redirect to /oauth/authorize    │                              │
    │     (with PKCE code_challenge)      │                              │
    │────────────────────────────────────>│                              │
    │                                     │                              │
    │  4. Redirect to Google OAuth        │                              │
    │<────────────────────────────────────│                              │
    │                                     │                              │
    │  5. User authenticates with Google  │                              │
    │─────────────────────────────────────────────────────────────────────>
    │                                     │                              │
    │  6. Google callback (if email matches ALLOWED_EMAIL)               │
    │                                     │<─────────────────────────────│
    │                                     │                              │
    │  7. Redirect to Claude with code    │                              │
    │<────────────────────────────────────│                              │
    │                                     │                              │
    │  8. Exchange code for JWT tokens    │                              │
    │     (with PKCE code_verifier)       │                              │
    │────────────────────────────────────>│                              │
    │                                     │                              │
    │  9. MCP calls with Bearer JWT       │                              │
    │────────────────────────────────────>│                              │
    │                                     │  10. Drive API calls         │
    │                                     │─────────────────────────────>│
```

## Key Components

- **Cloud Functions Gen 2** - Serverless Express app
- **In-memory state** - Pending auth states with 10-minute expiry and automatic cleanup
- **JWT tokens** - Access tokens (1 hour) and refresh tokens (30 days)
- **PKCE required** - S256 code challenge method mandatory
- **Single user** - Only ALLOWED_EMAIL can authenticate

## Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- Node.js 20+

## Step-by-Step Setup

### 1. Set Your Project

```bash
export GCP_PROJECT="your-project-id"
export GCP_REGION="us-central1"

gcloud config set project $GCP_PROJECT
```

### 2. Enable APIs

```bash
gcloud services enable \
    cloudfunctions.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com \
    drive.googleapis.com \
    docs.googleapis.com \
    sheets.googleapis.com
```

### 3. Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** > **OAuth client ID**
3. Application type: **Web application**
4. Name: `Google Drive MCP`
5. Leave redirect URIs empty for now
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

### 4. Configure OAuth Consent Screen

1. Go to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. User Type: **External** (or Internal for Workspace)
3. Fill in required fields (App name, support email, etc.)
4. Add scopes:
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Add test users (your email)
6. Save

### 5. Store Secrets

```bash
# Store OAuth Client ID
echo -n "YOUR_CLIENT_ID_HERE" | \
    gcloud secrets create oauth-client-id --data-file=- --project=$GCP_PROJECT

# Store OAuth Client Secret
echo -n "YOUR_CLIENT_SECRET_HERE" | \
    gcloud secrets create oauth-client-secret --data-file=- --project=$GCP_PROJECT

# Generate and store JWT secret
uuidgen | tr -d '\n' | \
    gcloud secrets create jwt-secret --data-file=- --project=$GCP_PROJECT
```

### 6. Build and Deploy

```bash
cd google-drive-mcp
npm install
npm run build

export ALLOWED_EMAIL="your-email@gmail.com"
./deploy.sh
```

Note the function URL from the output (e.g., `https://google-drive-mcp-xyz-uc.a.run.app`)

### 7. Update OAuth Redirect URI

1. Go back to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Edit your OAuth client
3. Add authorized redirect URI: `https://YOUR-FUNCTION-URL/oauth/callback`
4. Save

### 8. Verify Deployment

```bash
export FUNCTION_URL="https://google-drive-mcp-xyz-uc.a.run.app"

# Check health endpoint
curl $FUNCTION_URL/health

# Check OAuth metadata
curl $FUNCTION_URL/.well-known/oauth-authorization-server
```

## Connect to Claude Web

1. Go to [Claude](https://claude.ai)
2. Open Settings > Integrations
3. Add a new MCP server
4. Enter the function URL: `https://YOUR-FUNCTION-URL`
5. Click Connect - you'll be redirected to Google to authorize
6. Sign in with the email matching ALLOWED_EMAIL
7. Grant Drive access
8. You're connected!

## Available Tools

Once connected, Claude can use these tools:

| Tool | Description |
|------|-------------|
| `list_drive_files` | List files in Drive (optionally in a folder) |
| `get_file_info` | Get detailed info about a specific file |
| `search_drive` | Search files by name or content |
| `read_file` | Read file content (text, Docs, Sheets as CSV) |
| `move_file` | Move a file to a different folder |
| `rename_file` | Rename a file |
| `create_folder` | Create a new folder |
| `create_file` | Create a new text file or Google Doc |
| `create_sheet` | Create a new Google Sheet |
| `append_to_doc` | Append text to a Google Doc |
| `find_replace_in_doc` | Find and replace in a Google Doc |
| `insert_text` | Insert formatted text |
| `set_heading` | Set paragraph as heading |
| `insert_image` | Insert image from URL |
| `insert_link` | Insert hyperlink |
| `insert_list` | Insert bulleted/numbered list |

## Security Considerations

### What's Protected

- **OAuth2 with PKCE (S256)**: Prevents code interception attacks
- **JWT tokens**: Short-lived access (1 hour), longer refresh (30 days)
- **Single-user restriction**: Only ALLOWED_EMAIL can authenticate
- **In-memory state**: Auth state expires after 10 minutes, no persistent storage
- **Secrets in Secret Manager**: OAuth credentials never in code or environment

### What You Should Know

- The Cloud Function is publicly accessible (required for OAuth redirects)
- Only the configured email can complete authentication
- Google refresh token is stored in memory only (lost on cold start)
- If the function cold starts, you'll need to re-authenticate

### Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `BASE_URL` | Auto-set by deploy | Function URL for OAuth callbacks |
| `GOOGLE_CLIENT_ID` | Secret Manager | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Secret Manager | Google OAuth client secret |
| `JWT_SECRET` | Secret Manager | Secret for signing JWT tokens |
| `ALLOWED_EMAIL` | Environment | Single authorized user email |

## Troubleshooting

### "Email not authorized"

Only the ALLOWED_EMAIL can authenticate. Check:
1. The email you're signing in with matches ALLOWED_EMAIL exactly
2. ALLOWED_EMAIL is set correctly in the function environment

### "No refresh token received"

Google only returns a refresh token on the first authorization. To fix:
1. Go to https://myaccount.google.com/permissions
2. Remove access for "Google Drive MCP"
3. Try connecting again

### "Invalid client"

The OAuth client credentials are incorrect:
1. Verify secrets are stored correctly in Secret Manager
2. Check the function has secretmanager.secretAccessor role
3. Redeploy if needed

### "Session expired" or "State not found"

The OAuth flow took too long (>10 minutes) or the function cold started. Try connecting again.

### Function keeps cold starting

Cloud Functions may shut down after inactivity. This clears in-memory state including the Google refresh token. Consider:
1. Setting minimum instances: `--min-instances=1`
2. Re-authenticating when needed

## GitHub Actions Deployment

The repo includes automatic deployment via GitHub Actions. Required setup:

1. **Workload Identity Federation** for keyless GCP auth
2. **GitHub secrets**:
   - `WIF_PROVIDER` - Workload Identity Federation provider
   - `ALLOWED_EMAIL` - Authorized user email

See `.github/workflows/deploy.yml` for the workflow configuration.

## Cleanup

To remove all resources:

```bash
gcloud functions delete google-drive-mcp --region=$GCP_REGION
gcloud secrets delete oauth-client-id --project=$GCP_PROJECT
gcloud secrets delete oauth-client-secret --project=$GCP_PROJECT
gcloud secrets delete jwt-secret --project=$GCP_PROJECT
```
