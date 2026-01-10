import express from "express";
import { config } from "./config.js";
import { oauthRouter } from "./auth/oauth.js";
import { mcpRouter } from "./mcp/handler.js";
import { generateLandingPage } from "./landing.js";

// Import state to start cleanup interval
import "./auth/state.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth routes
app.use(oauthRouter);

// MCP protocol handler
app.use(mcpRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Landing page
app.get("/", (req, res) => {
  res.type("html").send(generateLandingPage());
});

// Export for Cloud Functions
export const googleDriveMcp = app;

// Start server only when running locally (not in Cloud Functions)
const isCloudFunction = process.env.K_SERVICE || process.env.FUNCTION_TARGET;
if (!isCloudFunction) {
  app.listen(config.port, () => {
    console.log(`Google Drive MCP Server running on port ${config.port}`);
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Allowed user: ${config.allowedEmail}`);
  });
}
