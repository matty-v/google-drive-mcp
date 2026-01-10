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
- **Edit docs** - Full document editing with formatting, headings, images, links, and lists

## Tools

| Tool | Description |
|------|-------------|
| `list_drive_files` | List files in Drive, optionally filtered by folder, MIME type, or query |
| `get_file_info` | Get detailed metadata about a specific file |
| `search_drive` | Search files by name or content |
| `read_file` | Read the content of a file (supports text files, Google Docs, Sheets as CSV) |
| `move_file` | Move a file or folder to a different location |
| `rename_file` | Rename a file or folder |
| `create_folder` | Create a new folder |
| `create_file` | Create a new file with text content |
| `create_sheet` | Create a new Google Sheet with optional initial data |
| `append_to_doc` | Append text to the end of a Google Doc |
| `find_replace_in_doc` | Find and replace text in a Google Doc |
| `insert_text` | Insert formatted text (bold, italic, colors, font size) at start or end |
| `set_heading` | Convert a paragraph to a heading (H1-H6) |
| `insert_image` | Insert an image from a URL |
| `insert_link` | Insert a hyperlink |
| `insert_list` | Insert a bulleted or numbered list |

## Architecture

```
Claude Web → OAuth2 (PKCE) → Cloud Functions → Google Drive API
                                   ↓
                           In-memory state
                           JWT tokens
                           Secret Manager (credentials)
```

- **Cloud Functions Gen 2** - Serverless deployment with automatic scaling
- **In-memory state** - Auth state stored in memory with automatic cleanup
- **JWT tokens** - Secure access/refresh tokens for MCP authentication
- **Single-user** - Restricted to a single authorized email (ALLOWED_EMAIL)
- **PKCE required** - OAuth 2.1 with S256 code challenge

See [SETUP.md](SETUP.md) for detailed setup instructions.

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

### 2. Create OAuth Credentials

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Google Drive MCP`
5. Leave redirect URIs empty for now (we'll add after deployment)
6. Copy the **Client ID** and **Client Secret**

### 3. Configure OAuth Consent Screen

1. Go to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. User Type: **External**
3. Fill in required fields
4. Add scopes: `drive`, `spreadsheets`, `documents`, `userinfo.email`
5. Add yourself as a test user

### 4. Store Secrets

```bash
export GCP_PROJECT="your-project-id"

# Store OAuth credentials
echo -n "YOUR_CLIENT_ID" | gcloud secrets create oauth-client-id --data-file=- --project=$GCP_PROJECT
echo -n "YOUR_CLIENT_SECRET" | gcloud secrets create oauth-client-secret --data-file=- --project=$GCP_PROJECT
uuidgen | tr -d '\n' | gcloud secrets create jwt-secret --data-file=- --project=$GCP_PROJECT
```

### 5. Deploy

```bash
export ALLOWED_EMAIL="your-email@gmail.com"
./deploy.sh
```

The script will output the function URL. Add this as the authorized redirect URI in your OAuth credentials:
```
https://YOUR-FUNCTION-URL/oauth/callback
```

### 6. Connect to Claude Web

1. Go to [claude.ai](https://claude.ai)
2. Settings → Integrations
3. Add MCP server with your Cloud Functions URL
4. Click Connect and authenticate with Google

## GitHub Actions Deployment

This repo includes automatic deployment via GitHub Actions on push to main.

Required secrets:
- `WIF_PROVIDER` - Workload Identity Federation provider
- `ALLOWED_EMAIL` - Authorized user email

See `.github/workflows/deploy.yml` for details.

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
- "Append today's meeting notes to my Project Doc"
- "Replace all occurrences of '2024' with '2025' in my annual report"
- "Add a bold heading called 'Introduction' to my blog post"
- "Insert a bulleted list of key takeaways"
- "Add a link to the source article"

## Security

- **OAuth2 with PKCE** - Secure authorization flow with S256 code challenge
- **Single-user authentication** - Only the configured ALLOWED_EMAIL can authenticate
- **JWT tokens** - Short-lived access tokens (1 hour), long-lived refresh tokens (30 days)
- **In-memory state** - No persistent storage of auth state (tokens stored only in memory)
- **Secret Manager** - OAuth credentials stored securely in Google Secret Manager
- **No credential storage** - Your Google password never touches the server

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Run locally (requires environment variables)
export BASE_URL="http://localhost:8080"
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
export ALLOWED_EMAIL="your-email@gmail.com"
npm start
```

## License

MIT
