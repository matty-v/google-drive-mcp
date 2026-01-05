import { Request, Response } from 'express';
import { firestore } from '../config.js';
import { toolDefinitions, toolsByName } from './tools/index.js';

async function validateAccessToken(authHeader: string | undefined): Promise<{
  valid: boolean;
  googleRefreshToken?: string;
  userEmail?: string;
  error?: string;
}> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid Authorization header' };
  }

  const accessToken = authHeader.slice(7);
  const tokenDoc = await firestore.doc(`access-tokens/${accessToken}`).get();

  if (!tokenDoc.exists) {
    return { valid: false, error: 'Invalid access token' };
  }

  const tokenData = tokenDoc.data()!;

  if (new Date() > tokenData.expires_at.toDate()) {
    return { valid: false, error: 'Access token expired' };
  }

  return {
    valid: true,
    googleRefreshToken: tokenData.google_refresh_token,
    userEmail: tokenData.user_email,
  };
}

export async function mcpHandler(req: Request, res: Response) {
  console.log('MCP Request:', JSON.stringify(req.body));

  const { method, params, id } = req.body;

  // Handle notifications (no id) - these don't require auth and don't return responses
  if (id === undefined || id === null) {
    console.log('Notification received:', method);
    // For notifications, just acknowledge with 200 OK and empty response
    res.status(200).end();
    return;
  }

  const tokenValidation = await validateAccessToken(req.headers.authorization);

  if (!tokenValidation.valid) {
    console.log('Token validation failed:', tokenValidation.error);
    res.status(401).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32001, message: tokenValidation.error },
    });
    return;
  }

  try {
    const response = await handleMcpMethod(
      method,
      params,
      id,
      tokenValidation.googleRefreshToken!,
      tokenValidation.userEmail!
    );
    console.log('MCP Response:', JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error('MCP error:', error);
    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: 'Internal error' },
    });
  }
}

async function handleMcpMethod(
  method: string,
  params: any,
  id: string | number,
  googleRefreshToken: string,
  userEmail: string
) {
  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'google-drive-mcp', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      };

    case 'tools/list': {
      // Inject userEmail into list_drive_files description dynamically
      const toolsWithEmail = toolDefinitions.map((t) => {
        if (t.name === 'list_drive_files') {
          return {
            ...t,
            description: `List files in your Google Drive (${userEmail}). Returns file names, types, and modification dates.`,
          };
        }
        return t;
      });
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: toolsWithEmail },
      };
    }

    case 'tools/call': {
      const { name, arguments: args } = params;
      console.log(`Tool call: ${name}`, JSON.stringify(args));

      const tool = toolsByName.get(name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true },
        };
      }

      try {
        const result = await tool.handler(args, googleRefreshToken);
        return { jsonrpc: '2.0', id, result };
      } catch (error: any) {
        console.error(`Tool ${name} error:`, error);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Error executing ${name}: ${error.message}` }], isError: true },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}
