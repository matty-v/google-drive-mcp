# Modular Architecture Design

## Goal

Refactor the 1,800-line single-file server into a modular structure to improve:
- **Navigation** - Find tools and handlers quickly
- **Extensibility** - Add new tools without growing a monolithic file
- **Testability** - Test pieces in isolation

## Directory Structure

```
src/
  index.ts              # Express app, route wiring, server startup (~50 lines)
  config.ts             # Constants, Firestore instance, Secrets client (~40 lines)

  oauth/
    index.ts            # Re-exports all OAuth handlers
    discovery.ts        # /.well-known/oauth-* endpoints
    registration.ts     # POST /register - dynamic client registration
    authorize.ts        # GET /authorize - starts OAuth flow
    callback.ts         # GET /google/callback - handles Google's response
    token.ts            # POST /token - code/refresh token exchange
    helpers.ts          # getGoogleOAuthClient, generateSecureToken, hashCodeVerifier

  mcp/
    index.ts            # Re-exports handler
    handler.ts          # JSON-RPC dispatcher, routes to tools
    types.ts            # Shared MCP types (ToolResult, etc.)
    tools/
      index.ts          # Tool registry - maps tool names to handlers
      drive.ts          # list_drive_files, get_file_info, search_drive,
                        # create_folder, create_file, read_file, move_file, rename_file
      docs.ts           # append_to_doc, find_replace_in_doc, insert_text,
                        # set_heading, insert_image, insert_link, insert_list
      sheets.ts         # create_sheet
```

## Key Patterns

### Thin Orchestrator (index.ts)

```typescript
import express from 'express';
import { PORT } from './config';
import { discoveryRoutes } from './oauth/discovery';
import { registrationRoutes } from './oauth/registration';
import { authorizeRoutes } from './oauth/authorize';
import { callbackRoutes } from './oauth/callback';
import { tokenRoutes } from './oauth/token';
import { mcpHandler } from './mcp/handler';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth routes
app.use(discoveryRoutes);
app.use(registrationRoutes);
app.use(authorizeRoutes);
app.use(callbackRoutes);
app.use(tokenRoutes);

// MCP routes
app.post('/', mcpHandler);
app.post('/mcp', mcpHandler);

// Health check
app.get('/health', (_req, res) => res.send('OK'));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### Tool Registry

```typescript
// src/mcp/tools/index.ts
import { driveTools } from './drive';
import { docsTools } from './docs';
import { sheetsTools } from './sheets';

export interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: any, authClient: OAuth2Client) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const tools: Tool[] = [
  ...driveTools,
  ...docsTools,
  ...sheetsTools,
];

export const toolsByName = new Map(tools.map(t => [t.name, t]));
```

### Tool Definition

```typescript
// src/mcp/tools/drive.ts
import { Tool } from './index';

export const driveTools: Tool[] = [
  {
    name: 'list_drive_files',
    description: 'List files in Google Drive',
    inputSchema: { /* ... */ },
    handler: async (args, authClient) => {
      const drive = google.drive({ version: 'v3', auth: authClient });
      // ... implementation
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  },
  // ... more tools
];
```

### MCP Dispatcher

```typescript
// src/mcp/handler.ts
export async function mcpHandler(req: Request, res: Response) {
  const { method, params, id } = req.body;

  try {
    switch (method) {
      case 'initialize':
        return res.json({ jsonrpc: '2.0', id, result: { /* ... */ } });

      case 'tools/list':
        return res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }
        });

      case 'tools/call':
        const tool = toolsByName.get(params.name);
        if (!tool) return res.json({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool` } });

        const authClient = await getGoogleAuthClient(req);
        const result = await tool.handler(params.arguments, authClient);
        return res.json({ jsonrpc: '2.0', id, result });

      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
  } catch (error) {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } });
  }
}
```

### OAuth Route Module

```typescript
// src/oauth/authorize.ts
import { Router } from 'express';
import { firestore, GOOGLE_SCOPES } from '../config';
import { getGoogleOAuthClient, generateSecureToken } from './helpers';

export const authorizeRoutes = Router();

authorizeRoutes.get('/authorize', async (req, res) => {
  // ... implementation using imported helpers
});
```

## Error Handling

Tools return consistent `ToolResult`:
- Success: `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`
- Error: `{ content: [{ type: 'text', text: 'Error: ...' }], isError: true }`

The dispatcher catches unhandled exceptions and converts to JSON-RPC errors.

## Testing

Structure enables isolated testing:

```typescript
// Test a tool directly
import { driveTools } from './mcp/tools/drive';
const listTool = driveTools.find(t => t.name === 'list_drive_files');
const result = await listTool.handler({ folderId: 'root' }, mockAuthClient);

// Test OAuth routes
import { authorizeRoutes } from './oauth/authorize';
const app = express().use(authorizeRoutes);
const res = await request(app).get('/authorize?client_id=...');
```

## Migration Strategy

1. Create new file structure
2. Extract config.ts first (no dependencies)
3. Extract oauth/helpers.ts (depends only on config)
4. Extract OAuth routes one at a time
5. Extract MCP types and tool registry
6. Extract tools by domain (drive, docs, sheets)
7. Extract MCP handler
8. Slim down index.ts to orchestrator
9. Verify build passes at each step
10. Deploy and test
