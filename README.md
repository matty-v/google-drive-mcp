# Google Drive MCP Server

An MCP (Model Context Protocol) server that enables Claude to interact with your Google Drive. Works with Claude Web via OAuth2 authentication.

## Features

- **List files** - Browse your Drive files and folders
- **Search** - Full-text search across your Drive
- **Read files** - Read content from text files, Google Docs, and Sheets
- **Create folders** - Organize your Drive with new folders
- **Create files** - Create text files, JSON files, or Google Docs
- **Create sheets** - Create Google Sheets with optional data
- **Move files** - Move files and folders to different locations

## Tools

| Tool | Description |
|------|-------------|
| `list_drive_files` | List files in Drive, optionally filtered by folder, MIME type, or query |
| `get_file_info` | Get detailed metadata about a specific file |
| `search_drive` | Search files by name or content |
| `read_file` | Read the content of a file (supports text files, Google Docs, Sheets as CSV) |
| `move_file` | Move a file or folder to a different location |
| `create_folder` | Create a new folder |
| `create_file` | Create a new file with text content |
| `create_sheet` | Create a new Google Sheet with optional initial data |

## Architecture

```
Claude Web → OAuth2 → Your Cloud Run Server → Google Drive API
                           ↓
                      Firestore (tokens)
                      Secret Manager (credentials)
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed documentation on how to build similar MCP servers.

## Quick Start

### Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated
- Node.js 20+

### 1. Clone and Install

```bash
git clone https://github.com/matty-v/google-drive-mcp.git
cd google-drive-mcp
npm install
```

### 2. Set Up Google Cloud

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"

gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  drive.googleapis.com

# Create Firestore database
gcloud firestore databases create --location=$REGION
```

### 3. Create OAuth Credentials

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `MCP Drive Server`
5. Leave redirect URIs empty for now (we'll add after deployment)
6. Copy the **Client ID** and **Client Secret**

### 4. Configure OAuth Consent Screen

1. Go to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. User Type: **External**
3. Fill in required fields
4. Add scopes: `drive`, `drive.file`, `userinfo.email`
5. Add yourself as a test user

### 5. Store Secrets

```bash
echo -n "YOUR_CLIENT_ID" | gcloud secrets create oauth-client-id --data-file=-
echo -n "YOUR_CLIENT_SECRET" | gcloud secrets create oauth-client-secret --data-file=-
```

### 6. Deploy

```bash
npm run build

gcloud run deploy mcp-drive-server \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars "GCP_PROJECT=$PROJECT_ID"
```

### 7. Update OAuth Redirect URI

1. Get your service URL:
   ```bash
   gcloud run services describe mcp-drive-server --region $REGION --format="value(status.url)"
   ```

2. Go back to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
3. Edit your OAuth client
4. Add authorized redirect URI: `https://YOUR-SERVICE-URL/google/callback`

### 8. Update Cloud Run with BASE_URL

```bash
SERVICE_URL=$(gcloud run services describe mcp-drive-server --region $REGION --format="value(status.url)")

gcloud run services update mcp-drive-server \
  --region $REGION \
  --set-env-vars "BASE_URL=$SERVICE_URL,GCP_PROJECT=$PROJECT_ID"
```

### 9. Grant IAM Permissions

```bash
SA_EMAIL="${PROJECT_ID}-compute@developer.gserviceaccount.com"

# Firestore access
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/datastore.user"

# Secret Manager access
gcloud secrets add-iam-policy-binding oauth-client-id \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding oauth-client-secret \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/secretmanager.secretAccessor"
```

### 10. Connect to Claude Web

1. Go to [claude.ai](https://claude.ai)
2. Settings → Integrations
3. Add MCP server with your Cloud Run URL
4. Click Connect and authenticate with Google

## Usage Examples

Once connected, you can ask Claude:

- "List my recent Google Drive files"
- "Search my Drive for documents about quarterly reports"
- "Read the content of my meeting notes document"
- "What's in my budget spreadsheet?"
- "Create a folder called 'Projects' in my Drive"
- "Create a file called 'notes.txt' with my meeting notes"
- "Create a Google Doc called 'Project Plan' with an outline"
- "Move the budget spreadsheet to the Finance folder"
- "Create a spreadsheet called 'Expenses' with columns for Date, Description, and Amount"

## Security

- **OAuth2 with PKCE** - Secure authorization flow
- **Per-user authentication** - Each user authenticates with their own Google account
- **Token encryption** - Tokens stored encrypted in Firestore
- **Minimal scopes** - Only requests necessary Drive permissions
- **No credential storage** - Your Google password never touches the server

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run locally (requires environment variables)
npm start
```

## License

MIT
