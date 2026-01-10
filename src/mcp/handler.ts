import { Router, Request, Response } from "express";
import { requireAuth, getGoogleCredentials } from "../auth/index.js";
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
      const googleCredentials = await getGoogleCredentials();
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
