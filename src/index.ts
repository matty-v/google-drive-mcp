import express, { Request, Response } from 'express';
import { PORT, BASE_URL } from './config.js';
import {
  discoveryRoutes,
  registrationRoutes,
  authorizeRoutes,
  callbackRoutes,
  tokenRoutes,
} from './oauth/index.js';
import { mcpHandler } from './mcp/handler.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(discoveryRoutes);
app.use(registrationRoutes);
app.use(authorizeRoutes);
app.use(callbackRoutes);
app.use(tokenRoutes);

// ============ MCP ENDPOINT ============

// Register MCP handler on both root and /mcp paths
app.post('/', mcpHandler);
app.post('/mcp', mcpHandler);

// ============ HEALTH CHECK ============

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============ START SERVER ============

app.listen(PORT, () => {
  console.log(`MCP Drive Server running on port ${PORT}`);
  console.log(`OAuth metadata: ${BASE_URL}/.well-known/oauth-authorization-server`);
});
