import { Router, Request, Response } from 'express';
import { firestore } from '../config.js';
import { generateSecureToken, hashCodeVerifier } from './helpers.js';

export const tokenRoutes = Router();

tokenRoutes.post('/token', async (req: Request, res: Response) => {
  try {
    const { grant_type, code, code_verifier, refresh_token, client_id, client_secret } = req.body;

    const clientDoc = await firestore.doc(`oauth-clients/${client_id}`).get();
    if (!clientDoc.exists || clientDoc.data()?.client_secret !== client_secret) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    if (grant_type === 'authorization_code') {
      const codeDoc = await firestore.doc(`auth-codes/${code}`).get();
      if (!codeDoc.exists) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid authorization code' });
        return;
      }
      const codeData = codeDoc.data()!;

      if (new Date() > codeData.expires_at.toDate()) {
        await firestore.doc(`auth-codes/${code}`).delete();
        res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
        return;
      }

      if (!code_verifier) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Missing code_verifier' });
        return;
      }

      const expectedChallenge = hashCodeVerifier(code_verifier);
      if (expectedChallenge !== codeData.code_challenge) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid code_verifier' });
        return;
      }

      const accessToken = generateSecureToken();
      const mcpRefreshToken = generateSecureToken();

      await firestore.doc(`access-tokens/${accessToken}`).set({
        google_refresh_token: codeData.google_refresh_token,
        user_email: codeData.user_email,
        client_id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      });

      await firestore.doc(`refresh-tokens/${mcpRefreshToken}`).set({
        google_refresh_token: codeData.google_refresh_token,
        user_email: codeData.user_email,
        client_id,
        created_at: new Date(),
      });

      await firestore.doc(`auth-codes/${code}`).delete();

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: mcpRefreshToken,
      });
    } else if (grant_type === 'refresh_token') {
      const rtDoc = await firestore.doc(`refresh-tokens/${refresh_token}`).get();
      if (!rtDoc.exists) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
        return;
      }
      const rtData = rtDoc.data()!;

      const newAccessToken = generateSecureToken();

      await firestore.doc(`access-tokens/${newAccessToken}`).set({
        google_refresh_token: rtData.google_refresh_token,
        user_email: rtData.user_email,
        client_id,
        created_at: new Date(),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      });

      res.json({
        access_token: newAccessToken,
        token_type: 'Bearer',
        expires_in: 3600,
      });
    } else {
      res.status(400).json({ error: 'unsupported_grant_type' });
    }
  } catch (error) {
    console.error('Token error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});
