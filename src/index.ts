import express, { Request, Response } from 'express';
import { PORT } from './config.js';
import {
  discoveryRoutes,
  registrationRoutes,
  authorizeRoutes,
  callbackRoutes,
  tokenRoutes,
} from './oauth/index.js';
import { mcpHandler } from './mcp/index.js';
import { generateLandingPage } from './landing.js';

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

// Landing page
app.get('/', (_req: Request, res: Response) => {
  res.type('html').send(generateLandingPage());
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`MCP Drive Server running on port ${PORT}`);
});
