# MCP Drive Server Setup Guide

This MCP server allows Claude Web to access your Google Drive using OAuth2 authentication.

## Architecture

```
Claude Web                        Your Cloud Run Service              Google
    │                                     │                              │
    │  1. Connect integration             │                              │
    │────────────────────────────────────>│                              │
    │                                     │                              │
    │  2. Redirect to /authorize          │                              │
    │<────────────────────────────────────│                              │
    │                                     │                              │
    │  3. Redirect to Google OAuth        │                              │
    │─────────────────────────────────────────────────────────────────────>
    │                                     │                              │
    │  4. User grants Drive access        │                              │
    │<─────────────────────────────────────────────────────────────────────
    │                                     │                              │
    │  5. Google callback to your server  │                              │
    │                                     │<─────────────────────────────│
    │                                     │                              │
    │  6. Redirect to Claude with code    │                              │
    │<────────────────────────────────────│                              │
    │                                     │                              │
    │  7. Exchange code for token         │                              │
    │────────────────────────────────────>│                              │
    │                                     │                              │
    │  8. MCP calls with Bearer token     │                              │
    │────────────────────────────────────>│                              │
    │                                     │  9. Drive API calls          │
    │                                     │─────────────────────────────>│
```

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
    run.googleapis.com \
    secretmanager.googleapis.com \
    firestore.googleapis.com \
    drive.googleapis.com
```

### 3. Create Firestore Database

```bash
gcloud firestore databases create --location=$GCP_REGION
```

### 4. Build and Deploy

```bash
cd mcp-drive-server
npm install
npm run build

gcloud run deploy mcp-drive-server \
    --source . \
    --region $GCP_REGION \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars "GCP_PROJECT=$GCP_PROJECT" \
    --memory 512Mi
```

Note the service URL from the output (e.g., `https://mcp-drive-server-xyz-uc.a.run.app`)

```bash
export SERVICE_URL="https://mcp-drive-server-xyz-uc.a.run.app"
```

### 5. Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** > **OAuth client ID**
3. Application type: **Web application**
4. Name: `MCP Drive Server`
5. Authorized redirect URIs: `${SERVICE_URL}/google/callback`
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

### 6. Configure OAuth Consent Screen

1. Go to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. User Type: **External** (or Internal for Workspace)
3. Fill in required fields (App name, support email, etc.)
4. Add scopes:
   - `https://www.googleapis.com/auth/drive.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Add test users (your email)
6. Save

### 7. Store Secrets

```bash
# Store OAuth Client ID
echo -n "YOUR_CLIENT_ID_HERE" | \
    gcloud secrets create oauth-client-id --data-file=-

# Store OAuth Client Secret
echo -n "YOUR_CLIENT_SECRET_HERE" | \
    gcloud secrets create oauth-client-secret --data-file=-
```

### 8. Grant Secret Manager Access

```bash
# Get Cloud Run service account
SA_EMAIL=$(gcloud run services describe mcp-drive-server \
    --region $GCP_REGION \
    --format='value(spec.template.spec.serviceAccountName)')

# If empty, it uses the default compute service account
if [ -z "$SA_EMAIL" ]; then
    SA_EMAIL="$(gcloud projects describe $GCP_PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
fi

# Grant access to secrets
gcloud secrets add-iam-policy-binding oauth-client-id \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding oauth-client-secret \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/secretmanager.secretAccessor"
```

### 9. Update Service with BASE_URL

```bash
gcloud run services update mcp-drive-server \
    --region $GCP_REGION \
    --set-env-vars "BASE_URL=$SERVICE_URL,GCP_PROJECT=$GCP_PROJECT"
```

### 10. Verify Deployment

```bash
# Check health endpoint
curl $SERVICE_URL/health

# Check OAuth metadata
curl $SERVICE_URL/.well-known/oauth-authorization-server
```

## Connect to Claude Web

1. Go to [Claude](https://claude.ai)
2. Open Settings > Integrations (or similar MCP settings)
3. Add a new MCP server
4. Enter the MCP endpoint URL: `${SERVICE_URL}/mcp`
5. Click Connect - you'll be redirected to Google to authorize
6. Grant Drive access
7. You're connected!

## Available Tools

Once connected, Claude can use these tools:

| Tool | Description |
|------|-------------|
| `list_drive_files` | List files in Drive (optionally in a folder) |
| `get_file_info` | Get detailed info about a specific file |
| `search_drive` | Search files by name or content |

## Security Considerations

### What's Protected

- **OAuth2 with PKCE**: Prevents code interception attacks
- **Short-lived tokens**: Access tokens expire in 1 hour
- **Scoped access**: Only `drive.readonly` - cannot modify files
- **Per-user auth**: Each user authenticates with their own Google account
- **Secrets in Secret Manager**: OAuth credentials never in code

### What You Should Know

- The Cloud Run service is publicly accessible (required for OAuth redirects)
- Only authenticated users can use the MCP tools (Bearer token required)
- Your Google refresh token is stored in Firestore (encrypted at rest)
- Claude Web only receives file metadata, not file contents

### Additional Security Options

1. **Restrict to specific domain** (Workspace only):
   ```typescript
   // Add email domain check in token endpoint
   if (!userEmail.endsWith('@yourcompany.com')) {
     return res.status(403).json({ error: 'access_denied' });
   }
   ```

2. **IP restrictions**: Configure Cloud Run ingress settings

3. **VPC**: Deploy in a VPC for additional network isolation

## Troubleshooting

### "No refresh token received"

Google only returns a refresh token on the first authorization. To fix:
1. Go to https://myaccount.google.com/permissions
2. Remove access for "MCP Drive Server"
3. Try connecting again

### "Invalid client"

The OAuth client credentials are incorrect:
1. Verify secrets are stored correctly
2. Check Cloud Run has Secret Manager access
3. Redeploy if needed

### "Session expired"

The OAuth flow took too long. Try connecting again.

## Cleanup

To remove all resources:

```bash
gcloud run services delete mcp-drive-server --region $GCP_REGION
gcloud secrets delete oauth-client-id
gcloud secrets delete oauth-client-secret
gcloud firestore databases delete --database="(default)"
```
