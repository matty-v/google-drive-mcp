import { Router, Request, Response } from 'express';
import { google } from 'googleapis';
import { firestore } from '../config.js';
import { getGoogleOAuthClient, generateSecureToken } from './helpers.js';

export const callbackRoutes = Router();

callbackRoutes.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: sessionId, error } = req.query as Record<string, string>;

    if (error) {
      res.status(400).send(`Google OAuth error: ${error}`);
      return;
    }

    if (!code || !sessionId) {
      res.status(400).send('Missing code or session');
      return;
    }

    const sessionDoc = await firestore.doc(`oauth-sessions/${sessionId}`).get();
    if (!sessionDoc.exists) {
      res.status(400).send('Invalid or expired session');
      return;
    }
    const session = sessionDoc.data()!;

    if (new Date() > session.expires_at.toDate()) {
      res.status(400).send('Session expired');
      return;
    }

    const googleOAuth = await getGoogleOAuthClient();
    const { tokens } = await googleOAuth.getToken(code);

    if (!tokens.refresh_token) {
      res.status(400).send(
        'No refresh token received. Please revoke access at https://myaccount.google.com/permissions and try again.'
      );
      return;
    }

    googleOAuth.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: googleOAuth });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email;

    const authCode = generateSecureToken();

    await firestore.doc(`auth-codes/${authCode}`).set({
      google_refresh_token: tokens.refresh_token,
      google_access_token: tokens.access_token,
      user_email: userEmail,
      client_id: session.client_id,
      code_challenge: session.code_challenge,
      code_challenge_method: session.code_challenge_method,
      redirect_uri: session.redirect_uri,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
    });

    await firestore.doc(`oauth-sessions/${sessionId}`).delete();

    const redirectUrl = new URL(session.redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (session.state) {
      redirectUrl.searchParams.set('state', session.state);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Google callback error:', error);
    res.status(500).send('Authentication failed');
  }
});
