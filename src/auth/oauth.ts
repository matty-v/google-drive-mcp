import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import {
  pendingAuth,
  authCodes,
  registeredClients,
  setGoogleCredentials,
} from "./state.js";

const router = Router();

const googleOAuth = new OAuth2Client(
  config.googleClientId,
  config.googleClientSecret,
  `${config.baseUrl}/oauth/callback`
);

// OAuth 2.0 Protected Resource Metadata (RFC 9449)
router.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: config.baseUrl,
    authorization_servers: [config.baseUrl],
  });
});

// OAuth 2.1 Authorization Server Metadata
router.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: config.baseUrl,
    authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
    token_endpoint: `${config.baseUrl}/oauth/token`,
    registration_endpoint: `${config.baseUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

// OAuth 2.0 Dynamic Client Registration (RFC 7591)
router.post("/oauth/register", (req, res) => {
  const { client_name, redirect_uris } = req.body;

  const clientId = uuidv4();
  const clientSecret = uuidv4();

  registeredClients.set(clientId, {
    clientSecret,
    clientName: client_name || "Claude",
    redirectUris: redirect_uris || [],
    createdAt: Date.now(),
  });

  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: client_name || "Claude",
    redirect_uris: redirect_uris || [],
  });
});

// OAuth 2.1 Authorization Endpoint
router.get("/oauth/authorize", (req, res) => {
  const {
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    response_type,
  } = req.query;

  // Validate request
  if (response_type !== "code") {
    return res.status(400).json({ error: "unsupported_response_type" });
  }
  if (code_challenge_method !== "S256") {
    return res
      .status(400)
      .json({ error: "invalid_request", error_description: "S256 required" });
  }
  if (!state || !code_challenge || !redirect_uri) {
    return res.status(400).json({ error: "invalid_request" });
  }

  // Store pending auth
  pendingAuth.set(state as string, {
    codeChallenge: code_challenge as string,
    redirectUri: redirect_uri as string,
    createdAt: Date.now(),
  });

  // Redirect to Google OAuth
  const googleAuthUrl = googleOAuth.generateAuthUrl({
    access_type: "offline",
    scope: config.googleScopes,
    state: state as string,
    prompt: "consent",
  });

  res.redirect(googleAuthUrl);
});

// Google OAuth Callback
router.get("/oauth/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`OAuth error: ${error}`);
  }

  if (!state || !code) {
    return res.status(400).send("Missing state or code");
  }

  // Retrieve pending auth
  const pending = pendingAuth.get(state as string);
  if (!pending) {
    return res.status(400).send("Invalid or expired state");
  }

  try {
    // Exchange code for Google tokens
    const { tokens } = await googleOAuth.getToken(code as string);

    // Get user info
    const ticket = await googleOAuth.verifyIdToken({
      idToken: tokens.id_token!,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();
    const email = payload?.email;

    // Check if this is the allowed user
    if (email !== config.allowedEmail) {
      console.log(`Rejected login attempt from: ${email}`);
      return res
        .status(403)
        .send(`Access denied. Only ${config.allowedEmail} can use this server.`);
    }

    console.log(`Successful login: ${email}`);

    // Store Google credentials for API calls
    if (tokens.refresh_token) {
      setGoogleCredentials({
        refreshToken: tokens.refresh_token,
        email: email!,
      });
    }

    // Generate auth code for Claude
    const authCode = uuidv4();
    authCodes.set(authCode, { createdAt: Date.now() });

    // Clean up pending auth
    pendingAuth.delete(state as string);

    // Redirect back to Claude with auth code
    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set("code", authCode);
    redirectUrl.searchParams.set("state", state as string);

    res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).send("Authentication failed");
  }
});

// OAuth 2.1 Token Endpoint
router.post("/oauth/token", (req, res) => {
  const { grant_type, code, refresh_token } = req.body;

  if (grant_type === "authorization_code") {
    // Validate auth code
    if (!code || !authCodes.has(code)) {
      return res.status(400).json({ error: "invalid_grant" });
    }

    // Consume the code
    authCodes.delete(code);

    // Issue tokens
    const accessToken = jwt.sign(
      { type: "access", email: config.allowedEmail },
      config.jwtSecret,
      { expiresIn: "1h" }
    );
    const refreshToken = jwt.sign(
      { type: "refresh", email: config.allowedEmail },
      config.jwtSecret,
      { expiresIn: "30d" }
    );

    return res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
    });
  }

  if (grant_type === "refresh_token") {
    // Validate refresh token
    try {
      const decoded = jwt.verify(refresh_token, config.jwtSecret) as any;
      if (decoded.type !== "refresh") {
        return res.status(400).json({ error: "invalid_grant" });
      }

      // Issue new access token
      const accessToken = jwt.sign(
        { type: "access", email: config.allowedEmail },
        config.jwtSecret,
        { expiresIn: "1h" }
      );

      return res.json({
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
      });
    } catch {
      return res.status(400).json({ error: "invalid_grant" });
    }
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

export const oauthRouter = router;
