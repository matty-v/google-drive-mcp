import { Router, Request, Response } from 'express';
import { firestore, GOOGLE_SCOPES } from '../config.js';
import { getGoogleOAuthClient, generateSecureToken } from './helpers.js';

export const authorizeRoutes = Router();

authorizeRoutes.get('/authorize', async (req: Request, res: Response) => {
  try {
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      response_type,
    } = req.query as Record<string, string>;

    // Validate required params
    if (!client_id || !redirect_uri || !code_challenge || response_type !== 'code') {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }

    // Verify client exists
    const clientDoc = await firestore.doc(`oauth-clients/${client_id}`).get();
    if (!clientDoc.exists) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }

    // Verify redirect URI is registered
    const clientData = clientDoc.data()!;
    if (!clientData.redirect_uris?.includes(redirect_uri)) {
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    // Store OAuth session
    const sessionId = generateSecureToken();
    await firestore.doc(`oauth-sessions/${sessionId}`).set({
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method: code_challenge_method || 'S256',
      created_at: new Date(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 min
    });

    // Redirect to Google OAuth for Drive permissions
    const googleOAuth = await getGoogleOAuthClient();
    const googleAuthUrl = googleOAuth.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent',
      state: sessionId,
    });

    res.redirect(googleAuthUrl);
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});
